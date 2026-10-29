/**
 * dsh-browser-kit —— **自持窗口（agentView）的所有权判定**（正典，纯函数，零平台依赖 ✓）。
 *
 * 审查报告 F03（P1 ✗）指出的问题：
 *   - `agentView` 是**全局单例** ✗，`target=agent` 直接返回它 ⇒ **任何会话**都能操作**别的会话**开的窗口 ✗；
 *   - `scopeCheck` 里 `|| agentViewWebview()` 只要有自持窗口就放行 ✗（不校验归属 ✗）；
 *   - 缺省目标解析还有"显式目标找不到就退回随便一个 webview"的回退 ✗ ⇒ 命令打到**没打算操作的窗口** ✗；
 *   - `guest-eval` 不在 `PAGE_ACTIONS` ⇒ 会话作用域检查被绕过 ✗。
 *
 * 本模块只负责判定（纯函数 ✓），让"谁能操作哪个自持窗口"只有一处真值 ✓。
 *
 * 设计基线（**失败关闭** ✓）：
 *   调用方有身份、窗口有归属、两者不一致 ⇒ **拒绝** ✗（不得因为"总算有个窗口"就放行 ✗）；
 *   窗口无归属（旧数据/刚升级）⇒ 允许并标注 `legacy-unowned` ✓（兼容但不静默 ✗）；
 *   调用方无身份但窗口有归属 ⇒ **拒绝** ✗（无身份不得接管别人的窗口 ✗）。
 */

/** 判定结果的 reason/code（便于日志与测试断言 ✓）。 */
export const OWNERSHIP_REASONS = Object.freeze({
  OWNER: 'owner',
  UNKNOWN_BOTH: 'unknown-both',
  LEGACY_UNOWNED: 'legacy-unowned',
  NO_CALLER_IDENTITY: 'no-caller-identity',
  OTHER_SESSION_OWNED: 'other-session-owned',
});

/** 归一化会话 id（空串/null/undefined ⇒ null ✓）。 */
export function normalizeOwnerId(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

/**
 * 调用方能否操作当前自持窗口。
 * @param {{callerSessionId?:unknown, ownerSessionId?:unknown}} p
 * @returns {{allow:boolean, code:string, reason:string}}
 */
export function agentViewAccessOf(p) {
  const caller = normalizeOwnerId(p && p.callerSessionId);
  const owner = normalizeOwnerId(p && p.ownerSessionId);
  if (!caller && !owner) {
    return { allow: true, code: OWNERSHIP_REASONS.UNKNOWN_BOTH, reason: '调用方与窗口都没有会话身份（探针/裸通道）' };
  }
  if (!caller && owner) {
    return { allow: false, code: OWNERSHIP_REASONS.NO_CALLER_IDENTITY, reason: `自持窗口属于会话 ${owner.slice(-6)}，但调用方没有会话身份 ⇒ 拒绝（无身份不得接管别人的窗口）` };
  }
  if (caller && !owner) {
    return { allow: true, code: OWNERSHIP_REASONS.LEGACY_UNOWNED, reason: '自持窗口还没有记录归属（旧数据）⇒ 允许，但下次创建起会记录归属' };
  }
  if (caller === owner) {
    return { allow: true, code: OWNERSHIP_REASONS.OWNER, reason: '调用方就是窗口所有者' };
  }
  return {
    allow: false,
    code: OWNERSHIP_REASONS.OTHER_SESSION_OWNED,
    reason: `自持窗口属于会话 ${owner.slice(-6)}，调用方是 ${caller.slice(-6)} ⇒ 拒绝（窗口按会话隔离，A 的窗口不给 B 用）`,
  };
}

/**
 * 目标解析失败时的错误文案（**不回退** ✓）。
 * @param {{want?:unknown, callerSessionId?:unknown, ownerSessionId?:unknown, hasScopedWebview?:boolean}} p
 * @returns {{ok:false, guard:string, error:string, hint?:string}}
 */
export function pageTargetErrorOf(p) {
  const want = p && p.want != null ? String(p.want) : null;
  const access = agentViewAccessOf(p || {});
  if (want === 'agent') {
    if (!access.allow) {
      return {
        ok: false,
        guard: 'agent-view-owned-by-other',
        error: `target=agent 被拒绝：${access.reason}`,
        hint: '请用 browser_agent_window {op:"open"} 在本会话开一个自己的窗口（或改用 target=session）',
      };
    }
    return {
      ok: false,
      guard: 'agent-view-missing',
      error: 'target=agent 但当前没有自持窗口',
      hint: '先调 browser_agent_window {op:"open", url} 打开一个属于本会话的窗口',
    };
  }
  if (want === 'session') {
    return {
      ok: false,
      guard: 'session-view-missing',
      error: 'target=session 但本会话没有已挂载的浏览器面板',
      hint: '先在本会话打开内置浏览器（或在右侧栏打开），或改用 target=agent',
    };
  }
  return {
    ok: false,
    guard: 'no-target',
    error: '没有可用的目标窗口（本会话既无浏览器面板，也无自持窗口）',
    hint: '先打开内置浏览器，或调 browser_agent_window {op:"open", url}',
  };
}

/**
 * 页面类操作的会话作用域判定（`scopeCheck` 用 ✓）。
 * @param {{callerSessionId?:unknown, hasScopedWebview?:boolean, hasAgentView?:boolean, ownerSessionId?:unknown}} p
 * @returns {{allow:boolean, guard:string|null, error:string|null}}
 */
export function scopePageAllowOf(p) {
  const caller = normalizeOwnerId(p && p.callerSessionId);
  const hasScoped = !!(p && p.hasScopedWebview);
  const hasAgentView = !!(p && p.hasAgentView);
  if (!caller) {
    // 裸命令通道（探针/实施会话）：没有会话身份 ⇒ 不得操作任何**有归属**的自持窗口 ✗
    const access = agentViewAccessOf({ callerSessionId: null, ownerSessionId: p && p.ownerSessionId });
    if (hasAgentView && !access.allow) return { allow: false, guard: 'agent-view-owned-by-other', error: `被拒绝：${access.reason}` };
    return { allow: true, guard: null, error: null };
  }
  if (hasScoped) return { allow: true, guard: null, error: null };
  if (hasAgentView) {
    const access = agentViewAccessOf({ callerSessionId: caller, ownerSessionId: p && p.ownerSessionId });
    if (access.allow) return { allow: true, guard: null, error: null };
    return {
      allow: false,
      guard: 'agent-view-owned-by-other',
      sessionId: caller,
      error: `${access.reason}；可先调 browser_agent_window {op:"open", url} 在本会话开一个自己的窗口`,
    };
  }
  return {
    allow: false,
    guard: 'no-window-for-session',
    sessionId: caller,
    error: `本会话（${caller.slice(-6)}）当前没有已挂载的浏览器面板，也没有自持窗口——为避免动到其他会话的窗口，本次操作已拒绝`,
  };
}
