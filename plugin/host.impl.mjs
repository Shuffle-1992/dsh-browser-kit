/**
 * @local/dsh-browser-kit —— Host 业务实现（由 index.js 薄壳按 mtime+seq 动态 import，见其头注）。
 *
 * MVP-0 探测 + MVP-1 截图管线（调研文档 §5.3 / docs/delivery-02-mvp0.md 定论的混合架构）：
 *  - face `reportClient`：client 探测结果上报 → 落 .data/probe-report.json（诊断）；
 *  - face `saveShot(meta, dataUrl)`：client capturePage() 的 PNG dataURL → <项目>/shots/<时间戳>-<标题>.png
 *    + index.jsonl 一行元数据（MVP-1 主通道；agent 经文件路径 read_image）；
 *  - face `saveAnnotations(markdown)`：批注协议块 → <项目>/annotations/<时间戳>.md（MVP-2 主通道，先备好）；
 *  - Path B 鉴定结论保留在探测输出里（host 插件 = RUN_AS_NODE runner，不可触达 Electron 主进程）。
 *
 * 缓存要点：本 impl 以 ?ts=mtime-seq 动态加载；它对 wire.host.mjs 的引用**同样带 ?ts=**（相对导入
 * 会丢查询参数，必须显式带上），否则 wire 里的 face 类被进程级缓存——新 face 方法永远不生效（P13 变体）。
 *
 * 激活安全：任何异常只记录不抛（绝不阻塞 cordis 激活；同 zcode-dispatch 纪律）。零 npm 依赖。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as pathResolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { buildAnnotationsMarkdown } from '../src/annotations-protocol.js';
// R-HID：hid-bridge 用 **?ts= 动态 import**——静态 import 会命中进程级模块缓存，
// impl 重载后新加的导出（如 hidTraceImpl）永远不生效（P13 变体，同 wire 的缓存纪律）。
let hidBridge = null;
const loadHidBridge = async () => {
  if (hidBridge) return hidBridge;
  hidBridge = await import(`../src/hid-bridge.mjs?ts=${wireCacheBust}`);
  return hidBridge;
};

/** 同款 ?ts= 击穿 wire.host.mjs 缓存（由 apply 传入 mtime）。 */
let wireCacheBust = 'init';
const loadWire = async () => import(`./wire.host.mjs?ts=${wireCacheBust}`).then((m) => m);

/* R-TOOL：agent 一等工具层（browser_*）。**?ts= 动态 import**——静态 import 会命中进程级模块缓存，
 * 改了不生效（P13 家族，同 hid-bridge/wire 的缓存纪律）。 */
let browserToolsMod = null;
const loadBrowserTools = async () => {
  if (browserToolsMod) return browserToolsMod;
  browserToolsMod = await import(`./browser-tools.host.mjs?ts=${wireCacheBust}`);
  return browserToolsMod;
};

const msg = (e) => (e && e.message ? `${e.message}` : String(e));
const safe = (fn) => {
  try {
    return fn();
  } catch (e) {
    return `<error: ${msg(e)}>`;
  }
};

/* ─────────────── 模块形状诊断 ─────────────── */

/** namespace 键 / default 键（只留前 40 个，防日志爆炸）。 */
function shapeOf(mod) {
  const keys = (m) => {
    try {
      return m && typeof m === 'object' ? Object.keys(m).slice(0, 40) : String(typeof m);
    } catch (e) {
      return `<keys error: ${msg(e)}>`;
    }
  };
  const me = mod && typeof mod === 'object' ? mod['module.exports'] : undefined;
  return {
    typeof: typeof mod,
    keys: keys(mod),
    hasDefault: !!(mod && typeof mod === 'object' && 'default' in mod),
    defaultTypeof: mod && typeof mod === 'object' ? typeof mod.default : null,
    defaultKeys: mod && typeof mod === 'object' ? keys(mod.default) : null,
    moduleExportsTypeof: typeof me,
    moduleExportsKeys: keys(me),
  };
}

/** 从 import/require 的各种返回形状里挑出带 webContents/app 的 API 对象（jiti 互操作形含 'module.exports' 键）。 */
function extractApi(mod) {
  const cands = [
    mod,
    mod && mod.default,
    mod && mod.default && mod.default.default,
    mod && typeof mod === 'object' ? mod['module.exports'] : undefined,
  ];
  for (const c of cands) {
    if (c && typeof c === 'object' && (c.webContents || c.app)) return c;
  }
  return null;
}

