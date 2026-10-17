/**
 * test/console-observer.test.mjs — console-observer 沙箱单测（node:test + node:vm，无浏览器）
 *
 * 手法对齐 test/hid-observer.test.js：vm.createContext 造最小 window/console/fetch/XHR 桩，
 * runInContext 注入 src/console-observer.js 源码，再从主 realm 断言。
 *
 * 跨 realm 注意：沙箱里造的数组/对象原型与主 realm 不同，deepEqual 会判不等，
 * 所以断言前统一用 plain()（JSON 往返）转成主 realm 纯值。
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(fileURLToPath(new URL('../src/console-observer.js', import.meta.url)), 'utf8');

const quiet = () => {};

/** 跨 realm → 主 realm 纯值（消除 prototype 差异）。 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** 让 microtask 队列排空（fetch 包装器是异步记账）。 */
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * 造一个最小浏览器沙箱：
 *   - console 桩：每个方法计数 + 记录调用参数（用于验证「仍调用原函数」）
 *   - fetch 桩：可配置 resolve / reject
 *   - XMLHttpRequest 桩：最小可用，自派发 loadend
 *   - addEventListener/removeEventListener 桩：把 handler 记下来供手动触发
 */
function makeSandbox({ fetchImpl } = {}) {
  const calls = { log: [], info: [], warn: [], error: [], debug: [] };
  const consoleStub = {
    log: (...a) => calls.log.push(a),
    info: (...a) => calls.info.push(a),
    warn: (...a) => calls.warn.push(a),
    error: (...a) => calls.error.push(a),
    debug: (...a) => calls.debug.push(a),
  };

  const fetchCalls = [];
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.console = consoleStub;
  sandbox.setTimeout = (fn, ms) => setTimeout(fn, ms);
  sandbox.clearTimeout = (id) => clearTimeout(id);

  // 事件监听桩：沙箱里没有真 EventTarget，手动记录 handler 以触发契约分支
  const winListeners = new Map();
  sandbox.addEventListener = (type, fn) => {
    if (!winListeners.has(type)) winListeners.set(type, []);
    winListeners.get(type).push(fn);
  };
  sandbox.removeEventListener = (type, fn) => {
    const list = winListeners.get(type) || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };

  // fetch 桩
  sandbox.fetch = function (input, init) {
    fetchCalls.push({ input, init, thisArg: this });
    if (fetchImpl) return fetchImpl(input, init);
    return Promise.resolve({ ok: true, status: 200 });
  };

  // XHR 桩：open/send 在 prototype 上（观察器 patch 的就是它）
  function FakeXHR() {
    this._listeners = {};
    this.readyState = 0;
    this.status = 0;
  }
  FakeXHR.prototype.open = function (method, url) {
    this._method = method;
    this._url = url;
    this.readyState = 1;
  };
  FakeXHR.prototype.send = function () {
    this._sent = true;
    this.readyState = 4;
  };
  FakeXHR.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  FakeXHR.prototype._emit = function (type) {
    (this._listeners[type] || []).slice().forEach((fn) => fn.call(this, { type }));
  };
  sandbox.XMLHttpRequest = FakeXHR;

  vm.createContext(sandbox);
  return {
    sandbox,
    calls,
    fetchCalls,
    winListeners,
    FakeXHR,
    natives: { consoleLog: consoleStub.log, fetch: sandbox.fetch }, // 注入前的原函数引用
    fire(type, event) {
      (winListeners.get(type) || []).slice().forEach((fn) => fn.call(sandbox, event || {}));
    },
  };
}

function inject(sandbox) {
  return vm.runInContext(SOURCE, sandbox, { filename: 'console-observer.js' });
}

let current = null;
afterEach(() => {
  if (current && current.sandbox.window.__dshKitConsole) {
    try {
      current.sandbox.window.__dshKitConsole.uninstall();
    } catch (_) {
      /* 尽力清理 */
    }
  }
  current = null;
});

function setup(opts) {
  const env = makeSandbox(opts);
  inject(env.sandbox);
  current = env;
  return env;
}

const kit = (env) => env.sandbox.window.__dshKitConsole;

// ------------------------------------------------------------------ 1. install 生效

