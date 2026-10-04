/**
 * @local/dsh-browser-kit —— Host 业务实现（由 index.js 薄壳按 mtime+seq 动态 import，见其头注）。
 *
 * MVP-0 探测（调研文档 §5.1 / README §3 第一步）：
 *  - Path B 验证：host 插件能否加载 `electron`、枚举 webContents、找到 webview guest，
 *    并对 guest 调 executeJavaScript / capturePage / debugger(Page.captureScreenshot fullPage)；
 *  - 结果落盘 probe-report.json（host 发现 + client 上报合并），供实施会话读取；
 *  - 注册最小远端面 `dshBrowserKit.reportClient`（wire.host.mjs），接收 client 半边的探测结果。
 *
 * 激活安全：任何异常只记录不抛（绝不阻塞 cordis 激活；同 zcode-dispatch 纪律）。零 npm 依赖。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createRemoteFace, FACE_NAME } from './wire.host.mjs';

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
    mkdirSync(dirnameCompat(reportPath), { recursive: true });
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
          typertService: FACE_NAME,
          host: state.host,
          client: state.client,
          clientReceivedAt: state.clientReceivedAt,
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

function dirnameCompat(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : '.';
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

/**
 * impl 入口（index.js 薄壳动态调用）。
 * @param {object} ctx cordis Context
 * @param {object} _config 插件 config（本插件暂无字段）
 * @param {{ pluginDir: string, reportPath: string }} paths 薄壳解析的路径
 */
export function apply(ctx, _config = {}, paths = {}) {
  const log = makeLogger(ctx);
  const reportPath = paths.reportPath;
  const state = {
    implLoadedAt: new Date().toISOString(),
    host: null,
    client: null,
    clientReceivedAt: null,
    probeRuns: 0,
    probing: false,
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

  log('info', `MVP-0 探测激活（impl ${state.implLoadedAt}；报告 → ${reportPath}）`);

  /* ---- face 注册（typertGateway SRC 兜底路径；typert-loader 路径靠 exports["./typert"] 自动发现） ---- */
  const face = createRemoteFace({
    onReport: (findings) => {
      const hadGuests = Array.isArray(state.client?.webviews) && state.client.webviews.length > 0;
      state.client = findings && typeof findings === 'object' ? findings : { raw: String(findings) };
      state.clientReceivedAt = new Date().toISOString();
      writeReport(reportPath, state, 'client report received');
      // client 发现了 webview 而上一轮 host 探测没采到 guest（guest 晚于激活出现）→ 补一轮
      const nowHasGuests = Array.isArray(state.client?.webviews) && state.client.webviews.length > 0;
      if (nowHasGuests && !hadGuests) probe('client-report-guests').catch(() => {});
      return Promise.resolve({ ok: true, savedAt: state.clientReceivedAt });
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

  /* ---- host 探测异步执行（不阻塞激活） ---- */
  probe('activation').catch(() => {});

  /* ---- 卸载清理（face 随插件卸载自动撤销；这里只留 hook 位） ---- */
  try {
    if (typeof ctx?.effect === 'function') ctx.effect(() => {});
  } catch { /* 卸载清理注册失败不致命 */ }

  return { face, reportPath };
}
