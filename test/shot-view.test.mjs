/**
 * C2 解耦验收：`src/shot-view.mjs`（正典）单测 + client.js 内嵌 canonical 副本 parity 对拍。
 * 另加：`src/tool-presentation.mjs`（宿主直接 import 的正典）单测 + 宿主引用钉子。
 *
 * A1 模式（本仓库既有）：纯逻辑正典放 src/；client 不支持相对 import ⇒ 内嵌副本 + 对拍锁定 ✓。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseName, shotNameOf, humanBytes, createShotStore } from '../src/shot-view.mjs';
import { presentTitleBits, presentCallOf, presentResultOf } from '../src/tool-presentation.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = readFileSync(join(root, 'plugin/client.js'), 'utf8');
const toolsSrc = readFileSync(join(root, 'plugin/browser-tools.host.mjs'), 'utf8');

/** 取出 client.js 的内嵌 canonical 副本并按模块语义实例化（同 annot-mirror-anchor 测试的取法 ✓）。 */
const embeddedShotView = () => {
  const begin = clientSrc.indexOf('/* @shot-view-canonical-begin');
  const end = clientSrc.indexOf('/* @shot-view-canonical-end */');
  assert.ok(begin > 0 && end > begin, 'client.js 缺少 shot-view canonical 区块 ✗');
  const block = clientSrc.slice(begin, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${block}\nreturn SHOT_VIEW;`)();
};

test('shot-view 正典：baseName 兼容 win/posix/尾斜杠/空值', () => {
  assert.equal(baseName('F:\\a\\b\\c.png'), 'c.png');
  assert.equal(baseName('/a/b/c.png'), 'c.png');
  assert.equal(baseName('c.png'), 'c.png');
  assert.equal(baseName('F:\\dir\\'), 'dir');
  assert.equal(baseName(''), '');
  assert.equal(baseName(null), '');
  assert.equal(baseName(undefined), '');
});

test('shot-view 正典：shotNameOf 三重兜底（meta → 文本 .png → JSON）', () => {
  assert.equal(shotNameOf({ meta: { path: 'F:\\x\\y\\s1.png' } }), 's1.png', 'meta.path 优先');
  assert.equal(shotNameOf({ meta: { file: '/p/s2.png' } }), 's2.png', 'meta.file 兜底');
  assert.equal(shotNameOf({ content: [{ type: 'text', text: '落盘到 F:\\p\\s3.png 了' }] }), 's3.png', '文本里找 .png');
  assert.equal(shotNameOf({ content: [{ type: 'text', text: '{"ok":true,"path":"C:\\\\q\\\\s4.png"}' }] }), 's4.png', 'JSON 兜底');
  assert.equal(shotNameOf({ content: [{ type: 'text', text: '没有图片' }] }), null);
  assert.equal(shotNameOf(null), null);
  assert.equal(shotNameOf({ meta: 3, content: 'x' }), null, '形状异常也不许抛 ✗');
});

test('shot-view 正典：humanBytes 人读且空值安全', () => {
  assert.equal(humanBytes(0), '');
  assert.equal(humanBytes(null), '');
  assert.equal(humanBytes(512), '512 B');
  assert.equal(humanBytes(57311), '56 KB');
  assert.equal(humanBytes(3 * 1024 * 1024), '3.0 MB');
});

test('shot-view 正典：createShotStore 双闸（条数 + 总字节）先到先出', () => {
  const s = createShotStore({ maxCount: 3, maxBytes: 1e9 });
  assert.equal(s.remember('a.png', 'x'.repeat(10), 10), true);
  s.remember('b.png', 'x'.repeat(10), 10);
  s.remember('c.png', 'x'.repeat(10), 10);
  s.remember('d.png', 'x'.repeat(10), 10); // 超条数 ⇒ 挤掉最早的
  assert.equal(s.size, 3);
  assert.deepEqual(s.keys(), ['b.png', 'c.png', 'd.png']);
  assert.equal(s.get('F:\\some\\where\\c.png')?.bytes, 10, '按 baseName 归一化取 ✓');
  assert.equal(s.get(''), null);
  assert.equal(s.remember('', 'x'), false, '缺路径/数据不存 ✗');
  const s2 = createShotStore({ maxCount: 99, maxBytes: 25 });
  s2.remember('a.png', 'x'.repeat(20));
  s2.remember('b.png', 'x'.repeat(20)); // 超总字节 ⇒ 挤掉最早的
  assert.equal(s2.size, 1);
  assert.deepEqual(s2.keys(), ['b.png']);
});

test('shot-view parity：client 内嵌副本与 src 正典逐例一致', () => {
  const emb = embeddedShotView();
  const cases = ['F:\\a\\b\\c.png', '/a/b/c.png', 'c.png', 'F:\\dir\\', '', null, undefined];
  for (const c of cases) assert.equal(emb.baseName(c), baseName(c), `baseName(${String(c)}) 不一致 ✗`);
  const blocks = [
    { meta: { path: 'F:\\x\\s1.png' } },
    { meta: { shot: '/p/s2.png' } },
    { content: [{ type: 'text', text: 'F:\\p\\s3.png' }] },
    { content: [{ type: 'text', text: '{"path":"C:\\\\q\\\\s4.png"}' }] },
    { content: [{ type: 'text', text: '无图' }] },
    /* ★评审 R-4：官方结果块是**包裹形状** `{ call: {...}, meta, content }` ⇒ 必须逐层取值 ✓ */
    { call: { meta: { path: '/w/w1.png' } } },
    { call: { content: [{ type: 'text', text: '落盘 F:\\w\\w2.png' }] } },
    { call: {}, meta: { path: '/w/w3.png' } },
    null,
  ];
  for (const b of blocks) assert.equal(emb.shotNameOf(b), shotNameOf(b), 'shotNameOf 不一致 ✗');
  for (const n of [0, 512, 57311, 3 * 1024 * 1024, null]) assert.equal(emb.humanBytes(n), humanBytes(n), 'humanBytes 不一致 ✗');
  const a = emb.createShotStore({ maxCount: 2, maxBytes: 1e9 });
  const b = createShotStore({ maxCount: 2, maxBytes: 1e9 });
  for (const [n, d] of [['a.png', 'x'.repeat(5)], ['b.png', 'y'.repeat(5)], ['c.png', 'z'.repeat(5)]]) { a.remember(n, d); b.remember(n, d); }
  assert.deepEqual(a.keys(), b.keys(), 'store 淘汰顺序不一致 ✗');
  assert.equal(a.get('c.png').bytes, b.get('c.png').bytes);
});

test('C2 解耦：宿主带 ?ts= 动态加载 src/tool-presentation.mjs（不复制一份 ✗、不丢查询参数 ✗）', () => {
  assert.match(toolsSrc, /import\(`\.\.\/src\/tool-presentation\.mjs\?ts=\$\{Date\.now\(\)\}`\)/, '必须带 ?ts= 动态加载正典（P13 ✓）');
  assert.equal(/const presentTitleBits = /.test(toolsSrc), false, 'plugin/ 里不得再留一份实现 ✗（解耦前就在这）');
  // 纯函数行为
  assert.deepEqual(presentTitleBits({ op: 'click', url: 'https://a/b', ref: 'x' }), ['op=click', 'url=https://a/b']);
  assert.deepEqual(presentTitleBits(null), []);
  assert.deepEqual(presentCallOf('browser_click', {}), { card: 'generic', title: 'browser_click' });
  assert.equal(presentCallOf('browser_click', { selector: '#a' }).title, 'browser_click · selector=#a');
  assert.equal(presentResultOf('browser_screenshot', { content: [{ type: 'text', text: '{"path":"F:\\\\s.png"}' }] }).title, 'browser_screenshot · s.png');
  assert.deepEqual(presentResultOf('browser_tabs', { content: [] }), { card: 'generic', title: 'browser_tabs' });
});