test('注入后 install 生效：console.log 仍调用原函数且产生条目', () => {
  const env = setup();
  const k = kit(env);
  assert.equal(k.version, '1.0.0');
  assert.equal(typeof k.entries, 'function');

  env.sandbox.console.log('hello', 42);

  // 原始行为保留：桩计数 +1，参数原样到达
  assert.equal(env.calls.log.length, 1);
  assert.deepEqual(plain(env.calls.log[0]), ['hello', 42]);

  // 同时产生条目
  const list = plain(k.dump());
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'console');
  assert.equal(list[0].level, 'log');
  assert.equal(list[0].text, "'hello' 42");
  assert.equal(list[0].args.length, 2);
  assert.equal(list[0].seq, 1);
  assert.equal(typeof list[0].t, 'number');
});

// ------------------------------------------------------------------ 2. dump 契约

test('dump：level / limit / since / filter（子串与正则）/ net 过滤', () => {
  const env = setup();
  const k = kit(env);
  const c = env.sandbox.console;

  c.log('l1');
  c.info('i1');
  c.warn('w1');
  c.error('e1');
  c.error('e2');
  c.debug('d1');
  const errors = plain(k.dump({ level: 'error' }));
  assert.equal(errors.length, 2);
  assert.deepEqual(
    errors.map((e) => e.level),
    ['error', 'error']
  );

  assert.equal(plain(k.dump({ level: 'warn' })).length, 1);
  assert.equal(plain(k.dump({ level: 'info' })).length, 1);
  assert.equal(plain(k.dump({ level: 'debug' })).length, 1);
  assert.equal(plain(k.dump({ level: 'all' })).length, 6);
  assert.equal(plain(k.dump()).length, 6);

  // limit：只回末尾 N 条
  const last2 = plain(k.dump({ limit: 2 }));
  assert.deepEqual(
    last2.map((e) => e.text),
    ["'e2'", "'d1'"]
  );
  assert.equal(plain(k.dump({ limit: 0 })).length, 0);
  // limit 硬上限 500
  assert.ok(plain(k.dump({ limit: 9999 })).length <= 500);

  // since：只回新条目
  const anchor = k.mark('after-e1');
  c.error('e3');
  const since = plain(k.dump({ since: anchor.t }));
  assert.ok(since.length >= 2);
  assert.ok(since.every((e) => e.t >= anchor.t));
  assert.ok(since.some((e) => e.text === "'e3'"));

  // filter：子串
  const sub = plain(k.dump({ filter: 'e2' }));
  assert.equal(sub.length, 1);
  assert.equal(sub[0].text, "'e2'");
  // filter：正则（text 里字符串参数带引号，故锚点要连引号一起写）
  const re = plain(k.dump({ filter: { re: "^'e[0-9]+'$" } }));
  assert.ok(re.length >= 3);
  assert.ok(re.every((e) => /^'e[0-9]+'$/.test(e.text)));
  assert.equal(plain(k.dump({ filter: { re: "^'e[0-9]+'$" } })).length, re.length);
  // 非法正则忽略（不丢光条目）
  assert.equal(plain(k.dump({ filter: { re: '[' } })).length, plain(k.dump()).length);
});

test('dump({net:true}) 只回 fetch/xhr 条目', async () => {
  const env = setup();
  const k = kit(env);
  env.sandbox.console.log('pure-log');

  await env.sandbox.fetch('https://example.test/a');
  await flushMicrotasks();

  const xhr = new env.sandbox.XMLHttpRequest();
  xhr.open('POST', 'https://example.test/b');
  xhr.send();
  xhr.status = 204;
  xhr._emit('loadend');

  const net = plain(k.dump({ net: true }));
  assert.equal(net.length, 2);
  assert.deepEqual(
    net.map((e) => e.kind),
    ['fetch', 'xhr']
  );
  // net:true 与 level 可叠加
  assert.equal(plain(k.dump({ net: true, level: 'log' })).length, 2);
  assert.equal(plain(k.dump({ net: true, level: 'error' })).length, 0);
});

// ------------------------------------------------------------------ 3. 防御性序列化