/** 进程身份鉴定：main / utility / renderer / 纯 Node runner 一锤定音。 */
function processIdentity(record) {
  const req = createRequire(import.meta.url);
  record.processType = process.type ?? null;
  record.runAsNode = process.env ? process.env.ELECTRON_RUN_AS_NODE ?? null : null;
  record.execPath = process.execPath ?? null;
  record.argv = Array.isArray(process.argv) ? process.argv.slice(0, 6) : null;
  record.mainModule = (process.mainModule && process.mainModule.filename) || null;
  record.versionsKeys = Object.keys(process.versions || {});
  record.hasLinkedBinding = typeof process._linkedBinding;
  try {
    record.moduleBuiltinHasElectron = req('node:module').builtinModules.includes('electron');
  } catch (e) {
    record.moduleBuiltinErr = msg(e);
  }
  try {
    record.globalElectronHints = Object.getOwnPropertyNames(globalThis)
      .filter((k) => /electron|webContents/i.test(k))
      .slice(0, 10);
  } catch { /* ignore */ }
}

/** CJS require 的候选根（Electron 对 'electron' 的解析可能依赖请求方路径，逐个尝试）。 */
function requireRoots() {
  const roots = [import.meta.url];
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    roots.push(
      join(process.resourcesPath, 'app.asar', 'package.json'),
      join(process.resourcesPath, 'app.asar', 'out', 'main.js'),
      join(process.resourcesPath, 'electron.asar', 'renderer.js'),
    );
  }
  return roots;
}

/** 尽可能加载 electron（ESM import 内建名 → 结果校验失败或抛错时 CJS require 降级）。 */
async function loadElectron(record) {
  try {
    const mod = await import('electron');
    record.shape = shapeOf(mod);
    const api = extractApi(mod);
    if (api) {
      record.strategy = 'esm-import';
      record.ok = true;
      return api;
    }
    record.esmEmpty = 'import 成功但命名空间无 webContents/app（形状见 shape 字段）';
  } catch (e) {
    record.esmError = msg(e);
  }
  const attempts = [];
  for (const root of requireRoots()) {
    try {
      const req = createRequire(root);
      const mod = req('electron');
      const shape = shapeOf(mod);
      attempts.push({ root, ok: true, shape });
      const api = extractApi(mod);
      if (api) {
        record.strategy = `cjs-require(${root})`;
        record.cjsShapes = attempts;
        record.ok = true;
        return api;
      }
      attempts[attempts.length - 1].note = 'require 成功但无 webContents/app';
    } catch (e) {
      attempts.push({ root, ok: false, error: msg(e) });
    }
  }
  record.cjsShapes = attempts;
  record.ok = false;
  return null;
}

/* ─────────────── 探测与报告 ─────────────── */

/** Path B 核心探测：electron 可达性 → webContents 枚举 → guest executeJavaScript/capturePage/debugger。 */
async function runHostProbe(reportPath, state) {
  const host = {
    at: new Date().toISOString(),
    node: process.version,
    electronVersion: process.versions.electron || null,
    chromeVersion: process.versions.chrome || null,
    resourcesPath: typeof process.resourcesPath === 'string' ? process.resourcesPath : null,
    electronLoad: { ok: false },
    identity: {},
    app: null,
    webContents: null,
    guestProbe: [],
  };

  processIdentity(host.identity);

  const electron = await loadElectron(host.electronLoad);

  if (electron) {
    try {
      if (electron.app && typeof electron.app.getVersion === 'function') {
        host.app = { version: electron.app.getVersion() };
      }
    } catch (e) {
      host.app = { error: msg(e) };
    }

    try {
      const all = electron.webContents.getAllWebContents();
      host.webContents = {
        count: all.length,
        items: all.map((wc) => ({
          id: wc.id,
          type: safe(() => wc.getType()),
          url: safe(() => wc.getURL()),
        })),
      };
      // webview 型 guest（lease guest 与 platform view 都是 webview；最多探测 3 个）
      const guests = all.filter((wc) => safe(() => wc.getType()) === 'webview').slice(0, 3);
      for (const wc of guests) {
        const g = {
          webContentsId: wc.id,
          url: safe(() => wc.getURL()),
          executeJavaScript: null,
          capturePage: null,
          debuggerFullPage: null,
        };
        try {
          g.executeJavaScript = { ok: true, value: await wc.executeJavaScript('1+1', false) };
        } catch (e) {
          g.executeJavaScript = { ok: false, error: msg(e) };
        }
        try {
          const img = await wc.capturePage();
          const png = img.toPNG();
          g.capturePage = { ok: true, pngBytes: png.length, size: img.getSize() };
        } catch (e) {
          g.capturePage = { ok: false, error: msg(e) };
        }
        try {
          wc.debugger.attach('1.3');
          try {
            await wc.debugger.sendCommand('Page.enable');
          } catch { /* Page.enable 失败不阻断截图尝试 */ }
          const r = await wc.debugger.sendCommand('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
          });
          g.debuggerFullPage = { ok: true, pngBytes: Buffer.from(r.data, 'base64').length };
        } catch (e) {
          g.debuggerFullPage = { ok: false, error: msg(e) };
        } finally {
          try {
            if (wc.debugger.isDebuggerAttached()) wc.debugger.detach();
          } catch { /* 已脱离 */ }
        }
        host.guestProbe.push(g);
      }
    } catch (e) {
      host.webContents = { error: msg(e) };
    }
  }

  state.host = host;
  writeReport(reportPath, state, 'host probe finished');
  return host;
}

