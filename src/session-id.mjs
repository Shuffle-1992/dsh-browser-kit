/**
 * dsh-browser-kit —— **会话 id 的唯一取值口径**（正典，纯函数，无 Node/DOM 依赖 ✓）。
 *
 * 为什么必须只有一份（评审 U-2 的真问题 ✗）：
 *   - 交付侧（`annot-delivery.host.mjs` 的 `agent/pre-step` 回调）原先**只认**
 *     `payload.agent.session.id || payload.agent.session.sessionId` ✗（2 个候选）；
 *   - 工具侧（`browser-tools.host.mjs` 的 `sessionIdOf`）认 **6 个候选** ✓。
 *   ⇒ 两边口径不同 ⇒ 宿主一旦把 id 挪到别的字段，就会出现"**工具能定位会话、批注却投递不到**"的错位 ✗，
 *     而且现象是"批注静默没进上下文"，极难查 ✗。
 *
 * 取值顺序（从严到宽）：`header.id` → `header.sessionId` → `session.id` → `agent.sessionId`
 *                      → `exec.sessionId` → `header.key` → `header.uid` ✓（含工具侧原有的 `uid` 候选，取超集 ✓）。
 *
 * 用法：
 *   - 工具侧：`sessionIdOfAgent(exec && exec.agent, exec)` ✓
 *   - 交付侧：`sessionIdOfAgent(payload && payload.agent, null)` ✓
 */
export function sessionIdOfAgent(agent, exec) {
  try {
    const a = agent || (exec && exec.agent) || null;
    const session = a && a.session;
    const h = (session && session.header) || {};
    const cands = [h.id, h.sessionId, session && session.id, a && a.sessionId, exec && exec.sessionId, h.key, h.uid];
    for (const c of cands) if (typeof c === 'string' && c) return c;
  } catch { /* 形状异常一律返回 null（调用方各自降级 ✓），绝不抛 ✗ */ }
  return null;
}
