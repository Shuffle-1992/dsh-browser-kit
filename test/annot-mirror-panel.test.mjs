/**
 * 批注面板视图模型 —— **行为钉**（2026-10-27 两轮实机回归后的正解 ✓）。
 *
 * 历史：面板原本由 guest 渲染、宿主搬 `outerHTML` 插进活动 DOM ✗ ⇒ ① 有跨文档 HTML 信任问题（审查 F02 ✗）；
 * ② 靠"净化"保安全，结果净化漏掉 SVG/样式 ⇒ 面板渲染成**空白方块** ✗（真机连踩两次 ✓）。
 * 现在：guest 只回**结构化纯文本数据** ✓，宿主用固定样式自己画 ✓ ⇒ 上面两类问题一起消失 ✓。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  annotMirrorViewModelOf,
  annotMirrorNeedsRender,
  isSafeCssColor,
  ANNOT_NOTE_MAX,
  ANNOT_TAG_MAX,
  ANNOT_LIST_MAX,
} from "../src/annot-mirror-view.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (p) => readFileSync(join(root, p), "utf8");

test("视图模型：空态（count=0 ⇒ 标题「批注」+ empty ✓）", () => {
  const vm = annotMirrorViewModelOf({ count: 0, list: [] });
  assert.equal(vm.title, "批注");
  assert.equal(vm.countText, "0");
  assert.equal(vm.empty, true);
  assert.deepEqual(vm.items, []);
  assert.equal(vm.hiddenCount, 0);
});

test("视图模型：有条目（编号 / 意见 / 元素标签 ✓）", () => {
  const vm = annotMirrorViewModelOf({
    count: 2,
    list: [
      { n: 1, note: "这个按钮文案太长", tag: "button", badge: "#2563eb", windowCode: "A", windowLabel: "会话窗口 1" },
      { n: 2, note: "", tag: "input", label: "邮箱输入框", badge: "#16a34a" },
    ],
  });
  assert.equal(vm.title, "批注");
  assert.equal(vm.countText, "2");
  assert.equal(vm.empty, false);
  assert.deepEqual(vm.items[0], {
    n: 1, note: "这个按钮文案太长", hasNote: true, tag: "button",
    badge: "#2563eb", windowCode: "A", windowLabel: "会话窗口 1",
  });
  // 无意见 ⇒ hasNote=false（渲染端显示「（未填写意见）」✓）
  assert.equal(vm.items[1].hasNote, false);
  assert.equal(vm.items[1].tag, "input");
  assert.equal(vm.items[1].badge, "#16a34a", "已提交徽标（绿）必须透传 ✓");
});

test("视图模型：超长文本截断 + 空白折叠（面板不被撑爆 ✓）", () => {
  const longNote = "啊".repeat(ANNOT_NOTE_MAX + 50);
  const vm = annotMirrorViewModelOf({ count: 1, list: [{ n: 1, note: longNote, tag: "x".repeat(ANNOT_TAG_MAX + 20) }] });
  assert.ok(vm.items[0].note.length <= ANNOT_NOTE_MAX, "意见必须截断 ✓");
  assert.ok(vm.items[0].note.endsWith("…"), "截断要有省略号 ✓");
  assert.ok(vm.items[0].tag.length <= ANNOT_TAG_MAX);
  const ws = annotMirrorViewModelOf({ count: 1, list: [{ n: 1, note: "  多行\n\n文本   " }] });
  assert.equal(ws.items[0].note, "多行 文本", "空白必须折叠成单行 ✓");
});

test("视图模型：列表上限 + 剩余条数（hiddenCount ✓）", () => {
  const list = Array.from({ length: ANNOT_LIST_MAX + 7 }, (_, i) => ({ n: i + 1, note: `n${i + 1}` }));
  const vm = annotMirrorViewModelOf({ count: list.length, list });
  assert.equal(vm.items.length, ANNOT_LIST_MAX, "列表必须有上限 ✓");
  assert.equal(vm.hiddenCount, 7, "剩余条数必须可展示 ✓");
});

test("视图模型：脏数据不抛（缺字段 / 非对象 / 编号非法 ✓）", () => {
  for (const bad of [null, undefined, 0, "x", [], { list: "nope" }, { list: [null, 3, {}] }]) {
    const vm = annotMirrorViewModelOf(bad);
    assert.ok(vm && typeof vm.title === "string", "脏数据必须给可用视图模型 ✓（不抛 ✗）");
  }
  const vm = annotMirrorViewModelOf({ list: [{ n: "abc", note: "x" }, {}] });
  assert.equal(vm.items[0].n, 1, "非法编号回退到序号 ✓");
  assert.equal(vm.items[1].n, 2);
});

test("徽标颜色只接受安全色值（防把任意 CSS 注入内联样式 ✗）", () => {
  for (const ok of ["#2563eb", "#16a34a", "#9ca3af", "#fff", "#2563ebcc", "rgb(37, 99, 235)", "rgba(37,99,235,0.5)"]) {
    assert.equal(isSafeCssColor(ok), true, ok + " 应放行 ✓");
  }
  for (const bad of ["red", "url(https://evil/x)", "expression(alert(1))", "var(--x)", "", null, "#12", "rgb(1,2,3); background:red"]) {
    assert.equal(isSafeCssColor(bad), false, String(bad) + " 必须拒绝 ✗");
  }
  // 非法颜色在视图模型里被丢掉 ⇒ 渲染端回退到 ACCENT ✓
  const vm = annotMirrorViewModelOf({ count: 1, list: [{ n: 1, note: "x", badge: "url(https://evil/x)" }] });
  assert.equal(vm.items[0].badge, "", "非法徽标色必须被丢弃 ✗");
});

test("重绘判定：rev 未变 ⇒ 不重绘；rev 变 / 首次 ⇒ 重绘 ✓", () => {
  assert.equal(annotMirrorNeedsRender(null, { rev: 1 }), true, "首次必须渲染 ✓");
  assert.equal(annotMirrorNeedsRender({ rev: 3 }, { rev: 3 }), false, "rev 未变不重绘 ✓");
  assert.equal(annotMirrorNeedsRender({ rev: 3 }, { rev: 4 }), true, "rev 变必须重绘 ✓");
  assert.equal(annotMirrorNeedsRender({ rev: null }, { rev: null }), true, "没有 rev 时保守重绘 ✓");
});

test("parity：client 内嵌副本与正典逐例同结果（A1 模式 ✓）", () => {
  const client = readText("plugin/client.js");
  const m = client.match(/\/\* @annot-mirror-view-canonical-begin[\s\S]*?\/\* @annot-mirror-view-canonical-end \*\//);
  assert.ok(m, "client.js 必须保留 @annot-mirror-view-canonical 内嵌块 ✓");
  const embedded = new Function(
    `${m[0].replace(/^[\s\S]*?\*\//, "").replace(/\/\* @annot-mirror-view-canonical-end \*\//, "")}; return { annotMirrorViewModelOf, annotMirrorNeedsRender, isSafeCssColor };`,
  )();
  const cases = [
    { count: 0, list: [] },
    { count: 3, list: [{ n: 1, note: "a", tag: "button" }, { n: "x", note: "" }, null] },
    { count: 2 },
    null,
    { list: Array.from({ length: ANNOT_LIST_MAX + 2 }, (_, i) => ({ n: i + 1, note: "n" })) },
  ];
  for (const c of cases) {
    assert.deepEqual(embedded.annotMirrorViewModelOf(JSON.parse(JSON.stringify(c))), annotMirrorViewModelOf(c), `视图模型必须一致 ✗ ${JSON.stringify(c).slice(0, 60)}`);
  }
  for (const [p, n] of [[null, { rev: 1 }], [{ rev: 2 }, { rev: 2 }], [{ rev: 2 }, { rev: 3 }]]) {
    assert.equal(embedded.annotMirrorNeedsRender(p, n), annotMirrorNeedsRender(p, n), "重绘判定必须一致 ✓");
  }
  for (const c of ["#2563eb", "rgba(1,2,3,0.5)", "red", "url(x)", ""]) {
    assert.equal(embedded.isSafeCssColor(c), isSafeCssColor(c), "颜色校验必须一致 ✓ " + c);
  }
});

test("架构钉子：宿主**不再**搬运 guest HTML（F02 的根本修法 ✓）", () => {
  const client = readText("plugin/client.js");
  const code = client.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // ① 不再调用 mirrorSnapshot / 不再用它的 html
  assert.doesNotMatch(code, /mirrorSnapshot/, "宿主不得再调用 mirrorSnapshot ✗");
  /* ② innerHTML 只允许写**自家图标常量** ✓（信任边界内）；任何来自页面/命令的数据都不许 ✗ */
  /* `inner` 是**宿主→guest** 注入我们自己的批注器脚本（方向相反、内容可信 ✓），不算跨文档搬运 ✗ */
  const TRUSTED_ICON_RHS = new Set(["want", "ANNOT_ICON_SVG", "SHOT_ICON_SVG", "svg", "inner"]);
  const rhs = [...code.matchAll(/\.innerHTML\s*=\s*([A-Za-z0-9_$.]+)/g)].map((m) => m[1]);
  assert.ok(rhs.length > 0, "应当只剩图标常量赋值 ✓（若全没了更好，但要显式确认 ✓）");
  for (const r of rhs) {
    assert.ok(TRUSTED_ICON_RHS.has(r), `innerHTML 只允许写可信图标常量，发现可疑来源：${r} ✗`);
  }
  // 页面/命令数据一律不得进 innerHTML ✓
  for (const bad of ["html", "snap.html", "raw", "data", "text", "String("]) {
    assert.equal(rhs.includes(bad), false, `innerHTML 不得写 ${bad} ✗`);
  }
  // ③ 必须用结构化接口
  assert.match(code, /a\.mirrorData/, "必须拉结构化 mirrorData ✓");
  assert.match(code, /JSON\.parse\(raw\)/, "必须按 JSON 解析（纯数据 ✓）");
  // ④ 面板结构顺序（绑定与列表显隐依赖 children[0..2] ✓）
  const panel = code.slice(code.indexOf("const renderAnnotMirrorPanel ="), code.indexOf("const syncAnnotMirror = async () =>"));
  /* 结构契约：root 的子节点依次是 头部 → 列表体 → 底部 ✓
   * （不钉变量名 ✗ —— 改名就会误红；按 appendChild 的**出现顺序**判定 ✓）
   * 列表体是第二个子节点这件事由 applyAnnotMirrorListState 的 children[1] 依赖 ✓，必须一致 ✓。 */
  const appends = [...panel.matchAll(/root\.appendChild\(([A-Za-z0-9_$]+)\)/g)].map((m) => m[1]);
  assert.equal(appends.length, 3, "root 必须恰好追加三个子节点（头部/列表体/底部 ✓）");
  assert.deepEqual(appends, ["head", "list", "footer"], "子节点顺序必须是 头部 → 列表体 → 底部 ✓");
  // 列表体必须由「展开/收起」控制显隐（宿主约定 children[1] ✓）
  assert.match(code, /root\.children\[1\]/, "applyAnnotMirrorListState 必须仍按 children[1] 控制列表体 ✓");
  // ⑤ 文本一律 textContent（不是 HTML 解析 ✓）
  assert.match(panel, /textContent/, "面板文本必须用 textContent ✓");
  assert.doesNotMatch(panel, /innerHTML|insertAdjacentHTML|outerHTML/, "面板渲染不得出现 HTML 注入 API ✗");
  // ⑥ guest 侧必须提供结构化接口
  const ann = readText("src/element-annotator.js");
  assert.match(ann, /mirrorData: function/, "annotator 必须提供 mirrorData ✓");
  const dataPart = ann.slice(ann.indexOf("mirrorData: function"));
  assert.match(dataPart.slice(0, 900), /list: out/, "mirrorData 必须回 list（纯文本字段 ✓）");
  assert.doesNotMatch(dataPart.slice(0, 900), /outerHTML|innerHTML/, "mirrorData 不得回 HTML ✗");
});
