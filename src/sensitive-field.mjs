/**
 * dsh-browser-kit —— **敏感字段识别与脱敏**（正典，纯函数，零平台依赖 ✓）。
 *
 * 为什么必须有它（审查报告 F05，P1 ✗）：`browser_element_info` 与 `browser_snapshot` 原本**回传所有元素的 value** ✗
 * ⇒ 自动填充写入的密码会被元素工具原样读回 ✗ ⇒ "密码不进 Agent 上下文"的产品承诺在**读取端**不成立 ✗。
 *
 * 边界（必须如实说清 ✓）：
 *   · 本模块只负责**默认读取路径**的脱敏 ✓（元素档案 / 快照 / 诊断日志）；
 *   · **页内 `browser_eval` 仍可读取页面表单值** ✗ —— 这是浏览器自动化能力本身，无法用字段屏蔽消除 ✓
 *     ⇒ 产品承诺必须收敛为"默认工具出口不返回敏感值"，不能宣称"绝不可能被读到" ✗（README 已同步修正）。
 *
 * 判定为敏感的规则（保守、可解释 ✓）：
 *   ① `type=password`；② `autocomplete` 含密码/信用卡/一次性码相关标记；
 *   ③ name/id/placeholder 命中 pass/pwd/secret/token/cvv/otp/密码/验证码 等提示词。
 */

/** 脱敏后的占位值（明确区分"空"与"已隐藏" ✓）。 */
export const MASKED_VALUE = "***";

/** autocomplete 里表示敏感数据的标记（W3C 词汇表子集 ✓）。 */
export const SENSITIVE_AUTOCOMPLETE = [
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-type",
];

/** name/id/placeholder 里的敏感提示词。 */
export const SENSITIVE_HINTS = ["pass", "pwd", "secret", "token", "cvv", "cvc", "otp", "密码", "验证码"];

/**
 * 判断一个字段是否属于"默认不返回其值"的敏感字段。
 * @param {{type?:unknown, autocomplete?:unknown, name?:unknown, id?:unknown, placeholder?:unknown}} f
 * @returns {boolean} true = 敏感（值必须脱敏 ✓）
 */
export function isSensitiveField(f) {
  const o = f && typeof f === "object" ? f : {};
  const type = String(o.type || "").toLowerCase();
  if (type === "password") return true;
  const ac = String(o.autocomplete || "").toLowerCase();
  if (ac && SENSITIVE_AUTOCOMPLETE.some((x) => ac.includes(x))) return true;
  const hint = [o.name, o.id, o.placeholder].map((x) => String(x || "")).join(" ").toLowerCase();
  if (!hint.trim()) return false;
  return SENSITIVE_HINTS.some((x) => hint.includes(x));
}

/**
 * 按需脱敏一个字段值。
 * @param {unknown} value 原始值
 * @param {boolean} sensitive 是否敏感
 * @returns {unknown} 敏感 ⇒ `MASKED_VALUE` ✓；否则原值 ✓
 */
export function maskValueIfSensitive(value, sensitive) {
  if (!sensitive) return value;
  return value === undefined || value === null || value === "" ? value : MASKED_VALUE;
}