/** 写探测报告（失败只留 console，不抛）。 */
function writeReport(reportPath, state, reason) {
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          plugin: '@local/dsh-browser-kit',
          probe: 'mvp-0',
          implLoadedAt: state.implLoadedAt,
          updatedAt: new Date().toISOString(),
          reason,
          probeRuns: state.probeRuns,
          shots: state.shots,
          host: state.host,
          client: state.client,
          clientReceivedAt: state.clientReceivedAt,
          // R-TOOL：agent 工具注册诊断（defineTool 来源 / 已注册清单 / 失败原因）
          tools: state.tools || null,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  } catch (e) {
    try {
      console.warn('[dsh-browser-kit] 写探测报告失败：', msg(e));
    } catch { /* 静默 */ }
  }
}

function groupsLen(sets) {
  return Array.isArray(sets) ? sets.filter((s) => s && Array.isArray(s.annotations) && s.annotations.length > 0).length : 0;
}

/* ─────────────── 入口 ─────────────── */

/** cordis Context 的 logger（缺席时退回 console）。 */
function makeLogger(ctx) {
  return (level, text) => {
    try {
      const logger = ctx && ctx.logger;
      if (logger && typeof logger[level] === 'function') logger[level](`[dsh-browser-kit] ${text}`);
      else console[level === 'info' ? 'log' : level](`[dsh-browser-kit] ${text}`);
    } catch { /* 日志失败不影响主流程 */ }
  };
}

/* ─────────────── 落盘（MVP-1 截图 / MVP-2 批注） ─────────────── */

/** 项目根 = plugin/ 的上一级（本仓）；shots/ 与 annotations/ 均已 gitignore。 */
function projectDirOf(paths) {
  return join(paths.pluginDir, '..');
}

/** Windows 安全 + 可读的文件名段：保留中英文/数字/点横线下划线，限 40 字。 */
function slugify(s) {
  const cleaned = String(s || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40);
  return cleaned || 'page';
}

/** 本地时间戳：YYYYMMDD-HHmmss。 */
function tsStamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * saveShot 实现：dataURL → PNG 文件 + index.jsonl 元数据行。
 * 1×1 假成功防线（调研文档 §5.3 / ZCode 坑）：PNG < 500 字节视为失败如实返回。
 */
/** 同名去重：文件已存在则追加 -2/-3… 序号（同秒同标题连拍不互相覆盖；ZCode 任务02 观察项落地）。 */
function dedupeFile(dir, name) {
  let file = join(dir, name);
  let n = 2;
  while (existsSync(file)) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    file = join(dir, `${stem}-${n}${ext}`);
    n += 1;
  }
  return file;
}

/**
 * H2（review 提取）：saveShot/saveAnnotations/saveMerged 三处同构尾部——
 * mkdir → dedupeFile → writeFileSync → index.jsonl 追加。索引写失败不影响主交付
 * （与历史行为一致）。indexEntryOf(finalName) 收到去重后的文件名以构建索引行。
 * 返回 { file, finalName }。
 */
