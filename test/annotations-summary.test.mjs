/**
 * test/annotations-summary.test.mjs — 提交摘要构建（R3-2 解耦）：
 * src/annotations-summary.mjs 正典单测 + client.js 内嵌副本 parity 对拍。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeSets, SUMMARY_TEXT_MAX } from '../src/annotations-summary.mjs';

const ann = (gid, index, extra = {}) => ({ gid, index, element: { selector: extra.selector ?? `#${gid}`, text: extra.text, accessibleName: extra.accessibleName } });
const set = (url, annotations) => ({ url, title: 'T', annotations });

test('summarizeSets：跨组同 gid 去重保序（多面板同步的重复条目）', () => {
  const items = summarizeSets([
    set('https://a.example', [ann('g1', 1), ann('g2', 2)]),
    set('https://a.example', [ann('g1', 1)]), // 同 gid 重复（另一面板同步）
  ]);
  assert.equal(items.length, 2, 'gid 去重');
  assert.deepEqual(items.map((i) => i.gid), ['g1', 'g2']);
});

test('summarizeSets：无 gid 条目不去重（保序保留）', () => {
  const items = summarizeSets([set('u', [ann(null, 1), ann(null, 1)])]);
  assert.equal(items.length, 2, '无 gid 无法判定重复，原样保留');
});

test('summarizeSets：index 升序（含字符串数字容错）', () => {
  const items = summarizeSets([set('u', [ann('g3', '3'), ann('g1', 1), ann('g2', 2)])]);
  assert.deepEqual(items.map((i) => i.index), [1, 2, 3]);
});

test('summarizeSets：text 空回退 accessibleName，再空为 ""', () => {
  const items = summarizeSets([set('u', [
    ann('g1', 1, { text: '正文' }),
    ann('g2', 2, { text: '', accessibleName: '登录' }),
    ann('g3', 3, {}),
  ])]);
  assert.equal(items[0].text, '正文');
  assert.equal(items[1].text, '登录', 'text 空回退 accessibleName');
  assert.equal(items[2].text, '');
});

test('summarizeSets：text 60 字截断（SUMMARY_TEXT_MAX）', () => {
  const long = 'x'.repeat(120);
  const items = summarizeSets([set('u', [ann('g1', 1, { text: long })])]);
  assert.equal(items[0].text.length, SUMMARY_TEXT_MAX);
});

test('summarizeSets：url 取所属组；空输入安全', () => {
  const items = summarizeSets([set('https://b.example', [ann('g1', 1)])]);
  assert.equal(items[0].url, 'https://b.example');
  assert.deepEqual(summarizeSets(null), []);
  assert.deepEqual(summarizeSets([]), []);
});

/* ─────── parity：client.js 内嵌副本与 ESM 正典输出一致（A1 先例模式） ─────── */

const clientSource = readFileSync(new URL('../plugin/client.js', import.meta.url), 'utf8');
const m = clientSource.match(/\/\* @annotations-summary-canonical-begin[\s\S]*?const summarizeSets = \(sets\) => \{([\s\S]*?)\n            \};/);
assert.ok(m, 'client.js 内嵌 summarizeSets 可定位（canonical 标记）');

test('parity：client.js 内嵌 summarizeSets ≡ src/annotations-summary.mjs（多组 fixtures 一致）', () => {
  const embedded = new Function(`"use strict"; return (sets) => {${m[1]}\n};`)();
  const fixtures = [
    [set('https://a.example', [ann('g1', 1), ann('g2', 2)]), set('https://a.example', [ann('g1', 1)])],
    [set('u', [ann('g3', '3'), ann('g1', 1, { text: '', accessibleName: '登录' }), ann(null, 2, { text: 'x'.repeat(100) })])],
    [set('https://b.example', [ann('g9', 9, { text: '正文' })])],
  ];
  for (const [i, sets] of fixtures.entries()) {
    assert.deepEqual(embedded(sets), summarizeSets(sets), `fixture#${i}：内嵌副本与正典输出必须一致`);
  }
});