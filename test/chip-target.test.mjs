/**
 * 批注胶囊落位 —— **行为钉**（P114 + M-1 两次实机打回区 ✓）。
 *
 * 铁律：**已挂过的模型只回到同一条消息** ✓；未挂过的模型**绝不**命中 base 行自身 ✓（那是上一条消息 ✗）。
 * 宁可不显示，也绝不挂错消息 ✗ —— 少显示是装饰缺失 ✓，挂错是信息错位 ✗✗。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveChipTargetOf as resolve, fuzzyFindKeyOf } from "../src/chip-target.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (p) => readFileSync(join(root, p), "utf8");
const keys = ["msg-1", "msg-2", "msg-3"];
const at = ({ attachedKey, base, attachIdx, pendingAttach } = {}, rowKeys = keys) =>
  resolve({ model: { attachedKey, base, attachIdx, pendingAttach }, rowKeys, rowCount: rowKeys.length });

test("P114：已挂过的模型匹配不到原行 ⇒ **绝不跳到别的行**（宁可不显示 ✓）", () => {
  // 原行已滚出视野，也没有可用相对锚 ⇒ 不挂 ✓
  assert.equal(at({ attachedKey: "gone", base: { last: "also-gone", n: 5 } }), -1);
  // 即使有 attachIdx（旧实现的"跳行"通道 ✗），也不得使用 ✗
  assert.equal(at({ attachedKey: "gone", base: { last: "also-gone" }, attachIdx: 2 }), -1);
  // 精确命中仍照常挂 ✓
  assert.equal(at({ attachedKey: "msg-2" }), 1);
});

test("已挂过的模型可用**相对锚**修好（前一行仍在视野 ⇒ 它的下一行 ✓），但不得回退 ✗", () => {
  // base=msg-1 ⇒ 目标是 msg-2 ✓
  assert.equal(at({ attachedKey: "stale-key", base: { last: "msg-1" }, attachIdx: 1 }), 1);
  // 单调守卫：目标行比上次挂载位置早 2 行以上 ⇒ 拒绝 ✗
  assert.equal(at({ attachedKey: "stale-key", base: { last: "msg-1" }, attachIdx: 3 }), -1);
});

test("M-1：未挂过的模型**不得**命中 base 行自身（那是上一条消息 ✗）", () => {
  // base=msg-3 恰是最后一行 ⇒ 下一行还不存在 ⇒ **不挂** ✓（旧实现会 return base 自身 ✗）
  assert.equal(at({ base: { last: "msg-3", n: 3 } }), -1);
  // 但 pendingAttach（等新行）时允许继续兜底 ✓
  const pend = at({ base: { last: "msg-3", n: 3 }, pendingAttach: true });
  assert.equal(pend, -1, "行数未增 ⇒ 仍不挂 ✓（不挂到 base ✓）");
});

test("未挂过的模型：相对锚 / 模糊锚 / 首条消息 / attachIdx / pendingAttach 五条兜底各自生效 ✓", () => {
  assert.equal(at({ base: { last: "msg-1" } }), 1); // 相对锚 ✓
  // base 不在视野 ⇒ 模糊前缀命中 ✓
  assert.equal(at({ base: { last: "msg-9-long-tail" } }, ["msg-1", "msg-9-long-tail-changed"]), 1);
  // 会话第一条消息 ✓
  assert.equal(at({ base: { last: "" } }, ["only"]), 0);
  // attachIdx 兜底 ✓
  assert.equal(at({ attachIdx: 2 }), 2);
  // pendingAttach 且行数已增 ⇒ 末行 ✓
  assert.equal(at({ base: { last: "msg-1", n: 1 }, pendingAttach: true }, ["msg-1", "msg-2"]), 1);
  // 什么都不满足 ⇒ -1 ✓
  assert.equal(at({}), -1);
});

test("fuzzyFindKeyOf：前缀双向匹配 + 空键安全 ✓", () => {
  assert.equal(fuzzyFindKeyOf(["abcdef", "abcdefghij"], "abcdefghijk"), 1);
  assert.equal(fuzzyFindKeyOf(["zzz"], ""), -1);
  assert.equal(fuzzyFindKeyOf(["zzz"], null), -1);
});

test("parity：client.js 内嵌副本与正典逐例同结果（A1 模式 ✓）", () => {
  const client = readText("plugin/client.js");
  const m = client.match(/\/\* @chip-target-canonical-begin[\s\S]*?\/\* @chip-target-canonical-end \*\//);
  assert.ok(m, "client.js 必须保留 @chip-target-canonical-begin/end 内嵌块 ✓");
  const embedded = new Function(
    `${m[0].replace(/^[\s\S]*?\*\//, "").replace(/\/\* @chip-target-canonical-end \*\//, "")}; return resolveChipTargetOf;`,
  )();
  const cases = [
    [{ attachedKey: "msg-2" }, keys],
    [{ attachedKey: "gone", base: { last: "also-gone" } }, keys],
    [{ attachedKey: "stale", base: { last: "msg-1" }, attachIdx: 1 }, keys],
    [{ base: { last: "msg-3", n: 3 } }, keys],
    [{ base: { last: "msg-3", n: 3 }, pendingAttach: true }, ["msg-1", "msg-2", "msg-3", "msg-4"]],
    [{ base: { last: "msg-1" } }, keys],
    [{ base: { last: "" } }, ["only"]],
    [{ attachIdx: 2 }, keys],
    [{}, keys],
  ];
  for (const [model, rowKeys] of cases) {
    const want = resolve({ model, rowKeys, rowCount: rowKeys.length });
    const got = embedded({ model, rowKeys, rowCount: rowKeys.length });
    assert.equal(got, want, `内嵌/正典结果必须一致（${JSON.stringify(model)} @ ${rowKeys.length} 行）`);
  }
});
