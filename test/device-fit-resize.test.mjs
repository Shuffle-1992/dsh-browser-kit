/**
 * v32 回归护栏：**设备尺寸的显示缩放必须随面板尺寸变化重算**。
 *
 * 用户实测：设定分辨率后页面显示正常，但拖动 DSH 分窗宽度 ⇒ 里面的页面尺寸没跟着变 ⇒
 * 要么留黑边、要么右侧内容超出边界被裁 ✗。
 * 根因：`applyPaneDeviceSize` 只在"设置分辨率"那一刻算一次 `k`（宿主容器宽高），之后没有任何 resize 监听。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 归一化：CRLF → LF（跨行正则必须，否则在 Windows checkout 上假阳性）
const src = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("v32：存在 refit 助手，且用 ResizeObserver 观察宿主容器", () => {
  assert.match(src, /const refitPaneDeviceSize = \(pane\) => \{/, "缺少 refitPaneDeviceSize");
  assert.match(src, /const observePaneFit = \(pane\) => \{/, "缺少 observePaneFit");
  assert.match(src, /const unobservePaneFit = \(pane\) => \{/, "缺少 unobservePaneFit");
  assert.match(src, /new ResizeObserver\(refitSoon\)/, "必须用 ResizeObserver（拖分窗不会触发 guest 的 resize）");
  assert.match(src, /ro\.observe\(pane\.parentElement \|\| pane\)/, "观察对象必须是**宿主容器**（可用空间），不是 webview 自身");
  // rAF 去抖：拖拽会高频触发，不去抖会打满主线程
  assert.match(src, /requestAnimationFrame\(run\)/, "refit 需要 rAF 去抖");
});

test("v32：refit 只重算缩放，不重设视口尺寸；未套预设的面板不动", () => {
  const a = src.indexOf("const refitPaneDeviceSize = (pane) => {");
  const body = src.slice(a, src.indexOf("const observePaneFit", a));
  assert.match(body, /const k = Math\.min\(1, availW \/ res\.w, availH \/ res\.h\)/, "refit 必须按当前可用空间重算 k");
  assert.match(body, /setProperty\('transform', `scale\(\$\{k\}\)`/, "refit 要写回 transform 缩放");
  assert.doesNotMatch(body, /setProperty\('width'/, "refit 不应重设宽度（视口严格等于预设，宽度只由 apply 设置）");
  assert.match(body, /if \(!key\) return null;/, "未套预设的面板必须原样跳过（不能改用户自己的宽度）");
  assert.match(body, /syncAnnotMetrics\(pane\)/, "refit 后要同步批注锚点（依赖可见带与缩放）");
});

test("v32：套用预设时挂观察者，重置时摘掉", () => {
  assert.match(src, /pane\.dataset\.kitDevicePreset = res\.key;\n\s+observePaneFit\(pane\);/, "apply 后必须挂观察者");
  assert.match(src, /unobservePaneFit\(pane\); \/\/ v32/, "reset 时必须摘掉观察者（不再跟随，交还 DSH 布局）");
});

test("v32：tick 自愈补挂（升级前已套预设的面板也要跟随）", () => {
  assert.match(src, /stateRef\.paneFit = \{ observe: observePaneFit, unobserve: unobservePaneFit, refit: refitPaneDeviceSize \}/, "必须把助手挂到 stateRef 供 tick 使用");
  assert.match(src, /if \(p && p\.dataset && p\.dataset\.kitDevicePreset\) pf\.observe\(p\);/, "tick 必须给已套预设的面板补挂观察者（老面板迁移缺口）");
  assert.match(src, /const pf = stateRef\.paneFit;/, "tick 里取 stateRef.paneFit");
});
test("v32：kit-status 暴露 deviceFit 现场", () => {
  assert.match(src, /deviceFit: \(\(\) => \{/, "kit-status 应暴露 deviceFit（拖分窗问题排查用）");
  assert.match(src, /fitScale: \(p\.dataset && p\.dataset\.kitFitScale\) \|\| null/, "deviceFit 应含 fitScale");
});
