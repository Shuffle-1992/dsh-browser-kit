/**
 * dsh-browser-kit —— 工具卡展示纯逻辑（**正典**，宿主侧带 `?ts=` 动态 import ✓）。
 *
 * 官方契约（`@deepseek-ai/dsh-tools@0.2.1-rc.2` `lib/types/index.d.ts:182/190`）：
 *   - `presentCall(args) -> ToolCallView | undefined`
 *   - `presentResult(args, result) -> ToolResultView | undefined`
 *   两者都是**纯函数、无副作用**（官方注明用于 replay ✓），返回 `{ card, title }`。
 *
 * ⚠️ **归因更正**（独立评审对我此前结论的纠偏，asar 内 `dsh-client-ui-tool/README.zh.md:54` 逐字）：
 *   "Host presentCall 与 presentResult 值**不会进入 Client**" ✗ ⇒ 它**不是** keyed `tool.call.toolview`
 *   的分派开关（我此前把它当成了开关 ✗，而当时"变更前后"恰好夹着一次**插件重载** ⇒ 混淆了因果 ✗）。
 *   自定义工具卡不渲染的**真因**在客户端侧：官方结果块把载荷包在 **`block.call`**
 *   （`dsh-client-ui-tool/lib/client.js:311/346`），而取值逻辑只读 `block.meta/content` ⇒ 取不到文件名 ✗。
 *   本模块继续保留（它仍是宿主侧展示契约的正当实现 ✓），但别再拿它解释客户端渲染 ✗。
 */

/** 取前两个最有信息量的参数，拼成一行标题（值过长/换行都裁掉，避免标题撑爆 ✓）。 */
export function presentTitleBits(args) {
  try {
    const a = args && typeof args === 'object' ? args : {};
    const bits = [];
    for (const k of ['op', 'url', 'selector', 'ref', 'query', 'name', 'id', 'text']) {
      const v = a[k];
      if (v === undefined || v === null || v === '') continue;
      bits.push(`${k}=${String(v).replace(/\s+/g, ' ').slice(0, 40)}`);
      if (bits.length >= 2) break;
    }
    return bits;
  } catch {
    return [];
  }
}

/** 运行中的卡片标题：`<工具名> · k=v k=v`（无参数就是工具名 ✓）。 */
export function presentCallOf(toolName, args) {
  try {
    const bits = presentTitleBits(args);
    return { card: 'generic', title: bits.length ? `${toolName} · ${bits.join(' ')}` : String(toolName) };
  } catch {
    return undefined;
  }
}

/** 结束后的卡片标题：截图类把落盘文件名带上 ✓（toolview 另有 content/meta 双兜底 ✓）。 */
export function presentResultOf(toolName, result) {
  try {
    let detail = null;
    const content = (result && result.content) || [];
    for (const c of content) {
      if (c && c.type === 'text' && typeof c.text === 'string') {
        const m = c.text.match(/[^\s"']+\.png/i);
        if (m) {
          const s = m[0];
          const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
          detail = i >= 0 ? s.slice(i + 1) : s;
          break;
        }
      }
    }
    return { card: 'generic', title: detail ? `${toolName} · ${detail}` : String(toolName) };
  } catch {
    return undefined;
  }
}
