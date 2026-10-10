/**
 * annot-delivery 回归钉子（批注 → Agent 上下文 的交付通道）。
 *
 * 事故：用户「在另一个会话的自持浏览器批注了发送，Agent 没有收到批注内容」。
 * 成因链：批注**落盘成功** ✓、消息行有胶囊 ✓，但**胶囊是 DOM 装饰、模型看不到** ✗；
 *   而历史上唯一进 agent 上下文的通道（把「已提交…路径」写进**用户输入框**）已按用户要求
 *   「不要带文字」删除 ✗ ⇒ 交付通道缺失。
 * 修法：用 DSH 官方注入点 `agent/pre-step`（waterfall）在**轮首**追加一条 user 消息
 *   （摘要 + 落盘路径），不碰输入框、不改用户消息、一次性、只在 step===1。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderAnnotDelivery, summarizeSetsForDelivery, SOURCE_KIND } from "../plugin/annot-delivery.host.mjs";

const deliverySrc = readFileSync(new URL("../plugin/annot-delivery.host.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const hostSrc = readFileSync(new URL("../plugin/host.impl.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const clientSrc = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("交付文本必须含：条数 + 落盘路径 + 窗口归属 + 逐条摘要 + 读取提示", () => {
  const text = renderAnnotDelivery({
    count: 2,
    path: "F:\\proj\\annotations\\x.md",
    windows: [{ code: "A", label: "A · DSH 会话浏览器 #1", count: 1 }, { code: "C", label: "C · 自持浏览器 #1", count: 1 }],
    items: [
      { index: 1, tag: "button", name: "保存", code: "A" },
      { index: 2, tag: "h1", name: "标题", code: "C" },
    ],
  });
  assert.match(text, /\[dsh-browser-kit\]/, "要有来源前缀");
  assert.match(text, /2 条元素批注/, "要写清条数");
  assert.match(text, /批注文件：F:\\proj\\annotations\\x\.md/, "必须给出落盘文件绝对路径");
  assert.match(text, /窗口 A/, "必须带窗口归属（A）");
  assert.match(text, /窗口 C/, "必须带窗口归属（C）");
  assert.match(text, /#1 button「保存」（窗口 A）/, "逐条摘要要含索引/标签/名称/窗口");
  assert.match(text, /读取/, "要提示 agent 去读文件（而不是让用户重发）");
});

test("summarizeSetsForDelivery：只统计本次新提交（dirty===false 的跳过），并按窗口聚合", () => {
  const sets = [
    {
      url: "http://a/", owner: "A · DSH 会话浏览器 #1",
      annotations: [
        { index: 1, dirty: true, windowCode: "A", window: "A · DSH 会话浏览器 #1", element: { tagName: "button", accessibleName: "保存" } },
        { index: 2, dirty: false, windowCode: "A", window: "A · DSH 会话浏览器 #1", element: { tagName: "i" } },
      ],
    },
    { url: "http://b/", owner: "C · 自持浏览器 #1", annotations: [{ index: 3, dirty: true, windowCode: "C", window: "C · 自持浏览器 #1", element: { tagName: "h1", text: "标题" } }] },
  ];
  const brief = summarizeSetsForDelivery(sets);
  assert.equal(brief.items.length, 2, "已提交过（dirty=false）的不再重复上报");
  assert.deepEqual(brief.items.map((i) => i.index), [1, 3]);
  assert.deepEqual(brief.windows.map((w) => `${w.code}:${w.count}`).sort(), ["A:1", "C:1"], "按窗口聚合条数");
});

test("宿主：saveMerged 成功后登记待投递，并把 sessionId 带进 meta", () => {
  assert.match(hostSrc, /state\.recordAnnotDelivery\(sid, \{ count: r\.count, path: r\.path, items: brief\.items, windows: brief\.windows \}\)/, "saveMerged 必须登记待投递");
  // 动态 import 模型下，同文件静态引用会是 undefined ⇒ 必须走模块引用
  assert.match(hostSrc, /const brief = annotDelivery \? annotDelivery\.summarizeSetsForDelivery\(sets\)/, "必须经动态模块引用拿 summarize");
  assert.match(hostSrc, /import\(`\.\/annot-delivery\.host\.mjs\?ts=\$\{wireCacheBust \|\| Date\.now\(\)\}`\)/, "交付模块必须带 ?ts= 动态加载（P13 缓存变体）");
  assert.match(hostSrc, /annotDelivery: state\.annotDelivery \|\| null,/, "报告里要暴露交付诊断");
  assert.match(clientSrc, /const meta = \{ sessionId: currentSurfaceSession\(\) \|\| null, at: new Date\(\)\.toISOString\(\) \};/, "客户端必须把 sessionId 交给宿主");
});

test("注入点：agent/pre-step，只在 step===1，投递后清除，异常不影响主流程", () => {
  assert.match(deliverySrc, /ctx\.on\('agent\/pre-step'/, "必须注册 agent/pre-step");
  assert.match(deliverySrc, /if \(Number\(payload && payload\.step\) !== 1\)/, "只在轮首注入（避免拆开 tool_use/结果对）");
  assert.match(deliverySrc, /pending\.delete\(String\(sid\)\);/, "投递后必须清除（一次性，不刷屏）");
  assert.match(deliverySrc, /return \{ \.\.\.decision, messages: \[\.\.\.\(\(decision && decision\.messages\) \|\| \[\]\), message\] \};/, "以追加消息方式注入（不改用户消息）");
  assert.match(deliverySrc, /source: \{ kind: SOURCE_KIND, form: 'snapshot', sections: \[\{ name: SOURCE_KIND, text \}\] \}/, "注入消息要带 source 归属标记");
  assert.match(deliverySrc, /catch \(e\) \{\s*diag\.lastError = String\(\(e && e\.message\) \|\| e\); \/\/ 绝不因为注入失败影响主流程/, "注入异常必须吞掉并记账");
  assert.match(deliverySrc, /export const SOURCE_KIND = 'dsh-browser-kit';/);
  assert.equal(SOURCE_KIND, "dsh-browser-kit");
});

test("激活安全：ctx.on / createUserMessage 不可用时只 warn + 记账", () => {
  assert.match(deliverySrc, /if \(!createUserMessage\) \{/, "createUserMessage 解析失败要有分支");
  assert.match(deliverySrc, /if \(typeof \(ctx && ctx\.on\) !== 'function'\) \{/, "ctx.on 不可用要有分支");
  assert.match(deliverySrc, /diag\.reason = /, "失败原因要记入诊断");
  assert.match(hostSrc, /ad\.registerAnnotDelivery\(ctx, state, \(level, line\) => log\(level === 'warn' \? 'warn' : 'info', line\), \(\) => writeReport\(reportPath, state, 'annot-delivery changed'\)\)/, "宿主必须接线（传日志函数 + 变更即写报告，保证诊断可查）");
});

test("客户端提供 annot-consume（立即交付 + 端到端可验收）", () => {
  assert.match(clientSrc, /'annot-consume': async function \(\) \{/, "缺少 annot-consume 命令");
  assert.match(clientSrc, /const r = await consumeDraft\(null\);/, "annot-consume 必须复用 consumeDraft（与用户发送同一条链路）");
  assert.match(clientSrc, /delivery: '已交给宿主：将在该会话下一轮首步注入 Agent 上下文（agent\/pre-step）'/, "回执要说明交付去向");
});
