/**
 * test/virtual-hid-device.test.js — mock 设备双形态（ESM 模块 + 可注入 IIFE）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createSandbox } from "./helpers/sandbox.mjs";
import { sleep } from "./helpers/chrome.mjs";
import { VirtualHIDDevice, createVirtualHidWorld, buildVirtualHidInjectScript } from "../src/virtual-hid-device.js";

test("ESM：createVirtualHidWorld 基本行为", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 0x1234, productId: 0x5678, serialNumber: "KIT001" } });
  assert.equal(world.devices.length, 1);
  const dev = world.devices[0];
  assert.equal(dev.vendorId, 0x1234);
  assert.equal(dev.productId, 0x5678);
  assert.equal(dev.serialNumber, "KIT001");
  assert.equal(dev.opened, false);
  assert.equal(await world.hid.requestDevice(), dev);
  assert.deepEqual(await world.hid.getDevices(), [dev]);
});

test("ESM：未 open 时 sendReport 抛 InvalidStateError", async () => {
  const world = createVirtualHidWorld({ autoConnect: false });
  await assert.rejects(() => world.devices[0].sendReport(0, [1]), /opened/);
  await world.devices[0].open();
  await world.devices[0].sendReport(0, [1]); // 不抛
  await world.devices[0].close();
  assert.equal(world.devices[0].opened, false);
});

test("ESM：simulateInput 以 inputreport 事件广播（DataView + device）", async () => {
  const world = createVirtualHidWorld({ autoConnect: false });
  const dev = world.devices[0];
  const received = [];
  dev.addEventListener("inputreport", (event) => {
    received.push({ reportId: event.reportId, device: event.device, bytes: event.data });
  });
  dev.simulateInput(0x03, [0xaa, 0xbb], 10);
  await sleep(50);
  assert.equal(received.length, 1);
  assert.equal(received[0].reportId, 0x03);
  assert.equal(received[0].device, dev);
  assert.equal(received[0].bytes.byteLength, 2);
  assert.equal(received[0].bytes.getUint8(0), 0xaa);
});

test("ESM：autoConnect 在下一个宏任务广播 connect", async () => {
  const world = createVirtualHidWorld({ device: { vendorId: 7, productId: 8 }, autoConnect: true });
  const events = [];
  world.hid.addEventListener("connect", (event) => events.push(event.device));
  await sleep(20);
  assert.deepEqual(events, world.devices);
});

test("IIFE 注入串：vm 沙箱中安装 navigator.hid 并暴露 __dshKitVirtualHid", async () => {
  const script = buildVirtualHidInjectScript({ device: { vendorId: 0x11, productId: 0x22 } });
  assert.ok(script.startsWith("(function virtualHidInjectMain"), "应为自包含 IIFE");

  const sandbox = createSandbox();
  vm.runInContext(script, sandbox, { filename: "virtual-hid.inject.js" });

  assert.ok(sandbox.window.__dshKitVirtualHid);
  assert.equal(sandbox.window.__dshKitVirtualHid.devices.length, 1);
  const hid = sandbox.navigator.hid;
  assert.ok(hid, "默认 autoInstall 应已安装 navigator.hid");

  const dev = await hid.requestDevice();
  assert.equal(dev.vendorId, 0x11);
  assert.equal(dev.productId, 0x22);
  await dev.open();
  await dev.sendReport(0, [0x01, 0x02]);

  const received = [];
  dev.addEventListener("inputreport", (event) => received.push(event.reportId));
  dev.simulateInput(0x01, [0xff]);
  await sleep(10);
  assert.deepEqual(received, [0x01]);

  // install 幂等
  assert.equal(sandbox.window.__dshKitVirtualHid.install(), hid);
});

test("IIFE 注入串：autoInstall=false 时仅注册、由页面显式 install", async () => {
  const script = buildVirtualHidInjectScript({ autoInstall: false });
  const sandbox = createSandbox();
  vm.runInContext(script, sandbox, { filename: "virtual-hid.inject.js" });
  assert.ok(sandbox.window.__dshKitVirtualHid);
  assert.equal(sandbox.navigator.hid, undefined);
  const hid = sandbox.window.__dshKitVirtualHid.install();
  assert.equal(sandbox.navigator.hid, hid);
});

test("IIFE 注入串：注入时机先于页面脚本（模拟 document_start）", async () => {
  // 注入串先执行，随后页面脚本才能拿到 fake hid —— 顺序断言
  const script = buildVirtualHidInjectScript({ device: { vendorId: 9, productId: 9 } });
  const sandbox = createSandbox();
  vm.runInContext(script, sandbox, { filename: "virtual-hid.inject.js" });
  vm.runInContext("window.__seenHid = typeof navigator.hid", sandbox, { filename: "page.js" });
  assert.equal(sandbox.window.__seenHid, "object");
});
