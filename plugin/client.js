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
          id: 'dsh-kit-panel',
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
            lastToggleError: null,
            clientBootAt: new Date().toISOString(),
            toolbarBtn: null,
            panelCollapsed: false,
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
            // GUI 侧自诊断（随探测上报：实施会话读报告即可定位面板/工具条问题）
            findings.gui = {
              clientBootAt: stateRef.clientBootAt,
              toolbarBtnCount: typeof stateRef.toolbarBtnCount === 'number' ? stateRef.toolbarBtnCount : null,
              panelRootInDom: !!document.getElementById('dsh-kit-panel'),
              remoteSvcReady: !!(stateRef.getRemote && stateRef.getRemote()),
              annotActive: !!(stateRef.annot && stateRef.annot.active),
              annotPaneCount: (stateRef.annot && Array.isArray(stateRef.annot.panes)) ? stateRef.annot.panes.length : 0,
              lastToggleError: stateRef.lastToggleError || null,
              syncDiag: (stateRef.annot && stateRef.annot.syncDiag) || null,
            };
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

          /**
           * 共享批注会话模型（用户需求：同会话多窗口共用一份批注、批注号跨窗口延续、
           * 不同会话的窗口互不影响）：
           *  - stateRef.annot = { active, panes:[webview…], pending:[{pane,promise}], leftIds:Set, count, … }；
           *  - 任一窗口点图标开启 → 会话建立；**其余窗口/标签自动加入**（数秒内面板出现、编号自动
           *    交接，无需再点图标——用户核心诉求「窗口1开启，窗口2直接显示已开启」）；点图标 =
           *    本窗口退出/重进（leftIds 记忆显式退出，防自动加入立刻拉回）；不同 DSH 会话的窗口
           *    天然独立（各自 client 实例、各自文档）；
           *  - **成员先入册再 start**：annotator start() 返回的 Promise 到该面板提交/取消才 settle，
           *    旧实现 settle 后才 push 成员表 → 新面板整个会话期不参与同步（P25 根因）；
           *  - 任一成员面板提交 → 收集**全部成员**的批注 → host `saveMerged` 按 capturedAt
           *    权威重编号（= 页内徽标号，由 startIndex 交接保证）→ 单个协议文件；
           *  - 编号交接：加入面板的 indexBase 下限 = 全局最大已用号 → 首个新批注 = 最大号 + 1
           *    （annotator nextIndex = max(listMax, indexBase) + 1；旧实现把 maxUsed+1 当下限传入
           *    → 直接跳号，用户实测「窗口1批1 → 窗口2变3」，P26）。
           */

          /** 面板身份：webContentsId 数字优先（框架重渲染换节点后仍能对上），失败退回元素自身。 */
          const paneIdOf = (el) => {
            if (!el) return null;
            try {
              const id = el.getWebContentsId && el.getWebContentsId();
              if (typeof id === 'number') return id;
            } catch { /* 已脱离 DOM 等：退回元素身份 */ }
            return el;
          };

          /** 把成员表里的陈旧节点映射回当前文档的同 id 节点（DSH 重渲染会替换 webview 节点）。 */
          const livePane = (el) => {
            const id = paneIdOf(el);
            if (typeof id === 'number') {
              for (const w of document.querySelectorAll('webview')) {
                if (paneIdOf(w) === id) return w;
              }
            }
            return el;
          };
          const refreshPanes = () => {
            const st = stateRef.annot;
            if (st && Array.isArray(st.panes)) st.panes = st.panes.map(livePane).filter(Boolean);
          };

          /** 编号交接下限（P26 契约钉死）：加入面板 indexBase = maxUsed → 首个新批注 = maxUsed+1。
           *  首个成员传 0 → 首批注 = 1。绝不要再 +1（那是 annotator nextIndex 自己加的）。 */
          const joinFloorIndex = (maxUsed) => (Number(maxUsed) || 0);

          const sessionMaxIndex = async () => {
            let max = 0;
            for (const p of stateRef.annot.panes) {
              try {
                const lst = await p.executeJavaScript('(window.__dshKitAnnotator ? window.__dshKitAnnotator.list().map(function (a) { return a.index; }) : [])', true);
                if (Array.isArray(lst)) for (const n of lst) if (typeof n === 'number' && n > max) max = n;
              } catch { /* 面板已关闭等：跳过 */ }
            }
            return max;
          };

          /** 确保批注层已注入目标面板（版本不匹配自动重注入，旧实例由注入头 stop 清理）。 */
          const EXPECTED_ANNOT_VERSION = '1.4.0';
          const ensureAnnotator = async (svc, targetEl) => {
            const target = targetEl || pickGuestEl();
            const has = await target.executeJavaScript('typeof window.__dshKitAnnotator !== "undefined" && typeof window.__dshKitAnnotator.start === "function"', true);
            let version = null;
            if (has === true) {
              version = await target.executeJavaScript('window.__dshKitAnnotatorVersion || null', true);
            }
            if (has === true && version === EXPECTED_ANNOT_VERSION) return target;
            if (!annotSourceCache) {
              const g = unwrap(await svc.getInjectScript());
              if (!g || g.ok === false) throw new Error(`getInjectScript 失败：${(g && g.error) || '未知'}`);
              annotSourceCache = { mtime: g.mtime, source: g.source };
              say('info', `批注层源已获取（${g.bytes} 字节，mtime ${g.mtime}）`);
            }
            await target.executeJavaScript(annotSourceCache.source, true);
            const ok = await target.executeJavaScript('typeof window.__dshKitAnnotator !== "undefined" && window.__dshKitAnnotatorVersion === "' + EXPECTED_ANNOT_VERSION + '"', true);
            if (ok !== true) throw new Error('批注层注入后 API/版本不符');
            return target;
          };

          /** 提交后把提示写入会话输入框（不自动发送）：找 GUI 聊天输入框（可见 textarea 优先，
           *  contenteditable 兜底），原生 value setter + input 事件保证 React 受控组件同步；
           *  输入框已有内容则换行追加，不覆盖用户正在输入的话。 */
          const primeSessionInput = (text) => {
            try {
              const visible = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0);
              const tas = Array.from(document.querySelectorAll('textarea')).filter((el) => visible(el) && !el.disabled && !el.readOnly);
              const ta = tas[tas.length - 1] || null;
              if (ta) {
                const cur = ta.value || '';
                const next = cur ? `${cur}\n${text}` : text;
                const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
                if (desc && desc.set) desc.set.call(ta, next);
                else ta.value = next;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                try { ta.focus(); } catch { /* 聚焦失败不影响 */ }
                return { ok: true, target: 'textarea' };
              }
              const ces = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(visible);
              const ce = ces[ces.length - 1] || null;
              if (ce) {
                const cur = (ce.innerText || '').replace(/\n+$/, '');
                ce.textContent = cur ? `${cur}\n${text}` : text;
                ce.dispatchEvent(new InputEvent('input', { bubbles: true }));
                try { ce.focus(); } catch { /* 聚焦失败不影响 */ }
                return { ok: true, target: 'contenteditable' };
              }
              return { ok: false, error: '未找到会话输入框' };
            } catch (e) {
              return { ok: false, error: msgOf(e) };
            }
          };

          /** 提交成功 → 会话输入框写入「N 条 + 路径」提示，用户可直接补一句发送给助手。 */
          const announceSubmission = (r) => {
            if (!r || r.ok !== true || !r.path) return;
            const n = Number(r.count);
            const head = (Number.isFinite(n) && n > 0) ? `已提交 ${n} 条元素批注` : '元素批注已提交';
            const pr = primeSessionInput(`${head}：${r.path}`);
            say(pr.ok ? 'info' : 'warn', pr.ok
              ? '提交提示已写入会话输入框（未自动发送）'
              : `会话输入框提示失败：${pr.error}`);
          };

          const sessionSettled = async (winner) => {
            const st = stateRef.annot;
            if (!st || !st.active) return;
            st.pending = (st.pending || []).filter((e) => e.pane !== winner.pane);
            if (winner.how === 'submitted') {
              const r = await mergeAndSave(winner.pane);
              st.active = false;
              st.lastSaved = r && r.ok ? r : null;
              if (r && r.ok === false) st.error = r.error;
              await stopAllPanes(true);
              st.origins = {}; // 编号来源表随会话结束清空
              st.pending = [];
              if (st.leftIds) st.leftIds.clear(); // 显式退出记忆随会话结束清空
              announceSubmission(r); // 会话输入框提示（N 条 + 路径）
              say('info', `共享批注会话提交完成：${r && r.ok ? r.path : r.error}`);
            } else {
              // 取消/Esc/重启动：**成员身份保留**（退出必须走 leavePane 显式开关）——
              // 否则 drive 自愈式 start 重启会把自己踢出成员表，跨面板同步随即失效。
              runSessionLoop(); // 其余 pending 继续
            }
          };

          const startPaneInSession = async (target, startIndex) => {
            const howPromise = (async () => {
              let how = 'cancelled';
              try {
                how = await target.executeJavaScript(
                  `window.__dshKitLastSubmit = undefined; window.__dshKitAnnotator.start({ onSubmit: function (r) { window.__dshKitLastSubmit = r; }, startIndex: ${Number(startIndex) || 0} })`,
                  true,
                );
              } catch (e) {
                how = `error:${msgOf(e)}`;
              }
              return { pane: target, how };
            })();
            stateRef.annot.pending.push({ pane: target, promise: howPromise });
            howPromise.then((w) => {
              sessionSettled(w).catch((e) => say('warn', `会话收尾异常：${msgOf(e)}`));
            }).catch(() => {});
            return howPromise;
          };

          const stopAllPanes = async (withClear) => {
            for (const p of stateRef.annot.panes) {
              try {
                await p.executeJavaScript(withClear
                  ? '(window.__dshKitAnnotator ? (window.__dshKitAnnotator.stop ? window.__dshKitAnnotator.stop() : undefined), window.__dshKitAnnotator.clear ? window.__dshKitAnnotator.clear() : undefined, undefined) : undefined'
                  : '(window.__dshKitAnnotator && window.__dshKitAnnotator.stop ? window.__dshKitAnnotator.stop() : undefined)', true);
              } catch { /* 面板已关闭等 */ }
            }
            stateRef.annot.panes = [];
          };

          /** 收集全部成员批注 → host saveMerged 合并落盘。 */
          const mergeAndSave = async (submitterPane) => {
            const svc = await waitSvc();
            if (!svc) return { ok: false, error: 'host 远端面未就绪' };
            refreshPanes(); // 重渲染换节点后按 webContentsId 映射回活节点
            const sets = [];
            for (const p of stateRef.annot.panes) {
              try {
                const lst = await p.executeJavaScript('(window.__dshKitAnnotator ? window.__dshKitAnnotator.list() : [])', true);
                if (!Array.isArray(lst)) continue;
                let meta = null;
                try {
                  const m = await p.executeJavaScript('({ url: location.href, title: document.title })', true);
                  if (m && typeof m === 'object') meta = { url: m.url ?? m.href ?? null, title: m.title ?? null };
                } catch { /* 元数据失败不拦合并 */ }
                if (lst.length > 0) sets.push({ url: (meta && meta.url) || null, title: (meta && meta.title) || null, annotations: lst });
              } catch { /* 成员不可达：跳过 */ }
            }
            if (sets.length === 0) return { ok: false, error: '无可提交批注' };
            void submitterPane;
            return unwrap(await svc.saveMerged(sets, null));
          };

          /** 面板加入共享会话（编号交接：首个新批注 = 全局最大已用号 + 1，跨窗口延续）。 */
          const joinPane = async (target) => {
            const svc = await waitSvc();
            if (!svc) throw new Error('host 远端面未就绪');
            await ensureAnnotator(svc, target);
            const st = stateRef.annot;
            // 先入册再 start（P25）：start() 的 Promise 到该面板提交/取消才 settle——
            // settle 后才 push 会让新面板整个会话期不在成员表 → syncPanes 恒 <2 面板直返、
            // 图标激活态恒灭、合并缺其批注（用户实测「窗口2没打通」根因）。
            if (st && !st.panes.some((p) => paneIdOf(p) === paneIdOf(target))) st.panes.push(target);
            const maxUsed = (st && st.panes.length > 1) ? await sessionMaxIndex() : 0;
            await startPaneInSession(target, joinFloorIndex(maxUsed)); // P26：下限=maxUsed，勿再 +1
          };

          /** 面板退出共享会话（stop 由其 watcher 收尾；记入 leftIds 防自动加入立刻拉回）。 */
          const leavePane = (target) => {
            const st = stateRef.annot;
            const live = st ? (st.panes.find((p) => paneIdOf(p) === paneIdOf(target)) || target) : target;
            if (st && st.leftIds) {
              const id = paneIdOf(target);
              if (id != null) st.leftIds.add(id);
            }
            return live.executeJavaScript('(window.__dshKitAnnotator && window.__dshKitAnnotator.stop ? window.__dshKitAnnotator.stop() : undefined)', true);
          };

          /** 图标/菜单开关语义：会话未开 → 开会话（本窗口首个成员，其余窗口自动加入）；
           *  会话已开 → 本窗口已参与则退出 / 未参与则（重新）加入。最后一个退出 = 会话结束。 */
          const togglePaneAnnot = async (targetEl) => {
            const target = targetEl || pickGuestEl();
            const st = stateRef.annot;
            if (st && st.active) {
              const tid = paneIdOf(target);
              if (st.panes.some((p) => paneIdOf(p) === tid)) {
                await leavePane(target);
                st.panes = st.panes.filter((p) => paneIdOf(p) !== tid);
                if (st.panes.length === 0) {
                  st.active = false;
                  if (st.leftIds) st.leftIds.clear();
                }
                return { ok: true, left: true };
              }
              if (st.leftIds && st.leftIds.has(paneIdOf(target))) st.leftIds.delete(paneIdOf(target));
              await joinPane(target);
              return { ok: true, joined: true };
            }
            // 新会话：点击者为其首个成员；其余窗口由自动加入在数秒内拉齐
            const svc = await waitSvc();
            if (!svc) return { ok: false, error: 'host 远端面未就绪' };
            await ensureAnnotator(svc, target);
            stateRef.annot = { active: true, panes: [target], pending: [], origins: {}, leftIds: new Set(), count: 0, startedAt: new Date().toISOString(), lastSaved: null, error: null };
            startPaneInSession(target, joinFloorIndex(0)); // 首个成员：编号从 1 起（下限 0，annotator +1）
            runSessionLoop();
            say('info', '共享批注会话开始（所有浏览器窗口自动加入，编号实时同步；点图标退出/重进本窗口）');
            return { ok: true, started: true };
          };

          /** 会话主循环：等任一成员 settle（提交/退出）并收尾。 */
          const runSessionLoop = () => {
            const pending = (stateRef.annot && stateRef.annot.pending) || [];
            if (pending.length === 0) return;
            Promise.race(pending.map((e) => e.promise))
              .then((winner) => { sessionSettled(winner).catch((e) => say('warn', `会话收尾异常：${msgOf(e)}`)); })
              .catch(() => {});
          };

          /**
           * 跨面板同步循环（会话活跃时每 1.5s）：以 gid 为唯一标识，实现「同一批注板块」——
           *  - 新 gid：登记来源面板 → addExternal 广播到其他成员（缺失即推送）；
           *  - note/index 变更：addExternal 幂等更新（同 gid）；
           *  - 删除：union(各窗口删除日志) + 来源面板消失 → 全员 removeExternal；
           *  - 同一页面开两个窗口时 selector 在两边都命中 → 徽标实时出现在两个窗口（用户核心诉求）。
           */
          let syncBusy = false;
          const syncPanes = async () => {
            const st = stateRef.annot;
            if (!st || !st.active || syncBusy) return;
            refreshPanes(); // 重渲染换节点后按 webContentsId 映射回活节点
            if (st.panes.length < 2) return;
            syncBusy = true;
            try {
              const states = [];
              for (const p of st.panes) {
                let list = [];
                let deleted = [];
                try {
                  list = (await p.executeJavaScript('(window.__dshKitAnnotator ? window.__dshKitAnnotator.list() : [])', true)) || [];
                  deleted = (await p.executeJavaScript('(window.__dshKitDeletedGids || [])', true)) || [];
                } catch { states.push({ pane: p, list, deleted, dead: true }); continue; }
                states.push({ pane: p, list: Array.isArray(list) ? list : [], deleted: Array.isArray(deleted) ? deleted : [] });
              }
              // 登记新 gid 的来源面板（首次出现处）
              for (const s of states) {
                for (const a of s.list) {
                  if (a.gid && !(a.gid in st.origins)) st.origins[a.gid] = s.pane;
                }
              }
              // 删除判定：gid 出现在任意删除日志，或来源面板已无此 gid
              const removedGids = {};
              for (const s of states) for (const g of s.deleted) removedGids[g] = true;
              for (const gid of Object.keys(st.origins)) {
                const origin = st.origins[gid];
                const originState = states.find((s) => s.pane === origin);
                if (originState && !originState.dead && !originState.list.some((a) => a.gid === gid)) removedGids[gid] = true;
              }
              // 合并视图（未被删除的 gid）
              const union = [];
              const seen = {};
              for (const s of states) {
                for (const a of s.list) {
                  if (a.gid && !seen[a.gid] && !removedGids[a.gid]) {
                    seen[a.gid] = true;
                    union.push({ item: a, origin: st.origins[a.gid] || null });
                  }
                }
              }
              // 推送缺失/落后项到各面板（addExternal 按 gid 幂等）
              for (const s of states) {
                const mine = {};
                for (const a of s.list) if (a.gid) mine[a.gid] = true;
                const toPush = union.filter((u) => u.origin !== s.pane && !mine[u.item.gid]).map((u) => u.item);
                if (toPush.length) {
                  try {
                    await s.pane.executeJavaScript('window.__dshKitAnnotator.addExternal(' + JSON.stringify(toPush) + ')', true);
                  } catch { /* 推送失败下轮重试 */ }
                }
              }
              // 删除广播
              for (const gid of Object.keys(removedGids)) {
                for (const s of states) {
                  if (s.dead) continue;
                  if (s.list.some((a) => a.gid === gid)) {
                    try {
                      await s.pane.executeJavaScript('window.__dshKitAnnotator.removeExternal(' + JSON.stringify(gid) + ')', true);
                    } catch { /* 下轮重试 */ }
                  }
                }
                delete st.origins[gid];
              }
              st.count = union.length;
              st.syncDiag = {
                at: new Date().toISOString(),
                panes: states.map((s) => ({ dead: !!s.dead, count: s.list.length })),
                unionLen: union.length,
                removed: Object.keys(removedGids).length,
              };
            } finally {
              syncBusy = false;
            }
          };
          setInterval(() => { syncPanes().catch(() => {}); }, 1500);

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
                  const target = pickGuestEl();
                  togglePaneAnnot(target).then((r) => {
                    say('info', `批注（命令触发）：${JSON.stringify(r).slice(0, 120)}`);
                  }).catch(() => {});
                  return { ok: true, started: true };
                }
                case 'toggle-pane': {
                  // 指定面板加入/退出共享会话（tab 0 起；省略 = 第一个）
                  const els = Array.from(document.querySelectorAll('webview'));
                  const pane = els[Number(c.tab) || 0];
                  if (!pane) return { ok: false, error: 'no pane: tab=' + c.tab };
                  togglePaneAnnot(pane).then((r) => {
                    say('info', `面板 ${c.tab} 批注：${JSON.stringify(r).slice(0, 120)}`);
                  }).catch((e) => { stateRef.lastToggleError = msgOf(e); });
                  return { ok: true, toggling: true };
                }
                case 'stop-annotator': {
                  const target = pickGuestEl();
                  await leavePane(target);
                  if (stateRef.annot) {
                    stateRef.annot.panes = stateRef.annot.panes.filter((p) => p !== target);
                    if (stateRef.annot.panes.length === 0) stateRef.annot.active = false;
                  }
                  return { ok: true };
                }
                case 'annotator-status': {
                  const target = pickGuestEl();
                  const st = await target.executeJavaScript('(function(){ if (typeof window.__dshKitAnnotator === "undefined") return { injected: false }; return { injected: true, count: window.__dshKitAnnotator.list().length, first: window.__dshKitAnnotator.list()[0] || null }; })()', true);
                  return { ok: true, ...st };
                }
                case 'guest-eval': {
                  // MVP-4：agent 侧任意求值；frame:true 时在 kit 沙箱文档内执行；
                  // tab（0 起）指定目标面板（默认第一个）——多浏览器窗口分别驱动。
                  // 注意：document 必须经【函数参数】传入（参数遮蔽安全）；函数体内 var document
                  // 会因提升让全函数体的 document 变 undefined（cmd-72/73 实测自坑，P23）。
                  const els = Array.from(document.querySelectorAll('webview'));
                  const tabIdx = Number(c.tab) || 0;
                  const target = els[tabIdx] || pickGuestEl();
                  const docPre = c.frame ? TARGET_DOC_SNIPPET : '';
                  const docExpr = c.frame ? 'DOC' : 'document';
                  const code = String(c.code || '');
                  const value = await target.executeJavaScript(
                    `(function () { ${docPre} return (function (document) {\n${code}\n})(${docExpr}); })()`,
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
                case 'kit-status': {
                  // 自诊断：回报 client 内部状态（实施会话经命令通道读取，定位「点击无效」类问题）
                  return {
                    ok: true,
                    clientBootAt: stateRef.clientBootAt || null,
                    annot: stateRef.annot
                      ? {
                          active: stateRef.annot.active,
                          paneCount: Array.isArray(stateRef.annot.panes) ? stateRef.annot.panes.length : 0,
                          count: stateRef.annot.count,
                          error: stateRef.annot.error || null,
                          startedAt: stateRef.annot.startedAt || null,
                        }
                      : null,
                    lastToggleError: stateRef.lastToggleError || null,
                    toolbarBtnCount: typeof stateRef.toolbarBtnCount === 'number' ? stateRef.toolbarBtnCount : null,
                    panelRootInDom: !!document.getElementById('dsh-kit-panel'),
                    panelError: typeof window.__dshKitPanelError === 'string' ? window.__dshKitPanelError : null,
                    remoteSvcReady: !!(stateRef.getRemote && stateRef.getRemote()),
                    mountOk: stateRef.mountOk === true,
                    mountError: stateRef.mountError || null,
                    webviewCount: document.querySelectorAll('webview').length,
                  };
                }
                case 'report-now': {
                  // 诊断：立即跑一轮探测并刷新 probe-report.json（含 gui/syncDiag 诊断）
                  probeAndPublish('command').then(() => reportNow()).catch(() => {});
                  return { ok: true, reporting: true };
                }
                case 'toolbar-probe': {
                  // 诊断：直接测 ensureToolbarButton 的每一步判定
                  const bySelector = !!document.querySelector('form[class*="toolbar"]');
                  const allForms = Array.from(document.querySelectorAll('form')).map((f) => f.className.slice(0, 60));
                  const btnById = !!document.getElementById('dsh-kit-toolbar-btn');
                  let formEl = document.querySelector('form[class*="toolbar"]');
                  let rootHasWebview = null, rootCls = null;
                  if (formEl && formEl.parentElement) {
                    rootCls = String(formEl.parentElement.className || '').slice(0, 60);
                    rootHasWebview = !!formEl.parentElement.querySelector('webview');
                  }
                  return { ok: true, bySelector, allForms, btnById, rootHasWebview, rootCls };
                }
                case 'panes-probe': {
                  // 诊断：枚举全部 webview 的批注层状态（injected/版本/条数/gid）
                  const els = Array.from(document.querySelectorAll('webview'));
                  const out = [];
                  let i = 0;
                  for (const el of els) {
                    let info = { tab: i, injected: false };
                    try {
                      info.src = el.getAttribute('src') || null;
                      const v = await el.executeJavaScript('({ v: window.__dshKitAnnotatorVersion || null, n: window.__dshKitAnnotator ? window.__dshKitAnnotator.list().length : null, gids: window.__dshKitAnnotator ? window.__dshKitAnnotator.list().map(function (x) { return x.gid; }) : [] })', true);
                      if (v && typeof v === 'object') { info.version = v.v; info.count = v.n; info.gids = v.gids; }
                    } catch (e) {
                      info.error = msgOf(e);
                    }
                    out.push(info);
                    i += 1;
                  }
                  return { ok: true, panes: out };
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
                  // 多面板共享会话：收集全部成员批注 → host saveMerged（重编号 + 合并构建）
                  if (stateRef.annot && stateRef.annot.active && stateRef.annot.panes.length > 0) {
                    const r = await mergeAndSave(null);
                    if (r && r.ok) announceSubmission(r);
                    return r && r.ok ? { ok: true, path: r.path, bytes: r.bytes, count: r.count } : { ok: false, error: (r && r.error) || '保存失败' };
                  }
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
                  if (sr && sr.ok) announceSubmission({ ok: true, path: sr.path, count: (r.annotations || []).length });
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
                  try {
                    const target = pickGuestEl();
                    togglePaneAnnot(target).then((r) => {
                      if (r && r.ok === false) {
                        if (stateRef.annot) stateRef.annot.error = r.error;
                        say('warn', `批注失败：${r.error}`);
                      }
                    }).catch((e) => say('warn', `批注异常：${msgOf(e)}`));
                  } catch (e) {
                    say('warn', `批注：${msgOf(e)}`);
                  }
                },
              },
            })),
          ));

          /* 尽力而为的临时入口：把批注图标注入**每一个**浏览器工具条（多标签各一个；
           * 宿主未开放该位置插槽，DOM 注入 + 守卫重挂；DSH 升级可能失效——正式方案等官方插槽或快捷键）。
           * 图标 = 本窗口退出/重进共享批注会话；会话活跃时其余窗口/标签由上方 2s 循环自动加入。 */
          try {
            const toolbarForms = () => Array.from(document.querySelectorAll('form[class*="toolbar"]'))
              .filter((f) => f.parentElement && f.parentElement.querySelector('webview'));
            const webviewOfForm = (form) => form.parentElement.querySelector('webview');
            const ensureToolbarButtons = () => {
              let attached = 0;
              for (const form of toolbarForms()) {
                if (form.querySelector('#dsh-kit-toolbar-btn')) { attached += 1; continue; }
                const pane = webviewOfForm(form);
                if (!pane) continue;
                const btn = document.createElement('button');
                btn.id = 'dsh-kit-toolbar-btn';
                btn.type = 'button';
                btn.title = '元素批注（点击本窗口加入/退出共享批注）';
                btn.style.cssText = 'margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;flex:none;';
                btn.innerHTML =
                  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
                  '<path d="M4 4h16v12H9l-5 4V4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
                  '<path d="M12 7.5v5M9.5 10h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                  '</svg>';
                btn.addEventListener('click', () => {
                  try {
                    // 即时视觉反馈（2s 同步循环随后校正）；面板点击时现取，
                    // 避免闭包持有重渲染前的旧 webview 节点（身份失配 = 永不点亮）
                    const pane = webviewOfForm(form);
                    if (!pane) return;
                    btn.style.background = '#2563eb';
                    btn.style.color = '#ffffff';
                    stateRef.lastToggleError = null;
                    togglePaneAnnot(pane).then((r) => {
                      if (r && r.ok === false) {
                        stateRef.lastToggleError = r.error || null;
                        btn.title = '批注失败：' + (r.error || '');
                      }
                    }).catch((e) => { stateRef.lastToggleError = msgOf(e); });
                  } catch (e) {
                    stateRef.lastToggleError = msgOf(e);
                  }
                });
                form.appendChild(btn);
                attached += 1;
              }
              stateRef.toolbarBtnCount = attached;
              return attached;
            };
            stateRef.ensureToolbarButtons = ensureToolbarButtons;
            ensureToolbarButtons();
            // 守卫：工具条被框架重渲染（按钮被移除/新标签出现）→ **同步**重挂，无去抖
            //（去抖会让按钮肉眼可见地消失重现=闪烁；微任务级重挂肉眼无感）
            const tbObserver = new MutationObserver(() => {
              if (tbLeft <= 0) return;
              tbLeft -= 1;
              try { ensureToolbarButtons(); } catch { /* ignore */ }
            });
            tbObserver.observe(document.body, { childList: true, subtree: true });
            if (typeof ctx?.effect === 'function') {
              ctx.effect(() => () => { try { tbObserver.disconnect(); } catch { /* ignore */ } });
            }
            setInterval(() => {
              try { ensureToolbarButtons(); } catch { /* ignore */ }
            }, 3000);
            // 各按钮激活态外观同步（2s，按 webContentsId 比对成员）+ 会话自动拉齐：
            //  - 会话活跃时，未入册且未被显式退出的面板 → 自动加入（用户核心诉求：
            //    「窗口1开启批注 → 窗口2直接显示已开启」，无需再点图标）；
            //  - 成员面板 guest 导航后批注层丢失（API 消失；主动取消不丢 API）→ 自动重注入续编号。
            let autoJoinBusy = false;
            const withTimeout = (p, ms, tag) => Promise.race([
              Promise.resolve(p),
              new Promise((_, rej) => setTimeout(() => rej(new Error(`${tag || 'op'} 超时(${ms}ms)`)), ms)),
            ]);
            setInterval(async () => {
              const st = stateRef.annot;
              refreshPanes();
              const activeIds = (st && st.active && Array.isArray(st.panes))
                ? new Set(st.panes.map(paneIdOf))
                : new Set();
              for (const form of toolbarForms()) {
                const btn = form.querySelector('#dsh-kit-toolbar-btn');
                if (!btn) continue;
                const pane = webviewOfForm(form);
                const active = pane != null && activeIds.has(paneIdOf(pane));
                // 固定高对比配色（蓝底白标）：主题令牌在工具条上下文里可能解析成浅色，
                // 叠加 color:inherit 的浅色描边 → 白底白标隐形（用户实测反馈，已修）
                btn.style.background = active ? '#2563eb' : 'transparent';
                btn.style.color = active ? '#ffffff' : '';
                btn.style.boxShadow = active ? '0 0 0 1px rgba(255,255,255,0.35) inset' : 'none';
              }
              if (!st || !st.active || autoJoinBusy) return;
              autoJoinBusy = true;
              try {
                // 自愈：成员批注层丢失（页面导航把 guest 文档换掉）→ 重注入并从全局最大号续编
                for (const p of Array.from(st.panes)) {
                  try {
                    const has = await withTimeout(p.executeJavaScript('typeof window.__dshKitAnnotator !== "undefined" && typeof window.__dshKitAnnotator.start === "function"', true), 4000, 'annot-probe');
                    if (has === true) continue;
                    const svc = await waitSvc();
                    if (!svc) break;
                    await withTimeout(ensureAnnotator(svc, p), 8000, 'annot-reinject');
                    const maxUsed = await sessionMaxIndex();
                    await withTimeout(startPaneInSession(p, joinFloorIndex(maxUsed)), 8000, 'annot-restart');
                    say('info', '批注层因页面导航丢失，已自动恢复（编号延续）');
                  } catch { /* 面板暂时不可达：下轮再试 */ }
                }
                // 自动加入：把会话拉齐到本 DSH 会话的全部浏览器窗口/标签
                for (const wv of Array.from(document.querySelectorAll('webview'))) {
                  if (!wv.isConnected) continue;
                  const id = paneIdOf(wv);
                  if (activeIds.has(id) || st.leftIds.has(id)) continue;
                  try {
                    await withTimeout(joinPane(wv), 8000, 'auto-join');
                    say('info', '浏览器窗口/标签已自动加入共享批注会话');
                  } catch { /* 注入失败（页面未就绪等）：下轮重试 */ }
                }
              } finally {
                autoJoinBusy = false;
              }
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
                      try {
                        const pane = document.querySelector('webview');
                        if (!pane) return;
                        togglePaneAnnot(pane).then((r) => {
                          if (r && r.ok === false) say('warn', `批注失败：${r.error}`);
                        }).catch(() => {});
                      } catch { /* ignore */ }
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
