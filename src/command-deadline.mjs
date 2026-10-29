/**
 * dsh-browser-kit —— **命令信封与到期判定**（正典，纯函数，零平台依赖 ✓）。
 *
 * 为什么必须有它（审查报告 F08，P2 ✗）：宿主超时后只是"停止等待" ✗ —— `command.json` 仍留在盘上，
 * client 断线/页面挂起后恢复照样会取走并**执行**这条早已宣告失败的命令 ✗
 * ⇒ Agent 重试时造成**重复副作用**（同一处点击/输入执行两次）✗。
 *
 * 关键点：只下发**相对**预算（`__timeoutMs`）无法判定"这条命令是不是迟到的" ✗ —— 必须带
 * **签发时刻 + 绝对 deadline** ✓，客户端取走时用本机时钟直接比较 ✓（过期即拒绝执行 ✗）。
 *
 * 三个字段都用 `__` 前缀，避免与业务参数重名（P47-D ✓）：
 *   `__timeoutMs` 宿主授予的期限（相对 ✓，用于压客户端上限）
 *   `__issuedAt`  签发时刻（epoch ms ✓，用于算迟到多久 ✓）
 *   `__deadlineAt` 绝对到期时刻（epoch ms ✓，**执行前判定**的依据 ✓）
 */

/** 信封里保留的元字段（业务参数不得占用 ✓）。 */
export const ENVELOPE_META_FIELDS = Object.freeze(["__timeoutMs", "__issuedAt", "__deadlineAt"]);

/**
 * 构造命令信封（宿主侧）。
 * @param {{id:string, action:string, params?:object, timeoutMs:number, now?:number}} p
 * @returns {object} 可直接写盘的信封 ✓
 */
export function envelopeOf({ id, action, params, timeoutMs, now }) {
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const cap = Number(timeoutMs);
  const ms = Number.isFinite(cap) && cap > 0 ? cap : 25000;
  const out = { id, action };
  const src = params && typeof params === "object" ? params : {};
  for (const k of Object.keys(src)) {
    if (ENVELOPE_META_FIELDS.includes(k)) continue; // 不允许业务参数覆盖信封 ✓
    out[k] = src[k];
  }
  out.__timeoutMs = ms;
  out.__issuedAt = t;
  out.__deadlineAt = t + ms;
  return out;
}

/**
 * 一条命令是否已经过期（客户端执行前必须判定 ✓）。
 * @param {object} envelope
 * @param {number} [now] 当前时刻（缺省 Date.now() ✓）
 * @returns {boolean} true = 已过期 ⇒ **不得执行** ✗
 */
export function isExpiredEnvelope(envelope, now) {
  const dl = Number(envelope && envelope.__deadlineAt);
  if (!Number.isFinite(dl) || dl <= 0) return false; // 没有 deadline 字段 ⇒ 视为未过期（旧宿主兼容 ✓）
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  return t > dl;
}

/**
 * 过期命令该回什么（结构化、可诊断 ✓）。
 * @param {object} envelope
 * @param {number} [now]
 * @returns {{ok:false, expired:true, lateMs:number|null, error:string}}
 */
export function expiredResultOf(envelope, now) {
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const issued = Number(envelope && envelope.__issuedAt);
  const lateMs = Number.isFinite(issued) && issued > 0 ? t - issued : null;
  const cap = Number(envelope && envelope.__timeoutMs) || 0;
  return {
    ok: false,
    expired: true,
    lateMs,
    error: `命令已过期（宿主期限 ${cap}ms 已过${lateMs == null ? "" : `，迟到 ${Math.round(lateMs / 1000)}s`}），客户端**未执行**；请重新发起该操作`,
  };
}
