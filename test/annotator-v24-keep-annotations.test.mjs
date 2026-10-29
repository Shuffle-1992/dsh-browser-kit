/**
 * v24 回归护栏：**提交后保留批注**（用户要求：同一会话内先提交 1 条 → 再打开批注 → 应延续前面的批注、
 * 能看到/能修改，新批注序号接着排）。
 *
 * 旧行为是「单次消耗：提交即全窗口 clearAll()」⇒ 重开批注从 0 开始，序号也从 1 重排 ✗。
 * 新行为：提交只 `stop()`（撤图层，记录留在 guest 内存）+ `markSubmitted()`（置"已提交"）；
 * 重开批注时 `startAnnotating` 会重新钉标，`nextIndex()` 天然从 max+1 续号；
 * 再次提交只发**新增/改过**的条目（client 按 `dirty !== false` 过滤）⇒ 不重复落盘。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clientSource = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const annotSource = readFileSync(new URL("../src/element-annotator.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const finishSubmitBody = () => {
  const a = clientSource.indexOf("const finishSubmit = async () => {");
  const b = clientSource.indexOf("const sessionSettled = async (winner)", a);
  assert.ok(a > 0 && b > a, "找不到 finishSubmit 边界");
  return clientSource.slice(a, b);
};

test("v26：提交/消费 = 清空页面批注与草稿（v24 的『保留』语义已被用户否决）", () => {
  const body = finishSubmitBody();
  assert.match(body, /if \(a\.clearAll\) a\.clearAll\(\)/, "提交/消费即清空（用户本轮明确要求）");
  assert.match(body, /a\.stop\(\)/, "仍应 stop：先撤掉批注图层再清空");
  assert.match(body, /draftClear\(\)/, "消费后必须清空草稿（否则重开会复活）");
  assert.doesNotMatch(body, /批注保留在页面上/, "v24 的『保留』文案必须改掉");
});

test("v24：再次提交只发「新增/改过」的条目", () => {
  const a = clientSource.indexOf("const mergeAndSave = async () => {");
  const b = clientSource.indexOf("if (sets.length === 0) return { ok: false, error: '无可提交批注' };", a);
  assert.ok(a > 0 && b > a, "找不到 mergeAndSave 边界");
  const body = clientSource.slice(a, b);
  assert.match(body, /const lstAll = await p\.executeJavaScript/, "先取全量列表");
  assert.match(body, /const lst = lstAll\.filter\(\(a\) => !a \|\| a\.dirty !== false\)/, "再按 dirty 过滤（老版本无该字段 ⇒ 视为 dirty，行为不变）");
  assert.match(body, /if \(lst\.length === 0\) continue;/, "无变更的面板应整块跳过");
});

test("v24：批注器提供 dirty/markSubmitted/三态徽标", () => {
  assert.match(annotSource, /dirty: true,\n\s+submitted: false,/, "新建记录必须带 dirty/submitted 初值");
  assert.match(annotSource, /markSubmitted: function \(\) \{/, "缺少 markSubmitted API");
  assert.match(annotSource, /if \(record\.dirty !== false \|\| record\.submitted !== true\) marked \+= 1;/, "markSubmitted 应统计新标记数");
  assert.match(annotSource, /function badgeColor\(record\) \{/, "徽标底色应有单一来源");
  assert.match(annotSource, /var SUBMITTED_COLOR = "#16a34a";/, "已提交用独立颜色（绿）以示区分");
  assert.match(annotSource, /out\.dirty = record\.dirty !== false;/, "publicAnnotation 必须下发 dirty 供宿主过滤");
  assert.match(annotSource, /var records = o\.dirtyOnly \? annotations\.filter/, "packageAnnotations 支持 dirtyOnly");
});

test("v24：**关闭/取消**也不再清空（丢弃只能走面板「清除」）", () => {
  const a = clientSource.indexOf("const endAnnotSession = async (target) => {");
  const b = clientSource.indexOf("const runSessionLoop = () => {", a);
  assert.ok(a > 0 && b > a, "找不到 endAnnotSession 边界");
  const body = clientSource.slice(a, b);
  assert.doesNotMatch(body, /clearAll/, "关闭批注不得清空（否则用户「提交→关闭→再打开」就看不到前面的批注）");
  assert.match(body, /a\.stop\(\)/, "仍应 stop：退出批注模式");
  assert.match(clientSource, /要丢弃请点「清除」/, "文案需指明丢弃入口是「清除」");
  // 丢弃入口仍在（面板「清除」→ clearAll）
  const clearA = clientSource.indexOf("b.hasAttribute('data-dsh-kit-panel-clear')");
  assert.ok(clearA > 0, "找不到面板「清除」绑定");
  assert.match(clientSource.slice(clearA, clearA + 400), /clearAll/, "「清除」必须仍是丢弃路径");
});

test("v24：提交标记随跨面板同步一起传（否则重注入后重复提交/徽标回蓝）", () => {
  assert.match(annotSource, /dirty: item\.dirty !== false,\n\s+submitted: item\.submitted === true,/, "addExternal 必须接收同步来的 dirty/submitted");
  // 同步载荷是整项展开 ⇒ 标记会随 list() 一起传
  const syncSrc = readFileSync(new URL("../src/annotator-sync.mjs", import.meta.url), "utf8");
  assert.match(syncSrc, /\.map\(\(u\) => \(\{ \.\.\.u\.item, _originUrl/, "推送项必须整项展开（会带上 dirty/submitted）");
});

test("v24：序号延续依赖「记录不清空 + nextIndex 取 max+1」", () => {
  // stop() 只撤图层；annotations 保留（clear() 才清空）——这是续号的前提
  assert.match(annotSource, /annotations\.length = 0;/, "clear() 仍是唯一的清空点");
  assert.match(annotSource, /function nextIndex\(\) \{\n\s+return Math\.max\(/, "nextIndex 必须取已有最大号 +1");
  // 重开批注要重新钉标旧批注（否则"看不到前面的批注"）
  const startBody = annotSource.slice(annotSource.indexOf("function startAnnotating(options) {"));
  assert.match(startBody.slice(0, 2000), /renderBadge\(record\); \/\/ 跨会话保留的批注重新钉标/, "重开会话必须重钉旧批注");
});
