/**
 * test/cdp-smoke.test.js — CDP 驱动冒烟（真实 Chrome）：
 * launch / connect / inject（document_start）/ evalJs / consoleStream / screenshot / close 清理
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as drive from "../src/cdp/drive.mjs";
import { fixtureUrl, getFreePort, readSource, sleep, waitReady } from "./helpers/chrome.mjs";

test("cdp smoke：launch/connect/inject/evalJs/consoleStream/screenshot/close 全链路", { timeout: 120000 }, async () => {
  const port = await getFreePort();
  const launched = await drive.launch({ port });
  try {
    const cdp = await drive.connect(port);

    // evalJs：求值 + 异常透传 + userGesture
    assert.equal(await drive.evalJs(cdp, "2 + 3"), 5);
    await assert.rejects(() => drive.evalJs(cdp, 'throw new Error("boom-xyz")'), /boom-xyz/);

    // consoleStream：页面 console 归一化流出
    const seen = [];
    const unsubscribe = await drive.consoleStream(cdp, (entry) => seen.push(entry));
    await drive.evalJs(cdp, "console.log('kit-marker-abc', 42)");
    await sleep(400);
    unsubscribe();
    const marker = seen.find((entry) => entry.args.includes("kit-marker-abc"));
    assert.ok(marker, "应捕获到 console.log");
    assert.equal(marker.type, "log");
    assert.ok(marker.args.includes(42), "多参数应归一化透传");

    // inject：addScriptToEvaluateOnNewDocument → 新文档自动执行（document_start 语义）
    const observerSource = readSource("src/hid-observer.js");
    await drive.inject(cdp, observerSource);
    await cdp.send("Page.navigate", { url: fixtureUrl("hid-docstart-page.html") });
    await waitReady(cdp);
    assert.equal(await drive.evalJs(cdp, "typeof window.__hidLog"), "object", "observer 应随新文档自动注入");
    const docstartEntries = await drive.evalJs(cdp, "__hidLog.dump()");
    assert.ok(
      docstartEntries.some((entry) => entry.op === "getDevices" && entry.api === "hid"),
      "document_start 注入应先于页面脚本捕获 getDevices",
    );

    // screenshot：viewport 与 fullPage 均产出合法 PNG
    const fullPng = await drive.screenshot(cdp, { fullPage: true });
    assert.ok(fullPng.length > 500, "fullPage 截图应有实际内容");
    assert.equal(fullPng[0], 0x89);
    assert.equal(fullPng[1], 0x50); // PNG 签名
    const viewportPng = await drive.screenshot(cdp);
    assert.ok(viewportPng.length > 500, "viewport 截图应有实际内容");

    await cdp.close();
  } finally {
    await drive.close();
  }

  // close() 清理：进程被杀、临时 userDataDir 被删
  assert.notEqual(launched.proc.exitCode, null, "Chrome 进程应已被 close() 终止");
  assert.equal(existsSync(launched.userDataDir), false, "临时 userDataDir 应已被删除");
});

test("cdp smoke：显式传入的 userDataDir 不被 close() 删除", { timeout: 120000 }, async () => {
  const port = await getFreePort();
  const ownDir = mkdtempSync(path.join(tmpdir(), "dsh-kit-own-"));
  try {
    await drive.launch({ port, userDataDir: ownDir });
    await drive.close();
    assert.equal(existsSync(ownDir), true, "调用方自备的 userDataDir 必须保留");
  } finally {
    rmSync(ownDir, { recursive: true, force: true, maxRetries: 3 });
  }
});
