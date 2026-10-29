/**
 * dsh-browser-kit —— **批注面板视图模型**（正典，纯函数，零平台依赖 ✓）。
 *
 * 背景（2026-10-27 三轮迭代后的正解 ✓）：面板原本由 **guest 页面渲染**、宿主把 `outerHTML` 搬进活动 DOM ✗ ——
 * 既有跨文档 HTML 信任问题（审查报告 F02 ✗），又极其脆弱 ✗（净化漏一个 SVG/样式就渲染成空白 ✗）。
 * 现在 guest 只回**结构化纯文本数据** ✓，宿主用固定组件 + 自己的样式自己画 ✓。
 *
 * 宿主渲染的观感**对齐页内面板的原始设计** ✓：深色卡片（rgba(17,24,39,.95)）、264px 宽、12px 圆角、
 * 编号徽标按状态取色（蓝=待提交 / 绿=已提交 / 灰=失联 ✓）、三列网格行（徽标 / 元素标签 / 意见单行省略）、
 * 窗口代号徽章、底部整宽按钮「展开列表 ▾」✓。
 */

/** 单条意见的最大展示长度（超出截断 ✓）。 */
export const ANNOT_NOTE_MAX = 160;
/** 单条元素标签的最大展示长度。 */
export const ANNOT_TAG_MAX = 40;
/** 列表最多展示多少条（超出显示"还有 N 条" ✓）。 */
export const ANNOT_LIST_MAX = 30;
/** 无意见时的占位文案（与页内面板一致 ✓）。 */
export const ANNOT_EMPTY_NOTE = "（未填写意见）";

/** 徽标配色：只接受 `#rgb[a]` / `#rrggbb[aa]`（防把任意 CSS 注入内联样式 ✗）。 */
export const ANNOT_BADGE_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** 也接受 `rgb()` / `rgba()` 形式 ✓。 */
export const ANNOT_RGBA_RE = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)$/i;

/** 校验颜色串能否安全用于内联样式 ✓。 */
export function isSafeCssColor(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s || s.length > 40) return false;
  return ANNOT_BADGE_RE.test(s) || ANNOT_RGBA_RE.test(s);
}

const clip = (v, n) => {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;
};

/**
 * 把 guest 回的结构化数据整理成宿主渲染用的视图模型。
 *
 * @param {object} raw guest 的 `mirrorData()` 返回值
 *   `{ count?, list?: Array<{n?, note?, tag?, label?, badge?, windowCode?, windowLabel?}> }`
 */
export function annotMirrorViewModelOf(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const rawList = Array.isArray(src.list) ? src.list : [];
  const rawCount = Number(src.count);
  const count = Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : rawList.length;

  const items = [];
  for (let i = 0; i < rawList.length && items.length < ANNOT_LIST_MAX; i += 1) {
    const r = rawList[i] && typeof rawList[i] === "object" ? rawList[i] : {};
    const nRaw = Number(r.n);
    const n = Number.isFinite(nRaw) && nRaw > 0 ? Math.floor(nRaw) : i + 1;
    const note = clip(r.note, ANNOT_NOTE_MAX);
    const tag = clip(r.tag || r.label, ANNOT_TAG_MAX);
    items.push({
      n,
      note,
      hasNote: note.length > 0,
      tag,
      badge: isSafeCssColor(r.badge) ? String(r.badge).trim() : "",
      windowCode: clip(r.windowCode, 8),
      windowLabel: clip(r.windowLabel, 60),
    });
  }

  return {
    count,
    title: "批注",
    countText: String(count),
    empty: count === 0,
    hiddenCount: Math.max(0, rawList.length - items.length),
    listOpen: src.listExpanded === true,
    items,
  };
}

/**
 * 是否需要重绘（rev 变化 / 没有 rev 时保守重绘 ✓）。
 * @param {object} prev 上一次的 `{rev, count}`
 * @param {object} next guest 新数据
 * @returns {boolean}
 */
export function annotMirrorNeedsRender(prev, next) {
  const p = prev && typeof prev === "object" ? prev : null;
  const n = next && typeof next === "object" ? next : {};
  if (!p) return true;
  if (p.rev != null && n.rev != null && p.rev === n.rev) return false;
  return true;
}
