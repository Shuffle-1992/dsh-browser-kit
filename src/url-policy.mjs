/**
 * dsh-browser-kit —— **导航 URL 策略**（正典，纯函数，零平台依赖 ✓）。
 *
 * 背景（深度 review L-9 ✗ / 解耦方案 D4 ✓）：`browser_open` 工具侧**拒绝** `file:` / 带凭据的 URL ✓，
 * 但**自持窗口**（`agent-view` 的 loadURL 路径）没有同一道校验 ✗ ⇒ 同一个"打开网页"动作在两处**策略不一致** ✗。
 * 抽成正典后：两处共用同一判定 ✓，并有行为钉（test/url-policy.test.mjs ✓）。
 *
 * 规则（保守 ✓）：
 *   · 允许 `http:` / `https:` ✓；`about:blank`（自持窗口的空白载具 ✓）单独放行 ✓。
 *   · 拒绝：`file:` / `javascript:` / `data:` / `chrome:` / `devtools:` 等其它协议 ✗；
 *   · 拒绝：URL 里带**用户信息**（`user:pass@host` ✗ —— 凭据不得进日志/上下文 ✓ 且极易被误用 ✗）；
 *   · 拒绝：无法解析的串 ✗（不做"猜测修正" ✗，避免把错串变成危险 URL ✗）。
 */

/** 允许的协议（白名单 ✓）。 */
export const ALLOWED_SCHEMES = ["http:", "https:"];

/**
 * 判断某个 URL 是否允许载入自持窗口 / 面板。
 * @param {unknown} url
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkNavUrl(url) {
  const s = typeof url === "string" ? url.trim() : "";
  if (!s) return { ok: false, reason: "URL 为空" };
  if (s === "about:blank" || s.startsWith("about:blank#")) return { ok: true };
  let u;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: `无法解析的 URL：${s.slice(0, 120)}` };
  }
  if (!ALLOWED_SCHEMES.includes(u.protocol)) {
    return { ok: false, reason: `不允许的协议 ${u.protocol}（只允许 http/https ✓）` };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "URL 不得携带用户名/密码（凭据不进日志与上下文 ✓）" };
  }
  return { ok: true };
}
