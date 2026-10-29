/**
 * dsh-browser-kit —— **凭据匹配（origin 级）**（正典，纯函数，零平台依赖 ✓）。
 *
 * 为什么必须有它（审查报告 F04，P1 ✗）：旧实现只比较 `new URL(x).host` ✗ ——
 * `https://review.example/login` 保存的凭据会**匹配** `http://review.example/login` ✗
 * （协议降级 + 忽略端口），补全密码等于把 HTTPS 凭据送给明文 HTTP 页面 ✗。
 *
 * 规则（保守 ✓）：
 *   ① 页面 URL 必须是 **https:**（默认）✓ —— HTTP 页面**不**取凭据 ✗（开发例外须显式 `allowHttp:true`）；
 *   ② 匹配按**标准化 origin**（协议 + 主机 + 端口）逐字相等 ✓，不是 host、不是后缀匹配 ✗；
 *   ③ 条目若不是 https:（同样是例外场景）默认**不参与**匹配 ✗；
 *   ④ 任何解析失败 ⇒ **不匹配** ✓（不猜测、不修正 ✗）。
 *
 * 第二个调用点：`fillCredential` 在**填充执行时**再用 `location.origin` 复核一次 ✓
 * （防止"选中目标后页面导航到别处"的竞态 ✗，见 F04 修复要求的后半句）。
 */

/** 默认允许的协议（只有 https ✓）。 */
export const CRED_SAFE_SCHEMES = ["https:"];

/**
 * 解析 URL 的 origin 信息。
 * @param {unknown} u
 * @returns {{origin:string, protocol:string, host:string, port:string}|null} 解析失败返回 null ✓
 */
export function originInfoOf(u) {
  const s = typeof u === "string" ? u.trim() : "";
  if (!s) return null;
  try {
    const x = new URL(s);
    return { origin: x.origin, protocol: x.protocol, host: x.host, port: x.port || "" };
  } catch {
    return null;
  }
}

/**
 * 页面是否允许取用凭据（默认只允许 https ✓）。
 * @param {unknown} pageUrl
 * @param {{allowHttp?: boolean}} [opts]
 * @returns {{ok: boolean, reason?: string, origin?: string}}
 */
export function credPageAllowed(pageUrl, opts) {
  const info = originInfoOf(pageUrl);
  if (!info) return { ok: false, reason: "页面 URL 无法解析" };
  const allowHttp = !!(opts && opts.allowHttp);
  const okScheme = CRED_SAFE_SCHEMES.includes(info.protocol) || (allowHttp && info.protocol === "http:");
  if (!okScheme) return { ok: false, reason: `页面协议 ${info.protocol} 不允许自动填充（默认仅 https ✓）` };
  if (info.origin === "null") return { ok: false, reason: "页面 origin 为 opaque（about:/data: 等），不取凭据" };
  return { ok: true, origin: info.origin };
}

/**
 * 单条目是否与页面 origin 匹配。
 * @param {unknown} entryOrigin 保存的条目 origin
 * @param {string} pageOrigin 已校验的页面 origin
 * @param {{allowHttp?: boolean}} [opts]
 * @returns {boolean}
 */
export function credEntryMatches(entryOrigin, pageOrigin, opts) {
  const e = originInfoOf(entryOrigin);
  if (!e || !pageOrigin) return false;
  const allowHttp = !!(opts && opts.allowHttp);
  const eOk = CRED_SAFE_SCHEMES.includes(e.protocol) || (allowHttp && e.protocol === "http:");
  if (!eOk) return false; // 条目协议不安全 ⇒ 不参与匹配 ✗
  return e.origin === pageOrigin;
}

/**
 * 从列表里挑出**唯一**匹配条目（origin 级 ✓）。
 * @param {Array<object>} list 凭据条目（含 `origin` 字段）
 * @param {unknown} pageUrl 当前页面 URL
 * @param {{allowHttp?: boolean}} [opts]
 * @returns {object|null} 命中条目或 null ✓
 */
export function credMatchOf(list, pageUrl, opts) {
  if (!Array.isArray(list) || !list.length) return null;
  const allowed = credPageAllowed(pageUrl, opts);
  if (!allowed.ok) return null;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    if (credEntryMatches(entry.origin, allowed.origin, opts)) return entry;
  }
  return null;
}
