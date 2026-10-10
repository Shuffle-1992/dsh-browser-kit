/**
 * v34 回归护栏：**批注必须带窗口信息**（用户要求）。
 *
 * 场景（用户原话）：会话里打开了 DSH 浏览器窗口 A、B，自持浏览器打开窗口 C、D，
 * 批注应各自带上所属窗口 ⇒ Agent 一眼知道批注对应哪个窗口，直达该窗口找元素代码。
 *
 * 落地链路：宿主 `annotWindowTag(pane)` 统一编号（会话窗口在前、自持在后 ⇒ A/B/C/D）
 *   → 落盘 markdown 的 `Window:` 行（协议 build 侧已支持，parse 侧本次补回读）
 *   → 草稿 `_window`（面板行显示窗口代号 + 跳页/水合后仍在）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAnnotationsMarkdown, parseAnnotationsMarkdown } from "../src/annotations-protocol.js";

const clientSrc = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const annotSrc = readFileSync(new URL("../src/element-annotator.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("v34：宿主按「会话窗口在前、自持在后」统一编字母代号", () => {
  assert.match(clientSrc, /const annotWindowTag = \(pane\) => \{/, "缺少 annotWindowTag");
  const a = clientSrc.indexOf("const annotWindowTag = (pane) => {");
  const body = clientSrc.slice(a, clientSrc.indexOf("const mergeAndSave", a));
  assert.match(body, /const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';/, "需要字母代号表");
  // 顺序：先会话窗口（DOM 顺序），再自持标签（标签顺序）——按**入队点**判定（isOwnedPane 里也会提到 tabs）
  const sessPush = body.indexOf("kind: 'session', n: i + 1");
  const ownedPush = body.indexOf("kind: 'owned', n }");
  assert.ok(sessPush > 0 && ownedPush > sessPush, "必须先枚举会话窗口，再枚举自持窗口（用户心智模型 A/B=会话, C/D=自持）");
  // 实测坑：自持窗口的 webview 可能挂在会话作用域容器内 ⇒ 只按 closest 判断会误判成会话窗口 ✗
  assert.match(body, /const isOwnedPane = \(p\) => \{/, "必须按身份（tabs 元素 / webContentsId）判别自持窗口");
  assert.match(body, /getWebContentsId\(\)\) === String\(id\)/, "自持判别要含 webContentsId 比对（元素比对会因 overlay 重建失败）");
  assert.match(body, /sess\.filter\(\(p2\) => !isOwnedPane\(p2\)\)/, "自持窗口不得计入会话窗口编号");
  assert.match(body, /line: `\$\{code\} · \$\{kindZh\} #\$\{slot\.n\}/, "Window 行要含代号 + 类别 + 序号");
  assert.match(body, /url \? ` · \$\{url\}` : ''/, "Window 行要含 URL（Agent 据此定位窗口）");
  assert.match(body, /if \(idx < 0\)/, "枚举不到（隐藏/刚移除）也要给代号（退化分支）");
});

test("v34：落盘时逐条写窗口（以创建地真相为准，不能按『谁先同步到』打标）", () => {
  assert.match(clientSrc, /const win = annotWindowTag\(p\);/);
  // 实测坑：跨窗口同步会把同一条批注复制到所有窗口 ⇒ 若按"当前面板"打标，
  // 在自持窗口批注的条目会被标成会话窗口 ✗。条目自带 _window.key 时必须按 key 映射当前代号。
  assert.match(clientSrc, /const annotWindowTagForKey = \(key\) => \{/);
  assert.match(clientSrc, /const own = annotWindowTagForKey\(a && a\._window && a\._window\.key\);/);
  assert.match(clientSrc, /const eff = own \|\| \(\(a && a\._window && a\._window\.line\) \? a\._window : win\);/);
  assert.match(clientSrc, /window: eff\.line,/);
  assert.match(clientSrc, /windowKey: eff\.key \|\| null,/);
});

test("v34：草稿带 _window（面板显示 + 跳页/水合后仍在）", () => {
  const a = clientSrc.indexOf("const draftMerge = (list, url, win) => {");
  const body = clientSrc.slice(a, clientSrc.indexOf("const draftRemove", a));
  assert.match(body, /if \(win && !item\._window\) item\._window = \{ code: win\.code, kind: win\.kind, ordinal: win\.ordinal, key: win\.key, label: win\.line \};/);
  // 所有采集点都要传窗口（按**行**判定，避免正则被参数里的括号截断）
  const callLines = clientSrc.split("\n").filter((l) => /^\s+draftMerge\(|draftMerge\(/.test(l) && !/const draftMerge/.test(l));
  assert.ok(callLines.length >= 3, `应有多处采集点（实际 ${callLines.length}）`);
  const missing = callLines.filter((l) => !/annotWindowTag/.test(l));
  assert.deepEqual(missing, [], `所有 draftMerge 采集点都要带窗口信息（缺: ${missing.join(" | ")}）`);
});

test("v34：批注器接收并显示窗口代号", () => {
  assert.match(annotSrc, /_window: item\._window \|\| \(item\.window \? \{ code: "", kind: "", ordinal: 0, key: "", label: String\(item\.window\) \} : null\)/, "addExternal 必须透传 _window");
  assert.match(annotSrc, /data-dsh-kit-window-tag/, "面板行要有窗口代号徽章");
  assert.match(annotSrc, /winNode\.textContent = record\._window\.code \? `窗口 \$\{record\._window\.code\}` : "窗口";/, "徽章显示窗口代号");
  assert.match(annotSrc, /winNode\.title = record\._window\.label \|\| "";/, "悬停显示完整窗口行");
  assert.match(annotSrc, /__dshKitAnnotatorVersion = "1\.13\.0"/, "版本必须升（否则宿主不重注入 ⇒ 面板看不到窗口代号）");
});

test("v34：协议 Window 行 build↔parse 往返无损", () => {
  const winLine = "A · DSH 会话浏览器 #1 · KESION 控制台 · http://localhost:5173/console/eq";
  const md = buildAnnotationsMarkdown([
    { index: 1, note: "按钮太小", window: winLine, element: { pageUrl: "http://localhost:5173/console/eq", pageTitle: "KESION 控制台", tagName: "button", selector: "#save" } },
    { index: 2, window: "C · 自持浏览器 #1 · Example", element: { pageUrl: "https://example.com/", tagName: "h1", selector: "h1" } },
  ]);
  assert.match(md, /^Window: A · DSH 会话浏览器 #1/m, "markdown 必须有 Window 行");
  const { annotations } = parseAnnotationsMarkdown(md);
  assert.equal(annotations.length, 2);
  assert.equal(annotations[0].window, winLine, "parse 必须回读 Window（v34 前会丢 ✗）");
  assert.equal(annotations[1].window, "C · 自持浏览器 #1 · Example");
  assert.equal(annotations[0].note, "按钮太小");
  assert.equal(annotations[0].element.selector, "#save");
});
