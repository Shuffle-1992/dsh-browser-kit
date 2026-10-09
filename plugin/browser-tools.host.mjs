/**
 * @local/dsh-browser-kit —— R-TOOL：把「内置浏览器命令通道」包装成 **agent 一等工具**。
 *
 * 链路：agent 工具调用 → `ctx.tools.register(defineTool({execute}))` → 写 `.data/command.json`
 *       → client 半边（2.5s tick 取走即删）执行 → 追加 `.data/command-results.jsonl` 回执
 *       → 工具轮询到自己的 id 后返回结果。
 *
 * 三条硬纪律（都有实测依据）：
 *  ①**激活安全第一**：任何解析/注册失败只 warn 不抛（defineTool 解析不到、ctx.tools 不可用、
 *    注册抛错都不得影响插件其余能力——同 zcode-dispatch Z10-1）。
 *  ②**defineTool 必须走「裸 import + 绝对路径回退」双策略**：本插件目录在 DSH 安装目录外，
 *    profile 的 node_modules 没有 @deepseek-ai 作用域，裸 `import('@deepseek-ai/dsh-tools')`
 *    必然 ERR_MODULE_NOT_FOUND → 工具静默不注册（zcode-dispatch ZB-01 现场）。回退候选里
 *    `resourcesPath/app.asar/...` 那条实测可行（asar 的 fs 补丁对 import() 生效）。
 *  ③**output 不可省略**：`defineTool` 无条件读 `options.output.render` / `.schema`（:842/:849），
 *    省略即 TypeError。最小合法形态 `{ schema: { type: 'json' }, render }`。
 *
 * 缓存纪律：本模块由 host.impl.mjs 以 `?ts=<mtime-seq>` 动态 import（静态 import 会命中进程级
 * 模块缓存，改了不生效——P13 家族）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errOf = (e) => (e && e.code ? `${e.code}: ${e.message}` : String((e && e.message) || e));

/* ─────────────── 命令通道传输层 ─────────────── */

/** 原子写命令文件（临时文件 + rename）：client 只会读到完整 JSON，不会读到半截。 */
export function writeCommandImpl(pluginDir, payload) {
  const dir = join(pluginDir, '.data');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'command.json');
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  renameSync(tmp, file);
  return { ok: true, file, id: payload && payload.id };
}

/** 在结果文件里找 id 的回执行（只扫尾部 maxLines 行：文件长驻会一直追加）。 */
export function readCommandResultImpl(pluginDir, id, maxLines = 400) {
  let text = '';
  try {
    text = readFileSync(join(pluginDir, '.data', 'command-results.jsonl'), 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  const from = Math.max(0, lines.length - maxLines);
  for (let i = lines.length - 1; i >= from; i -= 1) {
    const line = lines[i];
    if (!line || line.indexOf(id) < 0) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && obj.id === id) return obj.result === undefined ? null : obj.result;
    } catch { /* 坏行跳过 */ }
  }
  return null;
}

/** 等旧命令被 client 取走（take = 删文件）；避免覆盖尚未消费的命令。 */
async function waitChannelFree(pluginDir, maxMs = 3000) {
  const file = join(pluginDir, '.data', 'command.json');
  const t0 = Date.now();
  while (existsSync(file) && Date.now() - t0 < maxMs) await sleep(150);
}

/** 模块级串行队列：同一时刻只允许一条命令在飞（命令通道是单槽位）。 */
let commandQueue = Promise.resolve();
let commandSeq = 0;

/**
 * 执行一条 client 命令并等回执。**串行**（单槽位通道），超时返回结构化错误（不抛）。
 * @param {string} pluginDir 插件目录（command.json 所在）
 * @param {string} action 客户端 action 名（如 'browser-open'）
 * @param {object} params 业务参数（**不能叫 action/id**：信封已占用，见 P47-D）
 * @param {number} timeoutMs 等回执上限
 */
