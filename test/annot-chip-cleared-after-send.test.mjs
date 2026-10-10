/**
 * v33 回归护栏：**发送即消费之后，输入框里的批注胶囊必须消失**。
 *
 * 用户实测：批注已成功发送（消息行上挂出了「N 条批注 / 查看批注」✓），但**输入框里仍留着
 * 「N 条批注 · 已保存 ×」** ✗。
 * 根因：`consumeDraft` 成功分支把 saved 模型写回了 `stateRef.chip` ⇒ 渲染器 `saved || live`
 * 又把它当"待发送"胶囊画进输入框（那是旧流程的指示器；发送已经发生 ⇒ 不该再显示）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("v33：消费成功后不得把 saved 模型留在 stateRef.chip", () => {
  const a = src.indexOf("const consumeDraft = async (sentRowKey) => {");
  assert.ok(a > 0, "consumeDraft 可定位");
  const body = src.slice(a, src.indexOf("let annotMirrorSubmitBusy", a));
  assert.match(body, /const sentModel = \{/, "saved 模型应作为局部 sentModel（只进已发送队列）");
  assert.doesNotMatch(body, /stateRef\.chip = \{/, "不得把 saved 模型写回 stateRef.chip（会在输入框残留 ✗）");
  assert.match(body, /stateRef\.chip = null; \/\/ 不留在输入框（发送已完成）/, "消费后必须清空 stateRef.chip");
  assert.match(body, /removeAnnotChip\(\)/, "消费后必须撤掉输入框胶囊");
  assert.match(body, /stateRef\.draftBase = null;/, "消费后发送基线也要复位");
  // 挂载仍要发生（消息行上的装饰不能丢）
  assert.match(body, /attachMsgChip\(holder, sentModel\)/, "已发出的那条消息仍要挂上批注胶囊");
  assert.match(body, /\(stateRef\.sentChips = stateRef\.sentChips \|\| \[\]\)\.push\(sentModel\)/, "sentModel 要进补挂队列");
});

test("v33：渲染器忽略已挂到消息行上的 saved 模型（纵深防御）", () => {
  assert.match(
    src,
    /const saved = \(stateRef\.chip && stateRef\.chip\.mode === 'saved' && !stateRef\.chip\.attachedKey\)/,
    "attachedKey 有值 = 已发送 ⇒ 不得再渲染进输入框",
  );
});