function writeArtifact(dir, name, data, indexEntryOf) {
  mkdirSync(dir, { recursive: true });
  const file = dedupeFile(dir, name);
  const finalName = file.split(/[\\/]/).pop();
  writeFileSync(file, data);
  try {
    appendFileSync(join(dir, 'index.jsonl'), `${JSON.stringify(indexEntryOf(finalName))}\n`, 'utf8');
  } catch { /* 索引写失败不影响主交付 */ }
  return { file, finalName };
}

function saveShotImpl(paths, meta, dataUrl) {
  const m = meta && typeof meta === 'object' ? meta : {};
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    return { ok: false, error: 'dataUrl 不是 image/png 的 dataURL' };
  }
  const b64 = dataUrl.slice('data:image/png;base64,'.length).replace(/\s/g, '');
  const png = Buffer.from(b64, 'base64');
  if (png.length === 0) return { ok: false, error: 'PNG 解码为空' };
  if (png.length < 500) {
    return { ok: false, error: `PNG 仅 ${png.length} 字节——疑似 1×1 假成功（guest 不可见/已后台？）`, bytes: png.length };
  }
  const dir = join(projectDirOf(paths), 'shots');
  const { file } = writeArtifact(
    dir,
    `${tsStamp()}-${slugify(m.title || m.url || '')}.png`,
    png,
    (n) => ({ at: new Date().toISOString(), file: n, url: m.url ?? null, title: m.title ?? null, bytes: png.length }),
  );
  return { ok: true, path: file, bytes: png.length };
}

