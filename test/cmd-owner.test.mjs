/**
 * 唯一轮询者租约 —— **行为钉**（P115 判定核心 ✓）。
 *
 * 覆盖三条语义（见 src/cmd-owner.mjs 头注 ✓）：
 *   ①无租约/过期 ⇒ 抢占 ✓；②自己的 ⇒ 续租 ✓；③自己卡死 >30s ⇒ **让位** ✓（卡死自愈 ✓）。
 * 另做 client 内嵌副本的 parity 对拍（A1 模式 ✓，注入了假 localStorage ✓）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cmdOwnerTick, CMD_OWNER_KEY, CMD_LEASE_MS, CMD_BUSY_GIVEUP_MS } from "../src/cmd-owner.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (p) => readFileSync(join(root, p), "utf8");

const memStore = (init) => {
  let v = init === undefined ? null : init;
  return { get: () => v, set: (x) => { v = x; }, peek: () => v };
};

test("行为①：无租约 / 租约过期 ⇒ 抢占（谁都可能成为唯一持有者 ✓）", () => {
  const s = memStore(null);
  const r1 = cmdOwnerTick({ store: s, now: 1000, bootAt: "A" });
  assert.equal(r1.mine, true);
  assert.equal(r1.reason, "stale-claim");
  assert.deepEqual(JSON.parse(s.peek()), { bootAt: "A", at: 1000 });

  // 别人的租约**新鲜** ⇒ 不抢 ✓
  const r2 = cmdOwnerTick({ store: s, now: 2000, bootAt: "B" });
  assert.equal(r2.mine, false);
  assert.equal(r2.reason, "other-owner");

  // 过了租约期（6000ms）⇒ 可抢 ✓
  const r3 = cmdOwnerTick({ store: s, now: 1000 + CMD_LEASE_MS + 1, bootAt: "B" });
  assert.equal(r3.mine, true);
  assert.equal(r3.reason, "stale-claim");
});

test("行为②：自己的租约 ⇒ 续租（心跳刷新 ✓）", () => {
  const s = memStore(null);
  cmdOwnerTick({ store: s, now: 1000, bootAt: "A" });
  const r = cmdOwnerTick({ store: s, now: 4000, bootAt: "A" });
  assert.equal(r.mine, true);
  assert.equal(r.reason, "renew");
  assert.deepEqual(JSON.parse(s.peek()), { bootAt: "A", at: 4000 });
});

test("行为③：自己是持有者但 busy 超时 ⇒ **让位**（卡死自愈 ✓）", () => {
  const s = memStore(null);
  cmdOwnerTick({ store: s, now: 1000, bootAt: "A" });
  // 未超时 ⇒ 仍然续租 ✓
  const ok = cmdOwnerTick({ store: s, now: 2000, bootAt: "A", busy: true, busySince: 1000 });
  assert.equal(ok.mine, true);
  // 超过阈值 ⇒ 让位（不再写租约 ✓）
  const giveup = cmdOwnerTick({ store: s, now: 1000 + CMD_BUSY_GIVEUP_MS + 1, bootAt: "A", busy: true, busySince: 1000 });
  assert.equal(giveup.mine, false);
  assert.equal(giveup.reason, "self-busy-giveup");
  // 让位后，别的实例只要过了租约期就能接管 ✓
  const other = cmdOwnerTick({ store: s, now: 1000 + CMD_BUSY_GIVEUP_MS + 1 + CMD_LEASE_MS + 1, bootAt: "B" });
  assert.equal(other.mine, true);
});

test("F09：**合法的 60s 等待不得被让位规则打断**（阈值必须 > 最大命令时长 ✓）", () => {
  const s = memStore(null);
  cmdOwnerTick({ store: s, now: 1000, bootAt: "A" });
  // browser_wait 类命令合法跑 60s：此刻仍在阈值内 ⇒ 必须继续持有，不得让位 ✓
  const during = cmdOwnerTick({ store: s, now: 1000 + 60000, bootAt: "A", busy: true, busySince: 1000 });
  assert.equal(during.mine, true, "60s 的合法等待不得被当成卡死 ✗");
  assert.notEqual(during.reason, "self-busy-giveup");
  // 阈值本身必须高于 80s（客户端命令上限）✓
  assert.ok(CMD_BUSY_GIVEUP_MS > 80000, `让位阈值 ${CMD_BUSY_GIVEUP_MS}ms 必须大于 80s 的命令上限 ✗`);
});

test("F09：让位阈值可注入（不同调用方可自定义，缺省用常量 ✓）", () => {
  const s = memStore(null);
  cmdOwnerTick({ store: s, now: 1000, bootAt: "A" });
  const injected = cmdOwnerTick({ store: s, now: 1000 + 5000, bootAt: "A", busy: true, busySince: 1000, busyGiveUpMs: 3000 });
  assert.equal(injected.reason, "self-busy-giveup", "注入的阈值应生效 ✓");
  const s2 = memStore(null);
  cmdOwnerTick({ store: s2, now: 1000, bootAt: "A" });
  const notYet = cmdOwnerTick({ store: s2, now: 1000 + 5000, bootAt: "A", busy: true, busySince: 1000, busyGiveUpMs: 9000 });
  assert.equal(notYet.mine, true, "未到注入阈值不应让位 ✓");
});

test("行为：坏值/存储异常都不抛（坏 JSON 按无租约 ✓；store 抛错 ⇒ 退回都轮询 ✓）", () => {
  const bad = memStore('{not json');
  assert.equal(cmdOwnerTick({ store: bad, now: 1, bootAt: "A" }).mine, true);
  const throwing = { get: () => { throw new Error("denied"); }, set: () => {} };
  const r = cmdOwnerTick({ store: throwing, now: 1, bootAt: "A" });
  assert.equal(r.mine, true);
  assert.equal(r.reason, "store-unavailable");
});

test("常量自洽 + 键名一致（两端不漂移 ✓）", () => {
  assert.equal(CMD_LEASE_MS, 6000);
  assert.equal(CMD_BUSY_GIVEUP_MS, 150000);
  assert.equal(CMD_OWNER_KEY, "dsh-kit-cmd-owner");
  const client = readText("plugin/client.js");
  assert.ok(client.includes(CMD_OWNER_KEY), "client 必须使用同一键名 ✓");
  // F09：客户端内嵌副本的阈值必须与正典一致（防两端漂移 ✗）
  assert.match(client, /const CMD_BUSY_GIVEUP_MS = 150000;/, "client 让位阈值必须与正典一致 ✓");
  assert.match(client, /const CMDBUSY_STUCK_MS = 120000;/, "看门狗阈值必须高于 80s 命令上限 ✓");
});

test("parity：client.js 内嵌副本与正典逐例同结果（注入假 localStorage ✓）", () => {
  const client = readText("plugin/client.js");
  const m = client.match(/\/\* @cmd-owner-canonical-begin[\s\S]*?\/\* @cmd-owner-canonical-end \*\//);
  assert.ok(m, "client.js 必须保留 @cmd-owner-canonical-begin/end 内嵌块 ✓");
  const code = `${m[0].replace(/^[\s\S]*?\*\//, "").replace(/\/\* @cmd-owner-canonical-end \*\//, "")};
    return (scenario) => {
      const store = { v: scenario.raw, get() { return this.v; }, set(x) { this.v = x; } };
      return cmdOwnerDecide({ get: () => store.get(), now: scenario.now, bootAt: scenario.bootAt, busy: scenario.busy, busySince: scenario.busySince });
    };`;
  const fakeLocalStorage = { getItem: () => null, setItem: () => {} };
  const embedded = new Function("localStorage", code)(fakeLocalStorage);
  const scenarios = [
    { raw: null, now: 1000, bootAt: "A" },
    { raw: JSON.stringify({ bootAt: "A", at: 1000 }), now: 4000, bootAt: "A" },
    { raw: JSON.stringify({ bootAt: "Z", at: 9000 }), now: 10000, bootAt: "A" },
    { raw: JSON.stringify({ bootAt: "A", at: 1000 }), now: 40000, bootAt: "A", busy: true, busySince: 1000 },
    { raw: "{bad", now: 5, bootAt: "A" },
  ];
  for (const sc of scenarios) {
    const mem = memStore(sc.raw);
    const canonical = cmdOwnerTick({ store: mem, now: sc.now, bootAt: sc.bootAt, busy: sc.busy, busySince: sc.busySince });
    const copy = embedded(sc);
    assert.equal(copy.mine, canonical.mine, `mine 必须一致（场景 ${JSON.stringify(sc.raw)} @${sc.now}）`);
    assert.equal(copy.reason, canonical.reason, `reason 必须一致（场景 ${JSON.stringify(sc.raw)} @${sc.now}）`);
  }
});
