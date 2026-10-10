/**
 * test/hid-observer.test.js — hid-observer 沙箱单测（Node vm + virtual-hid mock，无硬件）
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, evalScriptFile } from "./helpers/sandbox.mjs";
import { projectRoot, readSource, sleep } from "./helpers/chrome.mjs";
import { createVirtualHidWorld, VirtualHIDDevice } from "../src/virtual-hid-device.js";

const OBSERVER_PATH = `${projectRoot}/src/hid-observer.js`;

// 各测试共享模块级类原型（VirtualHIDDevice.prototype 等），实例的 wrap 会跨测试残留——
// 每个测试结束后统一 detach 还原原生，避免后续测试因防重标记跳过包装。
let currentSandbox = null;
afterEach(() => {
  if (currentSandbox && currentSandbox.window.__dshKitHidObserver) {
    try {
      currentSandbox.window.__dshKitHidObserver.detach();
    } catch (_) {
      /* 尽力清理 */
    }
  }
  currentSandbox = null;
});

/** 跨 realm 比较辅助：vm 对象 → 主 realm 纯 JSON。 */
function json(value) {
  return JSON.parse(JSON.stringify(value));
}

/** vm 数组 → 主 realm 数组（deepStrictEqual 会因跨 realm prototype 判不等）。 */
function dumpOf(sandbox, options) {
  return Array.from(sandbox.window.__hidLog.dump(options));
}

function makeQuietConsole(sink) {
  return {
    debug: (...args) => sink.push(args.join(" ")),
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
  };
}

function setupObserver(navigatorObj, consoleImpl) {
  const sandbox = createSandbox({ navigator: navigatorObj, console: consoleImpl });
  evalScriptFile(sandbox, OBSERVER_PATH);
  currentSandbox = sandbox;
  return sandbox;
}

test("HID：EVENT/OPEN/TX/RX/CLOSE 顺序、hex/ascii/len、设备描述符、reportId", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 0x1a2b, productId: 0x3c4d }, autoConnect: false });
  const sandbox = setupObserver({ hid: world.hid });

  // 惰性 attach：首次访问 navigator.hid 才 patch——这里即为首次
  const hid = sandbox.navigator.hid;
  const dev = (await hid.getDevices())[0];
  await dev.open();
  await dev.sendReport(0x00, new Uint8Array([0xa1, 0x0c, 0x00]));
  dev.simulateInput(0x00, [0x0c, 0x4b]);
  await dev.close();

  const entries = dumpOf(sandbox);
  assert.deepEqual(entries.map((e) => e.dir), ["EVENT", "OPEN", "TX", "RX", "CLOSE"]);

  const event = entries[0];
  assert.equal(event.op, "getDevices");
  assert.equal(event.api, "hid");

  const tx = entries[2];
  assert.equal(tx.reportId, 0);
  assert.equal(tx.hex, "a1 0c 00");
  assert.equal(tx.ascii, "..."); // 0xa1/0x0c/0x00 均不可打印
  assert.equal(tx.len, 3);
  assert.deepEqual(json(tx.device), { vendorId: 0x1a2b, productId: 0x3c4d });
  assert.ok(typeof tx.t === "string" && !Number.isNaN(Date.parse(tx.t)));
  assert.ok(tx.seq > 0);
  // bytes 是拷贝（Uint8Array）
  assert.ok(ArrayBuffer.isView(tx.bytes));

  const rx = entries[3];
  assert.equal(rx.reportId, 0);
  assert.equal(rx.hex, "0c 4b");
  assert.equal(rx.len, 2);
  assert.ok(rx.ascii.startsWith(".K")); // 0x4b = 'K'
});