/** saveAnnotations 实现：批注协议块 → annotations/<时间戳>.md + index.jsonl 一行元数据。 */
function saveAnnotationsImpl(paths, markdown, meta) {
  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    return { ok: false, error: 'markdown 为空' };
  }
  const m = meta && typeof meta === 'object' ? meta : {};
  const dir = join(projectDirOf(paths), 'annotations');
  const content = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
  const firstLine = markdown.split(/\r?\n/, 1)[0] || '';
  const count = Number((firstLine.match(/# Web page annotations:\s*(\d+)/) || [])[1] || 0);
  const { file } = writeArtifact(
    dir,
    `${tsStamp()}.md`,
    content,
    (n) => ({ at: new Date().toISOString(), file: n, url: m.url ?? null, title: m.title ?? null, count }),
  );
  return { ok: true, path: file, bytes: Buffer.byteLength(markdown, 'utf8') };
}

/**
 * saveMerged 实现：多面板批注合并 → 单个协议文件。
 * 编号规则（用户需求：跨窗口延续 + 可互相引用）：
 *  1. 合并各组 annotations（每组 {url,title,annotations[]}）；
 *  2. 按 element.capturedAt（创建时刻，批注层采集时固化的毫秒时间戳）升序排序——
 *     创建顺序 = 窗口1 的 1、2 在前，窗口2 的在后；
 *  3. 重编号 index = 1..N（权威编号，与页内徽标一致——页内 startIndex 由 client 按同一规则交接）；
 *  4. 用 src/annotations-protocol.js 的构建器（与页内逐字同源）生成 markdown 落盘。
 */
function saveMergedImpl(paths, sets, meta) {
  if (!Array.isArray(sets) || sets.length === 0) {
    return { ok: false, error: 'sets 为空' };
  }
  const groups = [];
  for (const s of sets) {
    if (s && typeof s === 'object' && Array.isArray(s.annotations) && s.annotations.length > 0) {
      groups.push(s);
    }
  }
  if (groups.length === 0) {
    return { ok: false, error: '无可合并批注（各组均无 annotations）' };
  }
  const m = meta && typeof meta === 'object' ? meta : {};
  const combined = [];
  const seenGids = {};
  for (const g of groups) {
    for (const a of g.annotations) {
      if (!a || typeof a !== 'object') continue;
      // 同步后的两面板会持有相同 gid（跨面板共享）——按 gid 去重，合并不产生重复条目
      if (a.gid) {
        if (seenGids[a.gid]) continue;
        seenGids[a.gid] = true;
      }
      combined.push(a);
    }
  }
  combined.sort((a, b) => {
    const ta = (a.element && a.element.capturedAt) || 0;
    const tb = (b.element && b.element.capturedAt) || 0;
    return ta - tb;
  });
  const renumbered = combined.map((a, i) => Object.assign({}, a, { index: i + 1 }));
  const markdown = buildAnnotationsMarkdown(renumbered);
  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    return { ok: false, error: '协议构建结果为空' };
  }
  const dir = join(projectDirOf(paths), 'annotations');
  const content = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
  const firstLine = markdown.split(/\r?\n/, 1)[0] || '';
  const count = Number((firstLine.match(/# Web page annotations:\s*(\d+)/) || [])[1] || renumbered.length);
  const urls = [...new Set(groups.map((g) => g.url).filter(Boolean))];
  const { file } = writeArtifact(
    dir,
    `${tsStamp()}.md`,
    content,
    (n) => ({ at: new Date().toISOString(), file: n, url: m.url ?? urls[0] ?? null, title: m.title ?? null, count, merged: groups.length }),
  );
  return { ok: true, path: file, bytes: Buffer.byteLength(markdown, 'utf8'), count: renumbered.length };
}

/** getInjectScript 实现：按 mtime 供源（client 按 mtime 缓存；源文件改动即时生效）。 */
function getInjectScriptImpl(paths) {
  const file = join(projectDirOf(paths), 'src', 'element-annotator.js');
  const st = statSync(file);
  const source = readFileSync(file, 'utf8');
  return { ok: true, source, mtime: String(st.mtimeMs), bytes: source.length };
}

/** R-HID：WebHID shim 源供给（同 getInjectScriptImpl 形态；client 按 mtime 决定是否重注入 guest）。 */
function getHidShimImpl(paths) {
  const file = join(projectDirOf(paths), 'src', 'webhid-shim.js');
  const st = statSync(file);
  const source = readFileSync(file, 'utf8');
  return { ok: true, source, mtime: String(st.mtimeMs), bytes: source.length };
}

/** takeCommand 实现：取走即删（.data/command.json；实施会话用本地工具直接落此文件驱动 client）。 */
function takeCommandImpl(paths) {
  const file = join(paths.pluginDir, '.data', 'command.json');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, command: null };
    return { ok: false, error: msg(e) };
  }
  try {
    unlinkSync(file);
  } catch (e) {
    return { ok: false, error: `命令文件删除失败：${msg(e)}` };
  }
  try {
    // Windows PowerShell 5 的 Set-Content -Encoding UTF8 会带 BOM，先剥掉再 parse
    return { ok: true, command: JSON.parse(raw.replace(/^\uFEFF/, '')) };
  } catch (e) {
    return { ok: false, error: `命令 JSON 解析失败：${msg(e)}` };
  }
}

/** commandResult 实现：追加 .data/command-results.jsonl（实施会话读它收结果）。 */
function commandResultImpl(paths, id, result) {
  const dir = join(paths.pluginDir, '.data');
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    join(dir, 'command-results.jsonl'),
    `${JSON.stringify({ at: new Date().toISOString(), id, result: result === undefined ? null : result })}\n`,
    'utf8',
  );
  return { ok: true };
}

/**
 * deleteAnnotations 实现（撤回）：删除 annotations/ 内已保存的批注文件 + 清掉 index.jsonl 对应行。
 * 安全线：解析后的绝对路径必须位于 <项目>/annotations/ 目录内（拒绝一切越界删除）；
 * 文件名在 annotations/ 内由 dedupeFile 保证唯一，索引按 file 名整行过滤。
 */
function deleteAnnotationsImpl(paths, filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return { ok: false, error: 'path 为空' };
  }
  const dir = pathResolve(join(projectDirOf(paths), 'annotations'));
  let target;
  try {
    target = pathResolve(filePath);
  } catch (e) {
    return { ok: false, error: `路径解析失败：${msg(e)}` };
  }
  if (target !== dir && !target.startsWith(dir + sep)) {
    return { ok: false, error: '路径越界：仅允许删除 annotations/ 目录内的文件' };
  }
  if (!existsSync(target)) {
    return { ok: false, error: '文件不存在（可能已删除）' };
  }
  try {
    unlinkSync(target);
  } catch (e) {
    return { ok: false, error: `删除失败：${msg(e)}` };
  }
  let removedIndexEntries = 0;
  try {
    const indexFile = join(dir, 'index.jsonl');
    const base = target.split(/[\\/]/).pop();
    const kept = [];
    for (const line of readFileSync(indexFile, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let match = true;
      try {
        match = JSON.parse(line).file === base;
      } catch { /* 坏行保留 */ }
      if (match) removedIndexEntries += 1;
      else kept.push(line);
    }
    writeFileSync(indexFile, kept.length > 0 ? `${kept.join('\n')}\n` : '', 'utf8');
  } catch { /* 索引清理失败不影响撤回主交付 */ }
  return { ok: true, removedFile: target, removedIndexEntries };
}

/** getStats 实现：批注/截图两个 artifact 目录的数量与字节占用（供插件管理面板展示）。 */
function getStatsImpl(paths) {
  const root = projectDirOf(paths);
  const statDir = (name) => {
    const dir = join(root, name);
    let count = 0;
    let bytes = 0;
    try {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (!f.isFile() || f.name === 'index.jsonl') continue;
        count += 1;
        bytes += statSync(join(dir, f.name)).size;
      }
    } catch { /* 目录不存在 = 0 */ }
    return { count, bytes };
  };
  return { ok: true, annotations: statDir('annotations'), shots: statDir('shots') };
}

