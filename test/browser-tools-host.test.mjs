/**
 * R-TOOL 回归：agent 工具层（`plugin/browser-tools.host.mjs`）
 *
 * 这些钉子防的是**静默失败**家族：
 *  - 规格表 `action` 与 client `commandHandlers` 键漂移 ⇒ 工具调用永远 timeout（P29 同族）；
 *  - 命令通道传输（写/读/串行/超时）错 ⇒ 工具返回假结果；
 *  - defineTool 解析策略回归 ⇒ 工具静默不注册（zcode-dispatch ZB-01 现场）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MOD = new URL('../plugin/browser-tools.host.mjs', import.meta.url).href;
const {
  writeCommandImpl,
  readCommandResultImpl,
  runBrowserCommand,
  dshToolsCandidates,
  loadDefineTool,
  registerBrowserTools,
  BROWSER_TOOL_SPECS,
} = await import(MOD);

const CLIENT_SRC = readFileSync(new URL('../plugin/client.js', import.meta.url), 'utf8');
const CLIENT_ACTIONS = new Set([...CLIENT_SRC.matchAll(/'([a-z-]+)': async function \(svc, c\) \{/g)].map((m) => m[1]));

const tmpPlugin = () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbk-tools-'));
  mkdirSync(join(dir, '.data'), { recursive: true });
  return dir;
};

test('R-TOOL 规格表与 client 命令表**逐字对齐**（防漂移 = 工具静默失败）', async (t) => {
  await t.test('每个 spec.action 都存在于 client commandHandlers', () => {
    const missing = BROWSER_TOOL_SPECS.filter((s) => !CLIENT_ACTIONS.has(s.action)).map((s) => `${s.name}→${s.action}`);
    assert.deepEqual(missing, [], `工具规格里的 action 在 client 里不存在：${missing.join(', ')}`);
  });
  await t.test('工具名唯一、统一 browser_ 前缀、超时为正数', () => {
    const names = BROWSER_TOOL_SPECS.map((s) => s.name);
    assert.equal(new Set(names).size, names.length, '工具名重复');
    assert.ok(names.every((n) => n.startsWith('browser_')), '工具名必须以 browser_ 开头');
    assert.ok(BROWSER_TOOL_SPECS.every((s) => s.timeoutMs > 0), 'timeoutMs 必须为正');
    assert.ok(BROWSER_TOOL_SPECS.length >= 11, `工具数应 ≥11（当前 ${BROWSER_TOOL_SPECS.length}）`);
  });
  await t.test('参数名不得占用命令信封键（action/id）——P47-D 参数撞信封', () => {
    for (const s of BROWSER_TOOL_SPECS) {
      const keys = Object.keys(s.parameters || {});
      assert.ok(!keys.includes('action'), `${s.name} 用了保留名 action`);
      assert.ok(!keys.includes('id'), `${s.name} 用了保留名 id`);
    }
  });
  await t.test('dynamicSource（页内观察器）文件真实存在且导出 __dshKitConsole 契约', () => {
    const specs = BROWSER_TOOL_SPECS.filter((s) => s.dynamicSource);
    assert.ok(specs.length >= 1, '至少 browser_console 需要 dynamicSource');
    for (const s of specs) {
      const p = new URL(`../${s.dynamicSource}`, import.meta.url);
      const src = readFileSync(p, 'utf8');
      assert.ok(src.includes('window.__dshKitConsole'), `${s.dynamicSource} 未定义 __dshKitConsole`);
      for (const api of ['dump', 'clear', 'stats', 'mark', 'uninstall']) {
        assert.ok(src.includes(`${api}:`) || src.includes(`${api} =`), `${s.dynamicSource} 缺 API ${api}`);
      }
    }
  });
});

test('R-TOOL 命令通道传输层', async (t) => {
  await t.test('writeCommandImpl 原子写：JSON 可解析且含 id/action', () => {
    const dir = tmpPlugin();
    const r = writeCommandImpl(dir, { id: 'x1', action: 'browser-tabs' });
    assert.equal(r.ok, true);
    const raw = JSON.parse(readFileSync(join(dir, '.data', 'command.json'), 'utf8'));
    assert.equal(raw.id, 'x1');
    assert.equal(raw.action, 'browser-tabs');
    rmSync(dir, { recursive: true, force: true });
  });
  await t.test('readCommandResultImpl：尾部扫、跳过坏行、忽略别的 id、缺失返回 null', () => {
    const dir = tmpPlugin();
    const f = join(dir, '.data', 'command-results.jsonl');
    appendFileSync(f, '{"id":"other","result":{"ok":true,"mark":"other"}}\n');
    appendFileSync(f, '这不是 JSON\n');
    appendFileSync(f, '{"id":"t1","result":{"ok":true,"mark":"mine"}}\n');
    assert.deepEqual(readCommandResultImpl(dir, 't1'), { ok: true, mark: 'mine' });
    assert.equal(readCommandResultImpl(dir, 'nope'), null);
    rmSync(dir, { recursive: true, force: true });
  });
  await t.test('runBrowserCommand：回执到达即返回（模拟 client 消费）', async () => {
    const dir = tmpPlugin();
    const f = join(dir, '.data', 'command-results.jsonl');
    // 模拟 client：取走 command.json 并回执
    const timer = setInterval(() => {
      const cmdFile = join(dir, '.data', 'command.json');
      if (!existsSync(cmdFile)) return;
      try {
        const cmd = JSON.parse(readFileSync(cmdFile, 'utf8'));
        rmSync(cmdFile, { force: true });
        appendFileSync(f, `${JSON.stringify({ at: new Date().toISOString(), id: cmd.id, result: { ok: true, echo: cmd.action, sel: cmd.selector || null } })}\n`);
      } catch { /* 竞争：下轮再试 */ }
    }, 60);
    const r = await runBrowserCommand(dir, 'click', { selector: '#go' }, 8000);
    clearInterval(timer);
    assert.deepEqual(r, { ok: true, echo: 'click', sel: '#go' });
    rmSync(dir, { recursive: true, force: true });
  });
  await t.test('runBrowserCommand：无人消费 → 结构化超时错误（不抛）', async () => {
    const dir = tmpPlugin();
    const r = await runBrowserCommand(dir, 'browser-tabs', {}, 700);
    assert.equal(r.ok, false);
    assert.match(r.error, /超时/);
    rmSync(dir, { recursive: true, force: true });
  });
  await t.test('串行队列：并发两条命令不会互相覆盖 command.json', async () => {
    const dir = tmpPlugin();
    const f = join(dir, '.data', 'command-results.jsonl');
    const seen = [];
    const timer = setInterval(() => {
      const cmdFile = join(dir, '.data', 'command.json');
      if (!existsSync(cmdFile)) return;
      try {
        const cmd = JSON.parse(readFileSync(cmdFile, 'utf8'));
        seen.push(cmd.action);
        rmSync(cmdFile, { force: true });
        appendFileSync(f, `${JSON.stringify({ id: cmd.id, result: { ok: true, action: cmd.action } })}\n`);
      } catch { /* 竞争 */ }
    }, 50);
    const [a, b] = await Promise.all([
      runBrowserCommand(dir, 'browser-open', { url: 'https://a.test' }, 9000),
      runBrowserCommand(dir, 'browser-tabs', {}, 9000),
    ]);
    clearInterval(timer);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.deepEqual(seen, ['browser-open', 'browser-tabs'], '两条命令必须一前一后被消费（单槽位通道）');
    rmSync(dir, { recursive: true, force: true });
  });
});

