/**
 * v22 审查护栏（审计建议 T1/T2/T3/T6/T7）——全部可在 node --test 下运行（纯源码断言）。
 *
 * 这些断言专门钉住"这一轮审查发现并修掉的问题"，防止回潮：
 *  T1 版本字面量自洽（此前硬编码三处，改一处就会漂移）
 *  T2 已删除的死接口不得复活（面板定位历史包袱）
 *  T3 宿主镜像按钮绑定的**稳定属性**必须都在批注器里真实存在（否则按钮静默失联）
 *  T6 1s tick 的跨进程调用预算（防止"每 tick 无条件推送"回潮）
 *  T7 会话复位单一来源（两条收尾路径都必须走 resetAnnotState）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clientSource = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8");
const annotSource = readFileSync(new URL("../src/element-annotator.js", import.meta.url), "utf8");

test("T1：批注器版本字面量自洽（client EXPECTED == annotator 声明）", () => {
  const expected = /const EXPECTED_ANNOT_VERSION = '([\d.]+)';/.exec(clientSource);
  const actual = /window\.__dshKitAnnotatorVersion = "([\d.]+)"/.exec(annotSource);
  assert.ok(expected, "client.js 缺少 EXPECTED_ANNOT_VERSION");
  assert.ok(actual, "element-annotator.js 缺少 __dshKitAnnotatorVersion");
  assert.equal(expected[1], actual[1], `版本漂移：client 期望 ${expected[1]}，批注器实际 ${actual[1]}`);
});

test("T2：面板定位历史包袱（死接口/死指标）不得复活", () => {
  // 注意：只查**代码形态**（声明/赋值/传参），注释里保留的"已删除说明"不算违规
  const deadCode = [
    /var visibleHeight/, /visibleHeight\s*[=:]/, /opts\.visibleHeight/,
    /var bottomExtra/, /bottomExtra\s*[=:]/, /opts\.bottomExtra/,
    /var anchorRight/, /anchorRight\s*[=:]/, /var anchorBottom/, /anchorBottom\s*[=:]/,
    /setVisibleWidth\s*:/, /setUiScale\s*:/, /function visibleBandHeight/,
  ];
  for (const dead of deadCode) {
    assert.doesNotMatch(annotSource, dead, `element-annotator.js 又出现死符号：${dead}`);
  }
  for (const dead of [/const annotBottomExtra/, /const annotAnchors/, /const paneVisibleHeight/]) {
    assert.doesNotMatch(clientSource, dead, `client.js 又出现死代码：${dead}`);
  }
  // 仍然必需的两项（提示条用）必须还在
  assert.match(annotSource, /setPaneMetrics: function \(m\) \{/);
  assert.match(annotSource, /function visibleBand\(\) \{/);
  assert.match(annotSource, /function inverseScale\(\) \{/);
});

test("T3：宿主镜像绑定的稳定属性都在批注器里真实存在", () => {
  const bound = ["data-dsh-kit-panel-chevron", "data-dsh-kit-panel-clear", "data-dsh-kit-panel-submit", "data-dsh-kit-panel-cancel"];
  for (const attr of bound) {
    assert.match(clientSource, new RegExp(`hasAttribute\\('${attr}'\\)`), `client.js 未按 ${attr} 绑定`);
    assert.match(annotSource, new RegExp(`setAttribute\\("${attr}"`), `批注器没有创建带 ${attr} 的按钮 ⇒ 镜像按钮会静默失联`);
  }
  // 反向：批注器创建的每个 panel-* 按钮属性都应被宿主绑定（新增按钮忘了绑定会在此变红）
  const created = [...annotSource.matchAll(/setAttribute\("(data-dsh-kit-panel-[a-z]+)"/g)].map((m) => m[1]);
  for (const attr of new Set(created)) {
    assert.match(clientSource, new RegExp(`hasAttribute\\('${attr}'\\)`), `批注器新增了 ${attr} 但宿主未绑定`);
  }
});

test("T6：1s 空闲 tick 的跨进程调用有预算（回潮即变红）", () => {
  const start = clientSource.indexOf("const agentViewIdleTick =");
  const end = clientSource.indexOf("const startAgentViewIdleTick =", start);
  assert.ok(start > 0 && end > start, "找不到 agentViewIdleTick 边界");
  const body = clientSource.slice(start, end);
  // tick 本体只允许**经由** helper 发起跨进程调用（历史上是这里无条件推 6 个字段 × N 个面板）
  const direct = [...body.matchAll(/executeJavaScript\(/g)].length;
  assert.ok(direct === 0, `空闲 tick 本体不应直接 executeJavaScript（实际 ${direct}）`);
  assert.match(body, /syncAnnotMirror\(\)/, "tick 应驱动镜像同步");
  assert.match(body, /syncAnnotMetrics\(p\)/, "tick 应驱动指标同步（带缓存）");
  // helper 侧护栏：单飞 + 值未变不发
  const mirror = clientSource.slice(clientSource.indexOf("const syncAnnotMirror = async ()"), clientSource.indexOf("const startPaneInSession ="));
  assert.match(mirror, /if \(annotMirror\.busy\)/, "镜像同步缺少单飞护栏");
  const metrics = clientSource.slice(clientSource.indexOf("const syncAnnotMetrics = (pane)"));
  assert.match(metrics.slice(0, 900), /if \(annotMetricCache\.get\(pane\) === key\) return;/, "指标推送缺少「值未变则不推」的缓存");
});

test("T7：会话复位单一来源（各收尾路径都走 resetAnnotState）", () => {
  assert.match(clientSource, /const resetAnnotState = \(reason, keepLastSaved\) => \{/);
  const calls = [...clientSource.matchAll(/resetAnnotState\('(submit|end)'/g)].map((m) => m[1]);
  // v25 起三条收尾路径：提交 / 关闭 / 换 DSH 对话 —— 都复用同一助手，不再各自手写字面量
  assert.ok(calls.includes("submit"), "提交路径必须复用 resetAnnotState");
  assert.ok(calls.includes("end"), "结束路径必须复用 resetAnnotState");
  assert.ok(calls.length >= 2, `复位调用点应 >= 2（实际 ${calls.length}）`);
  // 复位字段集只在一处出现（count/startedAt/convo 必须一起复位，否则诊断报旧值）
  const literals = clientSource.match(/leftIds: new Set\(\), count: 0, convo: null, startedAt: null,/g) || [];
  assert.equal(literals.length, 1, `会话状态字面量应只有 1 处（实际 ${literals.length}）`);
});
