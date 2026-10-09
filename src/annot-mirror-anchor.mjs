/**
 * dsh-browser-kit — 批注镜像面板的**落位计算**（纯函数，无 DOM）。
 *
 * 为什么单独成模块：这段几何有两个消费者/两处历史实现（guest 侧屏幕锚点 `annotAnchors` 与宿主侧
 * `positionAnnotMirror`），二者对"自持窗口展开态"的处理**不一致**，导致展开时面板被顶出屏幕
 * （审计 2026-10-10 发现）。现在收敛为**唯一真值**：client.js 内嵌同一份 canonical 副本，
 * `test/annot-mirror-anchor.test.mjs` 对拍（与 annotations-summary / annotator-sync 同款手法）。
 *
 * 约定：
 *  - 输入全部是**屏幕坐标**（CSS px）：`paneRight` 板块可视区右缘、`barTop` 自持小窗/面板上沿、
 *    `winW/winH` 视口尺寸、`gap` 面板与边界间距、`panelH` 面板高度。
 *  - 输出 `{ right, bottom, clipped }`：直接写进 `position:fixed` 容器的 `right/bottom`。
 *  - 规则：①右缘贴板块右缘 − gap；②**小窗态**（bar 在视口下半）面板贴小窗上沿；
 *    其余（无小窗 / 自持面板展开态）贴视口右下角 —— 否则展开态下 bar.top≈46 会把面板顶出屏幕；
 *    ③上界保护：`bottom` 不得超过 `winH − panelH − gap`，超出则夹取并把 `clipped` 标真。
 */

export function mirrorPlacement(o) {
  o = o || {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const winW = Math.max(1, num(o.winW, 1024));
  const winH = Math.max(1, num(o.winH, 768));
  const gap = Math.max(0, num(o.gap, 12));
  const panelH = Math.max(0, num(o.panelH, 82));
  const paneRight = num(o.paneRight, NaN);
  const barTop = num(o.barTop, NaN);

  const right = Number.isFinite(paneRight) ? Math.max(gap, Math.round(winW - paneRight + gap)) : gap;
  // 只有"小窗在视口下半"才贴它上沿；展开态/无小窗一律贴视口右下角
  const dockToBar = Number.isFinite(barTop) && barTop > winH * 0.5;
  let bottom = dockToBar ? Math.max(gap, Math.round(winH - barTop + gap)) : gap;
  const maxBottom = winH - panelH - gap;
  let clipped = false;
  if (bottom > maxBottom) {
    bottom = Math.max(gap, Math.round(maxBottom));
    clipped = true;
  }
  return { right, bottom, clipped };
}

export default mirrorPlacement;