test('循环引用 / BigInt / 抛错 getter / Symbol 的参数不抛异常且条目仍生成', () => {
  const env = setup();
  const k = kit(env);

  const circular = { name: 'a' };
  circular.self = circular;
  const throwing = {
    get boom() {
      throw new Error('getter exploded');
    },
  };

  assert.doesNotThrow(() => {
    env.sandbox.console.log(circular, 10n, throwing, Symbol('s'), undefined);
  });

  const list = plain(k.dump());
  assert.equal(list.length, 1);
  const entry = list[0];
  assert.equal(entry.kind, 'console');
  assert.equal(entry.args.length, 5);
  assert.match(entry.args[0], /\[Circular\]/);
  assert.match(entry.args[0], /name: 'a'/);
  assert.equal(entry.args[1], '10n'); // BigInt → 字符串（JSON.stringify 会抛）
  assert.match(entry.args[2], /boom: \[threw\]/); // getter 抛错被兜住
  assert.match(entry.args[3], /Symbol\(s\)/);
  assert.equal(entry.args[4], 'undefined');
  assert.ok(typeof entry.text === 'string' && entry.text.length > 0);

  // Error 对象带 name/message/stack，且 stack 截断
  const boom = new Error('kaboom');
  env.sandbox.console.error(boom);
  const errEntry = plain(k.dump({ level: 'error' }))[0];
  assert.match(errEntry.args[0], /Error: kaboom/);
  assert.match(errEntry.args[0], /at /);
  assert.ok(errEntry.args[0].length <= 300);
});

test('text/args 截断：超长文本 ≤500、单参 ≤300、参数最多 5 项', () => {
  const env = setup();
  const k = kit(env);
  env.sandbox.console.log('x'.repeat(1200), 1, 2, 3, 4, 5, 6, 7);
  const entry = plain(k.dump())[0];
  assert.ok(entry.text.length <= 500);
  assert.equal(entry.args.length, 6); // 5 项 + '+3 more'
  assert.equal(entry.args[5], '+3 more');
  assert.ok(entry.args[0].length <= 300);
});

test('dump({filter:{re:RegExp}}) 跨 realm 正则对象也能识别', () => {
  const env = setup();
  const k = kit(env);
  env.sandbox.console.error('boom');
  env.sandbox.console.log('quiet');
  // 主 realm 造的正则对象，传给沙箱里的 dump
  const hit = plain(k.dump({ filter: { re: /boom/ } }));
  assert.equal(hit.length, 1);
  assert.match(hit[0].text, /boom/);
});

// ------------------------------------------------------------------ 4. 未捕获错误

test('uncaught 与 unhandledrejection 被抓到', () => {
  const env = setup();
  const k = kit(env);

  env.fire('error', {
    message: 'Uncaught TypeError: x is not a function',
    filename: 'https://example.test/app.js',
    lineno: 42,
    colno: 7,
    error: new Error('x is not a function'),
  });

  const entries = plain(k.dump());
  const uncaught = entries.filter((e) => e.kind === 'uncaught');
  assert.equal(uncaught.length, 1);
  assert.equal(uncaught[0].level, 'error');
  assert.match(uncaught[0].text, /x is not a function/);
  assert.equal(uncaught[0].source, 'https://example.test/app.js');
  assert.equal(uncaught[0].line, 42);
  assert.equal(uncaught[0].col, 7);
  // level:'error' 命中 uncaught
  assert.ok(plain(k.dump({ level: 'error' })).some((e) => e.kind === 'uncaught'));

  env.fire('unhandledrejection', { reason: new Error('promise blew up') });
  const rej = plain(k.dump()).filter((e) => e.kind === 'unhandledrejection');
  assert.equal(rej.length, 1);
  assert.equal(rej[0].level, 'error');
  assert.match(rej[0].text, /promise blew up/);
});

// ------------------------------------------------------------------ 5. fetch / xhr

