/**
 * 批注投递瘦身 + 消息下方卡片 —— 行为钉。
 *
 * 用户反馈（2026-10-28）：
 *  ① "批注胶囊在发送出去的信息中容易丢失显示，这个方式不稳定；改成在信息后面带一个
 *     批注 N 条（我发送的信息下面），点击可以查看内容"；
 *  ② "批注引入的信息体积比较大，主要是元素的路径等，看下能不能简化，随便几条批注就要 100KB"。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderCompactDelivery,
  compactAnnotationLineOf,
  compactSelectorOf,
  clipTextOf,
  ANNOT_DELIVERY_LIMIT,
  ANNOT_LINE_MAX,
  ANNOT_SELECTOR_MAX,
} from "../src/annot-compact.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (p) => readFileSync(join(root, p), "utf8");
const clientSrc = () => readText("plugin/client.js");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LONG_SEL = "html > body > div:nth-child(2) > main.content > form#order-form > div.actions > button.submit.primary";
const itemOf = (i, extra = {}) => ({
  index: i,
  tag: extra.tag || "BUTTON",
  name: extra.name || `提交订单按钮${i}`,
  note: extra.note || "颜色不对，应该是深蓝而不是现在的浅蓝",
  code: extra.code || "A",
  window: extra.window || "窗口 A",
  sel: extra.sel === undefined ? LONG_SEL : extra.sel,
});

test("体积：4 条批注的投递文本 < 1.5KB（旧实现内联协议全文约 100KB）", () => {
  const text = renderCompactDelivery({
    count: 4,
    items: [1, 2, 3, 4].map((i) => itemOf(i)),
    windows: [{ code: "A", label: "KEYSION 商城", count: 4 }],
    path: "plugin/.data/annotations/x.md",
    latestPath: "plugin/.data/annotations/latest.md",
  });
  assert.ok(text.length < 1500, `实际 ${text.length} 字符`);
  // 也要真的比"旧实现同内容"小一个量级
  const legacyLike = 4 * 12000;
  assert.ok(text.length * 10 < legacyLike, "必须比内联全文小一个量级以上");
});

test("体积：50 条批注也不会超过总预算（超出按条截断并说明）", () => {
  const items = Array.from({ length: 50 }, (_, k) => itemOf(k + 1, { note: "x".repeat(200) }));
  const text = renderCompactDelivery({ count: 50, items, windows: [], path: "a.md" });
  assert.ok(text.length <= ANNOT_DELIVERY_LIMIT + 400, `实际 ${text.length}，预算 ${ANNOT_DELIVERY_LIMIT}`);
  assert.match(text, /另有 \d+ 条未内联/, "截断必须明说还有多少条");
  assert.match(text, /a\.md/, "截断后仍要给出文件路径");
});

test("字段：只带定位必需字段，不带 XPath / HTML 片段 / 属性 / 坐标", () => {
  const text = renderCompactDelivery({
    count: 1,
    items: [itemOf(1)],
    windows: [{ code: "A", label: "站点", count: 1 }],
    path: "p.md",
    markdown: "## Annotation 1\nXPath: /html/body/div[2]\nHTML excerpt:\n```html\n<button>x</button>\n```\nRect: x=1\n",
  });
  assert.match(text, /#1 button「提交订单按钮1」/, "序号 + 标签 + 可读名");
  assert.match(text, /sel: #order-form button\.submit/, "精简选择器");
  assert.doesNotMatch(text, /XPath: /, "不得内联 XPath 字段");
  assert.doesNotMatch(text, /HTML excerpt:/, "不得内联 HTML 片段字段");
  assert.doesNotMatch(text, /Rect: /, "不得内联坐标");
  assert.doesNotMatch(text, /## Annotation 1/, "不得内联协议全文");
});

test("选择器压缩：祖先 id + 末段（既短又能定位到目标元素）", () => {
  assert.equal(compactSelectorOf(LONG_SEL), "#order-form button.submit.primary");
  assert.equal(compactSelectorOf("div#app > div > span"), "#app span");
  assert.equal(compactSelectorOf("#save"), "#save");
  assert.equal(compactSelectorOf("ul.list > li:nth-of-type(2) > a.link"), "li:nth-of-type(2) > a.link");
  assert.equal(compactSelectorOf(""), "");
  // 超长末段仍要有限长
  const long = `div#root > ${"span.deep ".repeat(40)}`;
  assert.ok(compactSelectorOf(long).length <= ANNOT_SELECTOR_MAX + 1);
});

test("单行上限：意见/名称/整行都有上限（防单条撑爆）", () => {
  const line = compactAnnotationLineOf(itemOf(1, { note: "长".repeat(500), name: "名".repeat(200) }));
  assert.ok(line.length <= ANNOT_LINE_MAX + 1, `实际 ${line.length}`);
  assert.ok(line.startsWith("- #1 button"), "固定形状：序号 + 标签");
  assert.equal(clipTextOf("abcdef", 3), "abc…");
  assert.equal(clipTextOf("  a   b  ", 10), "a b");
});

test("健壮：空数据/坏数据不抛，窗口聚合与文件行都在", () => {
  for (const bad of [undefined, null, {}, { items: null, windows: null }]) {
    const text = renderCompactDelivery(bad);
    assert.equal(typeof text, "string");
    assert.match(text, /\[dsh-browser-kit\]/);
  }
  const text = renderCompactDelivery({
    count: 3,
    items: [itemOf(1, { code: "A" }), itemOf(2, { code: "B" }), itemOf(3, { code: "A" })],
    windows: [{ code: "A", label: "窗口A的页面", count: 2 }, { code: "B", label: "窗口B的页面", count: 1 }],
    path: "dir/a.md",
    latestPath: "dir/latest.md",
  });
  assert.match(text, /涉及窗口：窗口 A（2 条/);
  assert.match(text, /窗口 B（1 条/);
  assert.match(text, /批注文件：dir\/a\.md（最近一次固定路径：dir\/latest\.md）/);
  assert.match(text, /browser_annotations/, "要说明按需读取完整记录的工具");
  assert.match(text, /不必搜索存放位置/, "保持旧承诺：不用去找批注在哪");
});

test("接线：宿主投递改用精简渲染（不再内联协议全文）", () => {
  const src = readText("plugin/annot-delivery.host.mjs");
  const code = stripComments(src);
  assert.match(code, /import \{ renderCompactDelivery \} from '\.\.\/src\/annot-compact\.mjs';/, "必须引用精简正典");
  assert.match(code, /export function renderAnnotDelivery\(d\) \{[\s\S]{0,400}?return renderCompactDelivery\(d\);/, "必须委派精简渲染");
  assert.match(code, /sel: \(a\.element && \(a\.element\.selector \|\| ''\)\) \|\| ''/, "items 必须带选择器（供压缩）");
});

test("卡片：**唯一渲染路径 = 消息上方 DOM 注入**（turnTail 插槽已于 2026-10-30 按用户要求移除）", () => {
  const code = stripComments(clientSrc());
  // 主路径：插槽注册
  /* 用户："本轮费用下面的这个，可以删除了" ⇒ turnTail 卡片移除，DOM 注入为唯一路径 */
  assert.ok(!/safeInject\(\'conversation\\.chat\\.turnTail\'/.test(code), "turnTail 不得再注册（已停用）");
  assert.ok(code.includes("attachMsgChipDom") || code.includes("data-dsh-kit-ann-card"), "DOM 注入路径必须在位");
  assert.match(code, /h\('details',/, "卡片用 details 折叠");
  assert.match(code, /h\('summary',/, "标题用 summary");
  // 互斥：插槽可用时绝不走 DOM
  assert.match(code, /const useDomCardFallback = \(\) => \{/, "必须有回退判定");
  assert.match(code, /setTimeout\(/, "必须有延迟自查（避免与插槽双卡）");
  // 回退路径仍完整（防止槽位 API 变化时用户看不到卡片）
  assert.match(code, /const attachMsgChipDom = \(row, model\) => \{/, "回退实现必须保留");
  assert.match(code, /parent\.insertBefore\(card, row\.nextSibling\)/, "回退仍挂在行之后");
  assert.match(code, /var\(--dsw-specific-bubble/, "卡片须与消息气泡同背景（缩小版气泡）");
  assert.match(code, /var\(--dsw-radius-xl/, "卡片须与气泡同圆角");
  assert.match(code, /font-size:11px/, "字号比气泡更小");
});

test("卡片：不再往消息气泡内部塞胶囊（旧不稳定实现的根因）", () => {
  const code = stripComments(clientSrc());
  assert.doesNotMatch(code, /holder\.querySelector\(MSG_CHIP_MARK\)/, "不得再在气泡内部探测旧胶囊");
  assert.doesNotMatch(code, /if \(!holder\.querySelector\(MSG_CHIP_MARK\)\) attachMsgChip\(holder, m\)/, "不得再传 holder 挂胶囊");
});
