/**
 * test/webhid-shim-delivery.test.mjs — P43 回归：**shim 投递链**（桥 → 页面 inputreport）
 *
 * 现场故障：设备响应全部到达桥（trace 完整 W/R 成对），页面却全部 timeout。根因两处：
 *  ① client 拆包谓词命中外层信封 → `{ok:true}` 无 data → shim 静默 return（已由 bridge-envelope 锁定）；
 *  ② shim 固定 250ms 轮询 + 多请求在飞 → 超时旧请求仍会执行并抢走响应。
 *
 * 本测试在 vm 沙箱里加载真实 shim，用「假 client」应答队列，断言：
 *  - 监听器收到 inputreport，且 `ev.data` 是 **DataView**、`reportId` 单列、载荷不含 report id；
 *  - 单飞：一次只挂一个未决读（不再堆请求）；
 *  - 防御：即便 client 回归成返回**外层信封**，shim 也能剥开并把数据投递出去。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox, evalScriptFile } from './helpers/sandbox.mjs';
import { projectRoot } from './helpers/chrome.mjs';

const SHIM = `${projectRoot}/src/webhid-shim.js`;
const DEV = { path: '\\\\?\\hid#test', vendorId: 0x3302, productId: 0x43b1, product: 'KSHF-02 Pro', serialNumber: 'SN1' };
const REPORT = [0x4b, 0x80, 0x0c, 0x00, 0x30, 0x2e, 0x33]; // report id 75 + [80 0c 00 "0.3"]

/** 极简 DOM 桩：选择器 UI 只需要 createElement/append/style/handlers。 */
function makeDocumentStub() {
  const created = [];
  const mk = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      handlers: {},
      style: {},
      _text: '',
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); },
      get innerText() { return this._text; },
      setAttribute() {},
      getAttribute() { return null; },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      append(...cs) { cs.forEach((c) => { c.parent = this; }); this.children.push(...cs); },
      removeChild() {},
      addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); },
      click() { (this.handlers.click || []).forEach((f) => f()); },
    };
    created.push(el);
    return el;
  };
  return { createElement: mk, documentElement: mk('html'), created };
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

function boot() {
  const sandbox = createSandbox();
  sandbox.document = makeDocumentStub();
  evalScriptFile(sandbox, SHIM);
  return sandbox;
}

/** 取出并应答当前队列中的全部桥请求（answer(req) → 结果对象，按内层业务结果给）。 */
function drain(sandbox, answer) {
  const q = sandbox.window.__dshKitHidQueue || [];
  const items = q.splice(0, q.length);
  for (const it of items) sandbox.window.__dshKitHidResolve(it.id, answer(it));
  return items;
}

/** 从选择器里点掉第一行（requestDevice 的 resolve 依赖它）：文本在行内 span 上，向上找带 click 的行。 */
function clickChooserRow(sandbox) {
  const label = sandbox.document.created.find((el) => el._text === DEV.product);
  assert.ok(label, '选择器应渲染出设备行文本');
  let row = label;
  while (row && !(row.handlers && row.handlers.click)) row = row.parent;
  assert.ok(row, '设备行应挂 click 处理器');
  row.click();
}

async function connect(sandbox) {
  const hid = sandbox.navigator.hid;
  assert.ok(hid && typeof hid.requestDevice === 'function', 'shim 应覆盖 navigator.hid');
  const pending = hid.requestDevice({ filters: [] });
  await tick();
  drain(sandbox, (req) => (req.method === 'hidList' ? { ok: true, devices: [DEV] } : { ok: true }));
  await tick(); // 让 requestDevice 的 .then 链渲染选择器
  clickChooserRow(sandbox);
  const [device] = await pending;
  assert.ok(device, 'requestDevice 应返回设备数组');
  const opened = device.open();
  await tick();
  drain(sandbox, (req) => (req.method === 'hidOpen' ? { ok: true, handleId: 'hid-1' } : { ok: true }));
  await opened;
  return { hid, device };
}

async function sendAndAnswerOneRead(sandbox, device, readResult) {
  const seen = [];
  const drained = [];
  const answer = (req) => {
    drained.push(req.method);
    if (req.method === 'hidRead') return readResult;
    if (req.method === 'hidWrite') return { ok: true, written: 64 };
    return { ok: true };
  };
  device.addEventListener('inputreport', (ev) => seen.push(ev));
  const sent = device.sendReport(75, new Uint8Array([0x80, 0x0c]));
  await tick();
  drain(sandbox, answer); // 读泵可能先于写落地：两拍都按方法分流应答
  await sent;
  for (let i = 0; i < 8 && seen.length === 0; i++) {
    await tick(15);
    drain(sandbox, answer);
  }
  return { seen, drained };
}

test('P43 投递链：桥数据 → inputreport（DataView / reportId 单列 / 载荷不含 report id）', async (t) => {
  const sandbox = boot();
  const { device } = await connect(sandbox);
  t.after(() => device.__dshKitStopPoll()); // 失败也必须停泵，否则沙箱轮询把测试进程吊住
  const { seen, drained } = await sendAndAnswerOneRead(sandbox, device, { ok: true, data: REPORT });

  assert.ok(drained.filter((m) => m === 'hidRead').length >= 1, '读泵应发起 hidRead');
  assert.ok(drained.filter((m) => m === 'hidRead').length <= 2, `单飞：未决读不应堆积（实测 ${drained.length} 次队列取用）`);
  assert.equal(seen.length, 1, '监听器应收到恰好一次 inputreport');
  const ev = seen[0];
  assert.equal(Object.prototype.toString.call(ev.data), '[object DataView]', 'ev.data 必须是 Chrome 语义的 DataView');
  assert.equal(typeof ev.data.getUint8, 'function', 'DataView 方法面可用（站点可能用 getUint8/byteLength）');
  assert.equal(ev.reportId, 0x4b, 'reportId 单列（75）');
  assert.deepEqual(Array.from(new Uint8Array(ev.data.buffer)), REPORT.slice(1), '载荷不含 report id 首字节');
  assert.equal(ev.device, device, 'ev.device 指向该设备实例');
});

test('P43 防御：client 若回归成返回外层信封，shim 仍能剥开并投递', async (t) => {
  const sandbox = boot();
  const { device } = await connect(sandbox);
  t.after(() => device.__dshKitStopPoll());
  const { seen } = await sendAndAnswerOneRead(sandbox, device, { ok: true, value: { ok: true, data: REPORT } });
  assert.equal(seen.length, 1, '外层信封泄漏时也必须投递（bridgeResult 防御）');
  assert.deepEqual(Array.from(new Uint8Array(seen[0].data.buffer)), REPORT.slice(1));
});

test('P43 单飞：读泵不堆积——连续多轮读，未决请求数始终 ≤ 1', async (t) => {
  const sandbox = boot();
  const { device } = await connect(sandbox);
  t.after(() => device.__dshKitStopPoll());
  device.addEventListener('inputreport', () => {});
  let maxInflight = 0;
  for (let i = 0; i < 5; i++) {
    await tick(20);
    const q = sandbox.window.__dshKitHidQueue || [];
    const reads = q.filter((r) => r.method === 'hidRead');
    maxInflight = Math.max(maxInflight, reads.length);
    drain(sandbox, () => ({ ok: false, error: 'timeout' }));
  }
  assert.ok(maxInflight <= 1, `未决读请求应 ≤1，实测 ${maxInflight}（旧实现 250ms 定时空转 = 堆积）`);
});
