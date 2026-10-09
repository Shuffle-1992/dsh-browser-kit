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

/* ─────────────── 调用方会话识别（R-SCOPE） ─────────────── */

/**
 * 从工具调用上下文里取「调用方会话 id」。
 * 依据：dsh-tools 的 `tool.execute(exec.arguments, exec)`，而 `exec.agent.session` 是调用 agent 的会话
 * （refs/dsh-tools/lib/index.js:1423 用 `exec.agent.session.header.cwd` 取 cwd ⇒ header 存在）。
 * 版本差异可能落在不同字段 → 逐个候选尝试；全拿不到返回 null（client 侧退回旧行为并如实回报）。
 */
export function sessionIdOf(exec) {
  try {
    const agent = exec && exec.agent;
    const session = agent && agent.session;
    const h = (session && session.header) || {};
    const cands = [h.id, h.sessionId, session && session.id, agent && agent.sessionId, exec && exec.sessionId, h.key, h.uid];
    for (const c of cands) if (typeof c === 'string' && c) return c;
    return null;
  } catch {
    return null;
  }
}

/**
 * 取「调用会话的 workspace 路径」——这正是侧栏窗口 storage identity 的输入
 * （官方公式 `cwd:<workspace.path>`，见 dsh-client-ui-sidebar-browser L1425）。
 * 有它才能让自持窗口拿到**同一分区** ⇒ 复用用户已登录的 cookie/localStorage。
 */
