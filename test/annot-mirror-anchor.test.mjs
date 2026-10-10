/**
 * 批注镜像面板落位：canonical 对拍（client 内嵌副本 ↔ src/annot-mirror-anchor.mjs）。
 *
 * 为什么要对拍：这段几何曾在 guest（屏幕锚点）与宿主（位置计算）各写一份、且对"自持窗口展开态"
 * 处理不一致 —— 展开时 bar.top≈46，按"贴 bar 上沿"算出的 bottom≈innerHeight−34 会把 82px 高的
 * 面板顶出屏幕（审计 2026-10-10）。现在规则只在模块里定义，client 内嵌同一份，本测试防止漂移。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mirrorPlacement } from "../src/annot-mirror-anchor.mjs";

const clientSource = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8");

const extractCanonical = () => {
  const begin = clientSource.indexOf("/* @annot-mirror-anchor-canonical-begin */");
  const end = clientSource.indexOf("/* @annot-mirror-anchor-canonical-end */");
  assert.ok(begin > 0 && end > begin, "client.js 缺少 mirrorPlacement canonical 区块");
  const body = clientSource.slice(begin, end);
  // 与 test/annotator-sync.test.mjs 同款：用 new Function 把内嵌副本取出来当函数用
  const fn = new Function(`${body}\nreturn mirrorPlacement;`);
  return fn();
};

test("mirrorPlacement：canonical 副本与模块实现逐例一致", () => {
  const embedded = extractCanonical();
  const cases = [
    { name: "小窗态（bar 在下半部）", input: { paneRight: 2560, barTop: 1344, winW: 2560, winH: 1400, gap: 12, panelH: 82 } },
    { name: "自持面板展开态（bar.top≈46）", input: { paneRight: 2560, barTop: 46, winW: 2560, winH: 1400, gap: 12, panelH: 82 } },
    { name: "无自持窗口", input: { paneRight: 1280, barTop: NaN, winW: 1280, winH: 900, gap: 12, panelH: 82 } },
    { name: "窗口极小（触发上界夹取）", input: { paneRight: 300, barTop: 290, winW: 320, winH: 300, gap: 12, panelH: 82 } },
    { name: "零/负值与非数值", input: { paneRight: NaN, barTop: -5, winW: 0, winH: -1, gap: -3, panelH: NaN } },
  ];
  for (const c of cases) {
    assert.deepEqual(embedded(c.input), mirrorPlacement(c.input), `不一致：${c.name}`);
  }
});

test("mirrorPlacement：展开态不得把面板顶出屏幕（回归审计发现）", () => {
  const expanded = mirrorPlacement({ paneRight: 2560, barTop: 46, winW: 2560, winH: 1400, gap: 12, panelH: 82 });
  assert.equal(expanded.bottom, 12, "展开态应贴视口右下角，而不是贴 bar 上沿");
  assert.equal(expanded.clipped, false);
  // 面板完全可见：bottom + panelH + gap ≤ winH
  assert.ok(expanded.bottom + 82 + 12 <= 1400);

  const collapsed = mirrorPlacement({ paneRight: 2560, barTop: 1344, winW: 2560, winH: 1400, gap: 12, panelH: 82 });
  assert.equal(collapsed.bottom, 68, "小窗态应贴小窗上沿（1400−1344+12）");
  assert.equal(collapsed.clipped, false);
});

test("mirrorPlacement：上界保护与退化输入", () => {
  // 夹取条件：dockToBar 为真（bar 在下半）且 bar 距顶不足 panelH + 2*gap ⇒ 视口很矮时才会发生
  const tight = mirrorPlacement({ paneRight: 300, barTop: 101, winW: 320, winH: 200, gap: 12, panelH: 82 });
  assert.equal(tight.clipped, true);
  assert.equal(tight.bottom, 200 - 82 - 12);
  // 退化输入只保证"有限、非负、不抛"（真实 UI 不会出现全空输入）
  const degenerate = mirrorPlacement({});
  for (const k of ["right", "bottom"]) {
    assert.ok(Number.isFinite(degenerate[k]) && degenerate[k] >= 0, `${k} 必须是有限非负值`);
  }
  assert.equal(typeof degenerate.clipped, "boolean");
});

test("mirrorPlacement：右缘始终等于 视口宽 − 板块右缘 + gap", () => {
  const p = mirrorPlacement({ paneRight: 2000, barTop: 900, winW: 2560, winH: 1400, gap: 12 });
  assert.equal(p.right, 2560 - 2000 + 12);
});

test("mirrorPlacement：锚点 rect 退化为 0 时回退视口右下角（回归实测 bug）", () => {
  // 实测：锚点面板此刻不可见 ⇒ paneRight≈0 ⇒ 旧算法 right = winW − 0 + gap = 2572 ⇒ 面板被推出屏幕（left −276）
  const degenerate = mirrorPlacement({ paneRight: 0, barTop: 0, winW: 2560, winH: 1400, gap: 12, panelH: 82 });
  assert.equal(degenerate.right, 12, "paneRight=0 不是有效锚点，应回退 gap");
  assert.equal(degenerate.bottom, 12, "barTop=0 不是有效小窗，应回退 gap");
  for (const bad of [-5, 0, NaN, null]) {
    const p = mirrorPlacement({ paneRight: bad, barTop: bad, winW: 2560, winH: 1400, gap: 12, panelH: 82 });
    assert.equal(p.right, 12, `paneRight=${bad} 应回退`);
    assert.ok(p.right + 264 <= 2560 && p.bottom + 82 <= 1400, "回退后必须完全在屏幕内");
  }
});