test('fetch 成功与失败各产生一条 kind:fetch 条目，durationMs 为数字', async () => {
  let mode = 'ok';
  const env = setup({
    fetchImpl: () => {
      if (mode === 'ok') return Promise.resolve({ ok: true, status: 200 });
      if (mode === 'bad') return Promise.resolve({ ok: false, status: 503 });
      return Promise.reject(new Error('network down'));
    },
  });
  const k = kit(env);

  // 成功：原行为保留（resolve 出原响应对象）+ 记一条
  const res = await env.sandbox.fetch('https://api.test/ok', { method: 'post' });
  assert.equal(res.status, 200);
  await flushMicrotasks();
  let list = plain(k.dump({ net: true }));
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'fetch');
  assert.equal(list[0].method, 'POST');
  assert.equal(list[0].url, 'https://api.test/ok');
  assert.equal(list[0].status, 200);
  assert.equal(typeof list[0].durationMs, 'number');
  assert.equal(list[0].level, 'log');

  // HTTP 失败（ok:false / status>=400）
  mode = 'bad';
  await env.sandbox.fetch('https://api.test/bad');
  await flushMicrotasks();
  list = plain(k.dump({ net: true }));
  assert.equal(list.length, 2);
  assert.equal(list[1].status, 503);
  assert.equal(list[1].level, 'error');
  assert.equal(typeof list[1].durationMs, 'number');

  // 网络 reject：条目记 error，且 rejection 原样透传
  mode = 'reject';
  await assert.rejects(() => env.sandbox.fetch('https://api.test/down'), /network down/);
  await flushMicrotasks();
  list = plain(k.dump({ net: true }));
  assert.equal(list.length, 3);
  assert.equal(list[2].kind, 'fetch');
  assert.equal(list[2].level, 'error');
  assert.equal(list[2].status, undefined);
  assert.match(list[2].text, /network down/);
  assert.equal(typeof list[2].durationMs, 'number');

  // 不读 body：桩返回的响应对象上没有任何 body 被访问过
  assert.equal(env.fetchCalls.length, 3);
});

test('XMLHttpRequest 被 hook：记录 method/url/status/durationMs 且不改行为', () => {
  const env = setup();
  const k = kit(env);
  const xhr = new env.sandbox.XMLHttpRequest();
  xhr.open('get', 'https://api.test/xhr');
  xhr.send();
  assert.equal(xhr._method, 'get'); // 原 open 行为保留
  assert.equal(xhr._sent, true); // 原 send 行为保留

  xhr.status = 200;
  xhr._emit('loadend');

  const list = plain(k.dump({ net: true }));
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'xhr');
  assert.equal(list[0].method, 'GET');
  assert.equal(list[0].url, 'https://api.test/xhr');
  assert.equal(list[0].status, 200);
  assert.equal(typeof list[0].durationMs, 'number');

  // 4xx 记 error
  const xhr2 = new env.sandbox.XMLHttpRequest();
  xhr2.open('POST', 'https://api.test/missing');
  xhr2.send();
  xhr2.status = 404;
  xhr2._emit('loadend');
  const net = plain(k.dump({ net: true, level: 'error' }));
  assert.equal(net.length, 1);
  assert.equal(net[0].status, 404);
});

// ------------------------------------------------------------------ 6. clear / stats / mark

test('clear() 返回清空条数、stats() 计数正确、mark() 产生锚点', () => {
  const env = setup();
  const k = kit(env);

  assert.deepEqual(plain(k.stats()).total, 0);
  assert.deepEqual(plain(k.stats()).dropped, 0);
  assert.equal(typeof k.stats().installedAt, 'number');

  env.sandbox.console.log('a');
  env.sandbox.console.warn('b');
  env.sandbox.console.error('c');

  const anchor = k.mark('step-1');
  assert.equal(typeof anchor.t, 'number');
  const st = plain(k.stats());
  assert.equal(st.total, 4);
  assert.equal(st.dropped, 0);
  assert.equal(st.byKind.console, 3);
  assert.equal(st.byKind.mark, 1);
  assert.equal(typeof st.installedAt, 'number');

  const marks = plain(k.dump()).filter((e) => e.kind === 'mark');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].text, 'step-1');
  assert.equal(marks[0].t, anchor.t);

  assert.equal(k.clear(), 4);
  assert.equal(plain(k.dump()).length, 0);
  assert.equal(plain(k.stats()).total, 0);
  assert.equal(plain(k.stats()).dropped, 0);
  assert.equal(k.clear(), 0);
});

// ------------------------------------------------------------------ 7. 环形缓冲