export function workspacePathOf(exec) {
  try {
    const session = exec && exec.agent && exec.agent.session;
    const h = (session && session.header) || {};
    const cands = [h.cwd, h.workspacePath, session && session.cwd, exec && exec.cwd];
    for (const c of cands) if (typeof c === 'string' && c) return c;
    return null;
  } catch {
    return null;
  }
}

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
    staticParams: { compact: true },
    description: '扫描当前页面可交互元素（链接/按钮/输入框/下拉/标题等），返回带 ref 编号的清单。后续 browser_click / browser_type 用 ref 定位，比手写 selector 稳定。默认 **compact**（只回 ref/tag/text，截断 40 字符，最多 60 项，省 token）；需要 id/placeholder/type/value 时传 compact:false。',
    parameters: {
      compact: { type: 'boolean', description: 'true（默认）= 精简输出（ref/tag/text）；false = 带 id/placeholder/type/value' },
      limit: { type: 'number', description: '最多返回多少项（默认 60，上限 120）' },
      maxText: { type: 'number', description: '每项文本截断长度（默认 40，上限 120）' },
      tab: { type: 'number', description: '目标面板序号（0 起；默认当前可见面板）' },
    },
  },
  {
    name: 'browser_state',
    action: 'state',
    timeoutMs: 20000,
    description: '读取当前页面状态一屏：url/title/loading/canGoBack/canGoForward/zoom + readyState/视口尺寸/滚动位置/焦点元素/页内控制台计数。做「操作前后对比」或决定是否 back/forward 时先调它。',
    parameters: { tab: { type: 'number', description: '目标面板序号（0 起）' } },
  },
  {
    name: 'browser_history',
    action: 'history',
    timeoutMs: 25000,
    description: '浏览器会话历史：op=back 后退 / op=forward 前进（返回操作前后的 url/title；已在尽头会提前失败）。刷新用 browser_reload。',
    parameters: {
      op: { type: 'string', required: true, description: 'back=后退；forward=前进' },
      tab: { type: 'number', description: '目标面板序号（0 起）' },
    },
  },
  {
    name: 'browser_wait',
    action: 'wait',
    timeoutMs: 70000,
    staticParams: { waitFor: 'selector' },
    description: '等待页面条件成立（页面内轮询，超时不报错、以 matched:false 返回）：waitFor=selector（元素出现）/ text（正文含子串）/ url（地址含子串）/ load（readyState=complete）/ fn（表达式为真）。自动化里「点完等结果」必备。',
    parameters: {
      waitFor: { type: 'string', description: 'selector（默认）| text | url | load | fn' },
      value: { type: 'string', description: '条件值（selector/文本/URL 片段/表达式）；waitFor=load 时可省略' },
      timeoutMs: { type: 'number', description: '等待上限（毫秒，默认 8000，上限 60000）' },
      tab: { type: 'number', description: '目标面板序号（0 起）' },
    },
  },
  {
    name: 'browser_select',
    action: 'select',
    timeoutMs: 20000,
    description: '选择 <select> 下拉项的选项（按 value 或文本匹配），走原生 setter + input/change 事件（受控组件可用）。',
    parameters: {
      ref: { type: 'number', description: 'browser_snapshot 返回的元素编号' },
      selector: { type: 'string', description: 'CSS 选择器（没有 ref 时使用）' },
      value: { type: 'string', required: true, description: '选项的 value 或显示文本' },
    },
  },
  {
    name: 'browser_element_info',
    action: 'element',
    timeoutMs: 20000,
    description: '按 ref（来自 browser_snapshot）或 CSS selector 读「元素档案」：tag/id/class/文本/值/是否禁用/是否勾选/属性 + 几何与**遮挡情况**。点击或输入前想核对「ref 到底指向哪个元素」时用它；ref 失效会明确报错并提示重取快照。',
    parameters: {
      ref: { type: 'number', description: 'browser_snapshot 返回的元素编号' },
      selector: { type: 'string', description: 'CSS 选择器（没有 ref 时使用）' },
      tab: { type: 'number', description: '目标面板序号（0 起）' },
    },
  },
  {
    name: 'browser_storage',
    action: 'storage',
    timeoutMs: 20000,
    description: '读写当前页面的存储：kind=local（localStorage，默认）| session（sessionStorage）| cookie。op=get（key 省略时列全部）| set | remove | clear。HttpOnly cookie 不可见（需 CDP，本环境不可达）。',
    parameters: {
      op: { type: 'string', description: 'get（默认）| set | remove | clear' },
      kind: { type: 'string', description: 'local（默认）| session | cookie' },
      key: { type: 'string', description: 'op=set/remove 必填；op=get 给了 key 就只回该项' },
      value: { type: 'string', description: 'op=set 的写入值' },
      tab: { type: 'number', description: '目标面板序号（0 起）' },
    },
  },
  {
    name: 'browser_upload',
    action: 'upload',
    timeoutMs: 30000,
    description: '给 <input type="file"> 注入一个文件并触发 input/change（等价 CDP 的 DOM.setFileInputFiles；本环境无 CDP，走 DOM+DataTransfer，对多数框架有效）。base64 上限 4MB。',
    parameters: {
      ref: { type: 'number', description: 'browser_snapshot 返回的元素编号' },
      selector: { type: 'string', description: 'CSS 选择器（没有 ref 时使用）' },
      name: { type: 'string', required: true, description: '文件名（含扩展名）' },
      base64: { type: 'string', required: true, description: '文件内容的 base64' },
      mimeType: { type: 'string', description: 'MIME 类型（默认 application/octet-stream）' },
      tab: { type: 'number', description: '目标面板序号（0 起）' },
    },
  },
  {
    name: 'browser_find',
    action: 'find',
    timeoutMs: 20000,
    description: '页内查找（省 token）：mode=elements（默认，按下标找可交互元素，命中项带 ref，可直接给 browser_click）| text（全文找子串，回上下文片段）| links（按文本或 href 找链接）。大页面里用它替代整份快照。',
    parameters: {
      query: { type: 'string', required: true, description: '要找的文本/选择器关键词（按子串或正则匹配）' },
      mode: { type: 'string', description: 'elements（默认）| text | links' },
      limit: { type: 'number', description: '最多返回多少项（默认 10，上限 50）' },
      tab: { type: 'number', description: '目标面板序号（0 起）' },
    },
  },
  {
    name: 'browser_agent_window',
    action: 'agent-view',
    timeoutMs: 60000,
    description: '**Agent 自己的浏览器窗口**（不占会话、不碰用户侧栏，租约由插件自己持有；右下角小窗，点头部标题或 op=expand 展开）：op=open 建/复用、navigate 导航（活动窗口）、expand/collapse/toggle 展开收起、resolution 改分辨率、zoom 改页面缩放（等同 Chrome 缩放 25%–500%）、fit 切换显示尺度、screenshot **截图当前窗口**（cli: insertToComposer 直接插进输入框）、idle 读/设空闲释放、**多窗口** tabs/tab-new/tab-close/tab-select、**批注** annotate（与会话浏览器共用同一批注）、close 关闭并释放租约、status 查状态、cleanup 清残留。默认 **100% 显示不缩放且页面缩放 100%**（装不下可在窗口内滚动），分辨率预设默认 **1920×1080**（Desktop 档；另有 2K/4K）（另有 4K/1080p/1440x900/1280x720/iPad/iPhone/Pixel/Galaxy 与自定义 WxH、dpr）。面板内自带**标签条（＋新建/×关闭）**与**地址栏（回车导航当前窗口）**。**空闲（默认 10 分钟无 Agent 操作）自动释放窗口让用户使用**（op=idle + idleReleaseMs 可调，0=不释放）；Agent 操作中才亮青色边框，空闲时是中性边框 ⇒ **用户可随时手动操作该窗口协作**。展开时窗口贴标题栏下方并置顶（不遮挡 DSH 右上角窗口按钮）。storageIdentity 缺省自动探测侧栏身份 ⇒ **共享其登录态**；多个窗口各自持租约但同一身份 ⇒ 登录态一致。',
    parameters: {
      op: { type: 'string', required: true, description: 'open | navigate | expand | collapse | toggle | resolution | zoom | fit | screenshot | idle | tabs | tab-new | tab-close | tab-select | annotate | close | status | cleanup' },
      tabId: { type: 'string', description: 'op=tab-select/tab-close：目标窗口 id（来自 tabs/status 的 tabs[].id；缺省=活动窗口）' },
      on: { type: 'boolean', description: 'op=annotate：true=加入共享批注、false=退出；缺省=toggle。批注与会话浏览器**共用同一批注**' },
      url: { type: 'string', description: 'op=open/navigate 时的目标地址（http/https）' },
      resolution: { type: 'string', description: 'op=open/resolution：预设名（2K/4K/1080p/1440x900/1280x720/iPad Pro/iPad mini/iPhone 15 Pro/iPhone 15 Pro Max/Pixel 7/Galaxy S20）或自定义 WxH（如 1440x900）' },
      zoom: { type: 'number', description: 'op=open/zoom：页面缩放倍数（等同 Chrome 缩放，0.25–5，如 1.25；也可用 zoomPct 传百分比）' },
      zoomPct: { type: 'number', description: 'op=zoom：缩放百分比（如 125 表示 125%）' },
      fit: { type: 'boolean', description: '显示尺度：缺省 false=**100% 不缩放**（装不下可滚动）；true=缩放到窗口内看得全。op=fit 时生效，也可随 open/resolution 传入' },
      clipboard: { type: 'boolean', description: 'op=screenshot：除落盘外**同时复制到系统剪贴板**（供直接粘贴）。UI 上的「截图」按钮默认就会复制；Agent 调用缺省 false，避免抢占用户剪贴板' },
      dpr: { type: 'number', description: '设备像素比（缺省按预设；走 webview setZoomFactor）' },
      state: { type: 'string', description: 'op=open 时的初始形态：collapsed（默认，小窗）| expanded' },
      idleReleaseMs: { type: 'number', description: '空闲自动释放毫秒数（缺省 600000=10 分钟；0=不自动释放）。op=idle 时设置，也可随 open 传入' },
      storageIdentity: { type: 'string', description: 'op=open 的存储身份（缺省=自动探测侧栏身份以复用登录态；传 dsh-browser-kit:agent-view 用独立干净分区）' },
      width: { type: 'number', description: '（兼容旧参数）面板宽，现由分辨率与缩放自动决定' },
      height: { type: 'number', description: '（兼容旧参数）面板高，现由分辨率与缩放自动决定' },
    },
  },
  {
    name: 'browser_check',
    action: 'check',
    timeoutMs: 20000,
    description: '勾选/取消勾选 checkbox 或 radio（按需切换，返回 before/after）。',
    parameters: {
      ref: { type: 'number', description: 'browser_snapshot 返回的元素编号' },
      selector: { type: 'string', description: 'CSS 选择器（没有 ref 时使用）' },
      checked: { type: 'boolean', description: '目标状态（默认 true=勾选）' },
    },
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
    timeoutMs: 40000,
    description: '截取当前**可见**浏览器面板（缺省自持窗口优先）并落盘，返回文件路径（再用 read_image 看图，供视觉识别/布局复刻）。隐藏/零尺寸面板会被拒绝（capturePage 高危，见 pitfalls P47-B）；自持窗口收起时先 `browser_agent_window {op:"expand"}` 或直接用 `{op:"screenshot"}`。',
    parameters: {},
  },
];

