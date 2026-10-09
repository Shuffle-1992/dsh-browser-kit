/**
 * src/webhid-shim.js — WebHID polyfill（R-HID 第二段）：在 guest 页内 hook navigator.hid，
 * 把 requestDevice/getDevices/open/read/write/close 代理到 dsh-browser-kit 的 HID 桥
 * （host 侧 node-hid 系统层直连，绕开 Chromium select-hid-device 宿主缺口——P35）。
 *
 * 页面零修改：WebHID 硬件配置器站点调 navigator.hid.requestDevice() 时，本 shim 弹出
 * dsh-kit 自己的选择器 UI（复用批注面板视觉语言），选择结果经桥打开设备并回传 HIDDevice
 * 形状对象；后续 open/oninputreport/sendReport 全部转发桥。
 *
 * 通信通道（guest 摸不到 face，client 摸不到 guest——双向靠队列轮询）：
 *  - guest→client 请求：window.__dshKitHidQueue（数组），client 每 2s tick 里
 *    executeJavaScript 取走执行（face hidList/hidOpen/hidRead/hidWrite/hidClose）；
 *  - client→guest 结果：window.__dshKitHidResolve(reqId, result)（client 拿到结果后
 *    executeJavaScript 回推，shim 里 pending 表 resolve 对应 Promise）。
 *
 * 版本：1.0.0（__dshKitHidShimVersion）
 */
