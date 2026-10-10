/**
 * test/annotator-smoke.test.js — element-annotator Chrome 冒烟：
 * 批注状态机（点击钉标 → 就地意见 → 面板/API 提交 → Esc 取消）+ capture 拦截 + 密码框可批注（1.3.0）
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

    // 密码框可批注（1.3.0：移除跳过逻辑；载荷白名单排除 value，无泄露）
    await drive.evalJs(cdp, 'document.getElementById("pwd").click()');
    await drive.evalJs(cdp, 'document.querySelector("[data-dsh-kit-confirm]").click()');
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 3, "密码框应正常入列");

    // SPA 式移除已标注元素 → stale
    await drive.evalJs(cdp, 'document.querySelectorAll(".card")[1].remove()');

    // API submit：纯打包，不结束会话
    const packed = JSON.parse(await drive.evalJs(cdp, "JSON.stringify(window.__dshKitAnnotator.submit())"));
    assert.ok(packed.markdown.startsWith("# Web page annotations: 3"), packed.markdown.slice(0, 40));
    assert.equal(packed.annotations.length, 3);
    assert.equal(packed.annotations[0].note, "按钮太小，加大 padding");
    assert.equal(packed.annotations[1].note, undefined);
    assert.equal(packed.annotations[1].stale, true, "被移除元素的批注应判 stale");
    assert.equal(packed.annotations[2].element.tagName, "input", "密码框应作为第 3 条入列");
    assert.ok(packed.markdown.includes("[element no longer matched]"));

    // Node 侧协议 parse 对拍 + round-trip
    const parsed = parseAnnotationsMarkdown(packed.markdown);
    assert.equal(parsed.annotations.length, 3);
    assert.equal(parsed.annotations[0].element.tagName, "button");
    assert.equal(parsed.annotations[0].element.selector, "#btn-a");
    assert.equal(parsed.annotations[0].element.accessibleName, "保存表单");
    assert.equal(parsed.annotations[0].note, "按钮太小，加大 padding");
    assert.equal(parsed.annotations[1].note, undefined);
    assert.equal(parsed.annotations[1].stale, true);
    assert.equal(parsed.annotations[1].element.rect.width, 120);

    // v26（用户指定）：面板已无「提交」按钮 —— 打包改由**宿主在"消息发送出去"时**发起。
    // 冒烟里走同源的公开 API：submit() 取打包结果，再 stop() 收束会话。
    await drive.evalJs(cdp, "window.__dshKitSubmitted = window.__dshKitAnnotator.submit(); 'ok'");
    // v26：面板按钮集变化（✕ 关闭 / 清除 / 展开收起；不再有提交、取消）——**必须在 stop() 之前查**
    assert.equal(await drive.evalJs(cdp, 'Boolean(document.querySelector("[data-dsh-kit-panel-submit]"))'), false, "不应再有提交按钮");
    assert.equal(await drive.evalJs(cdp, 'Boolean(document.querySelector("[data-dsh-kit-panel-cancel]"))'), false, "不应再有取消按钮");
    assert.equal(await drive.evalJs(cdp, 'Boolean(document.querySelector("[data-dsh-kit-panel-close]"))'), true, "应有 ✕ 关闭按钮");
    assert.equal(await drive.evalJs(cdp, 'Boolean(document.querySelector("[data-dsh-kit-panel-toggle]"))'), true, "应有展开/收起按钮");
    await drive.evalJs(cdp, "window.__dshKitAnnotator.stop(); 'stopped'");
    assert.equal(await drive.evalJs(cdp, "window.__p"), "cancelled", "stop() 收束会话（v26 不再有面板提交回调路径）");
    assert.equal(
      await drive.evalJs(cdp, "Boolean(window.__dshKitSubmitted && window.__dshKitSubmitted.markdown.length > 0)"),
      true,
      "submit() 应收到协议块",
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
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 3, "stop 保留已收集批注");

    // clear 清空
    await drive.evalJs(cdp, "window.__dshKitAnnotator.clear()");
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 0);

    // clearAll（1.4.0）：清空 + 全量 gid 写删除日志（共享会话跨窗口广播移除的依据）
    await drive.evalJs(cdp, "window.__p4 = window.__dshKitAnnotator.start(); 'ok'");
    await drive.evalJs(cdp, 'document.getElementById("btn-a").click()');
    await drive.evalJs(cdp, 'document.querySelector("[data-dsh-kit-confirm]").click()');
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 1);
    await drive.evalJs(cdp, "window.__dshKitAnnotator.clearAll()");
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 0, "clearAll 清空列表");
    assert.equal(
      await drive.evalJs(cdp, "(window.__dshKitDeletedGids || []).length"),
      1,
      "clearAll 应把该 gid 写入删除日志（否则其他窗口会被 addExternal 推回来）",
    );

    // 面板「清除」按钮：存在、位于**关闭图标左侧**（v26：头部顺序 = 图标/标题/计数/清除/✕）、点击即 clearAll 语义
    await drive.evalJs(cdp, "window.__p5 = window.__dshKitAnnotator.start(); 'ok'");
    const domOrder = await drive.evalJs(
      cdp,
      '(function () { var c = document.querySelector("[data-dsh-kit-panel-clear]"); var v = document.querySelector("[data-dsh-kit-panel-close]"); if (!c || !v) return "missing"; return (c.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING) ? "close-after-clear" : "wrong-order"; })()',
    );
    assert.equal(domOrder, "close-after-clear", "清除按钮应在关闭（✕）图标左侧（DOM 顺序）");
    await drive.evalJs(cdp, 'document.getElementById("btn-a").click()');
    await drive.evalJs(cdp, 'document.querySelector("[data-dsh-kit-confirm]").click()');
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 1);
    await drive.evalJs(cdp, 'document.querySelector("[data-dsh-kit-panel-clear]").click()');
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 0, "面板清除按钮应清空全部");
    assert.equal(
      await drive.evalJs(cdp, "(window.__dshKitDeletedGids || []).length"),
      2,
      "面板清除按钮与 clearAll 同源：gid 进删除日志",
    );

    // 同页门控（1.5.0）：跨页共享项只进列表不渲染徽标；同页共享项照常渲染
    await drive.evalJs(
      cdp,
      'window.__dshKitAnnotator.addExternal([{ gid: "xpage-1", index: 9, note: "别的页面来的", element: { tagName: "button", selector: "#btn-a" }, _originUrl: "http://other.example/login" }])',
    );
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 1, "跨页共享项应进共享板块列表");
    assert.equal(
      await drive.evalJs(cdp, 'document.querySelectorAll("[data-dsh-kit-marker]").length'),
      0,
      "跨页共享项不得渲染徽标（防串窗，用户实测反馈）",
    );
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list()[0].stale"), undefined, "跨页共享项无 stale 语义");
    await drive.evalJs(
      cdp,
      'window.__dshKitAnnotator.addExternal([{ gid: "xpage-2", index: 10, note: "同页来的", element: { tagName: "button", selector: "#btn-a" }, _originUrl: location.href }])',
    );
    assert.equal(await drive.evalJs(cdp, 'document.querySelectorAll("[data-dsh-kit-marker]").length'), 1, "同页共享项照常渲染徽标");

    // A2：addExternal 更新分支（同 gid 改 note → 徽标/列表同步）+ removeExternal 写删除日志
    await drive.evalJs(
      cdp,
      'window.__dshKitAnnotator.addExternal([{ gid: "xpage-2", index: 10, note: "更新后的意见", element: { tagName: "button", selector: "#btn-a" }, _originUrl: location.href }])',
    );
    const updated = JSON.parse(await drive.evalJs(cdp, 'JSON.stringify(window.__dshKitAnnotator.list().find(function (a) { return a.gid === "xpage-2"; }))'));
    assert.equal(updated.note, "更新后的意见", "同 gid 再推送应更新 note");
    const delLogBefore = JSON.parse(await drive.evalJs(cdp, "JSON.stringify(window.__dshKitDeletedGids || [])"));
    await drive.evalJs(cdp, 'window.__dshKitAnnotator.removeExternal("xpage-2")');
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 1, "removeExternal 应移除该条");
    const delLogAfter = JSON.parse(await drive.evalJs(cdp, "JSON.stringify(window.__dshKitDeletedGids || [])"));
    assert.ok(delLogAfter.includes("xpage-2") && !delLogBefore.includes("xpage-2"), "removeExternal 应写删除日志");

    // A3：startIndex 编号交接下限（P26 契约的 annotator 侧）：start({startIndex:5}) 后首条 = 6
    await drive.evalJs(cdp, "window.__dshKitAnnotator.clearAll()");
    await drive.evalJs(cdp, "window.__p6 = window.__dshKitAnnotator.start({ startIndex: 5 }); 'ok'");
    await drive.evalJs(cdp, 'document.getElementById("btn-a").click()');
    await drive.evalJs(cdp, 'document.querySelector("[data-dsh-kit-confirm]").click()');
    assert.equal(
      await drive.evalJs(cdp, "window.__dshKitAnnotator.list()[0].index"),
      6,
      "startIndex 是下限：首条编号应为 6（max(list, 5) + 1）",
    );

    // A4（R-01，评审采纳）：意见框键盘交互——capture 屏蔽层曾使 field 的 Enter/Esc
    // 监听成为死代码（capture stopPropagation 后事件不进 target 阶段，Enter 实际是换行、
    // Esc 无响应）。此处用真实事件传播路径验证修复：Enter=提交并关框、Esc=丢弃并关框。
    await drive.evalJs(cdp, "window.__dshKitAnnotator.clearAll()");
    await drive.evalJs(cdp, "window.__dshKitAnnotator.start(); 'ok'");
    await drive.evalJs(cdp, 'document.getElementById("btn-a").click()');
    await drive.evalJs(
      cdp,
      'var f = document.querySelector("[data-dsh-kit-note-field]"); f.value = "键盘确认路径";'
      + 'f.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));',
    );
    assert.equal(
      await drive.evalJs(cdp, 'document.querySelector("[data-dsh-kit-marker]").getAttribute("data-state")'),
      "confirmed",
      "R-01：Enter 应经 capture 分流提交批注（修复前为死代码，实际行为是换行）",
    );
    assert.ok(
      !(await drive.evalJs(cdp, 'Boolean(document.querySelector("[data-dsh-kit-note-input]"))')),
      "R-01：Enter 提交后意见框应关闭",
    );
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list()[0].note"), "键盘确认路径", "R-01：Enter 提交应带上输入的意见");
    // Esc 丢弃：再开一条，输入后 Esc 应关闭意见框且不入列
    await drive.evalJs(cdp, 'document.getElementById("btn-a").click()');
    await drive.evalJs(
      cdp,
      'var f2 = document.querySelector("[data-dsh-kit-note-field]"); f2.value = "应被丢弃";'
      + 'f2.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));',
    );
    assert.ok(
      !(await drive.evalJs(cdp, 'Boolean(document.querySelector("[data-dsh-kit-note-input]"))')),
      "R-01：Esc 应经 capture 分流关闭意见框（修复前为死代码）",
    );
    assert.equal(await drive.evalJs(cdp, "window.__dshKitAnnotator.list().length"), 1, "R-01：Esc 丢弃不应入列");

    await cdp.close();
  } finally {
    await drive.close();
  }
});
