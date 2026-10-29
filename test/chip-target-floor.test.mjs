/**
 * 2026-10-28 实机根因回归钉：**发送即消费时 base 已含新行** ⇒ 相对锚 j+1 会跑到"再下一条"。
 *
 * 用户原话："我发送信息，没有正常看到批注信息，而是 Agent 完成任务后的下面显示，
 * 我重新发起一条不带批注的信息，下面带有上一次的批注信息。"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveChipTargetOf } from "../src/chip-target.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientSrc = () => readFileSync(join(root, "plugin/client.js"), "utf8");

/** 复刻实机场景：用户发了第 3 条消息（带批注），此时 rows 已含该行 */
const KEYS3 = ["msg-1", "msg-2", "msg-3"];

test("反例：有 floorIdx 时不得挂到再下一条（本次实机 bug 的精确回归）", () => {
  /* 实机现场：消费时新行下标 = 2（msg-3），floorIdx 记 2。
   * 用户随后又发了一条**不带批注**的消息（msg-4，下标 3）⇒ 卡片**不得**跑到 msg-4 上。 */
  const model = { floorIdx: 2, base: { last: "msg-3", n: 3 }, pendingAttach: true };
  // 行数未增 ⇒ 不挂（目标行还没渲染出来）
  assert.equal(resolveChipTargetOf({ model, rowKeys: KEYS3, rowCount: 3 }), -1);
  // ★用户又发了一条不带批注的消息 ⇒ 必须不挂（旧实现挂到这里 ✗）
  assert.equal(
    resolveChipTargetOf({ model, rowKeys: [...KEYS3, "msg-4"], rowCount: 4 }),
    -1,
    "有 floorIdx 时不得挂到下一条消息上",
  );
});

test("修正：floorIdx 是权威锚 —— 卡片只认消费时点的那一行", () => {
  // 消费时新行下标 = 2（msg-3），floorIdx 记录它
  const model = { floorIdx: 2, base: { last: "msg-3", n: 3 }, pendingAttach: true };
  // 行数未增 ⇒ 不挂（还没渲染出目标行）
  assert.equal(resolveChipTargetOf({ model, rowKeys: KEYS3, rowCount: 3 }), -1);
  // 用户又发了一条 ⇒ 依然不挂（floorIdx 不符）✓
  assert.equal(resolveChipTargetOf({ model, rowKeys: [...KEYS3, "msg-4"], rowCount: 4 }), -1);
  // 目标行确实出现（4 行，floorIdx=3）⇒ 挂到 msg-4 ✓
  const m2 = { floorIdx: 3, base: { last: "msg-3", n: 3 }, pendingAttach: true };
  assert.equal(resolveChipTargetOf({ model: m2, rowKeys: [...KEYS3, "msg-4"], rowCount: 4 }), 3);
});

test("修正：精确命中仍最优先（floorIdx 不得挡住同一条消息）", () => {
  const model = { attachedKey: "msg-3", floorIdx: 2 };
  assert.equal(resolveChipTargetOf({ model, rowKeys: KEYS3, rowCount: 3 }), 2);
  // 行键漂移（attachedKey 失效）+ 有 floorIdx ⇒ 模糊锚可命中 floorIdx 那一行（合法 ✓）
  const model2 = { attachedKey: "gone", floorIdx: 2, base: { last: "msg-3" } };
  assert.equal(resolveChipTargetOf({ model: model2, rowKeys: KEYS3, rowCount: 3 }), 2, "模糊锚命中 floor 行 ✓");
  // 但不得落到 floor 之前
  const model3 = { attachedKey: "gone", floorIdx: 2, base: { last: "msg-1" } };
  assert.equal(resolveChipTargetOf({ model: model3, rowKeys: KEYS3, rowCount: 3 }), -1, "不得回退到 floor 之前 ✗");
});

test("接线：发送路径必须写 floorIdx（两条路径都写）", () => {
  const code = clientSrc().replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /sentModel\.floorIdx = idx;/, "有行键时 floorIdx = 该行下标");
  assert.match(code, /sentModel\.floorIdx = rows\.length;/, "无行键时 floorIdx = 当时行数");
  assert.match(code, /try \{ sentModel\.floorIdx = userRows\(\)\.length; \}/, "完全无行键也要记 floorIdx");
  assert.match(code, /m\.floorIdx = rows\.length - 1;/, "旧 saved 模型消耗分支也要写 floorIdx");
});

test("架构：卡片**唯一路径 = 消息上方 DOM 注入**（turnTail 已停用；floorIdx 仅 DOM 模式用）", () => {
  const code = clientSrc().replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/safeInject\(\'conversation\\.chat\\.turnTail\'/.test(code), "turnTail 不得再注册（用户已要求移除）");
  assert.match(code, /const useDomCardFallback = \(\) => \{/, "必须有回退判定");
  assert.match(code, /attachMsgChipDom\(row, model\)/, "DOM 卡片必须真挂（兜底）");
  assert.match(code, /const attachMsgChipDom = \(row, model\) => \{/, "回退实现必须保留");
  assert.match(code, /h\(.details./, "主路径用 details 折叠");
  assert.match(code, /h\(.summary./, "标题用 summary");
  assert.match(code, /var\(--dsw-specific-bubble/, "卡片须与消息气泡同背景（缩小版气泡）");
  assert.match(code, /var\(--dsw-radius-xl/, "卡片须与气泡同圆角");
  assert.match(code, /font-size:11px/, "字号比气泡更小");
});