export async function runBrowserCommand(pluginDir, action, params = {}, timeoutMs = 25000) {
  const run = async () => {
    await waitChannelFree(pluginDir);
    commandSeq += 1;
    const id = `tool-${Date.now().toString(36)}-${commandSeq.toString(36)}`;
    try {
      writeCommandImpl(pluginDir, { id, action, ...params });
    } catch (e) {
      return { ok: false, error: `写命令失败：${errOf(e)}` };
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = readCommandResultImpl(pluginDir, id);
      if (r !== null) return r;
      await sleep(250);
    }
    return { ok: false, error: `命令 ${action} 超时（${timeoutMs}ms 内 client 未回执；面板可能未打开或 client 未加载）` };
  };
  const next = commandQueue.then(run, run);
  commandQueue = next.then(() => undefined, () => undefined);
  return next;
}

/* ─────────────── 官方 defineTool 解析（双策略） ─────────────── */

const DSH_TOOLS_REL = ['dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'];
export const DEFINE_TOOL_PROBE = [];

/** 绝对路径候选（顺序即优先级；ds-tools 随 DSH 出货，位于 app.asar 内）。 */
export function dshToolsCandidates() {
  const out = [];
  const env = process.env.DBK_DSH_TOOLS;
  if (typeof env === 'string' && env) out.push({ source: 'env:DBK_DSH_TOOLS', path: env });
  const res = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  if (res) {
    out.push({ source: 'resourcesPath/app.asar', path: join(res, 'app.asar', ...DSH_TOOLS_REL) });
    out.push({ source: 'resourcesPath/app.asar.unpacked', path: join(res, 'app.asar.unpacked', ...DSH_TOOLS_REL) });
  }
  out.push({ source: 'abs:D:/DeepSeek/resources/app.asar', path: join('D:/DeepSeek/resources/app.asar', ...DSH_TOOLS_REL) });
  out.push({ source: 'abs:D:/DeepSeek/resources/app.asar.unpacked', path: join('D:/DeepSeek/resources/app.asar.unpacked', ...DSH_TOOLS_REL) });
  return out;
}

const acceptDefineTool = (mod) => (mod && typeof mod.defineTool === 'function' ? mod.defineTool : null);

/** 解析官方 defineTool；全失败返回 null（调用方降级 warn，不抛）。 */
export async function loadDefineTool() {
  try {
    const fn = acceptDefineTool(await import('@deepseek-ai/dsh-tools'));
    if (fn) {
      DEFINE_TOOL_PROBE.push({ source: 'bare', strategy: 'import', ok: true });
      return { defineTool: fn, source: 'bare|import' };
    }
    DEFINE_TOOL_PROBE.push({ source: 'bare', strategy: 'import', ok: false, error: '导入成功但无 defineTool 导出' });
  } catch (e) {
    DEFINE_TOOL_PROBE.push({ source: 'bare', strategy: 'import', ok: false, error: errOf(e) });
  }
  const require = createRequire(import.meta.url);
  for (const cand of dshToolsCandidates()) {
    try {
      const fn = acceptDefineTool(await import(pathToFileURL(cand.path).href));
      if (fn) {
        DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'import', ok: true, path: cand.path });
        return { defineTool: fn, source: `${cand.source}|import` };
      }
      DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'import', ok: false, path: cand.path, error: '导入成功但无 defineTool 导出' });
    } catch (e) {
      DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'import', ok: false, path: cand.path, error: errOf(e) });
    }
    try {
      const fn = acceptDefineTool(require(cand.path));
      if (fn) {
        DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'require', ok: true, path: cand.path });
        return { defineTool: fn, source: `${cand.source}|require` };
      }
      DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'require', ok: false, path: cand.path, error: '加载成功但无 defineTool 导出' });
    } catch (e) {
      DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'require', ok: false, path: cand.path, error: errOf(e) });
    }
  }
  return { defineTool: null, source: null };
}

/* ─────────────── 工具规格表（工具名 → 客户端 action） ─────────────── */

