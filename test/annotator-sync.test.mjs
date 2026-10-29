/**
 * test/annotator-sync.test.mjs — 跨面板同步判定（A1 解耦）：
 * src/annotator-sync.mjs 正典版全分支单测 + client.js 内嵌副本 parity 对拍。
 *
 * 背景：syncPanes 判定逻辑原先只能真机回归（最大测试盲区）；抽纯函数后此处全分支覆盖。
 * fixtures 全部合成，无 Chrome/网络依赖。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planPaneSync } from '../src/annotator-sync.mjs';

const pane = (id, list, extra = {}) => ({ id, url: extra.url ?? `https://p${id}.example.com/x`, list, deleted: extra.deleted ?? [], dead: extra.dead ?? false });
const ann = (gid, note = '') => ({ gid, index: 1, note, element: { tagName: 'button', selector: `#${gid}` } });

test('planPaneSync：新 gid 登记 origins/originUrls', () => {
  const r = planPaneSync([pane(1, [ann('g1')])], {}, {});
  assert.equal(r.nextOrigins.g1, 1);
  assert.equal(r.nextOriginUrls.g1, 'https://p1.example.com/x');
  assert.equal(r.union.length, 1);
  assert.deepEqual(r.pushes, [], '单面板无跨面板推送');
  assert.deepEqual(r.removals, []);
});

test('planPaneSync：双面板去重 + 推送计划（来源不推给自己，附 _originUrl）', () => {
  const r = planPaneSync(
    [pane(1, [ann('g1')]), pane(2, [])],
    { g1: 1 },
    { g1: 'https://p1.example.com/x' },
  );
  assert.equal(r.union.length, 1, '同 gid 去重');
  assert.equal(r.union[0].origin, 1);
  const push2 = r.pushes.find((p) => p.id === 2);
  assert.ok(push2, '面板2应收到推送');
  assert.equal(push2.items.length, 1);
  assert.equal(push2.items[0]._originUrl, 'https://p1.example.com/x', '推送项附来源页 URL（同页门控）');
  assert.equal(r.pushes.find((p) => p.id === 1), undefined, '来源面板不推给自己');
});

test('planPaneSync：删除日志 → removedGids + 广播目标 + origins 清理', () => {
  // 真实时序：面板1 删除 g1 → removeRecord 已把它从面板1 列表移除并写删除日志；
  // 面板2 快照仍持有 g1 → 广播目标是面板2
  const r = planPaneSync(
    [pane(1, [], { deleted: ['g1'] }), pane(2, [ann('g1')])],
    { g1: 1 },
    { g1: 'https://p1.example.com/x' },
  );
  assert.equal(r.union.length, 0, '已删 gid 不进合并视图');
  assert.equal(r.removedGids.g1, true);
  const rm = r.removals.find((x) => x.gid === 'g1');
  assert.deepEqual(rm.targets, [2], '广播目标=仍持有该 gid 的面板');
  assert.equal(r.nextOrigins.g1, undefined, '来源表随删除清理');
  assert.equal(r.nextOriginUrls.g1, undefined, '来源 URL 表随删除清理（旧实现漏删，此处修复泄漏）');
});

test('planPaneSync：来源面板消失判定（origin 列表缺该 gid → 删除）', () => {
  const r = planPaneSync(
    [pane(1, []), pane(2, [ann('g1')])],
    { g1: 1 },
    { g1: 'https://p1.example.com/x' },
  );
  assert.equal(r.removedGids.g1, true, '来源面板已无此 gid → 删除');
  const rm = r.removals.find((x) => x.gid === 'g1');
  assert.deepEqual(rm.targets, [2]);
});

test('planPaneSync：dead 面板不参与推送/广播，其来源消失不判定', () => {
  // 来源面板 dead：不能仅凭它的列表为空就判定删除
  const r1 = planPaneSync(
    [pane(1, [], { dead: true }), pane(2, [ann('g1')])],
    { g1: 1 },
    { g1: 'https://p1.example.com/x' },
  );
  assert.notEqual(r1.removedGids.g1, true, 'dead 来源面板不触发「来源消失」判定');
  assert.equal(r1.union.length, 1);
  // dead 面板不收推送也不收广播（面板2 删除 g1 后，dead 的面板1 不在广播目标里）
  const r2 = planPaneSync(
    [pane(1, [ann('g1')], { dead: true }), pane(2, [], { deleted: ['g1'] })],
    { g1: 1 },
    { g1: 'https://p1.example.com/x' },
  );
  assert.equal(r2.removedGids.g1, true, '面板2 的删除日志应判定 g1 已删');
  assert.deepEqual(r2.removals, [], 'dead 持有者不参与广播（其徽标待复活后自然消失）');
  assert.equal(r2.pushes.find((p) => p.id === 1), undefined, 'dead 面板不推送');
});

test('planPaneSync：单面板 count 正确、无推送（C3 修复语义）', () => {
  const r = planPaneSync([pane(1, [ann('a'), ann('b')])], {}, {});
  assert.equal(r.union.length, 2);
  assert.deepEqual(r.pushes, []);
});

/* ─────── parity：client.js 内嵌副本与 ESM 正典输出一致（防漂移，对拍先例=协议 builder） ─────── */

const clientSource = readFileSync(new URL('../plugin/client.js', import.meta.url), 'utf8');
const m = clientSource.match(/\/\* @annotator-sync-canonical-begin[\s\S]*?const planPaneSync = \(states, origins, originUrls\) => \{([\s\S]*?)\n          \};/);
assert.ok(m, 'client.js 内嵌 planPaneSync 可定位（canonical 标记）');

test('parity：client.js 内嵌 planPaneSync ≡ src/annotator-sync.mjs（三组 fixtures 输出一致）', () => {
  const embedded = new Function(`"use strict"; return (states, origins, originUrls) => {${m[1]}\n};`)();
  const fixtures = [
    // 单面板登记
    [[pane(1, [ann('g1')])], {}, {}],
    // 双面板共享 + 删除日志广播
    [[pane(1, [ann('g1')], { deleted: ['g1'] }), pane(2, [ann('g1'), ann('g2')])], { g1: 1, g2: 1 }, { g1: 'https://p1.example.com/x', g2: 'https://p1.example.com/x' }],
    // 来源消失 + dead 面板
    [[pane(1, [], { dead: true }), pane(2, [ann('g1')])], { g1: 1, g2: 2 }, { g1: 'https://p1.example.com/x', g2: 'https://p2.example.com/x' }],
  ];
  for (const [i, [states, origins, urls]] of fixtures.entries()) {
    const a = planPaneSync(states, origins, urls);
    const b = embedded(states, origins, urls);
    assert.deepEqual(b, a, `fixture#${i}：内嵌副本与 ESM 正典输出必须一致`);
  }
});