test('环形缓冲上限：塞入 520 条后长度 = 500 且 dropped = 20', () => {
  const env = setup();
  const k = kit(env);
  for (let i = 0; i < 520; i++) {
    env.sandbox.console.log('m' + i);
  }
  const st = plain(k.stats());
  assert.equal(st.total, 500);
  assert.equal(st.dropped, 20);
  assert.equal(st.byKind.console, 520); // 累计计数保留（只丢缓冲，不丢统计）

  const list = plain(k.dump({ limit: 500 })); // dump 缺省只回末尾 200 条，这里要全量
  assert.equal(list.length, 500);
  assert.equal(list[0].text, "'m20'"); // 最旧的 20 条被丢
  assert.equal(list[499].text, "'m519'");
  // seq 单调递增、不因丢弃重置
  assert.equal(list[0].seq, 21);
  assert.equal(list[499].seq, 520);
  // limit 硬上限
  assert.equal(list.length, plain(k.dump({ limit: 5000 })).length);
});

// ------------------------------------------------------------------ 8. 幂等

test('幂等：连续注入两次，第二次返回 exists 且 hook 不叠加', () => {
  const env = makeSandbox();
  const first = vm.runInContext(SOURCE, env.sandbox, { filename: 'console-observer.js' });
  assert.equal(first, 'installed');
  const api1 = env.sandbox.window.__dshKitConsole;
  const wrapped = env.sandbox.console.log;

  const second = vm.runInContext(SOURCE, env.sandbox, { filename: 'console-observer.js' });
  assert.equal(second, 'exists');
  assert.equal(env.sandbox.window.__dshKitConsole, api1); // 仍是同一实例，未被覆盖
  assert.equal(env.sandbox.console.log, wrapped); // hook 未叠加

  current = env; // 交给 afterEach 清理
  env.sandbox.console.log('once');
  assert.equal(env.calls.log.length, 1);
  assert.equal(plain(api1.dump()).length, 1); // 一次调用只产生 1 条，不是 2 条
});

// ------------------------------------------------------------------ 9. uninstall

test('uninstall()：console.log 不再产生条目，且原始函数仍是桩自身', () => {
  const env = setup();
  const k = kit(env);
  const original = env.sandbox.console.log; // 注入后是包装器

  env.sandbox.console.log('before');
  const before = plain(k.dump()).length;
  assert.equal(before, 1);

  assert.deepEqual(plain(k.uninstall()), { ok: true });

  env.sandbox.console.log('after');
  assert.equal(env.calls.log.length, 2); // 原行为仍在
  assert.equal(plain(k.dump()).length, before); // 不再新增条目
  assert.equal(env.sandbox.console.log, env.natives.consoleLog); // 还原成桩自身
  assert.notEqual(env.sandbox.console.log, original); // 包装器已被换掉
  assert.equal(env.winListeners.get('error').length, 0); // 监听器已摘
  assert.equal(env.winListeners.get('unhandledrejection').length, 0);
  assert.equal(typeof k.dump, 'function'); // 卸载后仍可 dump 历史条目
  assert.equal(plain(k.dump())[0].text, "'before'");
});

test('uninstall() 还原 fetch 与 XHR 原型方法（仍是桩自身）', () => {
  const env = makeSandbox();
  const nativeFetch = env.sandbox.fetch; // 注入前的桩引用
  inject(env.sandbox);
  current = env;
  const k = kit(env);
  // 注入后 fetch 已被包装
  assert.notEqual(env.sandbox.fetch, nativeFetch);

  k.uninstall();
  assert.equal(env.sandbox.fetch, nativeFetch); // 已还原成桩自身

  env.sandbox.fetch('https://api.test/after-uninstall');
  assert.equal(env.fetchCalls.length, 1); // 桩仍被调用（原函数已还原）
  assert.equal(plain(k.dump({ net: true })).length, 0); // 不再记账

  const xhr = new env.sandbox.XMLHttpRequest();
  xhr.open('GET', 'https://api.test/xhr-after');
  xhr.send();
  xhr.status = 200;
  xhr._emit('loadend');
  assert.equal(plain(k.dump({ net: true })).length, 0);
});