test("版本契约：version/1、__DSH_KIT_OBSERVER_VERSION、entries 只读视图", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 1, productId: 2 }, autoConnect: false });
  const sandbox = setupObserver({ hid: world.hid });
  const log = sandbox.window.__hidLog;
  assert.equal(log.version, "1");
  assert.equal(sandbox.window.__DSH_KIT_OBSERVER_VERSION, "1");

  const dev = (await sandbox.navigator.hid.getDevices())[0];
  await dev.open();
  await dev.sendReport(0, [0x01]);
  const view = log.entries;
  assert.equal(view.length, 3); // EVENT getDevices + OPEN + TX
  view.push({ fake: true }); // 数组是快照：增删不影响 ring
  assert.equal(log.entries.length, 3);
  assert.ok(ArrayBuffer.isView(dumpOf(sandbox, { dir: "TX" })[0].bytes));
});

test("ring 上限：config({max}) 裁剪旧条目，seq 单调", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 1, productId: 2 }, autoConnect: false });
  const sandbox = setupObserver({ hid: world.hid });
  sandbox.window.__hidLog.config({ max: 5 });
  const dev = (await sandbox.navigator.hid.getDevices())[0];
  await dev.open();
  for (let i = 0; i < 10; i++) {
    await dev.sendReport(0, [i]);
  }
  const entries = dumpOf(sandbox);
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.map((e) => e.hex), ["05", "06", "07", "08", "09"]);
  const seqs = entries.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
});

test("dump/filter 分支：dir/api/op/device/since/limit", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 0x1a2b, productId: 0x3c4d }, autoConnect: false });
  const sandbox = setupObserver({ hid: world.hid });
  const hid = sandbox.navigator.hid;
  const dev = (await hid.getDevices())[0];
  await dev.open();
  await dev.sendReport(0x00, [0xaa]);
  const cutoff = Date.now();
  await sleep(20);
  await dev.sendReport(0x00, [0xbb]);
  const log = sandbox.window.__hidLog;

  assert.equal(dumpOf(sandbox, { dir: "TX" }).length, 2);
  assert.equal(dumpOf(sandbox, { dir: "RX" }).length, 0);
  assert.equal(dumpOf(sandbox, { api: "hid" }).length, 4);
  assert.equal(dumpOf(sandbox, { op: "getDevices" }).length, 1);
  assert.equal(dumpOf(sandbox, { device: { vendorId: 0x1a2b } }).length, 3); // getDevices EVENT 无 device，正确排除
  assert.equal(dumpOf(sandbox, { device: { vendorId: 0xdead } }).length, 0);
  assert.equal(dumpOf(sandbox, { device: { vendorId: 0x1a2b, productId: 0x3c4d } }).length, 3);
  // since 过滤：用确定性断言（毫秒边界竞态会让"当前时刻"截止不稳定——
  // 快机器上整段序列可在同一毫秒内完成）
  assert.equal(dumpOf(sandbox, { since: cutoff - 60000 }).length, 4);
  assert.equal(dumpOf(sandbox, { since: cutoff + 60000 }).length, 0);
  assert.equal(dumpOf(sandbox, { since: new Date(cutoff - 60000).toISOString() }).length, 4, "ISO 字符串与 epoch 数值同参同果");
  const limited = dumpOf(sandbox, { limit: 2 });
  assert.deepEqual(limited.map((e) => e.hex), ["aa", "bb"]);
  // filter 与 dump 同参同果
  assert.deepEqual(Array.from(log.filter({ dir: "TX" })).map((e) => e.seq), dumpOf(sandbox, { dir: "TX" }).map((e) => e.seq));
  // 非法参数安全
  assert.equal(dumpOf(sandbox, { since: "not-a-date" }).length, 4);
  assert.equal(dumpOf(sandbox, { limit: -1 }).length, 4);
});

