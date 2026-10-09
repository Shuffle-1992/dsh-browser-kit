/**
 * test/bridge-envelope.test.mjs — P43 回归：face 外层信封剥离
 *
 * 守住两件事：
 *  ① **行为**：client.js 内嵌的 faceUnwrap 副本与 src/bridge-envelope.mjs 正典逐例同结果（A1 parity）；
 *  ② **根因模式**：HID 桥请求分发里**不许再出现 `x.ok !== undefined` 这类谓词**——外层信封自身带 ok，
 *     用它当终止条件必然把整个信封当结果返回（本轮页面全 timeout 的根因，静默失败、极难现场定位）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { faceUnwrap } from '../src/bridge-envelope.mjs';

const clientSource = readFileSync(new URL('../plugin/client.js', import.meta.url), 'utf8');

/** 抽出 client.js 里全部内嵌副本并实例化（普通 script，无 ESM 导入能力）。 */
function embeddedCopies() {
  const re = /const faceUnwrap = \(x\) => \{[\s\S]*?\n\s*\};/g;
  const found = clientSource.match(re) || [];
  return found.map((src) => new Function(`${src}; return faceUnwrap;`)());
}

const cases = [
  { name: 'hidRead 命中（双层信封）', x: { ok: true, value: { ok: true, data: [75, 128, 12] } }, want: { ok: true, data: [75, 128, 12] } },
  { name: 'hidRead 超时（双层信封内层 ok:false）', x: { ok: true, value: { ok: false, error: 'timeout' } }, want: { ok: false, error: 'timeout' } },
  { name: '三层信封', x: { ok: true, value: { ok: true, value: { ok: true, handleId: 'hid-1' } } }, want: { ok: true, handleId: 'hid-1' } },
  { name: '单层业务结果原样返回', x: { ok: true, data: [1] }, want: { ok: true, data: [1] } },
  { name: '非对象原样返回', x: 'x', want: 'x' },
  { name: 'null 原样返回', x: null, want: null },
  { name: '数组不当信封剥', x: [{ ok: true, value: 1 }], want: [{ ok: true, value: 1 }] },
];

test('P43 parity：client 内嵌 faceUnwrap 与 src 正典逐例同结果', () => {
  const copies = embeddedCopies();
  assert.ok(copies.length >= 2, `应至少两处内嵌副本（命令处理器 + HID 桥 tick），实测 ${copies.length}`);
  for (const [i, fn] of copies.entries()) {
    for (const c of cases) {
      assert.deepEqual(fn(c.x), faceUnwrap(c.x), `副本#${i + 1} 用例「${c.name}」结果与正典不一致`);
    }
    assert.deepEqual(fn(cases[0].x), cases[0].want, `副本#${i + 1} 未正确剥出内层业务结果`);
  }
});

test('P43 根因钉死：HID 桥分发不再用「业务键当信封谓词」', () => {
  // 注释里可以引述旧写法（评审留痕），只查**代码行**：以 // 或块注释 * 开头的行不算。
  const codeOnly = clientSource
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  assert.doesNotMatch(codeOnly, /x\.ok !== undefined/, '禁止再用 x.ok !== undefined 当拆包谓词（外层信封自身带 ok）');
  // HID 六法分发必须走 faceUnwrap
  assert.match(clientSource, /req\.method === 'hidRead'\) r = faceUnwrap\(await svc\.hidRead/);
  assert.match(clientSource, /req\.method === 'hidWrite'\) r = faceUnwrap\(await svc\.hidWrite/);
  assert.match(clientSource, /req\.method === 'hidClose'\) r = faceUnwrap\(await svc\.hidClose/);
  assert.match(clientSource, /req\.method === 'hidOpen'\) r = faceUnwrap\(await svc\.hidOpen/);
  assert.match(clientSource, /req\.method === 'hidList'\) r = faceUnwrap\(await svc\.hidList/);
});

test('P43 现场形状：外层 ok:true + 内层 timeout —— 剥出内层才算对', () => {
  const wire = { ok: true, value: { ok: false, error: 'timeout' } }; // face #guard 的落盘形状
  const inner = faceUnwrap(wire);
  assert.equal(inner.ok, false);
  assert.equal(inner.error, 'timeout');
  assert.equal(inner.value, undefined, '内层不应再带 value（否则仍是信封）');
});
