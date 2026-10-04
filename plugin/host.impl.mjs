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
  return {
    typeof: typeof mod,
    keys: keys(mod),
    hasDefault: !!(mod && typeof mod === 'object' && 'default' in mod),
    defaultKeys: mod && typeof mod === 'object' ? keys(mod.default) : null,
  };
}

/** 从 import/require 的各种返回形状里挑出带 webContents/app 的 API 对象。 */
function extractApi(mod) {
  for (const c of [mod, mod && mod.default, mod && mod.default && mod.default.default]) {
    if (c && typeof c === 'object' && (c.webContents || c.app)) return c;
  }
  return null;
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
  try {
    const require = createRequire(import.meta.url);
    const mod = require('electron');
    record.cjsShape = shapeOf(mod);
    const api = extractApi(mod);
    if (api) {
      record.strategy = 'cjs-require';
      record.ok = true;
      return api;
    }
    record.cjsEmpty = 'require 成功但无 webContents/app（形状见 cjsShape 字段）';
  } catch (e) {
    record.cjsError = msg(e);
  }
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
    app: null,
    webContents: null,
    guestProbe: [],
  };

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
  const state = { implLoadedAt: new Date().toISOString(), host: null, client: null, clientReceivedAt: null };

  log('info', `MVP-0 探测激活（impl ${state.implLoadedAt}；报告 → ${reportPath}）`);

  /* ---- face 注册（typertGateway SRC 兜底路径；typert-loader 路径靠 exports["./typert"] 自动发现） ---- */
  const face = createRemoteFace({
    onReport: (findings) => {
      state.client = findings && typeof findings === 'object' ? findings : { raw: String(findings) };
      state.clientReceivedAt = new Date().toISOString();
      writeReport(reportPath, state, 'client report received');
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
  runHostProbe(reportPath, state).catch((e) => {
    state.host = { at: new Date().toISOString(), fatal: msg(e) };
    writeReport(reportPath, state, 'host probe threw');
    log('warn', `host 探测异常：${msg(e)}`);
  });

  /* ---- 卸载清理（face 随插件卸载自动撤销；这里只留 hook 位） ---- */
  try {
    if (typeof ctx?.effect === 'function') ctx.effect(() => {});
  } catch { /* 卸载清理注册失败不致命 */ }

  return { face, reportPath };
}
