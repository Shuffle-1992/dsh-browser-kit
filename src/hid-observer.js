/**
 * dsh-browser-kit — hid-observer.js（L1 通用设备观测，SDK 无关）
 *
 * 自包含 IIFE：可用 Electron executeJavaScript / CDP Page.addScriptToEvaluateOnNewDocument
 * 注入任意页面。hook 在平台 API 边界（navigator.hid / serial / usb），不感知任何上层 SDK。
 *
 * 暴露契约（任务书 §3.1，钉死）：
 *   window.__hidLog = { version, entries(只读视图), dump(opts?), export(), clear(),
 *                       filter(opts), registerDecoder(name, fn), config({max?, consoleChannel?}) }
 *   window.__dshKitHidObserver = { detach() }      —— 撤销全部 patch，恢复原生
 *   window.__DSH_KIT_OBSERVER_VERSION = "1"        —— 防重注入标记
 *
 * Entry = { seq, t(ISO), dir:'TX'|'RX'|'OPEN'|'CLOSE'|'EVENT',
 *           api:'hid'|'serial'|'usb', device:{vendorId, productId, serialNumber?}|null,
 *           reportId?, bytes(Uint8Array 拷贝), hex, ascii, len, op?, note? }
 *
 * 手法（调研文档 §5.5）：代理 navigator.hid/serial/usb 的 getter（惰性 patch，首次访问才装
 * prototype wrap 与镜像监听）+ wrap 对应 prototype 方法；inputreport / data / connect /
 * disconnect 采用镜像监听（DOM 事件多播，不消费、不干扰页面自身监听）。
 *
 * 局限（如实声明）：
 *   - Web Serial 的标准 RX 走 readable 流（getReader().read()），无 DOM 事件可镜像；
 *     只做 `data` 事件镜像 best-effort（SDK/页面自行派发 data 事件时可被观测）。
 *   - 页面若在 observer 评估之后用 defineProperty 顶层替换 navigator.hid，则对该新对象的
 *     观测依赖 dump()/export() 的强制 ensure 或对象原型继承自原生类。
 *
 * 归属：dsh-browser-kit 原创实现（规格：调研文档 §5.5、任务书 §3.1），未复制 ZCode 代码。
 */
