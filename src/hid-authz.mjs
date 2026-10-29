/**
 * dsh-browser-kit —— **HID 桥的授权模型**（正典，纯函数，零平台依赖 ✓）。
 *
 * 审查报告 F01（P1 ✗）指出的问题：宿主把网页可写的 `__dshKitHidQueue` 当命令源 ✗ ——
 *   ① 任何页面都能排 `hidOpen/hidRead/hidWrite` ✗（不校验 origin/会话/文档 ✗）；
 *   ② 句柄是全局递增 `hid-N` ✗ ⇒ **可猜测**，A 页面的句柄能被 B 页面用 ✗；
 *   ③ 页面导航后旧句柄仍然可用 ✗（没有文档代际 ✓）。
 *
 * 本模块给出一套**失败关闭**（fail-closed ✓）的判定：
 *   - **默认拒绝**：页面所在 origin 未被**显式授权** ⇒ 一律拒绝 ✗（判罚只落在 HID 能力 ✓，不影响批注/自动化 ✓）；
 *   - 授权按 **origin** 记录并带**有效期** ✓（本机非持久信任 ✓，过期自动失效 ✓）；
 *   - 句柄绑定 **(pane, device)** ✓，且句柄 id 由宿主生成（**不可猜测** ✓）；
 *   - origin 变了（导航/跨站）⇒ paneKey 变 ⇒ 旧授权与旧句柄**自然失配** ✓ ⇒ 自动拒绝 ✓。
 */

/** 授权默认有效期：30 分钟（够一次调试/固件升级 ✓，不构成长期信任 ✓）。 */
export const HID_GRANT_TTL_MS = 30 * 60 * 1000;
/** 句柄上限（防句柄表无限增长 ✗）。 */
export const HID_HANDLE_MAX = 32;
/** 设备路径最大长度（防超长串打爆日志/存储 ✓）。 */
export const HID_PATH_MAX = 300;

/** 判定结果码（测试与日志用 ✓）。 */
export const HID_CODES = Object.freeze({
  ALLOWED: 'allowed',
  NOT_AUTHORIZED: 'hid-not-authorized',
  EXPIRED: 'hid-grant-expired',
  BAD_ORIGIN: 'hid-origin-unavailable',
  HANDLE_UNKNOWN: 'hid-handle-unknown',
  HANDLE_OTHER_PANE: 'hid-handle-other-pane',
  BAD_METHOD: 'hid-method-unknown',
});

/**
 * 从 URL 取 origin（**只接受 http/https** ✓；其余返回 null ⇒ 拒绝 ✓）。
 * @param {unknown} url
 * @returns {string|null}
 */
export function hidOriginOfUrl(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin || null;
  } catch {
    return null;
  }
}

/**
 * 面板身份 key：webContentsId + origin（**两者都要有** ✓，缺一不可 ✗）。
 * @param {{wcId?:unknown, origin?:unknown}} p
 * @returns {string|null}
 */
export function hidPaneKeyOf(p) {
  const id = Number(p && p.wcId);
  const origin = typeof (p && p.origin) === "string" ? p.origin.trim() : "";
  if (!Number.isFinite(id) || id <= 0 || !origin) return null;
  return `wc:${Math.floor(id)}|${origin}`;
}

/** 归一化设备路径（空/超长 ⇒ null ✓）。 */
export function hidDeviceKeyOf(path) {
  const s = String(path == null ? "" : path).trim();
  if (!s || s.length > HID_PATH_MAX) return null;
  if (s.includes("\u0000")) return null;
  return s;
}

/**
 * 授权一条 origin（幂等、覆盖同 origin 的旧记录 ✓）。
 * @param {{grants?:Array<object>, origin?:unknown, now?:number, ttlMs?:number}} p
 * @returns {Array<{origin:string, at:number, expiresAt:number}>} 新授权表（已剪掉过期项 ✓）
 */
export function hidAuthorizeOf(p) {
  const now = Number.isFinite(Number(p && p.now)) ? Number(p.now) : Date.now();
  const ttl = Number.isFinite(Number(p && p.ttlMs)) && Number(p.ttlMs) > 0 ? Number(p.ttlMs) : HID_GRANT_TTL_MS;
  const origin = String((p && p.origin) || "").trim();
  const keep = hidPruneGrantsOf(p && p.grants, now);
  if (!origin) return keep;
  if (!hidOriginOfUrl(origin)) return keep; // 非 http/https ⇒ 不授权 ✓
  const rest = keep.filter((g) => g.origin !== origin);
  rest.push({ origin, at: now, expiresAt: now + ttl });
  return rest;
}

/** 剪掉过期/形状坏的授权项 ✓。 */
export function hidPruneGrantsOf(grants, now) {
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const out = [];
  for (const g of Array.isArray(grants) ? grants : []) {
    if (!g || typeof g !== "object") continue;
    const origin = typeof g.origin === "string" ? g.origin.trim() : "";
    const exp = Number(g.expiresAt);
    if (!origin || !hidOriginOfUrl(origin)) continue;
    if (!Number.isFinite(exp) || exp <= t) continue;
    out.push({ origin, at: Number(g.at) || 0, expiresAt: exp });
  }
  return out;
}

