/**
 * @local/dsh-browser-kit —— Client 半边：MVP-0 webview 探测（Path A 验证）。
 *
 * 职责（全部兜底，任何异常不许冒泡——冒泡 = 条目激活失败 = web boot 失败）：
 *  1. 在 GUI 文档里 `document.querySelectorAll('webview')`，记录数量/属性/方法存在性；
 *  2. 对第一个可用 guest 实测 `executeJavaScript('1+1')` / `capturePage()` / `getWebContentsId()`；
 *  3. 结果四路出口：`window.__dshKitProbe`（页面全局契约）+ localStorage 镜像 +
 *     `ctx.remote.dshBrowserKit.reportClient()` 上报 host 半边落盘 + 左下角诊断小面板（用户可见）；
 *  4. MutationObserver 监听 webview 挂载（lease guest 打开时自动补测）；
 *  5. 「重新探测」按钮 + 手动「上报 host」按钮。
 *
 * 形态照抄 @local/zcode-dispatch/client.js（本机已验证）：window.__ModuleLoader__.load +
 * React.createElement + inject ['slots','remote','typert']（typert 是 $mount 的硬依赖）。
 * 样式只走主题令牌（--dsw-alias-* / --dsw-shadow-lv3 / --ds-font-family-code），零字面色值。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-browser-kit',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    /* ─────────────── 常量 ─────────────── */
    const SLOT = 'shell.overlay';
    const PANEL_ID = 'dsh-browser-kit.probe';
    const FACE_NAME = 'dshBrowserKit';
    const LS_KEY = 'dsh-browser-kit:probe:v1';
    const LOG_PREFIX = '[dsh-browser-kit]';
    const MAX_AUTO_REPROBE = 12; // 自动补测上限（防意外循环）
    const REMOTE_CONTRIBUTION = {
      package: '@local/dsh-browser-kit',
      descriptors: [
        ['reportClient', ['findings'], 'reportClient(findings): Promise<{ok:true, savedAt}|{ok:false, error}>', []],
        ['saveShot', ['meta', 'dataUrl'], 'saveShot(meta, dataUrl): Promise<{ok:true, path, bytes}|{ok:false, error}>', []],
        ['saveAnnotations', ['markdown', 'meta'], 'saveAnnotations(markdown, meta?): Promise<{ok:true, path, bytes}|{ok:false, error}>', ['meta']],
        ['getInjectScript', [], 'getInjectScript(): Promise<{ok:true, source, mtime, bytes}|{ok:false, error}>', []],
        ['takeCommand', [], 'takeCommand(): Promise<{ok:true, command}|{ok:false, error}>（command=null 表示无命令）', []],
        ['commandResult', ['id', 'result'], 'commandResult(id, result): Promise<{ok:true}|{ok:false, error}>', []],
      ].map(([method, parameters, , optionals]) => ({
        id: `@local/dsh-browser-kit#${FACE_NAME}/${method}`,
        service: FACE_NAME,
        namespace: FACE_NAME,
        method,
        invocation: { kind: 'direct' },
        parameters: parameters.map((name) => ({
          name,
          wire: name,
          source: 'json',
          ...(optionals.includes(name) ? { acceptsUndefined: true } : {}),
          codec: {
            mode: 'strict',
            typeSymbol: `@local/dsh-browser-kit#${FACE_NAME}/${method}:${name}`,
            create: () => ({ parse: (value) => value }),
          },
        })),
        result: {
          mode: 'strict',
          typeSymbol: `@local/dsh-browser-kit#${FACE_NAME}/${method}:result`,
          create: () => ({ parse: (value) => value }),
        },
      })),
    };

    /* ─────────────── 主题令牌（唯一字面出口，与 zcode-dispatch 同源核对） ─────────────── */
    const T = {
      bg: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, inherit))',
      border: 'var(--dsw-alias-border-l2, var(--dsw-alias-border-l1, transparent))',
      shadow: 'var(--dsw-shadow-lv3, 0 10px 28px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.10))',
      text: 'var(--dsw-alias-label-primary, currentColor)',
      text2: 'var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, currentColor))',
      text3: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, currentColor))',
      accent: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, currentColor))',
      onAccent: 'var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-layer-1, inherit))',
      danger: 'var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary, currentColor))',
      ok: 'var(--dsw-alias-state-success-primary, var(--dsw-alias-label-primary, currentColor))',
      warn: 'var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-primary, currentColor))',
      hover: 'var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3, transparent))',
      mono: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace)',
    };
    const STYLE_ID = 'dsh-browser-kit-probe-style';

    const say = (level, text) => {
      try {
        console[level === 'info' ? 'info' : level](`${LOG_PREFIX} ${text}`);
      } catch { /* 连 console 都没有就静默 */ }
    };
    const msgOf = (e) => (e && e.message ? e.message : String(e));

    /* ─────────────── 探测核心 ─────────────── */

    /** 优先选 lease guest（src=about:blank#<leaseId>），否则第一个；platform view 靠后。 */
    function pickProbeTarget(els) {
      const lease = els.filter((el) => String(el.getAttribute('src') || '').startsWith('about:blank#'));
      const pool = lease.length > 0 ? lease : els;
      return pool[0] || null;
    }

    /** 同步收集全部 webview 的静态信息。 */
    function collectStatics(els) {
      return els.slice(0, 4).map((el) => ({
        src: el.getAttribute('src'),
        name: el.getAttribute('name'),
        partition: el.getAttribute('partition'),
        constructorName: (el.constructor && el.constructor.name) || 'unknown',
        methods: {
          executeJavaScript: typeof el.executeJavaScript,
          capturePage: typeof el.capturePage,
          getWebContentsId: typeof el.getWebContentsId,
        },
      }));
    }

    /** 对第一个可用 guest 实测三个能力（各自独立 try/catch）。 */
    async function probeGuest(el) {
      const out = {};
      if (typeof el.getWebContentsId === 'function') {
        try {
          out.webContentsId = { ok: true, value: el.getWebContentsId() };
        } catch (e) {
          out.webContentsId = { ok: false, error: msgOf(e) };
        }
      } else {
        out.webContentsId = { ok: false, error: '方法不存在' };
      }
      if (typeof el.executeJavaScript === 'function') {
        try {
          const v = await el.executeJavaScript('1+1', true);
          out.executeJavaScript = { ok: true, value: v };
        } catch (e) {
          out.executeJavaScript = { ok: false, error: msgOf(e) };
        }
      } else {
        out.executeJavaScript = { ok: false, error: '方法不存在' };
      }
      if (typeof el.capturePage === 'function') {
        try {
          const img = await el.capturePage();
          out.capturePage = {
            ok: true,
            size: img && img.getSize ? img.getSize() : null,
            dataUrlLength: img && img.toDataURL ? img.toDataURL().length : null,
          };
        } catch (e) {
          out.capturePage = { ok: false, error: msgOf(e) };
        }
      } else {
        out.capturePage = { ok: false, error: '方法不存在' };
      }
      return out;
    }

    /** 跑一轮完整探测，产出 findings 对象（四路出口共用）。 */
    async function runProbe() {
      const findings = {
        at: new Date().toISOString(),
        href: safeValue(() => location.href),
        world: {
          hasModuleLoader: typeof window.__ModuleLoader__ !== 'undefined',
          hasDshBoot: typeof window.__DSH_BOOT__ !== 'undefined',
        },
        webviewCount: 0,
        statics: [],
        guest: null,
        error: null,
      };
      try {
        const els = Array.from(document.querySelectorAll('webview'));
        findings.webviewCount = els.length;
        findings.statics = collectStatics(els);
        const target = pickProbeTarget(els);
        if (target) findings.guest = await probeGuest(target);
      } catch (e) {
        findings.error = msgOf(e);
      }
      // 面板诊断：渲染崩溃原因随探测上报（PanelBoundary 写入）
      try {
        findings.panelError = typeof window.__dshKitPanelError === 'string' ? window.__dshKitPanelError : null;
      } catch { /* ignore */ }
      return findings;
    }

    function safeValue(fn) {
      try {
        return fn();
      } catch (e) {
        return `<error: ${msgOf(e)}>`;
      }
    }

    /* ─────────────── host 上报（$mount + 子 fiber 取命名空间） ─────────────── */

    /** 官方信封 {ok,value}/{ok:false,error} 与进程域形状双兼容拆包。 */
    function unwrap(raw) {
      if (raw && typeof raw === 'object' && typeof raw.ok === 'boolean' && 'value' in raw) {
        return raw.ok ? raw.value : { ok: false, error: (raw.error && raw.error.message) || String(raw.error ?? 'remote error') };
      }
      return raw;
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /**
     * 上报实现。要点（zcode-dispatch 同款纪律）：**顶层 ctx 不许直取 ctx.remote.dshBrowserKit**
     * —— cordis 守卫会抛 `cannot get property "remote.dshBrowserKit" without inject`（2026-10-04
     * 实测）；必须在 apply 里声明 `remote.$mount`（挂载）+ 子 fiber `ctx.inject(['remote.<名>'])`
     *（在子作用域内合法访问），把就绪的服务存进 stateRef.remoteSvc 后从这里拿。
     */
    async function reportToHost(stateRef, findings) {
      const result = { attempted: false, mounted: null, response: null, error: null };
      try {
        result.attempted = true;
        // $mount 未成功时不再重复挂载（apply 里已挂过）；这里只等服务就绪
        let svc = stateRef.getRemote ? stateRef.getRemote() : null;
        for (let i = 0; i < 27 && !svc; i++) {
          await sleep(300);
          svc = stateRef.getRemote ? stateRef.getRemote() : null;
        }
        result.mounted = stateRef.mountError
          ? `mount失败:${stateRef.mountError}`
          : stateRef.mountOk
            ? 'ok'
            : 'pending';
        if (!svc || typeof svc.reportClient !== 'function') {
          result.error = `remote.${FACE_NAME} 未就绪（mount=${result.mounted}）`;
          return result;
        }
        result.response = unwrap(await svc.reportClient(findings));
      } catch (e) {
        result.error = msgOf(e);
      }
      return result;
    }

    /* ─────────────── 本地镜像 ─────────────── */

    function mirrorLocally(findings) {
      try {
        window.__dshKitProbe = findings; // 页面全局契约（后续工具直接读）
      } catch { /* ignore */ }
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(findings));
      } catch { /* 隐私模式等场景静默 */ }
    }

    /* ─────────────── 面板 ─────────────── */

    const fmtResult = (r) => {
      if (!r) return '未测';
      return r.ok ? `OK ${JSON.stringify(r.value ?? r.size ?? r.dataUrlLength ?? '')}` : `FAIL ${r.error || ''}`;
    };

    /** 渲染错误边界：面板崩溃时就地显示原因 + 写入 window.__dshKitPanelError（随探测上报定位）。 */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { err: null };
      }
      static getDerivedStateFromError(e) {
        return { err: e };
      }
      componentDidCatch(e) {
        try {
          window.__dshKitPanelError = `面板渲染崩溃：${(e && e.message) || String(e)}`;
        } catch { /* ignore */ }
        say('error', window.__dshKitPanelError || '面板渲染崩溃');
      }
      render() {
        if (this.state.err) {
          return h('div', { style: { padding: '8px 10px', color: T.danger, fontSize: 11 } },
            `面板渲染出错：${(this.state.err && this.state.err.message) || '未知'}`);
        }
        return this.props.children;
      }
    }

    function ProbePanel({ stateRef, getState, actions }) {
      const [, force] = useState(0);
      useEffect(() => {
        const t = setInterval(() => force((n) => n + 1), 1500);
        return () => clearInterval(t);
      }, []);
      const s = getState();
      const f = s.findings;
      return h(
        'div',
        {
          style: {
            pointerEvents: 'auto',
            position: 'fixed', // 浮层默认从左上排布——钉到左下角（与 zcode-dispatch 右下角面板对称）
            left: 16,
            bottom: 16,
            zIndex: 2000000000,
            background: T.bg,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            boxShadow: T.shadow,
            color: T.text,
            width: 300,
            maxHeight: '52vh',
            overflow: 'auto',
            fontSize: 12,
            lineHeight: 1.5,
            userSelect: 'text',
          },
        },
        h(
          'div',
          { style: { padding: '8px 10px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 8 } },
          h('strong', { style: { fontSize: 12 } }, 'dsh-browser-kit'),
          h('span', { style: { color: T.text3, marginLeft: 'auto' } }, f ? new Date(f.at).toLocaleTimeString() : '—'),
          h(
            'button',
            {
              onClick: actions.collapse,
              title: '最小化（调试面板；正式版默认隐藏）',
              style: {
                border: 0, background: 'transparent', color: T.text3, cursor: 'pointer',
                fontSize: 12, padding: '0 2px', lineHeight: 1,
              },
            },
            '—',
          ),
        ),
        !s.collapsed
          ? h(
              'div',
              { style: { padding: '8px 10px', display: 'grid', gap: 4 } },
              !f
                ? h('div', { style: { color: T.text2 } }, '探测中…')
                : h(
                    React.Fragment,
                    null,
                    h('div', null, 'webview 数量：', h('b', null, String(f.webviewCount))),
                    f.webviewCount === 0
                      ? h('div', { style: { color: T.warn } }, '尚未发现 webview——打开内置浏览器后自动补测。')
                      : h(
                          React.Fragment,
                          null,
                          h('div', { style: { color: T.text2, fontFamily: T.mono, fontSize: 11 } },
                            `#1 src=${(f.statics && f.statics[0] && f.statics[0].src) || '—'}`),
                          f.guest && h('div', null, 'getWebContentsId：',
                            h('span', { style: { color: f.guest.webContentsId && f.guest.webContentsId.ok ? T.ok : T.danger } }, fmtResult(f.guest.webContentsId))),
                          f.guest && h('div', null, 'executeJavaScript：',
                            h('span', { style: { color: f.guest.executeJavaScript && f.guest.executeJavaScript.ok ? T.ok : T.danger } }, fmtResult(f.guest.executeJavaScript))),
                          f.guest && h('div', null, 'capturePage：',
                            h('span', { style: { color: f.guest.capturePage && f.guest.capturePage.ok ? T.ok : T.danger } }, fmtResult(f.guest.capturePage))),
                        ),
                  f.error && h('div', { style: { color: T.danger } }, `探测错误：${f.error}`),
                h('div', { style: { color: T.text3, borderTop: `1px solid ${T.border}`, paddingTop: 4 } },
                  '批注：',
                  h('span', { style: { color: s.annot && s.annot.active ? T.warn : T.text3 } },
                    s.annot && s.annot.active
                      ? `进行中 · ${s.annot.count} 条（页面点元素留意见，面板提交）`
                      : (s.annot && s.annot.lastSaved ? `已保存 ↓` : '未开始')),
                ),
                s.annot && s.annot.lastSaved && h('div', {
                  style: { color: T.text2, fontFamily: T.mono, fontSize: 10, wordBreak: 'break-all', cursor: 'pointer' },
                  title: '点击复制路径',
                  onClick: () => {
                    try {
                      navigator.clipboard.writeText(s.annot.lastSaved.path);
                    } catch { /* 剪贴板不可用静默 */ }
                  },
                }, s.annot.lastSaved.path),
                s.annot && s.annot.error && h('div', { style: { color: T.danger, fontSize: 11 } }, s.annot.error),
                h('div', { style: { color: T.text3, borderTop: `1px solid ${T.border}`, paddingTop: 4 } },
                  '截图：',
                  h('span', { style: { color: s.lastShot ? (s.lastShot.ok ? T.ok : T.danger) : T.text3 } },
                    s.lastShot
                      ? (s.lastShot.ok ? '已保存 ↓' : `失败 ${s.lastShot.error}`)
                      : '未截'),
                ),
                s.lastShot && s.lastShot.ok && h('div', {
                  style: { color: T.text2, fontFamily: T.mono, fontSize: 10, wordBreak: 'break-all' },
                  title: '点击复制路径',
                  onClick: () => {
                    try {
                      navigator.clipboard.writeText(s.lastShot.path);
                    } catch { /* 剪贴板不可用静默 */ }
                  },
                }, s.lastShot.path),
                h('div', { style: { color: T.text3, borderTop: `1px solid ${T.border}`, paddingTop: 4 } },
                  'host 上报：',
                  h('span', { style: { color: s.report && s.report.response && s.report.response.ok ? T.ok : (s.report && s.report.error ? T.danger : T.text3) } },
                    s.report
                      ? (s.report.response && s.report.response.ok
                        ? `已落盘 ${s.report.response.savedAt || ''}`
                        : `失败 ${s.report.error || (s.report.response && s.report.response.error) || ''}`)
                      : '未上报'),
                ),
              ),
            )
          : null,
        h(
          'div',
          { style: { padding: '8px 10px', borderTop: `1px solid ${T.border}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          /* ZCode 式单图标开关：点击在当前页面开启批注，再点关闭；激活态实心底 + 批注数徽标 */
          h(
            'button',
            {
              onClick: actions.toggleAnnot,
              title: (s.annot && s.annot.active)
                ? '批注进行中——点击关闭（已收集批注保留，可再开启继续提交）'
                : '在当前页面开启批注：点元素 → 就地留意见 → 页内面板提交',
              style: {
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                width: 30,
                height: 26,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: 0,
                background: (s.annot && s.annot.active) ? T.accent : T.hover,
                color: (s.annot && s.annot.active) ? T.onAccent : T.text,
                cursor: 'pointer',
              },
            },
            h(
              'svg',
              { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': true },
              h('path', {
                d: 'M4 4h16v12H9l-5 4V4z',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2,
                strokeLinejoin: 'round',
              }),
              h('path', {
                d: 'M12 7.5v5M9.5 10h5',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2,
                strokeLinecap: 'round',
              }),
            ),
            (s.annot && s.annot.active && s.annot.count > 0)
              ? h('span', { style: { fontSize: 10, fontWeight: 700 } }, String(s.annot.count))
              : null,
          ),
          h(
            'button',
            {
              onClick: actions.captureShot,
              style: {
                border: `1px solid ${T.border}`, borderRadius: 6, padding: '3px 10px',
                background: T.hover, color: T.text, cursor: 'pointer', fontSize: 12,
              },
            },
            '截图',
          ),
          h(
            'button',
            {
              onClick: actions.reportNow,
              style: {
                border: `1px solid ${T.border}`, borderRadius: 6, padding: '3px 10px',
                background: T.hover, color: T.text, cursor: 'pointer', fontSize: 12,
              },
            },
            '上报',
          ),
          h(
            'button',
            {
              onClick: actions.reprobe,
              style: {
                border: `1px solid ${T.border}`, borderRadius: 6, padding: '3px 10px',
                background: T.hover, color: T.text, cursor: 'pointer', fontSize: 12,
              },
            },
            '探测',
          ),
        ),
      );
    }

    /* ─────────────── 入口 ─────────────── */

    return {
      inject: ['slots', 'remote', 'typert'],
      apply(ctx) {
        try {
          const stateRef = {
            findings: null,
            report: null,
            lastShot: null,
            annot: null, // { active, count, startedAt, lastSaved, error }
            autoLeft: MAX_AUTO_REPROBE,
            autoShotLeft: 1, // 自动截图仅一次（MVP-1 验收），手动截图不限
            mountAttempted: false,
            mountOk: false,
            mountError: null,
            remoteSvc: null,
            getRemote: () => stateRef.remoteSvc,
          };

          /* ---- $mount：把 remote.dshBrowserKit 命名空间挂到本包（apply 时立即做，结果留痕） ---- */
          try {
            const mount = ctx?.remote && ctx.remote.$mount;
            if (typeof mount === 'function') {
              stateRef.mountAttempted = true;
              const mounted = mount.call(ctx.remote, REMOTE_CONTRIBUTION);
              Promise.resolve(mounted).then(
                () => {
                  stateRef.mountOk = true;
                  say('info', `$mount 成功：remote.${FACE_NAME} 已本地挂载`);
                },
                (e) => {
                  stateRef.mountError = msgOf(e);
                  say('warn', `$mount 失败：${stateRef.mountError}`);
                },
              );
            } else {
              stateRef.mountError = 'ctx.remote.$mount 不可用';
            }
          } catch (e) {
            stateRef.mountError = msgOf(e);
          }

          /* ---- 子 fiber 等命名空间就绪（顶层直取会被 cordis 守卫拒：without inject） ---- */
          try {
            if (typeof ctx?.inject === 'function') {
              ctx.inject([`remote.${FACE_NAME}`], (scope) => {
                try {
                  const svc = scope && scope.remote && scope.remote[FACE_NAME];
                  if (svc && typeof svc.reportClient === 'function') {
                    stateRef.remoteSvc = svc;
                    say('info', `remote.${FACE_NAME} 就绪（子 fiber）`);
                    if (scope && typeof scope.effect === 'function') {
                      scope.effect(() => () => {
                        if (stateRef.remoteSvc === svc) stateRef.remoteSvc = null;
                      }, 'dsh-browser-kit.namespace');
                    }
                  }
                } catch { /* 就绪回调异常不影响条目 */ }
              });
            }
          } catch { /* 子 fiber 建立失败：上报时按「未就绪」如实报告 */ }

          const probeAndPublish = async (trigger) => {
            const findings = await runProbe();
            stateRef.findings = findings;
            mirrorLocally(findings);
            say('info', `探测(${trigger})：webview=${findings.webviewCount} guest=${findings.guest ? 'yes' : 'no'}`);
            return findings;
          };

          /* ─────────────── MVP-2 批注模式（src/element-annotator.js 注入 guest） ─────────────── */

          let annotSourceCache = null; // { mtime, source }

          /** 取当前批注目标 guest（lease 优先；无 guest 抛可读错误）。 */
          const pickGuestEl = () => {
            const els = Array.from(document.querySelectorAll('webview'));
            const target = pickProbeTarget(els);
            if (!target) throw new Error('无 webview（先打开内置浏览器）');
            return target;
            };

          /** 确保批注层已注入（重复注入会打断活动会话，故先查 API 存在性）。 */
          const ensureAnnotator = async (svc) => {
            const target = pickGuestEl();
            const has = await target.executeJavaScript('typeof window.__dshKitAnnotator !== "undefined" && typeof window.__dshKitAnnotator.start === "function"', true);
            if (has === true) return target;
            if (!annotSourceCache) {
              const g = unwrap(await svc.getInjectScript());
              if (!g || g.ok === false) throw new Error(`getInjectScript 失败：${(g && g.error) || '未知'}`);
              annotSourceCache = { mtime: g.mtime, source: g.source };
              say('info', `批注层源已获取（${g.bytes} 字节，mtime ${g.mtime}）`);
            }
            await target.executeJavaScript(annotSourceCache.source, true);
            const ok = await target.executeJavaScript('typeof window.__dshKitAnnotator !== "undefined"', true);
            if (ok !== true) throw new Error('批注层注入后 API 缺失');
            return target;
          };

          /** 批注会话主流程：start 的 Promise 由 executeJavaScript await，提交后 payload 走全局暂存桥。 */
          const startAnnotSession = async () => {
            if (stateRef.annot && stateRef.annot.active) return { ok: false, error: '批注会话进行中' };
            const svc = await waitSvc();
            if (!svc) return { ok: false, error: 'host 远端面未就绪' };
            const target = await ensureAnnotator(svc);
            stateRef.annot = { active: true, count: 0, startedAt: new Date().toISOString(), lastSaved: null, error: null };
            // 批注条数轮询（面板实时显示）
            stateRef.annot.timer = setInterval(() => {
              target.executeJavaScript('(window.__dshKitAnnotator && window.__dshKitAnnotator.list ? window.__dshKitAnnotator.list().length : -1)', true)
                .then((n) => { if (stateRef.annot) stateRef.annot.count = n; })
                .catch(() => {});
            }, 1200);
            say('info', '批注会话开始（在页面里点元素 → 留意见 → 面板提交 / Esc 取消）');
            let how = 'cancelled';
            try {
              how = await target.executeJavaScript(
                'window.__dshKitLastSubmit = undefined; window.__dshKitAnnotator.start({ onSubmit: function (r) { window.__dshKitLastSubmit = r; } })',
                true,
              );
            } catch (e) {
              how = `error:${msgOf(e)}`;
            }
            clearInterval(stateRef.annot.timer);
            stateRef.annot.active = false;
            let saved = null;
            if (how === 'submitted') {
              try {
                const r = await target.executeJavaScript('window.__dshKitLastSubmit', true);
                if (r && typeof r.markdown === 'string') {
                  let meta = null;
                  try {
                    const m = await target.executeJavaScript('({ url: location.href, title: document.title })', true);
                    if (m && typeof m === 'object') meta = { url: m.url ?? m.href ?? null, title: m.title ?? null };
                  } catch { /* 元数据失败不拦保存 */ }
                  const sr = unwrap(await svc.saveAnnotations(r.markdown, meta));
                  saved = sr && sr.ok ? sr : null;
                  stateRef.annot.lastSaved = saved;
                  if (!saved) say('warn', `saveAnnotations 失败：${(sr && sr.error) || '未知'}`);
                }
              } catch (e) {
                say('warn', `取回提交结果失败：${msgOf(e)}`);
              }
            }
            say('info', `批注会话结束（${how}${saved ? `，已保存 ${saved.path}` : ''}）`);
            return { ok: true, how, saved };
          };

          const stopAnnotSession = async () => {
            const target = pickGuestEl();
            await target.executeJavaScript('(window.__dshKitAnnotator && window.__dshKitAnnotator.stop ? window.__dshKitAnnotator.stop() : undefined)', true);
            return { ok: true };
          };

          /* ─────────────── MVP-4 种子：命令通道（实施会话写 .data/command.json 驱动） ─────────────── */

          let cmdBusy = false;
          /** guest 内取「自动化目标文档」：优先 kit 沙箱 iframe（page-open 建立），否则顶层。 */
          const TARGET_DOC_SNIPPET =
            'var DOC = (function () { var f = document.querySelector("iframe[data-dsh-kit-frame]"); try { return f && f.contentDocument ? f.contentDocument : document; } catch (e) { return document; } })();';
          const executeCommand = async (svc, command) => {
            const c = command && typeof command === 'object' ? command : {};
            const action = String(c.action || '');
            try {
              switch (action) {
                case 'inject-annotator': {
                  await ensureAnnotator(svc);
                  return { ok: true, injected: true };
                }
                case 'start-annotator': {
                  // 不能 await：会话直到提交/Esc 才结束，await 会卡死命令轮询（cmdBusy）
                  startAnnotSession().then((r) => {
                    say('info', `批注会话（命令触发）收尾：${JSON.stringify(r).slice(0, 120)}`);
                  }).catch(() => {});
                  return { ok: true, started: true };
                }
                case 'stop-annotator': {
                  return await stopAnnotSession();
                }
                case 'annotator-status': {
                  const target = pickGuestEl();
                  const st = await target.executeJavaScript('(function(){ if (typeof window.__dshKitAnnotator === "undefined") return { injected: false }; return { injected: true, count: window.__dshKitAnnotator.list().length, first: window.__dshKitAnnotator.list()[0] || null }; })()', true);
                  return { ok: true, ...st };
                }
                case 'guest-eval': {
                  // MVP-4：agent 侧任意求值；frame:true 时在 kit 沙箱文档内执行。
                  // 注意：document 必须经【函数参数】传入（参数遮蔽安全）；函数体内 var document
                  // 会因提升让全函数体的 document 变 undefined（cmd-72/73 实测自坑，P23）。
                  const target = pickGuestEl();
                  const docPre = c.frame ? TARGET_DOC_SNIPPET : '';
                  const code = String(c.code || '');
                  const value = await target.executeJavaScript(
                    `(function () { ${docPre} return (function (document) {\n${code}\n})(DOC || document); })()`,
                    true,
                  );
                  return { ok: true, value };
                }
                case 'page-open': {
                  // MVP-4：iframe srcdoc 沙箱——独立 document（免疫宿主 SPA 重渲染，cmd-70 教训）、
                  // 不触发导航白名单（cmd-68 实测）、无 document.open 解析器悬挂（P22）。
                  // 重复调用 = 换页；page-close 移除沙箱恢复原页面视图。
                  const target = pickGuestEl();
                  const html = String(c.html || '');
                  if (!html) return { ok: false, error: '需要 html' };
                  const value = await target.executeJavaScript(
                    `(function () {\n` +
                    `  var old = document.querySelector('iframe[data-dsh-kit-frame]');\n` +
                    `  if (old) old.remove();\n` +
                    `  var fi = document.createElement('iframe');\n` +
                    `  fi.setAttribute('data-dsh-kit-frame', '');\n` +
                    `  fi.setAttribute('title', 'dsh-browser-kit sandbox');\n` +
                    `  fi.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff;z-index:2147483000;';\n` +
                    `  fi.srcdoc = ${JSON.stringify(html)};\n` +
                    `  (document.body || document.documentElement).appendChild(fi);\n` +
                    `  return { opened: true };\n` +
                    `})()`,
                    true,
                  );
                  return { ok: true, ...(value || {}) };
                }
                case 'page-close': {
                  const target = pickGuestEl();
                  const value = await target.executeJavaScript(
                    `(function () { var old = document.querySelector('iframe[data-dsh-kit-frame]'); if (old) old.remove(); return { closed: true }; })()`,
                    true,
                  );
                  return { ok: true, ...(value || {}) };
                }
                case 'dom-scan': {
                  // 诊断：扫描 GUI 页（非 guest）里含 webview 的容器结构，定位浏览器工具条 DOM。
                  // 只读，不改任何宿主节点。depth 限制防日志爆炸。
                  const outline = (el, depth, maxDepth) => {
                    if (!el || depth > maxDepth) return null;
                    const r = { tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 80) };
                    if (el.id) r.id = el.id;
                    if (el.getAttribute('aria-label')) r.aria = el.getAttribute('aria-label');
                    if (el.title) r.title = el.title;
                    const kids = [];
                    for (const c of el.children) {
                      const k = outline(c, depth + 1, maxDepth);
                      if (k) kids.push(k);
                    }
                    if (kids.length) r.children = kids;
                    return r;
                  };
                  const wv = document.querySelector('webview');
                  if (!wv) return { ok: false, error: '无 webview' };
                  // 自 webview 向上找 4 层容器，再从该容器向下展开 6 层
                  let host = wv;
                  for (let i = 0; i < 4 && host.parentElement; i++) host = host.parentElement;
                  return { ok: true, tree: outline(host, 0, 6) };
                }
                case 'snapshot': {
                  // MVP-4：可交互元素快照（ref 手柄落在 data-dsh-kit-ref，供 click/type 引用）
                  const target = pickGuestEl();
                  const value = await target.executeJavaScript(
                    '(function () {\n' +
                    `  ${TARGET_DOC_SNIPPET}\n` +
                    "  var SELS = 'a[href],button,input,textarea,select,[role=\"button\"],[role=\"link\"],[role=\"checkbox\"],[role=\"tab\"],h1,h2,h3,h4';\n" +
                    '  var els = Array.prototype.slice.call(DOC.querySelectorAll(SELS));\n' +
                    '  var out = [];\n' +
                    '  for (var i = 0; i < els.length && out.length < 120; i++) {\n' +
                    '    var el = els[i];\n' +
                    '    var r = el.getBoundingClientRect();\n' +
                    '    if (r.width === 0 && r.height === 0) continue;\n' +
                    '    if (el.closest && el.closest("[data-dsh-kit-ui]")) continue;\n' +
                    '    var ref = out.length + 1;\n' +
                    '    el.setAttribute("data-dsh-kit-ref", String(ref));\n' +
                    "    out.push({ ref: ref, tag: el.tagName.toLowerCase(), id: el.id || null,\n" +
                    "      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),\n" +
                    "      placeholder: el.getAttribute('placeholder') || null,\n" +
                    "      type: el.getAttribute('type') || null,\n" +
                    "      value: (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? String(el.value || '').slice(0, 60) : null });\n" +
                    '  }\n' +
                    '  return { url: location.href, title: document.title, count: out.length, items: out };\n' +
                    '})()',
                    true,
                  );
                  return { ok: true, ...(value || {}) };
                }
                case 'click': {
                  const target = pickGuestEl();
                  const sel = c.ref != null ? `[data-dsh-kit-ref="${Number(c.ref)}"]` : String(c.selector || '');
                  if (!sel) return { ok: false, error: '需要 ref 或 selector' };
                  const value = await target.executeJavaScript(
                    `(function () { ${TARGET_DOC_SNIPPET} var el = DOC.querySelector(${JSON.stringify(sel)}); if (!el) return { ok: false, error: 'no element' }; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 })); return { ok: true, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 60) }; })()`,
                    true,
                  );
                  return { ok: true, ...(value || {}) };
                }
                case 'type': {
                  const target = pickGuestEl();
                  const sel = c.ref != null ? `[data-dsh-kit-ref="${Number(c.ref)}"]` : String(c.selector || '');
                  if (!sel) return { ok: false, error: '需要 ref 或 selector' };
                  const text = String(c.text ?? '');
                  const value = await target.executeJavaScript(
                    `(function () {\n` +
                    `  ${TARGET_DOC_SNIPPET}\n` +
                    `  var el = DOC.querySelector(${JSON.stringify(sel)});\n` +
                    `  if (!el) return { ok: false, error: 'no element' };\n` +
                    `  el.focus();\n` +
                    `  var text = ${JSON.stringify(text)};\n` +
                    `  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {\n` +
                    `    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;\n` +
                    `    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);\n` +
                    `    el.dispatchEvent(new Event('input', { bubbles: true }));\n` +
                    `    el.dispatchEvent(new Event('change', { bubbles: true }));\n` +
                    `    return { ok: true, value: el.value };\n` +
                    `  }\n` +
                    `  if (el.isContentEditable) { el.textContent = text; el.dispatchEvent(new Event('input', { bubbles: true })); return { ok: true }; }\n` +
                    `  return { ok: false, error: 'not editable' };\n` +
                    `})()`,
                    true,
                  );
                  return { ok: true, ...(value || {}) };
                }
                case 'page-inject': {
                  // MVP-4：整页 HTML 注入 guest。innerHTML 原语（同步赋值）替代 document.write——
                  // 后者在页面资源未静止时 executeJavaScript 会永久悬挂（cmd-41/63 实测，P22）；
                  // 页内 <script> 不经 innerHTML 执行，注入后单独 new Function 接线。
                  const target = pickGuestEl();
                  const html = String(c.html || '');
                  if (!html) return { ok: false, error: '需要 html' };
                  const value = await target.executeJavaScript(
                    `(function () {\n` +
                    `  var html = ${JSON.stringify(html)};\n` +
                    `  var m = html.match(/<script>([\\s\\S]*?)<\\/script>/);\n` +
                    `  var scriptCode = m ? m[1] : '';\n` +
                    `  var htmlNoScript = html.replace(/<script>[\\s\\S]*?<\\/script>/, '');\n` +
                    `  var inner = htmlNoScript.replace(/^[\\s\\S]*?<html[^>]*>/, '').replace(/<\\/html>\\s*$/, '');\n` +
                    `  document.documentElement.innerHTML = inner;\n` +
                    `  var wired = true, wireError = null;\n` +
                    `  if (scriptCode) { try { (new Function(scriptCode))(); } catch (e) { wired = false; wireError = String(e); } }\n` +
                    `  return { wired: wired, wireError: wireError, title: document.title };\n` +
                    `})()`,
                    true,
                  );
                  return { ok: true, ...(value || {}) };
                }
                case 'page-inject': {
                  // MVP-4：整页 HTML 注入 guest 顶层文档。innerHTML 原语（同步赋值）——
                  // 实测在活跃 SPA 页面上持久可靠（v2 注入存活 30min+）；document.write 会在
                  // 页面资源未静止时永久悬挂（P22）；iframe srcdoc 会被宿主 CSP 拦成空文档（本轮实测）。
                  // 注意：页面自身的 SPA 框架在响应式刷新后可能重绘覆盖注入内容（keysion.cn 实测一次），
                  // 注入后应立即使用/截图。
                  const target = pickGuestEl();
                  const html = String(c.html || '');
                  if (!html) return { ok: false, error: '需要 html' };
                  const value = await target.executeJavaScript(
                    `(function () {\n` +
                    `  var html = ${JSON.stringify(html)};\n` +
                    `  var m = html.match(/<script>([\\s\\S]*?)<\\/script>/);\n` +
                    `  var scriptCode = m ? m[1] : '';\n` +
                    `  var htmlNoScript = html.replace(/<script>[\\s\\S]*?<\\/script>/, '');\n` +
                    `  var inner = htmlNoScript.replace(/^[\\s\\S]*?<html[^>]*>/, '').replace(/<\\/html>\\s*$/, '');\n` +
                    `  document.documentElement.innerHTML = inner;\n` +
                    `  var wired = true, wireError = null;\n` +
                    `  if (scriptCode) { try { (new Function(scriptCode))(); } catch (e) { wired = false; wireError = String(e); } }\n` +
                    `  return { wired: wired, wireError: wireError, hasInput: !!document.querySelector('.card'), title: document.title };\n` +
                    `})()`,
                    true,
                  );
                  return { ok: true, ...(value || {}) };
                }
                case 'reload': {
                  // 同源刷新（不跨白名单）；不 await 完成事件（P19：跨导航的 Promise 永不决）
                  const target = pickGuestEl();
                  target.executeJavaScript('location.reload()', true).catch(() => {});
                  return { ok: true, reloading: true };
                }
                case 'navigate': {
                  // 白名单内的源才可能成功（实测跨源被宿主静默拒绝）；fire-and-forget，两秒后回报 href
                  const url = String(c.url || '');
                  if (!url) return { ok: false, error: '需要 url' };
                  const target = pickGuestEl();
                  target.executeJavaScript(`location.href = ${JSON.stringify(url)}`, true).catch(() => {});
                  await sleep(2000);
                  let href = null;
                  try {
                    href = await target.executeJavaScript('location.href', true);
                  } catch { /* 导航成功时旧上下文已销毁，取不到属正常 */ }
                  return { ok: true, requested: url, currentHref: href, note: '跨源导航受宿主白名单限制，可能被静默拒绝（须用户在 DSH UI 手动导航）' };
                }
                case 'screenshot': {
                  return await captureShot();
                }
                case 'submit-annotations': {
                  const target = await ensureAnnotator(svc);
                  const r = await target.executeJavaScript('(window.__dshKitAnnotator && window.__dshKitAnnotator.submit ? window.__dshKitAnnotator.submit() : null)', true);
                  if (!r || typeof r.markdown !== 'string') return { ok: false, error: '无可打包批注' };
                  if (!(r.annotations || []).length) return { ok: false, error: '无可打包批注（0 条）' };
                  let meta = null;
                  try {
                    const m = await target.executeJavaScript('({ url: location.href, title: document.title })', true);
                    if (m && typeof m === 'object') meta = { url: m.url ?? m.href ?? null, title: m.title ?? null };
                  } catch { /* 元数据失败不拦保存 */ }
                  const sr = unwrap(await svc.saveAnnotations(r.markdown, meta));
                  return sr && sr.ok ? { ok: true, path: sr.path, bytes: sr.bytes, count: (r.annotations || []).length } : { ok: false, error: (sr && sr.error) || '保存失败' };
                }
                default:
                  return { ok: false, error: `未知命令 action=${action}` };
              }
            } catch (e) {
              return { ok: false, error: msgOf(e) };
            }
          };

          const pollCommands = async () => {
            if (cmdBusy) return;
            const svc = stateRef.getRemote ? stateRef.getRemote() : null;
            if (!svc || typeof svc.takeCommand !== 'function') return;
            cmdBusy = true;
            try {
              // takeCommand 自身也可能挂（P20），10s 竞速保底（watchdog 45s 兜底在更外层）
              const taken = await Promise.race([
                svc.takeCommand(),
                sleep(10000).then(() => { throw new Error('takeCommand 超时(10s)'); }),
              ]);
              const r = unwrap(taken);
              const command = r && r.ok !== false ? r.command : null;
              if (r && r.ok === false) say('warn', `takeCommand 失败：${r.error}`);
              if (command && command.id != null) {
                say('info', `执行命令 ${command.id}（${command.action}）`);
                // 30s 保险：命令挂起（如跨导航的 executeJavaScript 永不 resolve）不饿死队列（P19 变体）
                const result = await Promise.race([
                  executeCommand(svc, command),
                  sleep(30000).then(() => ({ ok: false, error: '命令超时(30s)，已放弃等待' })),
                ]);
                try {
                  await svc.commandResult(String(command.id), result);
                  say('info', `命令 ${command.id} 完成：${JSON.stringify(result).slice(0, 160)}`);
                } catch (e) {
                  say('warn', `commandResult 失败：${msgOf(e)}`);
                }
              }
            } catch (e) {
              say('warn', `命令轮询异常：${msgOf(e)}`);
            } finally {
              cmdBusy = false;
            }
          };
          setInterval(() => { pollCommands().catch(() => {}); }, 2500);
          /* 看门狗：单条命令最长占用 30s（race 上限），45s 仍未释放视为卡死，强制复位
           * cmdBusy，避免一次挂起饿死整条命令队列（P20）。 */
          setInterval(() => {
            if (cmdBusy) {
              cmdBusy = false;
              say('warn', '看门狗：命令轮询超 45s 未释放，已强制复位 cmdBusy');
            }
          }, 45000);

          const reportNow = async () => {
            if (!stateRef.findings) await probeAndPublish('report');
            stateRef.report = await reportToHost(stateRef, stateRef.findings);
            say(stateRef.report.error ? 'warn' : 'info',
              `host 上报：${stateRef.report.error || JSON.stringify(stateRef.report.response)}`);
            return stateRef.report;
          };

          /** 等 svc 就绪（复用 reportToHost 的等待语义），返回 svc 或 null。 */
          const waitSvc = async () => {
            for (let i = 0; i < 27; i++) {
              const svc = stateRef.getRemote ? stateRef.getRemote() : null;
              if (svc) return svc;
              await sleep(300);
            }
            return null;
          };

          /**
           * MVP-1 截图主通道：capturePage() → dataURL → face saveShot → shots/<ts>-<title>.png。
           * 元数据（url/title）经 executeJavaScript 从 guest 页面自取。
           */
          const captureShot = async () => {
            const out = { ok: false, error: null, path: null, bytes: null };
            try {
              const els = Array.from(document.querySelectorAll('webview'));
              const target = pickProbeTarget(els);
              if (!target) {
                out.error = '无 webview（先打开内置浏览器）';
                return out;
              }
              let meta = { url: null, title: null };
              try {
                const m = await target.executeJavaScript('({ href: location.href, title: document.title })', true);
                if (m && typeof m === 'object') meta = { url: m.href ?? null, title: m.title ?? null };
              } catch { /* 元数据失败不拦截图 */ }
              const img = await target.capturePage();
              const dataUrl = img.toDataURL();
              const svc = await waitSvc();
              if (!svc || typeof svc.saveShot !== 'function') {
                out.error = `remote.${FACE_NAME}.saveShot 未就绪`;
                return out;
              }
              const r = unwrap(await svc.saveShot(meta, dataUrl));
              out.ok = !!(r && r.ok);
              out.path = r && r.path ? r.path : null;
              out.bytes = r && r.bytes ? r.bytes : null;
              out.error = r && r.error ? r.error : null;
            } catch (e) {
              out.error = msgOf(e);
            }
            return out;
          };

          /** 首个 guest 出现后的一次性自动动作：上报探测 + 自动截一张（MVP-1 验收用）。 */
          const maybeAutoActions = () => {
            const f = stateRef.findings;
            if (!f || f.webviewCount === 0) return;
            if (!stateRef.report) reportNow().catch(() => {});
            if (stateRef.autoShotLeft > 0) {
              // 节流：client 每次重载都会跑这里，10 分钟内已自动截过就不再截（防 shots/ 刷屏）
              let last = 0;
              try {
                last = Number(localStorage.getItem('dsh-browser-kit:auto-shot-at')) || 0;
              } catch { /* ignore */ }
              if (Date.now() - last < 10 * 60 * 1000) {
                stateRef.autoShotLeft = 0;
                return;
              }
              stateRef.autoShotLeft -= 1;
              try {
                localStorage.setItem('dsh-browser-kit:auto-shot-at', String(Date.now()));
              } catch { /* ignore */ }
              setTimeout(() => {
                captureShot().then((r) => {
                  stateRef.lastShot = r;
                  say(r.ok ? 'info' : 'warn', `自动截图：${r.ok ? r.path : r.error}`);
                }).catch(() => {});
              }, 1200); // 给 face/远端面一点就绪余量
            }
          };

          /* 首测 + webview 挂载自动补测（MutationObserver） */
          probeAndPublish('initial').then(() => maybeAutoActions()).catch((e) => say('warn', `首测失败：${msgOf(e)}`));
          /* 启动后 5s 自动上报一次：让实施会话无需任何用户操作即可验证 client→host 通道。 */
          setTimeout(() => {
            if (!stateRef.report) reportNow().catch(() => {});
            maybeAutoActions();
          }, 5000);
          try {
            const mo = new MutationObserver(() => {
              if (stateRef.autoLeft <= 0) return;
              let has = false;
              try {
                has = !!document.querySelector('webview');
              } catch { /* ignore */ }
              if (!has) return;
              stateRef.autoLeft -= 1;
              clearTimeout(stateRef._t);
              stateRef._t = setTimeout(() => {
                probeAndPublish('mutation').then((f) => {
                  if (f && f.webviewCount > 0) maybeAutoActions();
                }).catch(() => {});
              }, 800);
            });
            mo.observe(document.documentElement, { childList: true, subtree: true });
            try {
              if (typeof ctx?.effect === 'function') ctx.effect(() => { try { mo.disconnect(); } catch { /* ignore */ } });
            } catch { /* ignore */ }
          } catch (e) {
            say('warn', `MutationObserver 建立失败：${msgOf(e)}`);
          }

          /* 槽位注册（list 型：id 必填；order 排在 zcode-dispatch 之后） */
          ctx.slots.inject(SLOT, () => ctx.slots.register(
            { name: SLOT, id: PANEL_ID, order: 30 },
            () => h(PanelBoundary, null, h(ProbePanel, {
              stateRef,
              getState: () => ({ findings: stateRef.findings, report: stateRef.report, lastShot: stateRef.lastShot, annot: stateRef.annot, collapsed: stateRef.panelCollapsed }),
              actions: {
                collapse: () => {
                  stateRef.panelCollapsed = !stateRef.panelCollapsed;
                  try {
                    localStorage.setItem('dsh-browser-kit:panel-collapsed', stateRef.panelCollapsed ? '1' : '0');
                  } catch { /* ignore */ }
                },
                reprobe: () => { probeAndPublish('manual').catch(() => {}); },
                reportNow: () => { reportNow().catch(() => {}); },
                captureShot: () => {
                  captureShot().then((r) => {
                    stateRef.lastShot = r;
                    say(r.ok ? 'info' : 'warn', `截图：${r.ok ? r.path : r.error}`);
                  }).catch(() => {});
                },
                toggleAnnot: () => {
                  if (stateRef.annot && stateRef.annot.active) {
                    stopAnnotSession().catch((e) => say('warn', `结束批注失败：${msgOf(e)}`));
                  } else {
                    startAnnotSession().then((r) => {
                      if (r && r.ok === false) {
                        if (stateRef.annot) stateRef.annot.error = r.error;
                        say('warn', `批注启动失败：${r.error}`);
                      }
                    }).catch((e) => say('warn', `批注异常：${msgOf(e)}`));
                  }
                },
              },
            })),
          ));

          /* 尽力而为的临时入口：把批注图标注进浏览器工具条（宿主未开放该位置插槽，DOM 注入 +
           * MutationObserver 守卫重挂；DSH 升级可能失效——正式方案等官方插槽或快捷键）。 */
          try {
            const ensureToolbarButton = () => {
              if (document.getElementById('dsh-kit-toolbar-btn')) return true;
              const form = document.querySelector('form[class*="toolbar"]');
              if (!form) return false;
              const rootEl = form.parentElement;
              if (!rootEl || !rootEl.querySelector('webview')) return false; // 只挂带 webview 的浏览器工具条
              const btn = document.createElement('button');
              btn.id = 'dsh-kit-toolbar-btn';
              btn.type = 'button';
              btn.title = '元素批注（点击开启/关闭）';
              btn.style.cssText = 'margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;flex:none;';
              btn.innerHTML =
                '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
                '<path d="M4 4h16v12H9l-5 4V4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
                '<path d="M12 7.5v5M9.5 10h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                '</svg>';
              btn.addEventListener('click', () => {
                if (stateRef.annot && stateRef.annot.active) {
                  stopAnnotSession().catch(() => {});
                } else {
                  startAnnotSession().catch(() => {});
                }
              });
              form.appendChild(btn);
              stateRef.toolbarBtn = btn;
              return true;
            };
            stateRef.ensureToolbarButton = ensureToolbarButton;
            ensureToolbarButton();
            // 守卫：按钮被框架重渲染移除后自动重挂（去抖 600ms，上限 200 次）
            let tbPending = null;
            let tbLeft = 200;
            const tbObserver = new MutationObserver(() => {
              if (tbLeft <= 0) return;
              if (document.getElementById('dsh-kit-toolbar-btn')) return;
              tbLeft -= 1;
              clearTimeout(tbPending);
              tbPending = setTimeout(() => { try { ensureToolbarButton(); } catch { /* ignore */ } }, 600);
            });
            tbObserver.observe(document.body, { childList: true, subtree: true });
            if (typeof ctx?.effect === 'function') {
              ctx.effect(() => () => { try { tbObserver.disconnect(); } catch { /* ignore */ } });
            }
            // 激活态外观同步（2s）
            setInterval(() => {
              const btn = stateRef.toolbarBtn;
              if (!btn || !btn.isConnected) return;
              const active = stateRef.annot && stateRef.annot.active;
              btn.style.background = active
                ? 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #2563eb))'
                : 'transparent';
            }, 2000);
          } catch (e) {
            say('warn', `工具条按钮注入失败（不影响其他功能）：${msgOf(e)}`);
          }

          /* 正式形态入口：内置浏览器标签 ⋯ 菜单里的「元素批注」项（官方插槽
           * sidebar.right.tab.menu.item，list 型；工具条图标位官方未开放插槽——见 delivery-08）。
           * 独立 try/catch：菜单项失败不拖累调试面板。 */
          try {
            const MENU_SLOT = 'sidebar.right.tab.menu.item';
            ctx.slots.inject(MENU_SLOT, () => ctx.slots.register(
              { name: MENU_SLOT, id: 'dsh-browser-kit.annotate', order: 10, label: '元素批注' },
              () => {
                const active = stateRef.annot && stateRef.annot.active;
                return h(
                  'div',
                  {
                    onClick: () => {
                      if (stateRef.annot && stateRef.annot.active) {
                        stopAnnotSession().catch((e) => say('warn', `结束批注失败：${msgOf(e)}`));
                      } else {
                        startAnnotSession().then((r) => {
                          if (r && r.ok === false) say('warn', `批注启动失败：${r.error}`);
                        }).catch(() => {});
                      }
                    },
                    style: {
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 8px', cursor: 'pointer',
                      color: active ? T.accent : 'inherit',
                      fontSize: 12,
                    },
                  },
                  h(
                    'svg',
                    { viewBox: '0 0 24 24', width: 13, height: 13, 'aria-hidden': true },
                    h('path', { d: 'M4 4h16v12H9l-5 4V4z', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinejoin: 'round' }),
                    h('path', { d: 'M12 7.5v5M9.5 10h5', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
                  ),
                  h('span', null, active ? '关闭元素批注' : '开启元素批注'),
                );
              },
            ));
            say('info', '菜单项「元素批注」已注册（sidebar.right.tab.menu.item）');
          } catch (e) {
            say('warn', `菜单项注册失败（不影响面板）：${msgOf(e)}`);
          }

          say('info', 'dsh-browser-kit 已挂载（左下角工具面板：截图 / 上报 / 探测）');
        } catch (e) {
          try {
            console.warn(`${LOG_PREFIX} apply 降级（不阻塞启动）:`, e && e.message);
          } catch { /* 彻底静默 */ }
        }
      },
    };
  },
});