/**
 * clearArtifacts 实现：一键清空批注/截图目录（'annotations' | 'shots' | 'all'）。
 * 安全面与 deleteAnnotationsImpl 同款：只清 <项目>/ 下这两个白名单目录内的普通文件
 * （含 index.jsonl 一并清空——目录被清空后索引行已无意义）。
 */
function clearArtifactsImpl(paths, kind) {
  const root = projectDirOf(paths);
  const targets = kind === 'all' ? ['annotations', 'shots'] : (kind === 'annotations' || kind === 'shots') ? [kind] : null;
  if (!targets) {
    return { ok: false, error: "kind 必须是 'annotations' | 'shots' | 'all'" };
  }
  const removed = {};
  try {
    for (const name of targets) {
      const dir = join(root, name);
      let n = 0;
      try {
        for (const f of readdirSync(dir, { withFileTypes: true })) {
          if (!f.isFile()) continue;
          try {
            unlinkSync(join(dir, f.name));
            n += 1;
          } catch { /* 单文件失败继续 */ }
        }
      } catch { /* 目录不存在 = 已是空 */ }
      removed[name] = n;
    }
  } catch (e) {
    return { ok: false, error: `清除失败：${msg(e)}` };
  }
  return { ok: true, removed };
}

/**
 * impl 入口（index.js 薄壳动态调用）。async：wire.host.mjs 需带 ?ts= 动态 import（见文件头）。
 * @param {object} ctx cordis Context
 * @param {object} _config 插件 config（本插件暂无字段）
 * @param {{ pluginDir: string, reportPath: string }} paths 薄壳解析的路径
 */