test("registerDecoder：命中填充 op/note，追溯 + 新条目即时生效，异常隔离", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 1, productId: 2 }, autoConnect: false });
  const sandbox = setupObserver({ hid: world.hid });
  const dev = (await sandbox.navigator.hid.getDevices())[0];
  await dev.open();
  await dev.sendReport(0x00, [0xa1, 0x0c]); // READ_PRESET 风格
  await dev.sendReport(0x00, [0x0c, 0x00]); // 应答

  const log = sandbox.window.__hidLog;
  log.registerDecoder("demo", (entry) =>
    entry.hex && entry.hex.startsWith("a1 0c") ? { op: "READ_PRESET#12", note: "preset query" } : null,
  );

  let entries = dumpOf(sandbox, { op: "READ_PRESET#12" });
  assert.equal(entries.length, 1); // 追溯生效
  assert.equal(entries[0].note, "preset query");
  assert.equal(dumpOf(sandbox)[3].op, undefined); // 未命中不受影响（第二个 TX：0c 00）

  await dev.sendReport(0x00, [0xa1, 0x0c]); // 新条目即时套用
  entries = dumpOf(sandbox, { op: "READ_PRESET#12" });
  assert.equal(entries.length, 2);

  // 解码器异常不崩溃
  log.registerDecoder("bad", () => {
    throw new Error("decoder boom");
  });
  await dev.sendReport(0x00, [0xa1, 0x0c]);
  assert.equal(dumpOf(sandbox, { op: "READ_PRESET#12" }).length, 3);

  // 同名覆盖：仅此前无 op 的条目被追溯
  log.registerDecoder("demo", (entry) => (entry.hex ? { op: "ANY" } : null));
  assert.equal(dumpOf(sandbox, { op: "ANY" }).length, 1);

  assert.throws(() => log.registerDecoder("nope", "not-a-function"), /fn must be a function/);
});

test("export()：JSONL 可解析、字段齐全、不含 bytes 本体", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 0x0a, productId: 0x0b }, autoConnect: false });
  const sandbox = setupObserver({ hid: world.hid });
  const dev = (await sandbox.navigator.hid.getDevices())[0];
  await dev.open();
  await dev.sendReport(0x00, [0xde, 0xad]);

  const lines = sandbox.window.__hidLog.export().split("\n");
  assert.equal(lines.length, 3); // EVENT getDevices + OPEN + TX
  const parsed = lines.map((line) => JSON.parse(line));
  const tx = parsed[2];
  assert.equal(tx.dir, "TX");
  assert.equal(tx.hex, "de ad");
  assert.equal(tx.len, 2);
  assert.equal(tx.ascii, "..");
  assert.deepEqual(tx.device, { vendorId: 0x0a, productId: 0x0b });
  assert.ok(!("bytes" in tx));
  for (const item of parsed) {
    assert.ok(item.seq > 0);
    assert.ok(!Number.isNaN(Date.parse(item.t)));
  }
});

test("clear()：清空 ring，seq 保持单调", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 1, productId: 2 }, autoConnect: false });
  const sandbox = setupObserver({ hid: world.hid });
  const dev = (await sandbox.navigator.hid.getDevices())[0];
  await dev.open();
  await dev.sendReport(0, [1]);
  sandbox.window.__hidLog.clear();
  assert.equal(dumpOf(sandbox).length, 0);
  await dev.sendReport(0, [2]);
  const entries = dumpOf(sandbox, { dir: "TX" });
  assert.equal(entries.length, 1);
  assert.ok(entries[0].seq >= 2);
});

test("config({consoleChannel})：默认 debug 输出 [HID]，off 静默；hex 预览 32 字节截断", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 1, productId: 2 }, autoConnect: false });
  const sink = [];
  const sandbox = setupObserver({ hid: world.hid }, makeQuietConsole(sink));
  const dev = (await sandbox.navigator.hid.getDevices())[0];
  await dev.open();
  await dev.sendReport(0, new Uint8Array(40).fill(0xab));
  assert.ok(sink.length >= 1);
  const line = sink.find((text) => text.includes("[TX]"));
  assert.ok(line, "应有 TX console 行");
  assert.ok(line.startsWith("[HID] [TX] hid"), line);
  assert.ok(line.includes("reportId=0x00"));
  assert.ok(line.includes("ab ".repeat(31).trim()));
  assert.ok(line.includes("... +8B"));
  const countBefore = sink.length;
  sandbox.window.__hidLog.config({ consoleChannel: "off" });
  await dev.sendReport(0, [0x01]);
  assert.equal(sink.length, countBefore);
  sandbox.window.__hidLog.config({ consoleChannel: "debug" });
  await dev.sendReport(0, [0x02]);
  assert.equal(sink.length, countBefore + 1);
});

