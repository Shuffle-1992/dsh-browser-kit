/**
 * dsh-browser-kit —— **命令通道超时预算**（正典，纯函数，零依赖 ✓）。
 *
 * 为什么值得单抽（P116 事故区 + 深度 review H-2 ✗）：
 *   这一段曾两次出错 ✗：①公式写错（`min(20000, …)` 把 `browser_wait` 的 60s 等待截断成假超时 ✗）；
 *   ②把 handler 的参数名 `c` 抄进轮询器作用域 ⇒ ReferenceError ⇒ 回执永不写 ⇒ 所有工具"无回执" ✗✗。
 *   两次都只有**字面钉**（`assert.match` 源码）⇒ 测试全绿、实机全死 ✗。
 *   抽成纯函数后可以用**行为钉**锁死数值语义 ✓（test/command-budget.test.mjs）。
 *
 * 契约（三条不变量 ✓）：
 *   ①客户端上限 **< 宿主期限**（留 2s 余量）⇒ 客户端总能先回一条结构化错误 ✓；
 *   ②客户端上限 **≥ 最大工具超时的一半**（封顶 80s ≥ `browser_wait` 宿主 70s ✓）⇒ 长等待不被截断 ✓；
 *   ③非法/缺失输入退回默认 25000 ✓（绝不抛 ✗）。
 *
 * 用法：
 *   - client 侧（不能 import ✗）：用内嵌副本 `/* @command-budget-canonical-begin/end *\/` ✓
 *   - host 侧：静态 import `DEFAULT_CMD_TIMEOUT_MS` ✓
 */

/** 命令通道默认期限（宿主工具未声明 timeoutMs 时的兜底 ✓，与 browser-tools 的形参缺省一致 ✓）。 */
export const DEFAULT_CMD_TIMEOUT_MS = 25000;

/** 客户端上限的下界（再小就没意义了 ✓）。 */
export const CLIENT_CAP_MIN_MS = 2000;

/** 客户端上限的上界（必须 ≥ 最大工具超时 70000 ✓，留 10s 余量）。 */
export const CLIENT_CAP_MAX_MS = 80000;

/** 客户端留给宿主的余量（客户端必须**先**回执 ✓）。 */
export const CLIENT_CAP_MARGIN_MS = 2000;

/**
 * 由宿主期限算出客户端单命令上限。
 * @param {unknown} hostCap 宿主期限（毫秒；非法/缺失 ⇒ 退回默认 ✓）
 * @returns {number} 客户端上限（毫秒，恒 ≥ 2000 且 ≤ 80000 ✓）
 */
export function clientCapOf(hostCap) {
  const n = Number(hostCap);
  const h = Number.isFinite(n) && n > 0 ? n : DEFAULT_CMD_TIMEOUT_MS;
  return Math.max(CLIENT_CAP_MIN_MS, Math.min(CLIENT_CAP_MAX_MS, h - CLIENT_CAP_MARGIN_MS));
}