export async function apply(ctx, _config = {}, paths = {}) {
  const log = makeLogger(ctx);
  const reportPath = paths.reportPath;
  wireCacheBust = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const wire = await loadWire();
  const FACE_NAME = wire.FACE_NAME;
  const state = {
    implLoadedAt: new Date().toISOString(),
    host: null,
    client: null,
    clientReceivedAt: null,
    probeRuns: 0,
    probing: false,
    shots: [],
  };

  /** 探测入口（激活时一次；client 上报到达时若 guest 已出现再补一轮）。 */
  const probe = async (trigger) => {
    if (state.probing) return;
    state.probing = true;
    state.probeRuns += 1;
    try {
      await runHostProbe(reportPath, state);
      log('info', `host 探测完成（#${state.probeRuns}，触发=${trigger}）`);
    } catch (e) {
      state.host = { at: new Date().toISOString(), fatal: msg(e) };
      writeReport(reportPath, state, 'host probe threw');
      log('warn', `host 探测异常：${msg(e)}`);
    } finally {
      state.probing = false;
    }
  };

  log('info', `MVP-1 impl 激活（${state.implLoadedAt}；wire ${wireCacheBust}；报告 → ${reportPath}）`);

  /* ---- 通知 web 端热换本包 client 模块（client-hmr 消费 rebuilt 事件） ----
   * 实测：仅靠文件改动/toggle，页面可能持续运行旧 client 模块（P20 系列症状：
   * 命令无 30s 超时防线、面板位置修复不生效）。显式调 clientModules.rebuilt(packageId)
   * 推送重建事件，让页面拉取最新 client.js。 */
  try {
    const clientModules = ctx && typeof ctx.get === 'function' ? ctx.get('clientModules') : null;
    if (clientModules && typeof clientModules.rebuilt === 'function') {
      clientModules.rebuilt('@local/dsh-browser-kit');
      log('info', 'clientModules.rebuilt 已推送（client 模块热换通知）');
    } else {
      log('warn', 'clientModules.rebuilt 不可用（client 模块可能不热换，需页面刷新）');
    }
  } catch (e) {
    log('warn', `clientModules.rebuilt 调用失败：${msg(e)}`);
  }

  /* ---- face 注册（typertGateway SRC 兜底路径；typert-loader 路径靠 exports["./typert"] 自动发现） ---- */
  const face = wire.createRemoteFace({
    onReport: (findings) => {
      // H1（review 修复）：旧实现读 findings.webviews——client findings 从无该字段，
      // 「client 见 guest 而 host 未采到 → 补一轮探测」永不触发；真实形状是 webviewCount
      const hadGuests = Number(state.client?.webviewCount) > 0;
      state.client = findings && typeof findings === 'object' ? findings : { raw: String(findings) };
      state.clientReceivedAt = new Date().toISOString();
      writeReport(reportPath, state, 'client report received');
      // client 发现了 webview 而上一轮 host 探测没采到 guest（guest 晚于激活出现）→ 补一轮
      const nowHasGuests = Number(state.client?.webviewCount) > 0;
      if (nowHasGuests && !hadGuests) probe('client-report-guests').catch(() => {});
      return Promise.resolve({ ok: true, savedAt: state.clientReceivedAt });
    },
    onSaveShot: (meta, dataUrl) => {
      const r = saveShotImpl(paths, meta, dataUrl);
      state.shots.push({ at: new Date().toISOString(), ...r, meta: meta && typeof meta === 'object' ? { url: meta.url ?? null, title: meta.title ?? null } : null });
      if (state.shots.length > 50) state.shots.splice(0, state.shots.length - 50); // R2.3：长驻进程元数据不无界累积（与 client sentChips 同款纪律）
      log(r.ok ? 'info' : 'warn', `saveShot → ${r.ok ? r.path : r.error}`);
      return Promise.resolve(r);
    },
    onSaveAnnotations: (markdown, meta) => {
      const r = saveAnnotationsImpl(paths, markdown, meta);
      log(r.ok ? 'info' : 'warn', `saveAnnotations → ${r.ok ? r.path : r.error}`);
      return Promise.resolve(r);
    },
    onSaveMerged: (sets, meta) => {
      const r = saveMergedImpl(paths, sets, meta);
      log(r.ok ? 'info' : 'warn', `saveMerged → ${r.ok ? `${r.path} (${r.count} 条, ${groupsLen(sets)} 组)` : r.error}`);
      return Promise.resolve(r);
    },
    onGetInjectScript: () => getInjectScriptImpl(paths),
    onGetHidShim: () => getHidShimImpl(paths),
    onHidTrace: async () => (await loadHidBridge()).hidTraceImpl(),
    onTakeCommand: () => takeCommandImpl(paths),
    onCommandResult: (id, result) => commandResultImpl(paths, id, result),
    // ── HID 桥（R-HID：系统层直连，绕开 Chromium select-hid-device 宿主缺口）──
    onHidList: async () => (await loadHidBridge()).hidListImpl(),
    onHidOpen: async (path) => (await loadHidBridge()).hidOpenImpl(path),
    onHidRead: async (handleId, timeoutMs) => (await loadHidBridge()).hidReadImpl(handleId, timeoutMs),
    onHidWrite: async (handleId, data) => (await loadHidBridge()).hidWriteImpl(handleId, data),
    onHidClose: async (handleId) => (await loadHidBridge()).hidCloseImpl(handleId),
    onDeleteAnnotations: (p) => {
      const r = deleteAnnotationsImpl(paths, p);
      log(r.ok ? 'info' : 'warn', `deleteAnnotations → ${r.ok ? `${r.removedFile}（索引行 -${r.removedIndexEntries}）` : r.error}`);
      return Promise.resolve(r);
    },
    onGetStats: () => {
      const r = getStatsImpl(paths);
      log('info', `getStats → 批注 ${r.annotations.count} 条/${r.annotations.bytes}B，截图 ${r.shots.count} 张/${r.shots.bytes}B`);
      return Promise.resolve(r);
    },
    onClearArtifacts: (kind) => {
      const r = clearArtifactsImpl(paths, kind);
      log(r.ok ? 'info' : 'warn', `clearArtifacts(${kind}) → ${r.ok ? JSON.stringify(r.removed) : r.error}`);
      return Promise.resolve(r);
    },
  });
  try {
    if (ctx && typeof ctx.provide === 'function') {
      ctx.provide(FACE_NAME, face);
      log('info', `远端面 ${FACE_NAME} 已注册（ctx.provide）`);
    } else {
      log('warn', 'ctx.provide 不可用：远端面未注册（client 上报将失败，host 探测不受影响）');
    }
  } catch (e) {
    log('warn', `远端面注册失败（不影响 host 探测）：${msg(e)}`);
  }

  /* ---- R-TOOL：agent 一等工具注册（browser_*）----
   * 纪律：**绝不写进顶层 inject**——本插件还承载批注/截图/HID 等能力，若因 `tools` 服务缺失
   * 导致 apply 不被调用，等于全插件阵亡。故先试 ctx.tools，缺则用惰性 ctx.inject(['tools'])，
   * 两条路都失败只 warn。注册结果落 state.tools（写进 probe-report.json，便于重启后一眼定位）。 */
  try {
    const mod = await loadBrowserTools();
    const register = (scope, label) => {
      mod.registerBrowserTools(scope, paths.pluginDir, log)
        .then((diag) => {
          state.tools = { at: new Date().toISOString(), via: label, ...diag };
          log('info', `浏览器工具注册（${label}）：${diag.registered.length} 个（来源 ${diag.defineToolSource || 'n/a'}）`);
        })
        .catch((e) => { state.tools = { at: new Date().toISOString(), via: label, fatal: msg(e) }; log('warn', `浏览器工具注册失败：${msg(e)}`); });
    };
    /* 注意：cordis 下**未 inject 直接读 `ctx.tools` 会抛**「cannot get property "tools" without inject」
     * （实测 16:03:20）。所以①读服务必须包 try/catch；②真正的通路是 `ctx.inject(['tools'], cb)` 的
     * 作用域上下文——在回调里才能合法访问 `.tools`。顶层 inject 不能加（tools 缺失会让整个插件不激活）。 */
    let toolsApi = null;
    try { toolsApi = ctx ? ctx.tools : null; } catch { toolsApi = null; }
    if (toolsApi && typeof toolsApi.register === 'function') {
      register(ctx, 'ctx.tools');
    } else if (ctx && typeof ctx.inject === 'function') {
      ctx.inject(['tools'], (scoped) => register(scoped, 'ctx.inject([tools])'));
      log('info', 'ctx.tools 需 inject：已登记惰性 inject([tools])，服务就绪后自动注册');
    } else {
      state.tools = { at: new Date().toISOString(), fatal: 'ctx.tools 与 ctx.inject 都不可用' };
      log('warn', 'ctx.tools / ctx.inject 都不可用：浏览器工具未注册（命令通道照常可用）');
    }
  } catch (e) {
    state.tools = { at: new Date().toISOString(), fatal: msg(e) };
    log('warn', `浏览器工具层加载失败（不影响其它能力）：${msg(e)}`);
  }

  /* ---- host 探测异步执行（不阻塞激活） ---- */
  probe('activation').catch(() => {});

  /* ---- 卸载清理（face 随插件卸载自动撤销；这里只留 hook 位） ---- */
  try {
    if (typeof ctx?.effect === 'function') ctx.effect(() => {});
  } catch { /* 卸载清理注册失败不致命 */ }

  return { face, reportPath };
}

/* ─────────────── 测试导出（任务02：仅汇总上方既有函数引用，零逻辑改动） ─────────────── */

/** 内部纯函数助手汇总（node:test 单测专用面；单测经此取用既有实现，不复制不改写）。 */
export const _internals = {
  shapeOf,
  extractApi,
  slugify,
  tsStamp,
  dedupeFile,
  writeArtifact,
  saveShotImpl,
  saveAnnotationsImpl,
  saveMergedImpl,
  deleteAnnotationsImpl,
  getStatsImpl,
  clearArtifactsImpl,
  takeCommandImpl,
  commandResultImpl,
};