test("detach()：方法还原、navigator 描述符还原、全局清除、镜像移除", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 1, productId: 2 }, autoConnect: false });
  const navigatorObj = { hid: world.hid };
  const descriptorBefore = Object.getOwnPropertyDescriptor(navigatorObj, "hid"); // 注入前：数据属性
  const sandbox = setupObserver(navigatorObj);
  const originalSendReport = VirtualHIDDevice.prototype.sendReport;

  const dev = (await sandbox.navigator.hid.getDevices())[0];
  await dev.open();
  assert.notEqual(VirtualHIDDevice.prototype.sendReport, originalSendReport); // 已 wrap
  const descriptorDuring = Object.getOwnPropertyDescriptor(navigatorObj, "hid");
  assert.ok(descriptorDuring.get, "注入后应为本实例 getter");

  sandbox.window.__dshKitHidObserver.detach();
  assert.equal(VirtualHIDDevice.prototype.sendReport, originalSendReport);
  assert.equal(sandbox.window.__hidLog, undefined);
  assert.equal(sandbox.window.__dshKitHidObserver, undefined);
  assert.equal(sandbox.window.__DSH_KIT_OBSERVER_VERSION, undefined);

  const descriptorAfter = Object.getOwnPropertyDescriptor(navigatorObj, "hid");
  assert.ok("value" in descriptorAfter);
  assert.equal(descriptorAfter.get, undefined);
  assert.deepEqual(json(descriptorAfter.value), json(descriptorBefore.value));

  // 镜像已移除：RX 不再有观察者；原生调用不受影响
  let received = 0;
  dev.addEventListener("inputreport", () => received++);
  dev.simulateInput(0, [1]);
  await sleep(10);
  assert.equal(received, 1);
  await dev.sendReport(0, [9]); // 不再记录，也不抛错
});

test("重注入防重：旧实例先 detach，TX 不重复计数", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 1, productId: 2 }, autoConnect: false });
  const sandbox = setupObserver({ hid: world.hid });
  const dev = (await sandbox.navigator.hid.getDevices())[0];
  await dev.open();
  await dev.sendReport(0, [1]);
  assert.equal(dumpOf(sandbox, { dir: "TX" }).length, 1);

  evalScriptFile(sandbox, OBSERVER_PATH); // 第二次注入
  assert.equal(sandbox.window.__hidLog.version, "1");
  const dev2 = (await sandbox.navigator.hid.getDevices())[0];
  await dev2.sendReport(0, [2]);
  const txEntries = dumpOf(sandbox, { dir: "TX" });
  assert.equal(txEntries.length, 1, "旧实例 wrapper 泄漏会导致 2 条");
  assert.equal(txEntries[0].hex, "02");
});

test("Serial：write TX 全量 + data 事件镜像（best-effort）", async () => {
  class FakeSerialPort extends EventTarget {
    constructor() {
      super();
      this.opened = false;
    }
    async open() {
      this.opened = true;
    }
    async close() {
      this.opened = false;
    }
    async write(chunk) {
      return chunk.length;
    }
  }
  const port = new FakeSerialPort();
  class FakeSerial extends EventTarget {
    async getPorts() {
      return [port];
    }
  }
  const sandbox = setupObserver({ serial: new FakeSerial() });
  await sandbox.navigator.serial.getPorts();
  await port.open();
  await port.write("HELLO");
  const dataEvent = new Event("data");
  dataEvent.data = new Uint8Array([0x01, 0x02]);
  port.dispatchEvent(dataEvent);

  const entries = dumpOf(sandbox);
  assert.deepEqual(entries.map((e) => e.dir), ["EVENT", "OPEN", "TX", "RX"]);
  const tx = entries[2];
  assert.equal(tx.api, "serial");
  assert.equal(tx.hex, "48 45 4c 4c 4f");
  assert.equal(tx.ascii, "HELLO");
  const rx = entries[3];
  assert.equal(rx.hex, "01 02");
  assert.ok((rx.note || "").includes("best-effort"));
});

