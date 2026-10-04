/**
 * test/annotator-smoke.test.js — element-annotator Chrome 冒烟：
 * 批注状态机（点击钉标 → 就地意见 → 面板/API 提交 → Esc 取消）+ capture 拦截 + 密码框跳过
 * + stale 标注 + 协议 round-trip 对拍（任务书 §3.6-4）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnnotationsMarkdown } from "../src/annotations-protocol.js";
import * as drive from "../src/cdp/drive.mjs";
import { clickAt, fixtureUrl, getFreePort, readSource, sleep, waitReady } from "./helpers/chrome.mjs";

test("annotator 冒烟：批注流全链路 + 协议 round-trip", { timeout: 120000 }, async () => {
  const port = await getFreePort();
  await drive.launch({ port });
  try {
    const cdp = await drive.connect(port);
    await cdp.send("Page.navigate", { url: fixtureUrl("page.html") });
    await waitReady(cdp);

    await drive.inject(cdp, readSource("src/element-annotator.js"));
    assert.equal(await drive.evalJs(cdp, "typeof window.__dshKitAnnotator"), "object");

    // 开始会话（Promise 挂在 window.__p 上，不阻塞求值）
    await drive.evalJs(
      cdp,
      "window.__p = window.__dshKitAnnotator.start({ onSubmit: function (r) { window.__dshKitSubmitted = r; } }); 'started'",
    );
    assert.equal(
      await drive.evalJs(cdp, 'Boolean(document.querySelector("[data-dsh-kit-picker-overlay]"))'),
      true,
      "hover 高亮层应存在",
    );

    // 真实 CDP 鼠标点击 #btn-a —— capture 拦截应阻断页面 click 处理器
    const rect = JSON.parse(
      await drive.evalJs(cdp, 'JSON.stringify(document.getElementById("btn-a").getBoundingClientRect())'),
    );
    await clickAt(cdp, rect.x + rect.width / 2, rect.y + rect.height / 2);
    await sleep(100);
    assert.equal(
      await drive.evalJs(cdp, 'document.getElementById("click-log").childElementCount'),
      0,
      "批注态点击应被 capture 拦截，页面处理器不得收到",
    );
    assert.equal(await drive.evalJs(cdp, 'document.querySelectorAll("[data-dsh-kit-marker]").length'), 1);
    assert.equal(
      await drive.evalJs(cdp, 'document.querySelector("[data-dsh-kit-marker]").getAttribute("data-state")'),
      "pending",
    );
    assert.ok(await drive.evalJs(cdp, 'Boolean(document.querySelector("[data-dsh-kit-note-input]"))'));

    // 就地输入意见并确认
    await drive.evalJs(
      cdp,
      'document.querySelector("[data-dsh-kit-note-field]").value = "按钮太小，加大 padding"; document.querySelector("[data-dsh-kit-confirm]").click()',
    );
    assert.equal(
      await drive.evalJs(cdp, 'document.querySelector("[data-dsh-kit-marker]").getAttribute("data-state")'),
      "confirmed",
      "确认后徽标应变实心",
    );

    // 第二个元素：留空意见（等价 ZCode 快速引用形态）
    await drive.evalJs(cdp, 'document.querySelectorAll(".card")[1].click()');
    await drive.evalJs(cdp, 'document.querySelector("[data-dsh-kit-confirm]").click()');
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 2);

    // 密码框跳过
    await drive.evalJs(cdp, 'document.getElementById("pwd").click()');
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 2, "密码框不得入列");

    // SPA 式移除已标注元素 → stale
    await drive.evalJs(cdp, 'document.querySelectorAll(".card")[1].remove()');

    // API submit：纯打包，不结束会话
    const packed = JSON.parse(await drive.evalJs(cdp, "JSON.stringify(window.__dshKitAnnotator.submit())"));
    assert.ok(packed.markdown.startsWith("# Web page annotations: 2"), packed.markdown.slice(0, 40));
    assert.equal(packed.annotations.length, 2);
    assert.equal(packed.annotations[0].note, "按钮太小，加大 padding");
    assert.equal(packed.annotations[1].note, undefined);
    assert.equal(packed.annotations[1].stale, true, "被移除元素的批注应判 stale");
    assert.ok(packed.markdown.includes("[element no longer matched]"));

    // Node 侧协议 parse 对拍 + round-trip
    const parsed = parseAnnotationsMarkdown(packed.markdown);
    assert.equal(parsed.annotations.length, 2);
    assert.equal(parsed.annotations[0].element.tagName, "button");
    assert.equal(parsed.annotations[0].element.selector, "#btn-a");
    assert.equal(parsed.annotations[0].element.accessibleName, "保存表单");
    assert.equal(parsed.annotations[0].note, "按钮太小，加大 padding");
    assert.equal(parsed.annotations[1].note, undefined);
    assert.equal(parsed.annotations[1].stale, true);
    assert.equal(parsed.annotations[1].element.rect.width, 120);

    // 面板「提交」：onSubmit 回调 + 会话以 submitted 收束
    await drive.evalJs(cdp, 'document.querySelector("[data-dsh-kit-panel-submit]").click()');
    assert.equal(await drive.evalJs(cdp, "window.__p"), "submitted");
    assert.equal(
      await drive.evalJs(cdp, "Boolean(window.__dshKitSubmitted && window.__dshKitSubmitted.markdown.length > 0)"),
      true,
      "onSubmit 应收到协议块",
    );
    assert.equal(
      await drive.evalJs(cdp, 'document.querySelectorAll("[data-dsh-kit-marker]").length'),
      0,
      "会话结束后图层应清理",
    );

    // Esc 取消路径 + store 保留语义
    await drive.evalJs(cdp, "window.__p2 = window.__dshKitAnnotator.start(); 'ok'");
    await drive.evalJs(cdp, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    assert.equal(await drive.evalJs(cdp, "window.__p2"), "cancelled");
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 2, "stop 保留已收集批注");

    // clear 清空
    await drive.evalJs(cdp, "window.__dshKitAnnotator.clear()");
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 0);

    await cdp.close();
  } finally {
    await drive.close();
  }
});