(function () {
  "use strict";
  if (typeof window === "undefined") {
    return;
  }

  var VERSION = "1";
  var DEFAULT_MAX = 500;
  var HEX_PREVIEW_BYTES = 32;
  var API_NAMES = ["hid", "serial", "usb"];

  // 防重注入：已有实例先干净 detach（还原原生），再装新实例。
  if (window.__DSH_KIT_OBSERVER_VERSION) {
    try {
      if (window.__dshKitHidObserver && typeof window.__dshKitHidObserver.detach === "function") {
        window.__dshKitHidObserver.detach();
      }
    } catch (_) {
      /* 旧实例 detach 失败不阻塞新实例 */
    }
  }

  // ---------------------------------------------------------------- 状态

  var seqCounter = 0;
  var maxEntries = DEFAULT_MAX;
  var consoleChannel = "debug"; // 'debug' | 'off'
  var entries = [];
  var decoders = new Map(); // name -> fn(entry) => {op, note?} | null

  var wrappedRecords = []; // { owner, key, descriptor }（descriptor 为被替换前的原始描述符）
  var wrappedFns = new WeakSet(); // 已包过的原函数，防同函数重复包
  var mirrorRecords = []; // { target, type, handler }
  var acquiredDevices = new WeakSet(); // 已挂镜像监听的设备实例

  var apiStates = {}; // api -> { available, ownDescriptor|null, protoDescriptor, installed, attached, backingValue }

  // ---------------------------------------------------------------- 小工具（全部鸭子类型，不跨 realm instanceof）

  function toBytes(data) {
    if (data == null) {
      return null;
    }
    try {
      if (typeof data === "string") {
        return new TextEncoder().encode(data);
      }
      if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      }
      if (typeof data.byteLength === "number" && typeof data.slice === "function") {
        return new Uint8Array(data.slice(0)); // ArrayBuffer（跨 realm 不用 instanceof）
      }
      return Uint8Array.from(data); // 数组 / 可迭代
    } catch (_) {
      return null;
    }
  }

  function toHex(bytes) {
    if (!bytes) {
      return undefined;
    }
    var parts = new Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) {
      parts[i] = bytes[i].toString(16).padStart(2, "0");
    }
    return parts.join(" ");
  }

  function toAscii(bytes) {
    if (!bytes) {
      return undefined;
    }
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      out += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
    }
    return out;
  }

  function previewHex(bytes, maxBytes) {
    if (!bytes || bytes.length === 0) {
      return "";
    }
    var head = bytes.length <= maxBytes ? bytes : bytes.slice(0, maxBytes);
    var text = toHex(head);
    return bytes.length <= maxBytes ? text : text + " ... +" + (bytes.length - maxBytes) + "B";
  }

  function toReportId(value) {
    var n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 0xff ? n : undefined;
  }

  function toEpochMs(value) {
    if (value == null) {
      return null;
    }
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      var parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  function describeDevice(dev, api) {
    if (!dev || (typeof dev !== "object" && typeof dev !== "function")) {
      return null;
    }
    var out = {};
    if (typeof dev.vendorId === "number") {
      out.vendorId = dev.vendorId;
    }
    if (typeof dev.productId === "number") {
      out.productId = dev.productId;
    }
    if (typeof dev.serialNumber === "string" && dev.serialNumber) {
      out.serialNumber = dev.serialNumber;
    }
    if (api === "serial" && typeof dev.getInfo === "function") {
      try {
        var info = dev.getInfo();
        if (info) {
          if (typeof info.usbVendorId === "number") {
            out.vendorId = info.usbVendorId;
          }
          if (typeof info.usbProductId === "number") {
            out.productId = info.usbProductId;
          }
        }
      } catch (_) {
        /* getInfo 失败不阻塞记录 */
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  function joinNote(existing, addition) {
    if (!addition) {
      return existing;
    }
    return existing ? existing + "; " + addition : addition;
  }

  // ---------------------------------------------------------------- 记录核心

  function applyDecoders(entry) {
    if (decoders.size === 0) {
      return;
    }
    decoders.forEach(function (fn) {
      if (typeof fn !== "function") {
        return;
      }
      var hit = null;
      try {
        hit = fn(entry);
      } catch (_) {
        return; // 解码器异常不得影响记录
      }
      if (hit && typeof hit === "object") {
        if (!entry.op && typeof hit.op === "string") {
          entry.op = hit.op;
        }
        if (hit.note) {
          entry.note = joinNote(entry.note, String(hit.note));
        }
      }
    });
  }

  function record(fields) {
    var entry = {
      seq: ++seqCounter,
      t: new Date().toISOString(),
      dir: fields.dir,
      api: fields.api,
      device: fields.device !== undefined ? fields.device : null,
    };
    if (fields.reportId !== undefined) {
      entry.reportId = fields.reportId;
    }
    if (fields.note) {
      entry.note = fields.note;
    }
    if (fields.op) {
      entry.op = fields.op;
    }

    var bytes = toBytes(fields.bytes);
    if (bytes && bytes.length > 0) {
      entry.bytes = bytes;
      entry.hex = toHex(bytes);
      entry.ascii = toAscii(bytes);
      entry.len = bytes.length;
    }

    applyDecoders(entry);
    entries.push(entry);
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }
    emitConsole(entry);
    return entry;
  }

  function emitConsole(entry) {
    if (consoleChannel !== "debug") {
      return;
    }
    var parts = ["[HID]", "[" + entry.dir + "]", entry.api];
    if (entry.reportId !== undefined) {
      parts.push("reportId=0x" + entry.reportId.toString(16).padStart(2, "0"));
    }
    if (entry.hex) {
      parts.push(previewHex(entry.bytes, HEX_PREVIEW_BYTES));
    }
    if (entry.op) {
      parts.push("op=" + entry.op);
    }
    try {
      console.debug(parts.join(" "));
    } catch (_) {
      /* console 不可用不影响记录 */
    }
  }

  // ---------------------------------------------------------------- wrap / mirror 基建

  function wrapFunction(owner, key, makeWrapper) {
    if (!owner || (typeof owner !== "object" && typeof owner !== "function")) {
      return false;
    }
    var descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(owner, key);
    } catch (_) {
      return false;
    }
    if (!descriptor || typeof descriptor.value !== "function" || !descriptor.configurable) {
      return false;
    }
    var original = descriptor.value;
    // 双重防重：WeakSet 管本 realm；标记属性跨 realm 可读（同一函数以不同代理身份再进来时跳过）
    if (wrappedFns.has(original) || original.__dshKitWrappedByObserver === true) {
      return true;
    }
    var replacement;
    try {
      replacement = makeWrapper(original);
    } catch (_) {
      return false;
    }
    try {
      Object.defineProperty(owner, key, {
        value: replacement,
        writable: true,
        enumerable: descriptor.enumerable,
        configurable: true,
      });
    } catch (_) {
      return false;
    }
    Object.defineProperty(replacement, "__dshKitWrappedByObserver", { value: true });
    wrappedFns.add(original);
    wrappedRecords.push({ owner: owner, key: key, descriptor: descriptor });
    return true;
  }

  function mirrorEvent(target, type, handler) {
    if (!target || typeof target.addEventListener !== "function") {
      return;
    }
    // 同实例内按 target+type 去重（跨 realm 代理身份不稳时 WeakSet 不可靠）
    if (mirrorRecords.some((rec) => rec.target === target && rec.type === type)) {
      return;
    }
    try {
      target.addEventListener(type, handler);
    } catch (_) {
      return;
    }
    mirrorRecords.push({ target: target, type: type, handler: handler });
  }

  /** 采集设备实例：wrap 其原型方法 + 挂镜像监听（每实例幂等：WeakSet + 镜像去重）。 */
  function acquireDevice(dev, api) {
    if (!dev || (typeof dev !== "object" && typeof dev !== "function") || acquiredDevices.has(dev)) {
      return;
    }
    acquiredDevices.add(dev);

    var proto = Object.getPrototypeOf(dev);
    var descriptor = describeDevice(dev, api);

    if (api === "hid") {
      wrapFunction(proto, "sendReport", makeTxWrapper("hid", descriptor));
      wrapFunction(proto, "open", makeLifecycleWrapper("hid", descriptor, "OPEN"));
      wrapFunction(proto, "close", makeLifecycleWrapper("hid", descriptor, "CLOSE"));
      mirrorEvent(dev, "inputreport", function (event) {
        record({
          dir: "RX",
          api: "hid",
          device: describeDevice(dev, "hid"),
          reportId: toReportId(event.reportId),
          bytes: event.data,
        });
      });
      wrapOnEventSetter(proto, "oninputreport", dev, "hid");
    } else if (api === "serial") {
      wrapFunction(proto, "write", makeTxWrapper("serial", descriptor));
      wrapFunction(proto, "open", makeLifecycleWrapper("serial", descriptor, "OPEN"));
      wrapFunction(proto, "close", makeLifecycleWrapper("serial", descriptor, "CLOSE"));
      // 局限：标准 Web Serial RX 走 readable 流，无事件可镜像；仅镜像 SDK/页面自派的 data 事件（best-effort）。
      mirrorEvent(dev, "data", function (event) {
        var payload = event.data !== undefined ? event.data : event.detail;
        record({ dir: "RX", api: "serial", device: describeDevice(dev, "serial"), bytes: payload, note: "mirrored data event (best-effort)" });
      });
    } else if (api === "usb") {
      wrapFunction(proto, "transferOut", makeUsbOutWrapper(descriptor, false));
      wrapFunction(proto, "controlTransferOut", makeUsbOutWrapper(descriptor, true));
      wrapFunction(proto, "transferIn", makeUsbInWrapper(descriptor, false));
      wrapFunction(proto, "controlTransferIn", makeUsbInWrapper(descriptor, true));
      wrapFunction(proto, "open", makeLifecycleWrapper("usb", descriptor, "OPEN"));
      wrapFunction(proto, "close", makeLifecycleWrapper("usb", descriptor, "CLOSE"));
    }
  }

  /** `on<event>` 属性 setter 兜底：页面用属性赋值挂监听时，借机捕获晚于注入出现的设备实例。 */
  function wrapOnEventSetter(proto, key, dev, api) {
    if (!proto) {
      return;
    }
    var descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(proto, key);
    } catch (_) {
      return;
    }
    if (!descriptor || !descriptor.configurable || typeof descriptor.set !== "function") {
      return;
    }
    try {
      Object.defineProperty(proto, key, {
        get: descriptor.get,
        set: function (value) {
          acquireDevice(dev, api); // 任何 oninputreport 赋值都触发一次镜像补挂
          return descriptor.set.call(this, value);
        },
        enumerable: descriptor.enumerable,
        configurable: true,
      });
    } catch (_) {
      /* 包装失败不影响主路径 */
    }
  }

  function makeTxWrapper(api, deviceFromClosure) {
    return function (original) {
      return function (a, b, c) {
        // hid: sendReport(reportId, data)；serial: write(chunk, ...)
        var self = this;
        var liveDevice = describeDevice(self, api) || deviceFromClosure;
        var entry;
        if (api === "hid") {
          entry = record({ dir: "TX", api: api, device: liveDevice, reportId: toReportId(a), bytes: b });
        } else {
          entry = record({ dir: "TX", api: api, device: liveDevice, bytes: a });
        }
        try {
          var result = original.call(this, a, b, c);
          if (result && typeof result.then === "function") {
            return result.then(
              function (value) {
                return value;
              },
              function (error) {
                if (entry) {
                  entry.note = joinNote(entry.note, "error: " + safeMessage(error));
                }
                throw error;
              },
            );
          }
          return result;
        } catch (error) {
          if (entry) {
            entry.note = joinNote(entry.note, "error: " + safeMessage(error));
          }
          throw error;
        }
      };
    };
  }

  function makeLifecycleWrapper(api, deviceFromClosure, dir) {
    return function (original) {
      return function (a, b) {
        var self = this;
        var entry = record({
          dir: dir,
          api: api,
          device: describeDevice(self, api) || deviceFromClosure,
        });
        try {
          var result = original.call(this, a, b);
          if (result && typeof result.then === "function") {
            return result.then(undefined, function (error) {
              entry.note = joinNote(entry.note, "error: " + safeMessage(error));
              throw error;
            });
          }
          return result;
        } catch (error) {
          entry.note = joinNote(entry.note, "error: " + safeMessage(error));
          throw error;
        }
      };
    };
  }

  var USB_REQUEST_TYPES = { standard: 0, class: 1, vendor: 2, reserved: 3 };
  var USB_RECIPIENTS = { device: 0, interface: 1, endpoint: 2, other: 3 };

  function usbEnumValue(value, table) {
    if (typeof value === "string") {
      var mapped = table[value.toLowerCase()];
      return mapped === undefined ? undefined : mapped;
    }
    var n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  function formatControlSetup(request) {
    if (!request || typeof request !== "object") {
      return null;
    }
    var toHexBits = function (v, bits) {
      var n = v === undefined ? 0 : v;
      return "0x" + (n & ((1 << bits) - 1)).toString(16).padStart(bits === 8 ? 2 : 4, "0");
    };
    var type = usbEnumValue(request.requestType, USB_REQUEST_TYPES);
    var recipient = usbEnumValue(request.recipient, USB_RECIPIENTS);
    return (
      "ctrl type=" + (type === undefined ? "?" : toHexBits(type, 8)) +
      " recipient=" + (recipient === undefined ? "?" : toHexBits(recipient, 8)) +
      " request=" + toHexBits(Number(request.request), 8) +
      " value=" + toHexBits(Number(request.value), 16) +
      " index=" + toHexBits(Number(request.index), 16)
    );
  }

  /** USB OUT 传输：调用即记 TX（transferOut(request,data) / controlTransferOut(request, data?) —— data 均为第 2 参）。 */
  function makeUsbOutWrapper(deviceFromClosure, isControl) {
    return function (original) {
      return function (a, b) {
        var self = this;
        var liveDevice = describeDevice(self, "usb") || deviceFromClosure;
        var entry = record({
          dir: "TX",
          api: "usb",
          device: liveDevice,
          bytes: b,
          note: isControl ? formatControlSetup(a) : undefined,
        });
        try {
          var result = original.call(this, a, b);
          if (result && typeof result.then === "function") {
            return result.then(undefined, function (error) {
              entry.note = joinNote(entry.note, "error: " + safeMessage(error));
              throw error;
            });
          }
          return result;
        } catch (error) {
          entry.note = joinNote(entry.note, "error: " + safeMessage(error));
          throw error;
        }
      };
    };
  }

  /** USB IN 传输：resolve 后记 RX（拿到实际返回字节）；reject 记 RX 空帧 + error note。 */
  function makeUsbInWrapper(deviceFromClosure, isControl) {
    return function (original) {
      return function (a, b) {
        // transferIn(endpoint, length) / controlTransferIn(request, length)
        var self = this;
        var liveDevice = describeDevice(self, "usb") || deviceFromClosure;
        var note = isControl ? formatControlSetup(a) : undefined;
        var result;
        try {
          result = original.call(this, a, b);
        } catch (error) {
          record({ dir: "RX", api: "usb", device: liveDevice, note: joinNote(note, "error: " + safeMessage(error)) });
          throw error;
        }
        if (!result || typeof result.then !== "function") {
          return result;
        }
        return result.then(
          function (value) {
            record({
              dir: "RX",
              api: "usb",
              device: liveDevice,
              bytes: value && value.data,
              note: joinNote(note, value && value.status ? "status=" + value.status : undefined),
            });
            return value;
          },
          function (error) {
            record({ dir: "RX", api: "usb", device: liveDevice, note: joinNote(note, "error: " + safeMessage(error)) });
            throw error;
          },
        );
      };
    };
  }

  function safeMessage(error) {
    try {
      return String((error && error.message) || error);
    } catch (_) {
      return "unknown error";
    }
  }

  /** 采集类调用（getDevices / requestDevice / getPorts）：记 EVENT + 顺带采集返回的设备。 */
  function makeAcquisitionWrapper(api, plural, op) {
    return function (original) {
      return function (a, b) {
        record({ dir: "EVENT", api: api, op: op });
        try {
          var result = original.call(this, a, b);
          if (result && typeof result.then === "function") {
            return result.then(
              function (value) {
                forEachDevice(value, plural, function (dev) {
                  acquireDevice(dev, api);
                });
                return value;
              },
              function (error) {
                record({ dir: "EVENT", api: api, op: op + " failed", note: "error: " + safeMessage(error) });
                throw error;
              },
            );
          }
          forEachDevice(result, plural, function (dev) {
            acquireDevice(dev, api);
          });
          return result;
        } catch (error) {
          record({ dir: "EVENT", api: api, op: op + " failed", note: "error: " + safeMessage(error) });
          throw error;
        }
      };
    };
  }

  function forEachDevice(value, plural, fn) {
    if (!value) {
      return;
    }
    if (plural) {
      if (typeof value.forEach === "function") {
        value.forEach(fn);
      }
      return;
    }
    fn(value);
  }

  // ---------------------------------------------------------------- navigator getter 代理

  function findDescriptor(navigator, key) {
    var cursor = navigator;
    for (var hop = 0; cursor && hop < 5; hop++) {
      var own = Object.getOwnPropertyDescriptor(cursor, key);
      if (own) {
        return own;
      }
      cursor = Object.getPrototypeOf(cursor);
    }
    return null;
  }

  function installNavigatorGetter(api, state) {
    var descriptor = {
      configurable: true,
      enumerable: true,
      get: function () {
        ensureApiAttached(api);
        return resolveValue(api, state);
      },
    };
    // 原本是可写数据属性（如页面先 defineProperty 伪造）时保留可写性，行为贴近原生
    if (state.ownDescriptor && "value" in state.ownDescriptor && state.ownDescriptor.writable) {
      descriptor.set = function (value) {
        state.backingValue = value;
      };
    }
    Object.defineProperty(navigator, api, descriptor);
    state.installed = true;
  }

  function resolveValue(api, state) {
    if (state.backingValue !== undefined) {
      return state.backingValue;
    }
    if (state.ownDescriptor) {
      if (typeof state.ownDescriptor.get === "function") {
        return state.ownDescriptor.get.call(navigator);
      }
      return state.ownDescriptor.value;
    }
    if (state.protoDescriptor && typeof state.protoDescriptor.get === "function") {
      return state.protoDescriptor.get.call(navigator);
    }
    return undefined;
  }

  function ensureApiAttached(api) {
    var state = apiStates[api];
    if (!state || !state.available || state.attached) {
      return;
    }
    var value = resolveValue(api, state);
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return; // 尚无可观测对象，下次访问再试
    }
    state.attached = true;
    attachApi(api, value);
  }

  function ensureAllAttached() {
    API_NAMES.forEach(function (api) {
      ensureApiAttached(api);
    });
  }

  function attachApi(api, value) {
    var proto = Object.getPrototypeOf(value) || value;
    // HID/USB 的连接事件载体是 event.device，Web Serial 是 event.port
    var eventDeviceKey = api === "serial" ? "port" : "device";

    // connect / disconnect 事件镜像（三类 API 同构）
    mirrorEvent(value, "connect", function (event) {
      var dev = event[eventDeviceKey];
      if (dev) {
        acquireDevice(dev, api);
      }
      record({ dir: "EVENT", api: api, op: "connect", device: describeDevice(dev, api) });
    });
    mirrorEvent(value, "disconnect", function (event) {
      record({ dir: "EVENT", api: api, op: "disconnect", device: describeDevice(event[eventDeviceKey], api) });
    });

    // 采集类调用
    if (api === "hid") {
      wrapFunction(proto, "requestDevice", makeAcquisitionWrapper("hid", false, "requestDevice"));
      wrapFunction(proto, "getDevices", makeAcquisitionWrapper("hid", true, "getDevices"));
      // 真实 Chrome 全局类存在时先包 prototype（覆盖注入前已持有的设备实例）
      if (typeof window.HIDDevice === "function") {
        wrapFunction(window.HIDDevice.prototype, "sendReport", makeTxWrapper("hid", null));
        wrapFunction(window.HIDDevice.prototype, "open", makeLifecycleWrapper("hid", null, "OPEN"));
        wrapFunction(window.HIDDevice.prototype, "close", makeLifecycleWrapper("hid", null, "CLOSE"));
      }
    } else if (api === "serial") {
      wrapFunction(proto, "getPorts", makeAcquisitionWrapper("serial", true, "getPorts"));
      wrapFunction(proto, "requestPort", makeAcquisitionWrapper("serial", false, "requestPort"));
      if (typeof window.SerialPort === "function") {
        wrapFunction(window.SerialPort.prototype, "write", makeTxWrapper("serial", null));
        wrapFunction(window.SerialPort.prototype, "open", makeLifecycleWrapper("serial", null, "OPEN"));
        wrapFunction(window.SerialPort.prototype, "close", makeLifecycleWrapper("serial", null, "CLOSE"));
      }
    } else if (api === "usb") {
      wrapFunction(proto, "requestDevice", makeAcquisitionWrapper("usb", false, "requestDevice"));
      wrapFunction(proto, "getDevices", makeAcquisitionWrapper("usb", true, "getDevices"));
      if (typeof window.USBDevice === "function") {
        var usbProto = window.USBDevice.prototype;
        wrapFunction(usbProto, "transferOut", makeUsbOutWrapper(null, false));
        wrapFunction(usbProto, "controlTransferOut", makeUsbOutWrapper(null, true));
        wrapFunction(usbProto, "transferIn", makeUsbInWrapper(null, false));
        wrapFunction(usbProto, "controlTransferIn", makeUsbInWrapper(null, true));
        wrapFunction(usbProto, "open", makeLifecycleWrapper("usb", null, "OPEN"));
        wrapFunction(usbProto, "close", makeLifecycleWrapper("usb", null, "CLOSE"));
      }
    }
  }

  // ---------------------------------------------------------------- 初始化

  API_NAMES.forEach(function (api) {
    var ownDescriptor = null;
    try {
      ownDescriptor = Object.getOwnPropertyDescriptor(navigator, api);
    } catch (_) {
      ownDescriptor = null;
    }
    var anyDescriptor = findDescriptor(navigator, api);
    if (!anyDescriptor) {
      apiStates[api] = { available: false };
      return;
    }
    var state = {
      available: true,
      ownDescriptor: ownDescriptor,
      protoDescriptor: ownDescriptor ? null : anyDescriptor,
      installed: false,
      attached: false,
      backingValue: undefined,
    };
    apiStates[api] = state;
    try {
      installNavigatorGetter(api, state);
    } catch (_) {
      state.installed = false; // defineProperty 被拒（冻结等）：退化为不观测该 API
    }
  });

  // ---------------------------------------------------------------- 公开契约

  function filterEntries(options) {
    var opts = options || {};
    var out = entries.slice();
    if (opts.dir !== undefined && opts.dir !== null) {
      out = out.filter(function (e) {
        return e.dir === opts.dir;
      });
    }
    if (opts.api !== undefined && opts.api !== null) {
      out = out.filter(function (e) {
        return e.api === opts.api;
      });
    }
    if (opts.op !== undefined && opts.op !== null) {
      out = out.filter(function (e) {
        return e.op === opts.op;
      });
    }
    if (opts.device && typeof opts.device === "object") {
      var keys = Object.keys(opts.device);
      out = out.filter(function (e) {
        return keys.every(function (key) {
          return opts.device[key] === undefined || (e.device && e.device[key] === opts.device[key]);
        });
      });
    }
    if (opts.since !== undefined && opts.since !== null) {
      var cutoff = toEpochMs(opts.since);
      if (cutoff !== null) {
        out = out.filter(function (e) {
          var t = Date.parse(e.t);
          return !Number.isNaN(t) && t >= cutoff;
        });
      }
    }
    if (typeof opts.limit === "number" && Number.isFinite(opts.limit) && opts.limit > 0) {
      out = out.slice(-opts.limit);
    }
    return out;
  }

  function exportEntry(entry) {
    var out = {
      seq: entry.seq,
      t: entry.t,
      dir: entry.dir,
      api: entry.api,
      device: entry.device,
    };
    if (entry.reportId !== undefined) {
      out.reportId = entry.reportId;
    }
    // bytes 是 Uint8Array，JSONL 里以 hex 为准（无损且可读），不序列化 bytes 本体
    if (entry.hex !== undefined) {
      out.hex = entry.hex;
      out.ascii = entry.ascii;
      out.len = entry.len;
    }
    if (entry.op !== undefined) {
      out.op = entry.op;
    }
    if (entry.note !== undefined) {
      out.note = entry.note;
    }
    return JSON.stringify(out);
  }

  window.__hidLog = {
    get version() {
      return VERSION;
    },
    get entries() {
      return entries.slice(); // 只读视图：返回快照，外界改动不影响 ring
    },
    dump: function (options) {
      ensureAllAttached(); // 晚注入兜底：读日志时强制补挂（可观测到此后的事件）
      return filterEntries(options);
    },
    filter: function (options) {
      return filterEntries(options);
    },
    export: function () {
      ensureAllAttached();
      return entries.map(exportEntry).join("\n");
    },
    clear: function () {
      entries.length = 0;
    },
    registerDecoder: function (name, fn) {
      if (typeof fn !== "function") {
        throw new TypeError("registerDecoder: fn must be a function");
      }
      decoders.set(String(name), fn);
      // 追溯补解码：已入库且尚无 op 的条目立即套用
      entries.forEach(function (entry) {
        if (!entry.op) {
          applyDecoders(entry);
        }
      });
    },
    config: function (options) {
      if (!options || typeof options !== "object") {
        return;
      }
      if (options.max !== undefined && options.max !== null) {
        var max = Number(options.max);
        if (Number.isFinite(max) && max >= 1) {
          maxEntries = Math.floor(max);
          if (entries.length > maxEntries) {
            entries.splice(0, entries.length - maxEntries);
          }
        }
      }
      if (options.consoleChannel !== undefined && options.consoleChannel !== null) {
        consoleChannel = options.consoleChannel === "off" ? "off" : "debug";
      }
    },
  };

  window.__dshKitHidObserver = {
    detach: function () {
      wrappedRecords.forEach(function (rec) {
        try {
          Object.defineProperty(rec.owner, rec.key, rec.descriptor);
        } catch (_) {
          /* 个别属性不可还原时跳过 */
        }
      });
      wrappedRecords = [];
      wrappedFns = new WeakSet();

      mirrorRecords.forEach(function (rec) {
        try {
          rec.target.removeEventListener(rec.type, rec.handler);
        } catch (_) {
          /* 忽略 */
        }
      });
      mirrorRecords = [];
      acquiredDevices = new WeakSet();

      API_NAMES.forEach(function (api) {
        var state = apiStates[api];
        if (!state || !state.installed) {
          return;
        }
        try {
          if (state.ownDescriptor) {
            Object.defineProperty(navigator, api, state.ownDescriptor);
          } else {
            delete navigator[api];
          }
        } catch (_) {
          /* 忽略 */
        }
        state.installed = false;
        state.attached = false;
      });

      try {
        delete window.__hidLog;
      } catch (_) {}
      try {
        delete window.__dshKitHidObserver;
      } catch (_) {}
      try {
        delete window.__DSH_KIT_OBSERVER_VERSION;
      } catch (_) {}
    },
  };

  window.__DSH_KIT_OBSERVER_VERSION = VERSION;
})();
