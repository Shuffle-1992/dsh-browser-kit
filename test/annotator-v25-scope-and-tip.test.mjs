/**
 * v25 回归护栏：①提示条不会永久滞留 ②批注会话按 DSH 对话隔离。
 *
 * 事故 1（用户实测「这个浮窗一直不消失」）：提示条只在胶囊自身的 mouseenter/mouseleave 上开关，
 *   而胶囊会被 2s tick / 提交（live→saved 模型切换）/ 会话门控移除或重建 ⇒ mouseleave 永不触发；
 *   且提示条是 `pointer-events:none`，鼠标划过去也关不掉它 ⇒ 永久滞留。
 * 事故 2（用户要求「批注是单会话的，避免跨会话」）：`stateRef.annot` 是实例级全局 ⇒ 换 DSH 对话后
 *   批注会话与编号会跨会话续用（新对话接着 4、5、6 排 ✗，页面上还留着上个对话的徽标 ✗）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** 源码归一化：CRLF → LF。
 *  ⚠️ 实测教训：在 Windows 上 checkout 的文件是 CRLF，而断言写的是 `\n` ⇒ 正则不匹配（假阳性）。
 *  凡是对源码做**跨行**匹配的护栏，都必须先归一化（与"先剥注释"同属护栏自身的防坑）。 */
const clientSource = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8");
const norm = (s) => s.replace(/\r\n/g, "\n");
const src = norm(clientSource);

test("v25：提示条有兜底回收（不依赖被移除的胶囊发 mouseleave）", () => {
  assert.match(src, /const reapAnnTip = \(\) => \{/, "缺少提示条兜底回收");
  assert.match(src, /const tip = document\.getElementById\(ANN_TIP_ID\);\n\s+if \(!tip \|\| tip\.style\.display === 'none'\) return;/);
  assert.match(src, /hovered = chip\.matches\(':hover'\);/, "需以真实悬停态判断（胶囊被移除时同样收掉）");
  assert.match(src, /if \(!chip \|\| !hovered\) hideAnnTip\(\);/, "胶囊不在 DOM 或指针已离开 ⇒ 收掉");
  // 必须由每轮 tick 驱动（仅靠事件绑定就回到了老毛病）
  assert.match(src, /ensureAnnotChip\(\);[\s\S]{0,200}reapAnnTip\(\);/, "tickChipLifecycle 里必须调用 reapAnnTip");
});

test("v25：批注会话按 DSH 对话隔离（换对话即结束+清空，编号从 1 起）", () => {
  assert.match(src, /const enforceAnnotConvoScope = \(\) => \{/);
  const a = src.indexOf("const enforceAnnotConvoScope = () => {");
  const body = src.slice(a, src.indexOf("const tickChipLifecycle", a));
  assert.match(body, /const now = convoTitle\(\);/);
  assert.match(body, /if \(!st\.convo \|\| !now \|\| st\.convo === now\) return;/, "同对话直接返回（不能误清）");
  assert.match(body, /resetAnnotState\('end', true\);/, "换对话要复位会话状态");
  assert.match(body, /a\.clearAll\(\)/, "换对话要清空页面批注（否则旧编号与新会话混在一起）");
  assert.match(body, /hideAnnTip\(\);/, "换对话顺带收掉提示条");
  // 必须在主 tick 里被驱动
  assert.match(src, /enforceAnnotConvoScope\(\); \/\/ v25/, "主 tick 必须调用 enforceAnnotConvoScope");
  // 会话开始时要记下所属对话（隔离判据的来源）
  assert.match(src, /convo: convoTitle\(\)/, "会话开始必须记录 convo，否则无从判断切换");
});
