/**
 * test/annotator-consume.test.mjs — 消息胶囊消耗判定（R3-1 解耦）：
 * src/annotator-consume.mjs 正典全分支单测 + client.js 内嵌副本 parity 对拍。
 *
 * 判定规则固化原因（历史教训）：跨会话误耗（末行键跨视图比对）与「末尾 N 条」扩散
 * 两次真机事故——此处单测钉死，防未来改动靠真机回归。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planChipConsume } from '../src/annotator-consume.mjs';

const sig = (n, first, last) => ({ n, first, last });

test('planChipConsume：无 base/sig → idle（基线未建立不误耗）', () => {
  assert.equal(planChipConsume(sig(3, 'a', 'c'), null), 'idle');
  assert.equal(planChipConsume(null, sig(3, 'a', 'c')), 'idle');
});

test('planChipConsume：顶行键变化（切会话/虚拟化重组）→ reset（胶囊保留待命）', () => {
  assert.equal(planChipConsume(sig(5, 'X', 'z'), sig(5, 'A', 'c')), 'reset');
  // 行数也变了同样 reset（切会话场景的常态）
  assert.equal(planChipConsume(sig(9, 'X', 'q'), sig(5, 'A', 'c')), 'reset');
});

test('planChipConsume：同视图行数增长 → consume（用户发出新消息）', () => {
  assert.equal(planChipConsume(sig(6, 'A', 'c'), sig(5, 'A', 'c')), 'consume');
  // 行数增长但末行键恰好未变（合成/重复文本）也应 consume
  assert.equal(planChipConsume(sig(6, 'A', 'c'), sig(5, 'A', 'c')), 'consume');
});

test('planChipConsume：同视图末行变化且行数不减 → consume（虚拟化一进一出）', () => {
  assert.equal(planChipConsume(sig(5, 'A', 'z'), sig(5, 'A', 'c')), 'consume');
  assert.equal(planChipConsume(sig(7, 'A', 'z'), sig(5, 'A', 'c')), 'consume');
});

test('planChipConsume：同视图行数与末行均不变 → idle（未发送）', () => {
  assert.equal(planChipConsume(sig(5, 'A', 'c'), sig(5, 'A', 'c')), 'idle');
});

test('planChipConsume：同视图行数减少且末行未变 → idle（删消息/虚拟化收窄，防误耗）', () => {
  assert.equal(planChipConsume(sig(3, 'A', 'c'), sig(5, 'A', 'c')), 'idle');
});

/* ─────── parity：client.js 内嵌副本与 ESM 正典输出一致（A1 先例模式） ─────── */

const clientSource = readFileSync(new URL('../plugin/client.js', import.meta.url), 'utf8');
const m = clientSource.match(/\/\* @annotator-consume-canonical-begin[\s\S]*?const planChipConsume = \(sig, base\) => \{([\s\S]*?)\n          \};/);
assert.ok(m, 'client.js 内嵌 planChipConsume 可定位（canonical 标记）');

test('parity：client.js 内嵌 planChipConsume ≡ src/annotator-consume.mjs（全分支输出一致）', () => {
  const embedded = new Function(`"use strict"; return (sig, base) => {${m[1]}\n};`)();
  const fixtures = [
    [sig(3, 'a', 'c'), null],
    [sig(5, 'X', 'z'), sig(5, 'A', 'c')],
    [sig(6, 'A', 'c'), sig(5, 'A', 'c')],
    [sig(5, 'A', 'z'), sig(5, 'A', 'c')],
    [sig(5, 'A', 'c'), sig(5, 'A', 'c')],
    [sig(3, 'A', 'c'), sig(5, 'A', 'c')],
  ];
  for (const [i, [s, b]] of fixtures.entries()) {
    assert.equal(embedded(s, b), planChipConsume(s, b), `fixture#${i}：内嵌副本与正典判定必须一致`);
  }
});