/**
 * 撤销某 origin 的授权（或全部 ✓）。
 * @param {{grants?:Array<object>, origin?:unknown, now?:number}} p
 */
export function hidRevokeOf(p) {
  const now = Number.isFinite(Number(p && p.now)) ? Number(p.now) : Date.now();
  const keep = hidPruneGrantsOf(p && p.grants, now);
  const origin = String((p && p.origin) || "").trim();
  if (!origin) return [];
  return keep.filter((g) => g.origin !== origin);
}

/**
 * 某个页面能不能用 HID（**默认拒绝** ✓）。
 * @param {{grants?:Array<object>, origin?:unknown, now?:number}} p
 * @returns {{allow:boolean, code:string, reason:string, expiresAt?:number}}
 */
export function hidAuthzCheckOf(p) {
  const now = Number.isFinite(Number(p && p.now)) ? Number(p.now) : Date.now();
  const origin = typeof (p && p.origin) === "string" ? p.origin.trim() : "";
  if (!origin || !hidOriginOfUrl(origin)) {
    return { allow: false, code: HID_CODES.BAD_ORIGIN, reason: "无法确定页面 origin（非 http/https 或读取失败）⇒ 拒绝使用 HID" };
  }
  const grants = Array.isArray(p && p.grants) ? p.grants : [];
  const hit = grants.find((g) => g && g.origin === origin);
  if (!hit) {
    return { allow: false, code: HID_CODES.NOT_AUTHORIZED, reason: `origin ${origin} 未被授权使用 HID ⇒ 拒绝（默认拒绝 ✓）` };
  }
  const exp = Number(hit.expiresAt);
  if (!Number.isFinite(exp) || exp <= now) {
    return { allow: false, code: HID_CODES.EXPIRED, reason: `origin ${origin} 的 HID 授权已过期 ⇒ 拒绝（请重新授权 ✓）` };
  }
  return { allow: true, code: HID_CODES.ALLOWED, reason: `origin ${origin} 已授权使用 HID（有效至 ${new Date(exp).toISOString()}）`, expiresAt: exp };
}

/**
 * 绑定句柄到 (pane, device) ✓（超出上限时丢最旧 ✓）。
 * @param {{handles?:Map<string,object>|Array<object>, handleId?:unknown, paneKey?:unknown, deviceKey?:unknown, at?:number}} p
 * @returns {Map<string,{paneKey:string, deviceKey:string, at:number}>}
 */
export function hidHandleBindOf(p) {
  const map = p && p.handles instanceof Map ? new Map(p.handles) : new Map();
  const handleId = String((p && p.handleId) || "").trim();
  const paneKey = String((p && p.paneKey) || "").trim();
  const deviceKey = String((p && p.deviceKey) || "").trim();
  if (!handleId || !paneKey) return map;
  map.set(handleId, { paneKey, deviceKey, at: Number(p && p.at) || Date.now() });
  while (map.size > HID_HANDLE_MAX) {
    const first = map.keys().next();
    if (first.done) break;
    map.delete(first.value);
  }
  return map;
}

/**
 * 句柄能否被当前 pane 使用（**绑定校验** ✓：A 的句柄不给 B ✗，导航后自动失配 ✓）。
 * @param {{handles?:Map<string,object>, handleId?:unknown, paneKey?:unknown}} p
 * @returns {{allow:boolean, code:string, reason:string, deviceKey?:string}}
 */
export function hidHandleCheckOf(p) {
  const map = p && p.handles instanceof Map ? p.handles : new Map();
  const handleId = String((p && p.handleId) || "").trim();
  const paneKey = String((p && p.paneKey) || "").trim();
  if (!handleId || !map.has(handleId)) {
    return { allow: false, code: HID_CODES.HANDLE_UNKNOWN, reason: `句柄 ${handleId || "(空)"} 不在宿主句柄表里 ⇒ 拒绝（句柄只由宿主创建 ✓）` };
  }
  const rec = map.get(handleId) || {};
  if (!paneKey || rec.paneKey !== paneKey) {
    return { allow: false, code: HID_CODES.HANDLE_OTHER_PANE, reason: `句柄 ${handleId} 属于另一个页面/文档 ⇒ 拒绝（导航或跨页面复用均不允许 ✗）` };
  }
  return { allow: true, code: HID_CODES.ALLOWED, reason: "句柄归属匹配 ✓", deviceKey: rec.deviceKey };
}

/** 被拒绝时回给页面的结构化结果（页面/调试都能看懂 ✓）。 */
export function hidDenialOf(info) {
  const i = info && typeof info === "object" ? info : {};
  return {
    ok: false,
    denied: String(i.code || HID_CODES.NOT_AUTHORIZED),
    error: String(i.reason || "HID 请求被拒绝"),
    hint: "需先由用户/Agent 显式授权该站点使用 HID（browser_hid op=authorize）；授权按 origin 记录且有有效期 ✓",
  };
}
