/**
 * 命令信封与到期判定 —— **行为钉**（审查报告 F08 反例 ✓）。
 *
 * 反例：宿主超时只"停止等待"，`command.json` 仍在 ⇒ client 恢复后照样取走并**执行** ✗
 * （Agent 已收到失败 ⇒ 重试 ⇒ 重复副作用 ✗）。修法：信封带**绝对** deadline，执行前判定。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { envelopeOf, isExpiredEnvelope, expiredResultOf, ENVELOPE_META_FIELDS } from "../src/command-deadline.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (p) => readFileSync(join(root, p), "utf8");

test("F08：信封必须带**签发时刻 + 绝对 deadline**（相对预算判不出迟到 ✗）", () => {
  const env = envelopeOf({ id: "c1", action: "click", params: { ref: 3 }, timeoutMs: 5000, now: 1000 });
  assert.equal(env.id, "c1");
  assert.equal(env.action, "click");
  assert.equal(env.ref, 3, "业务参数必须保留 ✓");
  assert.equal(env.__timeoutMs, 5000);
  assert.equal(env.__issuedAt, 1000);
  assert.equal(env.__deadlineAt, 6000, "deadline = issuedAt + timeoutMs ✓");
  for (const f of ENVELOPE_META_FIELDS) assert.ok(f in env, `信封必须含 ${f} ✓`);
});

test("F08：业务参数不得覆盖信封元字段（防调用方伪造 deadline ✗）", () => {
  const env = envelopeOf({ id: "c2", action: "x", params: { __deadlineAt: 1, __issuedAt: 2, __timeoutMs: 3, ok: true }, timeoutMs: 7000, now: 500 });
  assert.equal(env.__deadlineAt, 7500, "伪造的 __deadlineAt 必须被覆盖 ✓");
  assert.equal(env.__issuedAt, 500);
  assert.equal(env.__timeoutMs, 7000);
  assert.equal(env.ok, true, "普通业务参数照旧 ✓");
});

test("F08 反例：迟到的命令必须判为过期（客户端据此拒绝执行 ✓）", () => {
  const env = envelopeOf({ id: "c3", action: "click", params: {}, timeoutMs: 5000, now: 0 });
  // 期限内 ⇒ 可执行 ✓
  assert.equal(isExpiredEnvelope(env, 4999), false);
  // 恰好到点 ⇒ 不算过期（deadline 含端点 ✓）
  assert.equal(isExpiredEnvelope(env, 5000), false);
  // 超一点 ⇒ 过期 ✓（这就是"宿主已超时、命令还在盘上"的场景 ✗）
  assert.equal(isExpiredEnvelope(env, 5001), true);
  // 迟到很久 ✓
  assert.equal(isExpiredEnvelope(env, 60000), true);
});

test("F08：旧宿主没带 deadline 字段 ⇒ 不判过期（向后兼容 ✓，不误杀 ✗）", () => {
  assert.equal(isExpiredEnvelope({ id: "old", __timeoutMs: 5000 }, 999999), false);
  assert.equal(isExpiredEnvelope({}, 999999), false);
  assert.equal(isExpiredEnvelope(null, 999999), false);
});

test("F08：过期回执结构可诊断（含 lateMs 与明确措辞 ✓）", () => {
  const env = envelopeOf({ id: "c4", action: "type", params: {}, timeoutMs: 5000, now: 1000 });
  const r = expiredResultOf(env, 12000);
  assert.equal(r.ok, false);
  assert.equal(r.expired, true);
  assert.equal(r.lateMs, 11000, "lateMs = now - issuedAt ✓");
  assert.match(r.error, /未执行/, "必须明确『未执行』（不能暗示已执行 ✗）");
  assert.match(r.error, /5000ms/, "必须点名宿主期限 ✓");
  const legacy = expiredResultOf({ id: "x", __timeoutMs: 1000 }, 5000);
  assert.equal(legacy.lateMs, null, "没有签发时刻时 lateMs 为 null ✓（不假装知道迟到多久 ✗）");
});

test("parity：client.js 内嵌副本与正典同判定（A1 模式 ✓）", () => {
  const client = readText("plugin/client.js");
  const m = client.match(/\/\* @command-deadline-canonical-begin[\s\S]*?\/\* @command-deadline-canonical-end \*\//);
  assert.ok(m, "client.js 必须保留 @command-deadline-canonical 内嵌块 ✓");
  const embedded = new Function(
    `${m[0].replace(/^[\s\S]*?\*\//, "").replace(/\/\* @command-deadline-canonical-end \*\//, "")}; return { isExpiredEnvelope, expiredResultOf };`,
  )();
  const cases = [
    [{ __deadlineAt: 100, __issuedAt: 0, __timeoutMs: 100 }, 50],
    [{ __deadlineAt: 100, __issuedAt: 0, __timeoutMs: 100 }, 100],
    [{ __deadlineAt: 100, __issuedAt: 0, __timeoutMs: 100 }, 101],
    [{ __deadlineAt: 100, __issuedAt: 0, __timeoutMs: 100 }, 5000],
    [{ __timeoutMs: 100 }, 999999],
    [{}, 1],
    [null, 1],
  ];
  for (const [env, now] of cases) {
    assert.equal(embedded.isExpiredEnvelope(env, now), isExpiredEnvelope(env, now), `过期判定必须一致：${JSON.stringify(env)} @${now} ✗`);
    assert.equal(embedded.expiredResultOf(env, now).error, expiredResultOf(env, now).error, "回执文案必须一致 ✓");
  }
});

test("F08 接线：宿主下发绝对 deadline + client 执行前校验（反例必须能红 ✓）", () => {
  const host = readText("plugin/browser-tools.host.mjs");
  assert.match(host, /import \{ envelopeOf \} from '\.\.\/src\/command-deadline\.mjs'/, "宿主必须用正典构造信封 ✓");
  assert.match(host, /writeCommandImpl\(pluginDir, envelopeOf\(/, "写入必须经 envelopeOf ✓（含 __deadlineAt ✓）");
  assert.match(host, /__deadlineAt/, "waitChannelFree/注释应体现 deadline ✓");
  const client = readText("plugin/client.js");
  const code = client.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /isExpiredEnvelope\(command, Date\.now\(\)\)/, "client 执行前必须校验过期 ✓");
  assert.match(code, /expiredResultOf\(command, Date\.now\(\)\)/, "过期必须回结构化结果 ✓");
  // 关键顺序：过期判定必须在 `执行命令` 之前 ✓
  const iCheck = code.indexOf("isExpiredEnvelope(command, Date.now())");
  const iRun = code.indexOf("执行命令 ${command.id}");
  assert.ok(iCheck > 0 && iRun > 0 && iCheck < iRun, "过期判定必须**先于**执行 ✗");
});