test('R-TOOL defineTool 解析策略', async (t) => {
  await t.test('候选表含 resourcesPath 推导与硬编码兜底', () => {
    const list = dshToolsCandidates();
    assert.ok(list.length >= 2);
    assert.ok(list.some((c) => c.path.includes('dsh-tools')), '候选必须指向 dsh-tools');
  });
  await t.test('本机可从 app.asar 解析到真 defineTool（仅在 DSH/Electron 运行时内可验）', async (t2) => {
    // plain Node **读不了 app.asar**（asar fs 补丁只存在于 DSH 的 Electron/Node 运行时里），
    // 故此处只在运行时具备条件时断言；实机证据 = 激活后 11 个 browser_* 工具可用（本轮已实测）。
    if (!process.resourcesPath || !existsSync('D:/DeepSeek/resources/app.asar')) {
      t2.skip('非 DSH 运行时：app.asar 不可读，跳过（实机已由激活日志/工具调用证明）');
      return;
    }
    const res = await loadDefineTool();
    assert.equal(typeof res.defineTool, 'function', `defineTool 未解析（source=${res.source}）`);
    assert.ok(res.source, '必须记录来源');
  });
});

test('R-TOOL 注册：stub ctx（含未 inject 抛错场景）', async (t) => {
  /** 桩 defineTool：透传 options；并用它验证 execute → 命令通道 的完整链路。 */
  const stubDefineTool = (options) => ({ ...options, execute: options.execute });

  await t.test('正常 ctx：全部工具注册，返回 diag', async () => {
    const registered = [];
    let effectCalls = 0;
    const ctx = { tools: { register: (def) => { registered.push(def); return () => {}; } }, effect: () => { effectCalls += 1; } };
    const diag = await registerBrowserTools(ctx, tmpPlugin(), () => {}, { defineTool: stubDefineTool });
    assert.equal(diag.registered.length, BROWSER_TOOL_SPECS.length);
    assert.equal(registered.length, BROWSER_TOOL_SPECS.length);
    assert.equal(diag.ctxToolsAvailable, true);
    assert.equal(diag.errors.length, 0);
    assert.ok(effectCalls >= 1, '必须登记卸载清理');
  });
  await t.test('execute 链路：工具调用 → 命令通道 → client 回执 → 带 tool/action 的结果', async () => {
    const dir = tmpPlugin();
    const registered = [];
    const ctx = { tools: { register: (def) => { registered.push(def); return () => {}; } }, effect: () => {} };
    await registerBrowserTools(ctx, dir, () => {}, { defineTool: stubDefineTool });
    const tabsTool = registered.find((d) => d.name === 'browser_tabs');
    assert.ok(tabsTool, '必须有 browser_tabs');
    // 模拟 client：消费命令并回执
    const f = join(dir, '.data', 'command-results.jsonl');
    const timer = setInterval(() => {
      const cmdFile = join(dir, '.data', 'command.json');
      if (!existsSync(cmdFile)) return;
      try {
        const cmd = JSON.parse(readFileSync(cmdFile, 'utf8'));
        rmSync(cmdFile, { force: true });
        appendFileSync(f, `${JSON.stringify({ id: cmd.id, result: { ok: true, count: 3, clientSawAction: cmd.action } })}\n`);
      } catch { /* 竞争 */ }
    }, 60);
    const out = await tabsTool.execute({});
    clearInterval(timer);
    assert.equal(out.tool, 'browser_tabs', '结果必须回显工具名（排障用，工具名 ≠ action）');
    assert.equal(out.action, 'browser-tabs');
    assert.equal(out.count, 3);
    assert.equal(out.clientSawAction, 'browser-tabs');
    rmSync(dir, { recursive: true, force: true });
  });
  await t.test('未 inject 的 ctx（读 .tools 抛错）→ 返回 diag 而非抛', async () => {
    const ctx = {};
    Object.defineProperty(ctx, 'tools', { get() { throw new Error('cannot get property "tools" without inject'); } });
    ctx.effect = () => {};
    const diag = await registerBrowserTools(ctx, tmpPlugin(), () => {}, { defineTool: stubDefineTool });
    assert.equal(diag.ctxToolsAvailable, false);
    assert.ok(diag.errors.length >= 1);
  });
});