(function () {
  "use strict";
  if (window.__dshKitHidShimVersion) {
    return; // 幂等：重复注入直接返回
  }
  window.__dshKitHidShimVersion = "1.0.0";

  var REQ_SEQ = 0;
  var REQ_QUEUE = window.__dshKitHidQueue = window.__dshKitHidQueue || [];
  var PENDING = {}; // reqId -> { resolve, reject, timer }
  var OPEN_DEVICES = {}; // handleId -> HIDDevice shim 实例

  function callBridge(method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = "r" + (++REQ_SEQ) + "_" + Date.now();
      var timer = setTimeout(function () {
        if (PENDING[id]) { delete PENDING[id]; reject(new Error("HID 桥超时：" + method)); }
      }, timeoutMs || 15000);
      PENDING[id] = { resolve: resolve, reject: reject };
      REQ_QUEUE.push({ id: id, method: method, params: params || {} });
    });
  }

  /** client 拿到结果后回推入口（client 经 executeJavaScript 调用）。 */
  window.__dshKitHidResolve = function (reqId, result) {
    var p = PENDING[reqId];
    if (!p) return;
    delete PENDING[reqId];
    clearTimeout(p.timer);
    p.resolve(result);
  };

  // ---------- 选择器 UI（复用批注面板视觉语言：暗底圆角 + 行悬停） ----------

  var chooserState = null; // { overlay, list, chosen }

  function closeChooser() {
    if (chooserState && chooserState.overlay && chooserState.overlay.parentNode) {
      chooserState.overlay.parentNode.removeChild(chooserState.overlay);
    }
    chooserState = null;
  }

  function openChooser(devices) {
    return new Promise(function (resolve) {
      closeChooser();
      var overlay = document.createElement("div");
      overlay.setAttribute("data-dsh-kit-hid-chooser", "");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.45);"
        + "display:flex;align-items:center;justify-content:center;font:13px/1.5 -apple-system,'Segoe UI','Noto Sans SC',sans-serif;";
      var panel = document.createElement("div");
      panel.style.cssText = "background:var(--dsw-alias-bg-primary,#243244);color:var(--dsw-alias-label-primary,#e5e7eb);"
        + "border:1px solid var(--dsw-alias-border,#3a4a5e);border-radius:12px;min-width:360px;max-width:520px;"
        + "box-shadow:0 12px 40px rgba(0,0,0,0.5);overflow:hidden;";
      var head = document.createElement("div");
      head.style.cssText = "padding:12px 16px;font-weight:600;border-bottom:1px solid var(--dsw-alias-border,#3a4a5e);";
      head.textContent = "选择 HID 设备（dsh-browser-kit 桥）";
      var list = document.createElement("div");
      list.style.cssText = "max-height:320px;overflow:auto;";
      var foot = document.createElement("div");
      foot.style.cssText = "padding:10px 16px;border-top:1px solid var(--dsw-alias-border,#3a4a5e);text-align:right;";
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "取消";
      cancel.style.cssText = "background:transparent;border:1px solid var(--dsw-alias-border,#3a4a5e);color:inherit;"
        + "border-radius:8px;padding:5px 14px;cursor:pointer;";
      cancel.addEventListener("click", function () { closeChooser(); resolve(null); });
      foot.appendChild(cancel);
      panel.append(head, list, foot);
      overlay.appendChild(panel);
      document.documentElement.append(overlay);
      chooserState = { overlay: overlay, list: list };

      devices.forEach(function (d, i) {
        var row = document.createElement("div");
        row.style.cssText = "padding:10px 16px;cursor:pointer;display:flex;justify-content:space-between;gap:12px;"
          + "border-bottom:1px solid rgba(255,255,255,0.06);";
        if (i % 2 === 1) row.style.background = "rgba(255,255,255,0.03)";
        var name = document.createElement("span");
        name.textContent = d.product || ("HID " + d.vendorId + ":" + d.productId);
        var meta = document.createElement("span");
        meta.style.cssText = "opacity:0.65;font-size:12px;";
        meta.textContent = (d.vendorId + ":" + d.productId) + (d.serialNumber ? " · " + d.serialNumber : "");
        row.append(name, meta);
        row.addEventListener("mouseenter", function () { row.style.background = "rgba(124,196,255,0.15)"; });
        row.addEventListener("mouseleave", function () { row.style.background = i % 2 === 1 ? "rgba(255,255,255,0.03)" : "transparent"; });
        row.addEventListener("click", function () {
          var chosen = d;
          closeChooser();
          resolve(chosen);
        });
        list.appendChild(row);
      });
    });
  }

  // ---------- HIDDevice shim 形状（页面上手的就是它） ----------

  function ShimHIDDevice(info, handleId) {
    var self = this;
    this.__dshKitHandleId = handleId;
    Object.defineProperties(this, {
      opened: { get: function () { return true; } },
      vendorId: { get: function () { return info.vendorId; } },
      productId: { get: function () { return info.productId; } },
      productName: { get: function () { return info.product || ""; } },
      collections: { get: function () { return []; } },
    });
    this.oninputreport = null;
    // 输入轮询：桥是拉模型（hidRead 阻塞读），这里 250ms 轮询转发为 oninputreport 事件
    var pollTimer = setInterval(function () {
      if (!self.oninputreport) return;
      callBridge("hidRead", { handleId: handleId, timeoutMs: 200 }, 5000).then(function (r) {
        if (r && r.ok && Array.isArray(r.data) && r.data.length) {
          var ev = { data: new Uint8Array(r.data), device: self, reportId: r.data[0] };
          try { self.oninputreport(ev); } catch (_) { /* 页面回调异常不拦桥 */ }
        }
      }).catch(function () { /* 桥超时：下轮再试 */ });
    }, 300);
    this.__dshKitStopPoll = function () { clearInterval(pollTimer); };
  }
  ShimHIDDevice.prototype.open = function () { return Promise.resolve(); }; // 桥在 requestDevice 后已 open
  ShimHIDDevice.prototype.close = function () {
    var handleId = this.__dshKitHandleId;
    this.__dshKitStopPoll();
    delete OPEN_DEVICES[handleId];
    return callBridge("hidClose", { handleId: handleId }).then(function () {});
  };
  ShimHIDDevice.prototype.sendReport = function (reportId, data) {
    var bytes = Array.prototype.slice.call(data instanceof Uint8Array ? data : new Uint8Array(data));
    if (reportId) bytes.unshift(0); // reportId 填充与 WebHID 语义一致（无 report id 设备传 0）
    return callBridge("hidWrite", { handleId: this.__dshKitHandleId, data: bytes }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || "hidWrite 失败");
      return;
    });
  };
  ShimHIDDevice.prototype.sendFeatureReport = function (reportId, data) {
    return this.sendReport(reportId, data); // node-hid 无 feature 读写分离，退化为主通道
  };
  ShimHIDDevice.prototype.forget = function () { return this.close(); };

  // ---------- navigator.hid 覆盖 ----------

  function filtersMatch(device, filters) {
    if (!filters || !filters.length) return true;
    return filters.some(function (f) {
      if (f.vendorId != null && device.vendorId !== f.vendorId) return false;
      if (f.productId != null && device.productId !== f.productId) return false;
      if (f.usagePage != null && device.usagePage !== f.usagePage) return false;
      if (f.usage != null && device.usage !== f.usage) return false;
      return true;
    });
  }

  var shimHid = {
    getDevices: function () {
      // 已打开的 shim 设备（桥侧句柄仍活着）
      return Promise.resolve(Object.keys(OPEN_DEVICES).map(function (k) { return OPEN_DEVICES[k]; }));
    },
    requestDevice: function (options) {
      return callBridge("hidList", {}).then(function (r) {
        var all = (r && r.ok && Array.isArray(r.devices)) ? r.devices : [];
        var usable = all.filter(function (d) { return d.path; }); // 无 path 的系统设备打不开，过滤
        var filtered = usable.filter(function (d) { return filtersMatch(d, options && options.filters); });
        var candidates = filtered.length ? filtered : usable;
        if (!candidates.length) {
          var err = new Error("未找到可用的 HID 设备");
          err.name = "NotFoundError";
          throw err;
        }
        return openChooser(candidates).then(function (chosen) {
          if (!chosen) {
            var cancelled = new Error("用户取消了设备选择");
            cancelled.name = "NotFoundError";
            throw cancelled;
          }
          return callBridge("hidOpen", { path: chosen.path }).then(function (opened) {
            if (!opened || !opened.ok) throw new Error((opened && opened.error) || "设备打开失败");
            var dev = new ShimHIDDevice(chosen, opened.handleId);
            OPEN_DEVICES[opened.handleId] = dev;
            return [dev]; // WebHID 规范：requestDevice resolve 数组（页面代码 d[0]）
          });
        });
      });
    },
    getAvailableDevices: function () { // 非标准 API，Debug 用
      return callBridge("hidList", {}).then(function (r) {
        return (r && r.ok && Array.isArray(r.devices)) ? r.devices : [];
      });
    },
    onconnect: null,
    ondisconnect: null,
    addEventListener: function () {},
    removeEventListener: function () {},
    dispatchEvent: function () { return true; },
  };
  try {
    Object.defineProperty(shimHid, "ongeometryconnected", { value: null, writable: true });
  } catch (_) { /* 可选属性 */ }

  try {
    // 覆盖 navigator.hid（可写则直写；只读则 defineProperty）
    var desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "hid") || Object.getOwnPropertyDescriptor(navigator, "hid");
    if (!desc || desc.configurable) {
      Object.defineProperty(navigator, "hid", { value: shimHid, configurable: true });
    } else {
      navigator.hid = shimHid; // 兜底直写（部分环境允许实例遮蔽）
    }
  } catch (e) {
    navigator.hid = shimHid;
  }

  window.__dshKitHidShim = shimHid; // 调试句柄
})();