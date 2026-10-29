/**
 * 自持窗口所有权 —— **行为钉**（审查报告 F03 反例 ✓）。
 *
 * 反例：`agentView` 是全局单例 ✗ ⇒ **B 会话能直接操作 A 会话开的窗口** ✗；
 * `scopeCheck` 里 `|| agentViewWebview()` 不校验归属 ✗；显式目标缺失时**回退**到别的窗口 ✗；
 * `guest-eval` 不在 PAGE_ACTIONS ⇒ 绕过会话作用域 ✗。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentViewAccessOf,
  pageTargetErrorOf,
  scopePageAllowOf,
  normalizeOwnerId,
  OWNERSHIP_REASONS,
} from "../src/window-ownership.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (p) => readFileSync(join(root, p), "utf8");
const A = "session-aaaa-1111";
const B = "session-bbbb-2222";

test("F03 反例：B 会话**不得**操作 A 会话的自持窗口（旧实现直接放行 ✗）", () => {
  const access = agentViewAccessOf({ callerSessionId: B, ownerSessionId: A });
  assert.equal(access.allow, false, "跨会话必须拒绝 ✗");
  assert.equal(access.code, OWNERSHIP_REASONS.OTHER_SESSION_OWNED);
  assert.match(access.reason, /拒绝/);
});

test("F03：所有者自己可以操作（唯一放行路径 ✓）", () => {
  const access = agentViewAccessOf({ callerSessionId: A, ownerSessionId: A });
  assert.equal(access.allow, true);
  assert.equal(access.code, OWNERSHIP_REASONS.OWNER);
});

test("F03：无会话身份的调用方不得接管**有归属**的窗口（失败关闭 ✓）", () => {
  const access = agentViewAccessOf({ callerSessionId: null, ownerSessionId: A });
  assert.equal(access.allow, false, "无身份必须拒绝 ✗");
  assert.equal(access.code, OWNERSHIP_REASONS.NO_CALLER_IDENTITY);
});

test("F03：旧数据（窗口无归属）放行但标注 legacy-unowned ✓（兼容不静默 ✗）", () => {
  const access = agentViewAccessOf({ callerSessionId: A, ownerSessionId: null });
  assert.equal(access.allow, true);
  assert.equal(access.code, OWNERSHIP_REASONS.LEGACY_UNOWNED);
  // 双方都无身份（纯探针）也允许 ✓
  assert.equal(agentViewAccessOf({ callerSessionId: null, ownerSessionId: null }).allow, true);
});

test("F03：target=agent 被拒时给出可操作提示（不是含糊报错 ✓）", () => {
  const denied = pageTargetErrorOf({ want: "agent", callerSessionId: B, ownerSessionId: A });
  assert.equal(denied.ok, false);
  assert.equal(denied.guard, "agent-view-owned-by-other");
  assert.match(denied.error, /target=agent 被拒绝/);
  assert.match(denied.hint, /browser_agent_window/, "必须告诉 Agent 怎么开自己的窗口 ✓");
  const missing = pageTargetErrorOf({ want: "agent", callerSessionId: A, ownerSessionId: null });
  assert.equal(missing.guard, "agent-view-missing");
  const none = pageTargetErrorOf({});
  assert.equal(none.guard, "no-target");
});

test("F03：页面类作用域判定（本会话面板 ✓ / 归属不符 ✗ / 都没有 ✗）", () => {
  // 本会话有面板 ⇒ 放行 ✓
  assert.equal(scopePageAllowOf({ callerSessionId: A, hasScopedWebview: true }).allow, true);
  // 本会话没面板，但自持窗口属于本会话 ⇒ 放行 ✓
  assert.equal(scopePageAllowOf({ callerSessionId: A, hasAgentView: true, ownerSessionId: A }).allow, true);
  // 自持窗口属于别人 ⇒ 拒绝 ✗（报告的核心洞 ✓）
  const denied = scopePageAllowOf({ callerSessionId: B, hasAgentView: true, ownerSessionId: A });
  assert.equal(denied.allow, false);
  assert.equal(denied.guard, "agent-view-owned-by-other");
  // 什么都没有 ⇒ 拒绝 ✓
  const none = scopePageAllowOf({ callerSessionId: A });
  assert.equal(none.allow, false);
  assert.equal(none.guard, "no-window-for-session");
  // 无身份 + 有归属窗口 ⇒ 拒绝 ✓（裸通道不得接管别人的窗口 ✗）
  const bare = scopePageAllowOf({ callerSessionId: null, hasAgentView: true, ownerSessionId: A });
  assert.equal(bare.allow, false);
  assert.equal(bare.guard, "agent-view-owned-by-other");
});

test("归一化：非字符串/空白 ⇒ null ✓", () => {
  assert.equal(normalizeOwnerId(A), A);
  assert.equal(normalizeOwnerId(`  ${A}  `), A);
  for (const bad of [null, undefined, 0, {}, "", "   "]) assert.equal(normalizeOwnerId(bad), null);
});

test("parity：client 内嵌副本与正典逐例同结果（A1 模式 ✓）", () => {
  const client = readText("plugin/client.js");
  const m = client.match(/\/\* @window-ownership-canonical-begin[\s\S]*?\/\* @window-ownership-canonical-end \*\//);
  assert.ok(m, "client.js 必须保留 @window-ownership-canonical 内嵌块 ✓");
  const embedded = new Function(
    `${m[0].replace(/^[\s\S]*?\*\//, "").replace(/\/\* @window-ownership-canonical-end \*\//, "")}; return { agentViewAccessOf, pageTargetErrorOf, scopePageAllowOf, normalizeOwnerId };`,
  )();
  const accessCases = [
    { callerSessionId: A, ownerSessionId: A },
    { callerSessionId: B, ownerSessionId: A },
    { callerSessionId: null, ownerSessionId: A },
    { callerSessionId: A, ownerSessionId: null },
    { callerSessionId: null, ownerSessionId: null },
  ];
  for (const c of accessCases) {
    assert.deepEqual(embedded.agentViewAccessOf(c), agentViewAccessOf(c), "归属判定必须一致 ✓ " + JSON.stringify(c));
  }
  const scopeCases = [
    { callerSessionId: A, hasScopedWebview: true },
    { callerSessionId: B, hasAgentView: true, ownerSessionId: A },
    { callerSessionId: null, hasAgentView: true, ownerSessionId: A },
    { callerSessionId: A },
  ];
  for (const c of scopeCases) {
    assert.deepEqual(embedded.scopePageAllowOf(c), scopePageAllowOf(c), "作用域判定必须一致 ✓ " + JSON.stringify(c));
  }
  for (const w of ["agent", "session", null]) {
    assert.deepEqual(
      embedded.pageTargetErrorOf({ want: w, callerSessionId: B, ownerSessionId: A }),
      pageTargetErrorOf({ want: w, callerSessionId: B, ownerSessionId: A }),
      "错误文案必须一致 ✓ want=" + w,
    );
  }
});

test("F03 接线：四处洞都堵上（目标解析 / 作用域 / eval / 归属记录 ✓）", () => {
  const client = readText("plugin/client.js");
  const code = client.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // ① 不再有"目标找不到就随便找一个 webview"的回退 ✗
  assert.doesNotMatch(code, /inputTargetOf\(c\) \|\| pickGuestEl\(\)/, "不得再回退到任意 webview ✗");
  assert.match(code, /pageTargetOf\(c\)/, "必须走 pageTargetOf（显式目标缺失即失败 ✓）");
  // ② 目标解析与作用域都过所有权判定 ✓
  assert.match(code, /agentViewAccessOf\(\{ callerSessionId, ownerSessionId: agentView\.ownerSessionId \}\)/, "inputTargetOf 必须校验归属 ✓");
  assert.match(code, /scopePageAllowOf\(\{/, "scopeCheck 必须用正典判定 ✓");
  assert.doesNotMatch(code, /!scopedWebviews\(sid\)\.length && !agentViewWebview\(\)/, "旧的『有自持窗口就放行』必须删除 ✗");
  // ③ guest-eval 纳入页面类作用域 ✓
  assert.match(client, /const PAGE_ACTIONS = new Set\(\['snapshot', 'guest-eval'/, "guest-eval 必须在 PAGE_ACTIONS ✓");
  // ④ 创建时记录归属 ✓
  assert.match(code, /agentView\.ownerSessionId = normalizeOwnerId\(opts && opts\.sessionId\)/, "ensureAgentView 必须记录创建者 ✓");
  // ⑤ 结构化错误透传 ✓
  assert.match(code, /e && e\.dshKit \?/, "执行器必须透传 guard/hint ✓");
});
