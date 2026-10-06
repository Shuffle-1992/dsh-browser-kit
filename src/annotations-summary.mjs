/**
 * src/annotations-summary.mjs — 提交摘要构建（R3-2 解耦，A1 先例模式）：
 * 「gid 去重 + 字段映射 + index 序化」公共核。
 *
 * 边界（防误用）：只做去重/映射/排序——host 落盘的重编号、client 悬浮的展示映射
 * 留在各自调用侧。text 缺失时回退 accessibleName，60 字截断。
 * client.js 内嵌副本 parity 锁定（client 不能 import，见评审报告研究项 A）。
 */
export const SUMMARY_TEXT_MAX = 60;

export function summarizeSets(sets) {
  const list = Array.isArray(sets) ? sets : [];
  const items = [];
  const seenGids = {};
  for (const s of list) {
    const anns = (s && s.annotations) || [];
    for (const a of anns) {
      const gid = (a && a.gid) || null;
      if (gid) {
        if (seenGids[gid]) continue;
        seenGids[gid] = true;
      }
      items.push({
        index: Number(a && a.index) || 0,
        gid,
        selector: String((a && a.element && a.element.selector) || ''),
        text: String((a && a.element && a.element.text) || (a && a.element && a.element.accessibleName) || '').slice(0, SUMMARY_TEXT_MAX),
        url: (s && s.url) || null,
      });
    }
  }
  items.sort((x, y) => x.index - y.index);
  return items;
}