test("USB：transferOut/In 与 controlTransfer 的 TX/RX 及 ctrl note", async () => {
  class FakeUSBDevice {
    vendorId = 0x2222;
    productId = 0x3333;
    async open() {}
    async close() {}
    async transferOut(endpoint, data) {
      return { bytesWritten: data.byteLength };
    }
    async transferIn() {
      return { status: "ok", data: new DataView(new Uint8Array([0xde, 0xad]).buffer) };
    }
    async controlTransferOut(request) {
      return { bytesWritten: 0 };
    }
    async controlTransferIn() {
      return { status: "ok", data: new DataView(new Uint8Array([0x09]).buffer) };
    }
  }
  const dev = new FakeUSBDevice();
  class FakeUSB extends EventTarget {
    async getDevices() {
      return [dev];
    }
  }
  const sandbox = setupObserver({ usb: new FakeUSB() });
  await sandbox.navigator.usb.getDevices();
  await dev.transferOut(1, new Uint8Array([0x11, 0x22]));
  await dev.transferIn(1, 64);
  await dev.controlTransferOut(
    { requestType: "class", recipient: "interface", request: 0x09, value: 0x0301, index: 0 },
    new Uint8Array([0x01]),
  );
  await dev.controlTransferIn(
    { requestType: "standard", recipient: "device", request: 0x08, value: 0, index: 0 },
    8,
  );

  const entries = dumpOf(sandbox);
  const out = entries.find((e) => e.dir === "TX" && e.hex === "11 22");
  assert.ok(out, "transferOut 应记 TX");
  const input = entries.find((e) => e.dir === "RX" && e.hex === "de ad");
  assert.ok(input, "transferIn resolve 后应记 RX");
  assert.ok((input.note || "").includes("status=ok"));
  const ctrlOut = entries.find((e) => e.dir === "TX" && e.hex === "01");
  assert.ok((ctrlOut.note || "").includes("ctrl type=0x01")); // "class" → 0x01
  assert.ok((ctrlOut.note || "").includes("recipient=0x01")); // "interface" → 0x01
  assert.ok((ctrlOut.note || "").includes("request=0x09"));
  assert.ok((ctrlOut.note || "").includes("value=0x0301"));
  const ctrlIn = entries.find((e) => e.dir === "RX" && e.hex === "09");
  assert.ok((ctrlIn.note || "").includes("request=0x08"));
});

test("无任何设备 API 的页面：observer 安装与 dump 均安全", () => {
  const sandbox = setupObserver({});
  assert.equal(typeof sandbox.window.__hidLog.dump, "function");
  assert.deepEqual(dumpOf(sandbox), []);
  assert.equal(sandbox.window.__hidLog.export(), "");
});

test("connect 事件镜像：autoConnect 广播被记录并采集设备", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 0x77, productId: 0x88 }, autoConnect: true });
  const sandbox = setupObserver({ hid: world.hid });
  sandbox.navigator.hid; // 触发 attach
  await sleep(20);
  const connect = dumpOf(sandbox, { op: "connect" });
  assert.equal(connect.length, 1);
  assert.deepEqual(json(connect[0].device), { vendorId: 0x77, productId: 0x88 });
});

test("注入串与观察层共用 readSource 冒烟：observer 源码可重复 eval 于同一沙箱", () => {
  const world = createVirtualHidWorld({ device: { vendorId: 1, productId: 2 }, autoConnect: false });
  const sandbox = setupObserver({ hid: world.hid });
  const source = readSource("src/hid-observer.js");
  assert.ok(source.includes("window.__dshKitHidObserver"));
  assert.ok(source.includes("__DSH_KIT_OBSERVER_VERSION"));
  assert.ok(world.hid instanceof EventTarget);
});
