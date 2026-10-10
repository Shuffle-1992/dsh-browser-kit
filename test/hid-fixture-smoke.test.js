/**
 * test/hid-fixture-smoke.test.js — hid-observer Chrome 冒烟：
 * Runtime.evaluate 兜底注入 + 内联伪造 navigator.hid 的无硬件收发断言（任务书 §3.6-3）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as drive from "../src/cdp/drive.mjs";
import { fixtureUrl, getFreePort, readSource, waitFor, waitReady } from "./helpers/chrome.mjs";

test("hid fixture 冒烟：evaluate 兜底注入 + 配对帧 + 镜像不消费", { timeout: 120000 }, async () => {
  const port = await getFreePort();
  await drive.launch({ port });
  try {
    const cdp = await drive.connect(port);
    await cdp.send("Page.navigate", { url: fixtureUrl("hid-mock-page.html") });
    await waitReady(cdp);

    // 页面此时已加载、内联 fake 已就位 → 走「当前文档 Runtime.evaluate 兜底」注入路径
    await drive.inject(cdp, readSource("src/hid-observer.js"));
    assert.equal(await drive.evalJs(cdp, "typeof window.__hidLog"), "object");

    // 页面按钮触发收发（连接 → 发送 → 等待应答帧 → 断开）
    await drive.evalJs(cdp, 'document.getElementById("connect").click()');
    await drive.evalJs(cdp, 'document.getElementById("send").click()');
    // 轮询等待 60ms 定时器派发的模拟应答帧（Chrome 忙时定时器可能推迟，固定 sleep 会 flake）
    const rxArrived = await waitFor(
      () => drive.evalJs(cdp, "__hidLog.dump({ dir: 'RX' }).length > 0"),
      5000,
    );
    assert.ok(rxArrived, "5s 内应收到模拟应答帧（RX 镜像）");
    await drive.evalJs(cdp, 'document.getElementById("disconnect").click()');

    const entries = await drive.evalJs(cdp, "__hidLog.dump()");

    // 配对帧断言（调研文档 §5.5 验收样例的无硬件版本）
    const tx = entries.find((entry) => entry.dir === "TX");
    assert.ok(tx, "应捕获 TX");
    assert.equal(tx.reportId, 0);
    assert.equal(tx.hex, "a1 0c 00 0c 00 00");
    assert.equal(tx.len, 6);
    assert.deepEqual(tx.device, { vendorId: 0x1a2b, productId: 0x3c4d });
    assert.ok(typeof tx.t === "string");

    const rx = entries.find((entry) => entry.dir === "RX");
    assert.ok(rx, "应捕获 RX（inputreport 镜像监听）");
    assert.equal(rx.reportId, 0);
    assert.equal(rx.hex, "0c 4b 45 59 53 00");
    assert.equal(rx.len, 6);

    assert.ok(entries.some((entry) => entry.dir === "OPEN"), "应有 OPEN");
    assert.ok(entries.some((entry) => entry.dir === "CLOSE"), "应有 CLOSE");
    assert.ok(entries.some((entry) => entry.op === "requestDevice"), "应有 requestDevice EVENT");

    // 时序：TX 早于 RX（配对帧时序断言）
    const txTime = Date.parse(entries.find((entry) => entry.dir === "TX").t);
    const rxTime = Date.parse(entries.find((entry) => entry.dir === "RX").t);
    assert.ok(txTime <= rxTime, "TX 应先于 RX");

    // 镜像不消费：fake 设备自身收到报文，页面逻辑不受影响
    const lastSent = await drive.evalJs(cdp, "window.__fakeHidDevice.__lastSent");
    assert.deepEqual(lastSent, [0xa1, 0x0c, 0x00, 0x0c, 0x00, 0x00]);
    assert.equal(await drive.evalJs(cdp, 'document.getElementById("status").textContent'), "disconnected");

    // export JSONL
    const jsonl = await drive.evalJs(cdp, "__hidLog.export()");
    const lines = jsonl.split("\n");
    assert.ok(lines.length >= 5);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.seq > 0 && parsed.dir && parsed.api);
      assert.ok(!("bytes" in parsed), "JSONL 不含 bytes 本体");
    }

    await cdp.close();
  } finally {
    await drive.close();
  }
});