/* R-OWN：给所有「页面级」工具补一个统一的 target 参数（一次成型，避免逐个 spec 手改）。
 * 语义：agent=插件自持窗口（browser_agent_window）；session=本会话侧栏面板；
 *       省略=自持窗口优先（若已开），否则本会话面板——默认即「不打扰用户」。 */
const PAGE_TOOL_ACTIONS = new Set([
  'snapshot', 'state', 'history', 'wait', 'select', 'element', 'check', 'input',
  'click', 'type', 'reload', 'navigate', 'screenshot', 'console-observer', 'storage', 'upload', 'find',
]);
for (const spec of BROWSER_TOOL_SPECS) {
  if (!PAGE_TOOL_ACTIONS.has(spec.action)) continue;
  spec.parameters = spec.parameters || {};
  if (!spec.parameters.target) {
    spec.parameters.target = {
      type: 'string',
      description: '作用目标：agent=Agent 自持窗口（browser_agent_window）；session=本会话侧栏面板；省略=**自持窗口优先**（若已开），否则本会话面板',
    };
  }
}

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
          execute: async (args, exec) => {
            // staticParams：规格层固定参数（如 mode:'trusted' / op:'hover'），调用方可覆盖
            const params = { ...(spec.staticParams || {}), ...(args && typeof args === 'object' ? args : {}) };
            // R-SCOPE：把**调用方会话**带下去，client 只在「本会话的浏览器面板」上操作（不动别的会话）
            const sessionId = sessionIdOf(exec);
            if (sessionId) params.sessionId = sessionId;
            // R-OWN-ID：workspace 路径是 storage identity 的输入（cwd:<path>）——只在 agent-view 需要，
            // 但它很小，统一带上便于将来复用（登录态探测靠它命中侧栏同分区）
            const workspacePath = workspacePathOf(exec);
            if (workspacePath) params.workspacePath = workspacePath;
            // dynamicSource：源码随命令下发（页内观察器需要；hook 随页面销毁，下发即自愈）
            if (spec.dynamicSource) {
              try {
                params.source = readFileSync(join(pluginDir, '..', spec.dynamicSource), 'utf8');
              } catch (e) {
                return { tool: spec.name, action: spec.action, ok: false, error: `读取 ${spec.dynamicSource} 失败：${errOf(e)}` };
              }
            }
            const r = await runBrowserCommand(pluginDir, spec.action, params, spec.timeoutMs || 25000);
            // 结果统一带工具名与客户端 action，便于排障（工具名 ≠ action 名，别让模型混淆）；
            // sessionId 回显用于核对「到底作用在哪个会话」（R-SCOPE 的可见性保证）
            return { tool: spec.name, action: spec.action, ...(sessionId ? { requestedSession: sessionId } : {}), ...(r && typeof r === 'object' ? r : { value: r }) };
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
