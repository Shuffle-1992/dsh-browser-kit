/**
 * dsh-browser-kit — virtual-hid-device.js
 *
 * VirtualHIDDevice：`navigator.hid` 的最小假象（无硬件、无用户手势），用于
 *   1. Node 侧 hid-observer 沙箱单测（ESM 导入）；
 *   2. Chrome 冒烟 / 无硬件回归：buildVirtualHidInjectScript() 产出自包含 IIFE 注入串，
 *      在页面脚本执行前安装 `window.__dshKitVirtualHid` 并伪造 `navigator.hid`。
 *
 * 说明：单个 JS 文件无法既是合法 ESM 又是经典 <script>（`export` 在经典脚本里是语法错误），
 * 因此「可注入 IIFE」以 ZCode webElementPickerScript.ts 的「函数即模板」方式导出：
 * `(${injectMain.toString()})(${JSON.stringify(options)})`——injectMain 必须保持零外部引用。
 *
 * 归属：dsh-browser-kit 原创实现（规格：调研文档 §5.5「VirtualHidDevice」、任务书 §3.4），未复制 ZCode 代码。
 */

/**
 * 仿 HIDDevice：方法全部挂在 prototype 上（hid-observer 依赖 prototype wrap 捕获调用），
 * 事件用标准 EventTarget 多播，inputreport 事件携带 reportId / data(DataView) / device。
 */
export class VirtualHIDDevice extends EventTarget {
  constructor({ vendorId = 0, productId = 0, serialNumber = null } = {}) {
    super();
    this.vendorId = vendorId;
    this.productId = productId;
    this.serialNumber = serialNumber;
    this.opened = false;
  }

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  /** 发送上行报告（真实收发由 hid-observer 记录；本 mock 自身不做断言）。 */
  async sendReport(reportId, data) {
    if (!this.opened) {
      throw new DOMException("Device must be opened before sending a report", "InvalidStateError");
    }
    return undefined;
  }

  /** 脚本化喂一条下行报告：延迟 delayMs 后以 inputreport 事件广播（镜像监听器与页面监听器互不干扰）。 */
  simulateInput(reportId, data, delayMs = 0) {
    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : Uint8Array.from(data ?? []);
    const fire = () => {
      const event = new Event("inputreport");
      event.reportId = reportId;
      event.data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      event.device = this;
      this.dispatchEvent(event);
    };
    if (delayMs > 0) {
      setTimeout(fire, delayMs);
    } else {
      fire();
    }
  }
}

/**
 * 创建假的 navigator.hid 世界。
 * options.device / options.devices 指定设备；autoConnect（默认 true）在下一个宏任务广播 connect 事件。
 * 返回 { hid, devices }，hid 可直接塞进沙箱 navigator / 由注入 IIFE 安装。
 */
export function createVirtualHidWorld({ device, devices, autoConnect = true, filters = null } = {}) {
  const list =
    devices ??
    (device ? [new VirtualHIDDevice(device)] : [new VirtualHIDDevice({ vendorId: 0x1234, productId: 0x5678 })]);

  class VirtualHID extends EventTarget {
    /** 模拟授权：免手势返回第一台设备（requestDevice 在真实 Chrome 需用户手势，mock 侧不做限制）。 */
    async requestDevice(_options) {
      return list[0] ?? null;
    }

    /** 真实语义：首次授权后可免手势取回设备——mock 直接返回全部设备。 */
    async getDevices() {
      return list.slice();
    }
  }

  const hid = new VirtualHID();
  if (autoConnect) {
    setTimeout(() => {
      for (const dev of list) {
        const event = new Event("connect");
        event.device = dev;
        hid.dispatchEvent(event);
      }
    }, 0);
  }

  return { hid, devices: list, filters };
}

/**
 * 产出可在页面（document_start 时机）直接执行的注入串：
 *   evaluate 后即自动伪造 navigator.hid，并暴露 window.__dshKitVirtualHid = { devices, install }。
 * options 透传设备参数（{ device: { vendorId, productId, serialNumber } } 或 { devices: [...] }）。
 */
export function buildVirtualHidInjectScript(options = {}) {
  return `(${virtualHidInjectMain.toString()})(${JSON.stringify(options)})`;
}

/** 自包含注入体：不得引用任何外部标识符（经 Function.toString 序列化进页面）。 */
function virtualHidInjectMain(options) {
  "use strict";
  if (typeof window === "undefined") {
    return;
  }

  class VirtualHIDDevice extends EventTarget {
    constructor(descriptor) {
      super();
      this.vendorId = descriptor.vendorId || 0;
      this.productId = descriptor.productId || 0;
      this.serialNumber = descriptor.serialNumber ?? null;
      this.opened = false;
    }
    async open() {
      this.opened = true;
    }
    async close() {
      this.opened = false;
    }
    async sendReport(reportId, data) {
      if (!this.opened) {
        throw new Error("virtual hid: device not opened");
      }
      return undefined;
    }
    simulateInput(reportId, data, delayMs) {
      const bytes = data instanceof Uint8Array ? new Uint8Array(data) : Uint8Array.from(data ?? []);
      const fire = () => {
        const event = new Event("inputreport");
        event.reportId = reportId;
        event.data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        event.device = this;
        this.dispatchEvent(event);
      };
      if (delayMs > 0) {
        setTimeout(fire, delayMs);
      } else {
        fire();
      }
    }
  }

  class VirtualHID extends EventTarget {
    constructor(devices) {
      super();
      this.__devices = devices;
    }
    async requestDevice() {
      return this.__devices[0] ?? null;
    }
    async getDevices() {
      return this.__devices.slice();
    }
  }

  const descriptors = options.devices ?? (options.device ? [options.device] : [{ vendorId: 0x1234, productId: 0x5678 }]);
  const devices = descriptors.map((descriptor) => new VirtualHIDDevice(descriptor));
  const hid = new VirtualHID(devices);

  window.__dshKitVirtualHid = {
    devices,
    /** 幂等安装：把 navigator.hid 替换为 fake（configurable，供 hid-observer 观测/还原）。 */
    install() {
      try {
        Object.defineProperty(navigator, "hid", {
          value: hid,
          configurable: true,
          enumerable: true,
          writable: true,
        });
      } catch (error) {
        // navigator 已被冻结等极端场景：保持静默，调用方可用返回值探测
      }
      return hid;
    },
  };

  if (options.autoInstall !== false) {
    window.__dshKitVirtualHid.install();
  }

  setTimeout(() => {
    for (const dev of devices) {
      const event = new Event("connect");
      event.device = dev;
      hid.dispatchEvent(event);
    }
  }, 0);
}