const OUT = {
  schema: { type: 'json' },
  render: (args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
};

/**
 * 规格表：`action` 必须与 client.js 的 commandHandlers 键逐字一致（漂移 = 工具静默失败）。
 * 参数名**不得使用 `action` / `id`**（命令信封已占用，P47-D）。
 */
export const BROWSER_TOOL_SPECS = [
  {
    name: 'browser_tabs',
    action: 'browser-tabs',
    timeoutMs: 20000,
    description: '列出 DSH 内置浏览器当前打开的全部页面（跨会话：sessionId/tabId/类型），并给出已挂载 webview 的实时 url/title/webContentsId。回答「用户现在开着哪些页面 / 该操作哪个标签」时先调它。',
    parameters: {},
  },
  {
    name: 'browser_open',
    action: 'browser-open',
    timeoutMs: 35000,
    description: '在内置浏览器里新开标签并加载 URL（自己打开网页）。只支持 http/https；策略与 DSH 地址栏一致：拒绝带凭据 URL 与 DSH 自身地址。',
    parameters: { url: { type: 'string', required: true, description: '要打开的 http/https 地址' } },
  },
  {
    name: 'browser_close',
    action: 'browser-close',
    timeoutMs: 20000,
    description: '关闭内置浏览器的标签（自己关网页）。省略 tabId 时关闭当前活动标签；tabId 取自 browser_tabs。',
    parameters: { tabId: { type: 'string', description: '要关闭的标签 id（来自 browser_tabs 的 tabId）' } },
  },
  {
    name: 'browser_panel',
    action: 'browser-panel',
    timeoutMs: 20000,
    description: '收起/展开右侧栏的浏览器面板（浏览器「窗口」本体的显隐），不影响页面内容。',
    parameters: { op: { type: 'string', required: true, description: 'open=展开；close=收起；toggle=切换' } },
  },
  {
    name: 'browser_navigate',
    action: 'navigate',
    timeoutMs: 35000,
    description: '让当前浏览器标签跳转到指定地址（同源才可能成功；跨站请用 browser_open 新开标签）。',
    parameters: { url: { type: 'string', required: true, description: '目标地址' } },
  },
  {
    name: 'browser_reload',
    action: 'reload',
    timeoutMs: 20000,
    description: '刷新当前浏览器标签页面。',
    parameters: {},
  },
  {
    name: 'browser_snapshot',
    action: 'snapshot',
    timeoutMs: 30000,
    description: '扫描当前页面可交互元素（链接/按钮/输入框/下拉/标题等），返回带 ref 编号的清单。后续 browser_click / browser_type 用 ref 定位，比手写 selector 稳定。',
    parameters: {},
  },
  {
    name: 'browser_click',
    action: 'click',
    timeoutMs: 30000,
    staticParams: { mode: 'trusted' },
    description: '点击页面元素：ref（来自 browser_snapshot）或 CSS selector，二选一。走 **Chromium 级可信事件**（isTrusted=true，React 受控组件/反自动化检测都认）；点击前做**遮挡检测**——中心被别的元素盖住时提前失败并回报遮挡者（确认无误可用 force:true 强点）。',
    parameters: {
      ref: { type: 'number', description: 'browser_snapshot 返回的元素编号' },
      selector: { type: 'string', description: 'CSS 选择器（没有 ref 时使用）' },
      force: { type: 'boolean', description: 'true = 即使检测到遮挡也照点' },
      tab: { type: 'number', description: '目标面板序号（0 起；默认当前可见面板）' },
    },
  },
  {
    name: 'browser_dblclick',
    action: 'input',
    timeoutMs: 30000,
    staticParams: { op: 'dblclick' },
    description: '双击页面元素（可信事件 + 遮挡检测）。参数同 browser_click。',
    parameters: {
      ref: { type: 'number', description: 'browser_snapshot 返回的元素编号' },
      selector: { type: 'string', description: 'CSS 选择器' },
      force: { type: 'boolean', description: 'true = 即使遮挡也照点' },
    },
  },
  {
    name: 'browser_hover',
    action: 'input',
    timeoutMs: 30000,
    staticParams: { op: 'hover' },
    description: '把鼠标移到页面元素上（触发 hover 态/悬停菜单）。参数同 browser_click。',
    parameters: {
      ref: { type: 'number', description: 'browser_snapshot 返回的元素编号' },
      selector: { type: 'string', description: 'CSS 选择器' },
      force: { type: 'boolean', description: 'true = 即使遮挡也移动' },
    },
  },
  {
    name: 'browser_type',
    action: 'type',
    timeoutMs: 30000,
    staticParams: { mode: 'trusted' },
    description: '向输入框/文本域/可编辑元素逐字符发送**真键盘事件**（isTrusted=true）：ref 或 selector 定位（会先可信点击聚焦），text 必填；clear 先清空，submit 末尾回车提交。',
    parameters: {
      ref: { type: 'number', description: 'browser_snapshot 返回的元素编号' },
      selector: { type: 'string', description: 'CSS 选择器（没有 ref 时使用）' },
      text: { type: 'string', required: true, description: '要输入的文本' },
      clear: { type: 'boolean', description: 'true = 输入前先清空（原生 setter + input 事件）' },
      submit: { type: 'boolean', description: 'true = 输入完按回车提交' },
      force: { type: 'boolean', description: 'true = 即使遮挡也点' },
      tab: { type: 'number', description: '目标面板序号（0 起）' },
    },
  },
  {
    name: 'browser_press',
    action: 'input',
    timeoutMs: 20000,
    staticParams: { op: 'press' },
    description: '向当前页面焦点发送一次按键：key 支持 Enter/Tab/Escape/Backspace/Delete/ArrowUp/ArrowDown/ArrowLeft/ArrowRight/Home/End/PageUp/PageDown/Space 或单字符（如 "a"）。可配 modifiers:["control"] 等做组合键。',
    parameters: {
      key: { type: 'string', required: true, description: '键名（见描述）' },
      modifiers: { type: 'array', description: '修饰键数组，如 ["control","shift"]' },
      tab: { type: 'number', description: '目标面板序号（0 起）' },
    },
  },
  {
    name: 'browser_scroll',
    action: 'input',
    timeoutMs: 20000,
    staticParams: { op: 'scroll' },
    description: '滚动当前页面（可信 wheel 事件）：dy 正数向下、负数向上；可给 dx 横向。返回滚动后的 scrollX/scrollY。',
    parameters: {
      dy: { type: 'number', description: '纵向滚动量（正=向下）' },
      dx: { type: 'number', description: '横向滚动量' },
      tab: { type: 'number', description: '目标面板序号（0 起）' },
    },
  },
  {
    name: 'browser_eval',
    action: 'guest-eval',
    timeoutMs: 30000,
    description: '在当前页面（guest 文档）内执行一段 JS 并返回结果：读页面内部状态、做断言、注入测试数据。**注意：代码会被包进函数体，必须自己写 `return`**（例：`return document.title;`），否则返回空值。',
    parameters: {
      code: { type: 'string', required: true, description: '要执行的 JS，需自带 return 才能拿到值' },
      tab: { type: 'number', description: '目标面板序号（0 起；默认第一个）' },
    },
  },
  {
    name: 'browser_console',
    action: 'console-observer',
    timeoutMs: 30000,
    dynamicSource: 'src/console-observer.js',
    description: '读取内置浏览器当前页面的**控制台与网络事件**（DSH 无 DevTools/CDP，本工具用页内观察器实现）：console.log/warn/error、未捕获异常、未处理 Promise 拒绝、fetch/XHR（method/url/status/耗时，不读 body）。会自动注入观察器；页面刷新或新开标签后再次调用会**自动重装（自愈）**。',
    parameters: {
      op: { type: 'string', description: 'dump（默认）读日志 | install 安装并看状态 | clear 清空缓冲 | mark 打时间锚点 | stats 计数 | uninstall 卸载还原' },
      level: { type: 'string', description: '级别过滤：all（默认）| error（含未捕获异常/未处理拒绝）| warn | info | log | debug' },
      limit: { type: 'number', description: '最多返回末尾 N 条（默认 50，硬上限 500）' },
      filter: { type: 'string', description: '对日志文本做子串过滤' },
      net: { type: 'boolean', description: 'true 时只返回 fetch/xhr 网络条目' },
      since: { type: 'number', description: '只返回 t >= since（毫秒时间戳；可先用 op=mark 拿锚点）' },
      label: { type: 'string', description: 'op=mark 时的锚点标签' },
      tab: { type: 'number', description: '目标面板序号（0 起；默认第一个）' },
    },
  },
  {
    name: 'browser_screenshot',
    action: 'screenshot',
    timeoutMs: 30000,
    description: '截取当前**可见**浏览器面板并落盘，返回文件路径（再用 read_image 看图）。隐藏/零尺寸面板会被拒绝（capturePage 高危，见 pitfalls P47-B）。',
    parameters: {},
  },
];

/* ─────────────── 注册 ─────────────── */

/**
 * 注册全部浏览器工具。返回诊断对象（供激活信标/日志；永不抛）。
 * @param {object} ctx cordis Context（host 半边）
 * @param {string} pluginDir 插件目录
 * @param {(level: string, m: string) => void} log 日志器
 * @param {{ defineTool?: Function }} [opts] 测试注入缝：plain Node 读不了 app.asar（asar 补丁只在 DSH
 *   运行时里），单测用桩 defineTool 覆盖注册与 execute 链路；生产不传，走真实解析。
 */
export async function registerBrowserTools(ctx, pluginDir, log = () => {}, opts = {}) {
  const diag = { defineToolResolved: false, defineToolSource: null, ctxToolsAvailable: false, registered: [], errors: [], attempts: DEFINE_TOOL_PROBE };
  try {
    // cordis：**未 inject 直接读服务会抛**「cannot get property "tools" without inject」→ 必须包 try/catch
    let toolsApi = null;
    try { toolsApi = ctx ? ctx.tools : null; } catch { toolsApi = null; }
    diag.ctxToolsAvailable = !!toolsApi && typeof toolsApi.register === 'function';
    if (!diag.ctxToolsAvailable) {
      diag.errors.push("ctx.tools.register 不可用（inject=['tools'] 未满足？）");
      log('warn', 'ctx.tools.register 不可用：浏览器工具未注册（非致命，命令通道照常可用）');
      return diag;
    }
    const resolved = typeof opts.defineTool === 'function'
      ? { defineTool: opts.defineTool, source: 'injected(test)' }
      : await loadDefineTool();
    const { defineTool, source } = resolved;
    diag.defineToolResolved = typeof defineTool === 'function';
    diag.defineToolSource = source;
    if (!diag.defineToolResolved) {
      diag.errors.push('@deepseek-ai/dsh-tools 未解析（defineTool 为 null）');
      log('warn', `defineTool 未解析：浏览器工具未注册（候选失败 ${DEFINE_TOOL_PROBE.filter((p) => !p.ok).length} 项，见 diag.attempts）`);
      return diag;
    }
    const disposers = [];
    for (const spec of BROWSER_TOOL_SPECS) {
      try {
        const def = defineTool({
          name: spec.name,
          description: spec.description,
          parameters: spec.parameters || {},
          output: OUT,
          execute: async (args) => {
            // staticParams：规格层固定参数（如 mode:'trusted' / op:'hover'），调用方可覆盖
            const params = { ...(spec.staticParams || {}), ...(args && typeof args === 'object' ? args : {}) };
            // dynamicSource：源码随命令下发（页内观察器需要；hook 随页面销毁，下发即自愈）
            if (spec.dynamicSource) {
              try {
                params.source = readFileSync(join(pluginDir, '..', spec.dynamicSource), 'utf8');
              } catch (e) {
                return { tool: spec.name, action: spec.action, ok: false, error: `读取 ${spec.dynamicSource} 失败：${errOf(e)}` };
              }
            }
            const r = await runBrowserCommand(pluginDir, spec.action, params, spec.timeoutMs || 25000);
            // 结果统一带工具名与客户端 action，便于排障（工具名 ≠ action 名，别让模型混淆）
            return { tool: spec.name, action: spec.action, ...(r && typeof r === 'object' ? r : { value: r }) };
          },
        });
        const dispose = ctx.tools.register(def);
        if (typeof dispose === 'function') disposers.push(dispose);
        diag.registered.push(spec.name);
      } catch (e) {
        diag.errors.push(`${spec.name}: ${errOf(e)}`);
        log('warn', `工具 ${spec.name} 注册失败：${errOf(e)}`);
      }
    }
    log('info', `浏览器工具已注册 ${diag.registered.length}/${BROWSER_TOOL_SPECS.length}（defineTool 来源 ${source}）`);
    try {
      if (typeof ctx?.effect === 'function') {
        ctx.effect(() => () => {
          for (const d of disposers) { try { d(); } catch { /* 卸载尽力而为 */ } }
        });
      }
    } catch { /* 卸载钩子注册失败不致命 */ }
  } catch (e) {
    diag.errors.push(`registerBrowserTools 抛错：${errOf(e)}`);
    log('warn', `浏览器工具注册异常（不影响其它能力）：${errOf(e)}`);
  }
  return diag;
}
