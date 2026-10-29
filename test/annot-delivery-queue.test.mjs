/**
 * 批注投递队列 —— **行为钉**（审查报告 F10 反例 ✓）。
 *
 * 反例：①同一会话连续两次登记 ⇒ 旧的 `pending.set` **覆盖** ✗，只剩最后一批；
 *       ②注入时在 `createUserMessage` **之前** `delete` ✗ ⇒ 工厂一抛错，这批批注**永久丢失** ✗。
 * 现在：按会话有界队列（上限 8 ✓）+ 幂等 id ✓ + **构造成功后才消费** ✓。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { registerAnnotDelivery, BROWSER_PRIMER } from "../plugin/annot-delivery.host.mjs";

/* 2026-10-28：投递文本改为精简渲染（不再内联 markdown）⇒ 钉子改用 items 承载可识别文本 */
const mkInfo = (n) => ({ count: n, items: [{ index: n, tag: 'BUTTON', name: '', note: `批注批#${n}`, code: 'A', sel: '#a' }], sets: [{ gid: `g${n}`, items: [] }] });

/** 注册一个可驱动的最小环境（消息工厂可替换 ✓）。 */
async function harness(initialFactory) {
  const handlers = [];
  let factory = initialFactory;
  const ctx = { on: (ev, h) => { handlers.push({ ev, h }); } };
  const state = {};
  const diag = registerAnnotDelivery(ctx, state, () => {}, () => {}, {
    createUserMessage: (opts) => factory(opts),
  });
  await tick(); // 等 wire() 注册完成 ✓
  const fire = async (sid = "s1") => {
    assert.equal(handlers.length, 1, "应注册一个 agent/pre-step 处理器 ✓");
    return handlers[0].h({ agent: { session: { header: { id: sid } } } }, async () => ({ messages: [] }));
  };
  return { diag, state, fire, setFactory: (f) => { factory = f; } };
}

const okFactory = (opts) => ({ role: "user", content: opts.content, source: opts.source });

test("F10 反例①：同一会话连续两次登记必须**都**到达（不许覆盖 ✗）", async () => {
  const { diag, state, fire } = await harness(okFactory);
  assert.equal(diag.registered, true, "必须注册成功 ✓");
  state.recordAnnotDelivery("s1", mkInfo(1));
  state.recordAnnotDelivery("s1", mkInfo(2));
  assert.equal(diag.pending, 2, "两批都必须留在队列里 ✓（旧实现只剩 1 ✗）");
  const decision = await fire("s1");
  const text = (decision.messages || []).map((m) => m.content.map((c) => c.text).join("\n")).join("\n---\n");
  assert.match(text, /批注批#1/, "第一批必须在同一条注入消息里 ✓");
  assert.match(text, /批注批#2/, "第二批也必须出现 ✓");
  assert.equal(diag.pending, 0, "投递成功后应清空 ✓");
  assert.equal(diag.injected, 1);
});

test("F10 反例②：消息工厂失败 ⇒ 批注**不得**丢（下次还能投递 ✓）", async () => {
  const { diag, state, fire, setFactory } = await harness(() => { throw new Error("boom"); });
  state.recordAnnotDelivery("s1", mkInfo(1));
  const before = diag.pending;
  const d1 = await fire("s1");
  assert.equal((d1.messages || []).length, 0, "构造失败时不得注入 ✓");
  assert.equal(diag.pending, before, "构造失败**不得**消费待投递（旧实现会丢 ✗）");
  assert.match(String(diag.lastError || ""), /boom/, "错误必须可诊断 ✓");
  // 恢复工厂后同一批仍能投递 ✓
  setFactory(okFactory);
  const d2 = await fire("s1");
  const text = (d2.messages || []).map((m) => m.content.map((c) => c.text).join("\n")).join("\n");
  assert.match(text, /批注批#1/, "重试必须投递成功 ✓");
  assert.equal(diag.pending, 0);
});

test("F10：队列有界（上限 8 批，超出丢最旧并计数 ✓）", async () => {
  const { diag, state } = await harness(okFactory);
  for (let i = 1; i <= 10; i += 1) state.recordAnnotDelivery("s1", mkInfo(i));
  assert.equal(diag.pending, 8, "队列必须有界 ✓");
  assert.equal(diag.skipped.dropped, 2, "被丢的批数必须可诊断 ✓");
});

test("F10：每批带幂等 id，且投递后不再重复注入 ✓", async () => {
  const { diag, state, fire } = await harness(okFactory);
  state.recordAnnotDelivery("s1", mkInfo(1));
  const list = diag && state.annotDeliveries.get("s1");
  assert.ok(Array.isArray(list) && list.length === 1, "队列必须是数组 ✓");
  assert.match(String(list[0].id || ""), /^ad-/, "每批必须有幂等 id ✓");
  const d1 = await fire("s1");
  assert.equal((d1.messages || []).length, 1, "首次投递含能力说明 + 批注 ✓");
  // 再触发：批注已消费 ⇒ 只有能力说明也已发过 ⇒ 不再追加消息 ✓（不重复注入 ✗）
  const d2 = await fire("s1");
  assert.equal((d2.messages || []).length, 0, "不得重复注入 ✓");
});

test("F10：多会话互不影响（按 sessionId 分队列 ✓）", async () => {
  const { diag, state, fire } = await harness(okFactory);
  state.recordAnnotDelivery("s1", mkInfo(1));
  state.recordAnnotDelivery("s2", mkInfo(2));
  assert.equal(diag.pending, 2);
  assert.equal(diag.pendingSessions, 2);
  await fire("s1");
  assert.equal(diag.pending, 1, "只消费 s1 的那批 ✓");
  assert.equal(state.annotDeliveries.has("s2"), true, "s2 的批注必须还在 ✓");
  const d = await fire("s2");
  const text = (d.messages || []).map((m) => m.content.map((c) => c.text).join("\n")).join("\n");
  assert.match(text, /批注批#2/);
  assert.match(text, new RegExp(BROWSER_PRIMER.slice(0, 8).replace(/[[\]]/g, "\\$&")), "每个新会话仍应收到一次能力说明 ✓");
});

test("F10：没有 sessionId 时登记失败但计数（不静默 ✗）", async () => {
  const { diag, state } = await harness(okFactory);
  assert.equal(state.recordAnnotDelivery("", mkInfo(1)), false);
  assert.equal(diag.skipped.noSession, 1);
});

test("F10：源码级接线（构造成功后才消费 + 有界队列 ✓）", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../plugin/annot-delivery.host.mjs", import.meta.url), "utf8");
  assert.match(src, /PENDING_MAX_PER_SESSION/, "必须有队列上限 ✓");
  assert.match(src, /pendingCountOf/, "pending 计数必须是**总批数** ✓");
  // 关键顺序：createUserMessage 必须在消费之前 ✓
  const iFactory = src.indexOf("const message = createUserMessage(");
  const iConsume = src.indexOf("const consumedIds = new Set(");
  assert.ok(iFactory > 0 && iConsume > 0 && iFactory < iConsume, "必须**先构造成功、后消费** ✗");
  assert.doesNotMatch(src, /pending\.delete\(String\(sid\)\);\s*\n\s*diag\.pending = pending\.size;/, "不得在构造前删除 ✗");
});
