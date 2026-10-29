/**
 * 批注投递文本精简化（正典 · 纯函数）。
 *
 * 2026-10-28（用户实测："批注引入的信息体积比较大，主要是元素的路径等…随便几条批注就要 100KB"）：
 * 旧投递把协议 markdown 全文内联进上下文 —— 每条批注都带 URL、Title、Window、Tag、Role、
 * Accessible name、Selector、XPath、Attributes、Color、Background、Font、Font weight、Display、
 * Rect、Text、Nearby context、HTML excerpt ⇒ 单条 5～15KB，几条就 100KB（挤上下文，且大部分用不上）。
 *
 * 现在的取舍（够用主义）：
 *  - 投递文本只带定位必需的最小集：序号、标签、可读名、窗口、意见、短选择器；
 *  - 不再内联 XPath、HTML 片段、属性转储、样式、Rect、Nearby context —— 需要时用工具
 *    browser_annotations 按需读取完整记录（plugin/.data/annotations/ 下仍是全量）；
 *  - 有总预算（ANNOT_DELIVERY_LIMIT）：超出时按条截断并明确告知在文件里（绝不静默丢）。
 */
export const ANNOT_DELIVERY_LIMIT = 4000;
/** 单条批注行上限（字符） */
export const ANNOT_LINE_MAX = 220;
/** 意见字段单行上限 */
export const ANNOT_NOTE_MAX = 80;
/** 元素可读名单行上限 */
export const ANNOT_NAME_MAX = 36;
/** 短选择器上限 */
export const ANNOT_SELECTOR_MAX = 90;

const str = (v) => (v == null ? '' : String(v));
const squeeze = (v) => str(v).replace(/\s+/g, ' ').trim();

/** 截断（带省略号）✓ */
export function clipTextOf(value, max) {
  const t = squeeze(value);
  const n = Number(max) > 0 ? Number(max) : 0;
  if (!n) return t;
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * 把长 CSS 选择器压成"最短可定位形式" ✓。
 *
 * 规则（按优先级）：
 *  ① 含 `#id` ⇒ 取 `#id`（唯一，最短 ✓）；
 *  ② 否则取**末尾最多 3 段**（`button.submit` / `form > button:nth-of-type(2)` ✓）；
 *  ③ 仍超长 ⇒ 只留最后 1 段再截断 ✓。
 * 放弃 XPath ✗ —— 它最长且最容易失效 ✗。
 */
export function compactSelectorOf(selector) {
  const s = squeeze(selector);
  if (!s) return '';
  const limit = ANNOT_SELECTOR_MAX;
  const parts = s.split(/\s*>\s*/).filter(Boolean);
  if (!parts.length) return clipTextOf(s, limit);
  const seg = (p) => p.trim();
  const idOf = (p) => {
    const m = seg(p).match(/#([\w-]+)/);
    return m ? `#${m[1]}` : '';
  };
  const lastPart = seg(parts[parts.length - 1]);
  // ① 末段自带 id ⇒ 最短且精确
  const lastId = idOf(lastPart);
  if (lastId) return clipTextOf(lastId, limit);
  // ② 最近祖先 id + 末段（如 #order-form > button.submit ⇒ "#order-form button.submit"）
  for (let k = parts.length - 2; k >= 0; k -= 1) {
    const id = idOf(parts[k]);
    if (id) return clipTextOf(`${id} ${lastPart}`, limit);
  }
  // ③ 末尾 2 段
  const two = parts.slice(-2).map(seg).join(' > ');
  if (two.length <= limit) return two;
  // ④ 只剩末段再截断
  return clipTextOf(lastPart, limit);
}
/**
 * 单条批注 → 一行精简描述 ✓（**固定形状**，便于 Agent 扫读）：
 * `- #1 button「提交订单」· 窗口 A · 意见：颜色不对 · sel: #submit`
 */
export function compactAnnotationLineOf(item) {
  const it = item || {};
  const idx = Number(it.index) > 0 ? `#${Number(it.index)}` : '#?';
  const tag = clipTextOf(it.tag, 24).toLowerCase();
  const name = clipTextOf(it.name, ANNOT_NAME_MAX);
  const code = squeeze(it.code);
  const winLabel = code ? `窗口 ${code}` : clipTextOf(it.window, 24);
  const note = clipTextOf(it.note, ANNOT_NOTE_MAX);
  const sel = compactSelectorOf(it.sel || it.selector);
  const bits = [`- ${idx}${tag ? ` ${tag}` : ''}${name ? `「${name}」` : ''}`];
  if (winLabel) bits.push(winLabel);
  if (note) bits.push(`意见：${note}`);
  if (sel) bits.push(`sel: ${sel}`);
  return clipTextOf(bits.join(' · '), ANNOT_LINE_MAX);
}

/**
 * 渲染投递文本 ✓（**这是注入到会话里的全部批注描述**）。
 * @param {{count?:number, items?:Array, windows?:Array, path?:string, latestPath?:string}} d
 */
export function renderCompactDelivery(d) {
  const data = d || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const windows = Array.isArray(data.windows) ? data.windows : [];
  const count = Number(data.count) > 0 ? Number(data.count) : items.length;
  const path = squeeze(data.path);
  const latestPath = squeeze(data.latestPath);

  const head = `[dsh-browser-kit] 用户刚发送了 ${count} 条元素批注（**精简版**：只含定位必需字段 ✓；XPath / HTML 片段 / 属性 / 坐标等完整记录在文件里，需要时用 browser_annotations 读取）：`;
  const winLine = windows.length
    ? `涉及窗口：${windows.map((w) => `${w && w.code ? `窗口 ${w.code}` : '窗口'}（${Number((w && w.count) || 0)} 条${w && w.label ? ` · ${clipTextOf(w.label, 40)}` : ''}）`).join('；')}`
    : '';

  const lines = [];
  let used = head.length + winLine.length;
  let shown = 0;
  for (const it of items) {
    const line = compactAnnotationLineOf(it);
    if (!line) continue;
    // 预留文件行与尾部说明的空间，避免"最后一行被截断"✗
    if (used + line.length + 200 > ANNOT_DELIVERY_LIMIT && shown > 0) break;
    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }
  const rest = items.length - shown;

  const out = [head];
  if (winLine) out.push(winLine);
  if (lines.length) out.push(lines.join('\n'));
  if (rest > 0) out.push(`…（另有 ${rest} 条未内联：完整记录见下方文件 ✓）`);
  if (path) out.push(`批注文件：${path}${latestPath && latestPath !== path ? `（最近一次固定路径：${latestPath}）` : ''}`);
  out.push('以上即批注摘要；需要元素代码定位细节（XPath / HTML 片段 / 属性）时用 browser_annotations，不必搜索存放位置。');
  return out.join('\n');
}
