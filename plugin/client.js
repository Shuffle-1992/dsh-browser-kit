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
    // 调试面板显隐（用户要求：默认隐藏、功能保留、可唤出）：'0'=显示；缺省/'1'=隐藏。
    // 切换走命令 panel-toggle（写 localStorage + 广播事件，面板监听后即时显隐，跨刷新持久）。
    const PANEL_HIDDEN_KEY = 'dsh-browser-kit:panel:hidden:v1';
    const PANEL_TOGGLE_EVENT = 'dsh-kit-panel-toggle';
    const readPanelHidden = () => {
      try { return localStorage.getItem(PANEL_HIDDEN_KEY) !== '0'; } catch { return true; }
    };
    // 工具条 accent（字面豁免见下方 TOOLBAR_ACCENT 注释）同级的共享资源：批注图标（C9，
    // 工具条与菜单两份同款 24-viewBox 合一；面板用的是另一枚 16-viewBox 图钉，独立保留）
    const ANNOT_ICON_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">'
      + '<path d="M4 4h16v12H9l-5 4V4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
      + '<path d="M12 7.5v5M9.5 10h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
      + '</svg>';
    // 工具条强调色——字面色豁免（C15）：主题令牌在工具条上下文可能解析成浅色 → 白底白标
    // 隐形（真机修正）；两处引用（点击即时反馈 + 2s 同步循环）共用常量，勿回退令牌。
    const TOOLBAR_ACCENT = '#2563eb';
    const TOOLBAR_ACCENT_TEXT = '#ffffff';
    const REMOTE_CONTRIBUTION = {
      package: '@local/dsh-browser-kit',
      descriptors: [
        ['reportClient', ['findings'], 'reportClient(findings): Promise<{ok:true, savedAt}|{ok:false, error}>', []],
        ['saveShot', ['meta', 'dataUrl'], 'saveShot(meta, dataUrl): Promise<{ok:true, path, bytes}|{ok:false, error}>', []],
        ['saveAnnotations', ['markdown', 'meta'], 'saveAnnotations(markdown, meta?): Promise<{ok:true, path, bytes}|{ok:false, error}>', ['meta']],
        ['saveMerged', ['sets', 'meta'], 'saveMerged(sets, meta?): Promise<{ok:true, path, bytes, count}|{ok:false, error}>（多面板合并：sets=[{url,title,annotations[]}]，host 重编号构建单个协议文件）', ['meta']],
        ['deleteAnnotations', ['path'], 'deleteAnnotations(path): Promise<{ok:true, removedFile, removedIndexEntries}|{ok:false, error}>（撤回：仅限 annotations/ 目录内，删文件 + 清对应索引行）', []],
        ['getStats', [], 'getStats(): Promise<{ok:true, annotations:{count,bytes}, shots:{count,bytes}}|{ok:false, error}>（批注/截图数量与字节统计，供插件管理面板）', []],
        ['clearArtifacts', ['kind'], "clearArtifacts(kind): Promise<{ok:true, removed}|{ok:false, error}>（一键清空：kind='annotations'|'shots'|'all'）", []],
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
    /** 等 remote svc 就绪（27×300ms）。C13：reportToHost 与 apply 内 waitSvc 共用同一实现。 */
    async function waitForSvc(stateRef) {
      for (let i = 0; i < 27; i++) {
        const svc = stateRef.getRemote ? stateRef.getRemote() : null;
        if (svc) return svc;
        await sleep(300);
      }
      return null;
    }

    async function reportToHost(stateRef, findings) {
      const result = { attempted: false, mounted: null, response: null, error: null };
      try {
        result.attempted = true;
        // $mount 未成功时不再重复挂载（apply 里已挂过）；这里只等服务就绪
        const svc = await waitForSvc(stateRef);
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
      // 默认隐藏（用户要求），可经命令 panel-toggle 唤出/再隐藏；显隐持久化，跨刷新有效
      const [hidden, setHidden] = useState(readPanelHidden);
      useEffect(() => {
        const onToggle = () => setHidden(readPanelHidden());
        window.addEventListener(PANEL_TOGGLE_EVENT, onToggle);
        return () => window.removeEventListener(PANEL_TOGGLE_EVENT, onToggle);
      }, []);
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
            display: hidden ? 'none' : 'block',
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
            h('span', {
              style: { display: 'inline-flex', alignItems: 'center' },
              dangerouslySetInnerHTML: { __html: ANNOT_ICON_SVG }, // C9：共享图标常量
            }),
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
            chip: null, // 批注胶囊 saved 模型 { mode:'saved', count, path, items, convo, bornAt }（live 模式由 annot 派生）
            sentChips: [], // 已随消息发出的胶囊模型 FIFO（发送检测后自 chip 迁入；tick 按序配对到会话消息）
            lastToggleError: null,
            clientBootAt: new Date().toISOString(),
            toolbarBtn: null,
            panelCollapsed: false,
            autoLeft: MAX_AUTO_REPROBE,
            autoShotLeft: 1, // 自动截图仅一次（MVP-1 验收），手动截图不限
            mountOk: false,
            mountError: null,
            remoteSvc: null,
            getRemote: () => stateRef.remoteSvc,
          };

          /* ---- 常驻 interval 统一登记：卸载/toggle 时 clearInterval（C6；P20：旧实例
           * interval 与新实例并存会造成双轮询/双写，两个 MutationObserver 已挂 effect，
           * 五个 setInterval 此前漏挂） ---- */
          const trackedIntervals = [];
          const trackInterval = (id) => { trackedIntervals.push(id); return id; };
          try {
            if (typeof ctx?.effect === 'function') {
              ctx.effect(() => {
                for (const id of trackedIntervals.splice(0)) {
                  try { clearInterval(id); } catch { /* ignore */ }
                }
              });
            }
          } catch { /* 清理注册失败不致命 */ }

          /* ---- $mount：把 remote.dshBrowserKit 命名空间挂到本包（apply 时立即做，结果留痕） ---- */
          try {
            const mount = ctx?.remote && ctx.remote.$mount;
            if (typeof mount === 'function') {
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

          // 源缓存按 client 生命周期失效；**版本号即失效机制**（EXPECTED_ANNOT_VERSION bump
          // 触发整体重注入，P28 清场同款）——cache 里的 mtime 字段从不参与比对（C12），已删。
          let annotSourceCache = null; // { source }

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
          const EXPECTED_ANNOT_VERSION = '1.6.0';
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
              annotSourceCache = { source: g.source };
              say('info', `批注层源已获取（${g.bytes} 字节，mtime ${g.mtime}）`);
            }
            await target.executeJavaScript(annotSourceCache.source, true);
            const ok = await target.executeJavaScript('typeof window.__dshKitAnnotator !== "undefined" && window.__dshKitAnnotatorVersion === "' + EXPECTED_ANNOT_VERSION + '"', true);
            if (ok !== true) throw new Error('批注层注入后 API/版本不符');
            return target;
          };

          /** 元素可见性判定（C7：checkVisibility 优先，旧环境退 getClientRects）——
           *  primeSessionInput 与 findComposer 共用，勿再各写一份。 */
          const isVisibleEl = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0);

          /** guest 页元数据回读（C8：mergeAndSave / 单面板提交共用同一表达式与归一化）。 */
          const GUEST_META_JS = '({ url: location.href, title: document.title })';
          const metaOf = (m) => (m && typeof m === 'object' ? { url: m.url ?? m.href ?? null, title: m.title ?? null } : null);

          /** 提交后把提示写入会话输入框（不自动发送）：可见 textarea 优先（原生 value setter +
           *  input 事件），contenteditable 兜底（execCommand insertText——DSH 会话输入框实测为
           *  Lexical 编辑器，此路可用）。**校验必须延迟**：Lexical 异步 reconcile，同步回读必误报
           *  （P30，1.4.x 实测写入成功但回读为空 → 误报失败）。结果记 stateRef.lastPrime 并随
           *  kit-status 上报；只追加不覆盖，绝不清理/改写用户已有内容。 */
          const primeSessionInput = (text) => {
            const startedAt = new Date().toISOString();
            let r = null;
            try {
              const tas = Array.from(document.querySelectorAll('textarea')).filter((el) => isVisibleEl(el) && !el.disabled && !el.readOnly);
              const ta = tas[tas.length - 1] || null;
              if (ta) {
                const cur = ta.value || '';
                const next = cur ? `${cur}\n${text}` : text;
                const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
                if (desc && desc.set) desc.set.call(ta, next);
                else ta.value = next;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                try { ta.focus(); } catch { /* 聚焦失败不影响 */ }
                r = { target: 'textarea', candidates: { textarea: tas.length } };
                setTimeout(() => {
                  const held = (ta.value || '').includes(text); // 延迟回读：受控组件可能回滚
                  stateRef.lastPrime = { at: startedAt, verifiedAt: new Date().toISOString(), ok: held, target: 'textarea' };
                  if (!held) say('warn', '会话输入框提示写入未保持（textarea 受控回滚？）');
                }, 300);
              }
              if (!r) {
                const ces = Array.from(document.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"],[contenteditable=""]')).filter(isVisibleEl); // P36：曾误写 `visible`（未定义标识符）→ 整个 primeSessionInput 抛错、输入框提示永远失败
                const ce = ces[ces.length - 1] || null;
                if (ce) {
                  try { ce.focus(); } catch { /* ignore */ }
                  try {
                    const sel = window.getSelection();
                    if (sel) {
                      const range = document.createRange();
                      range.selectNodeContents(ce);
                      range.collapse(false); // 光标移到末尾，追加不覆盖
                      sel.removeAllRanges();
                      sel.addRange(range);
                    }
                  } catch { /* 选区失败按空内容追加 */ }
                  const cur = (ce.innerText || '').replace(/\n+$/, '');
                  const insert = cur ? `\n${text}` : text;
                  let via = 'execCommand';
                  let done = false;
                  try { done = document.execCommand('insertText', false, insert); } catch { done = false; }
                  if (!done) {
                    via = 'textContent';
                    ce.textContent = cur + insert;
                    ce.dispatchEvent(new InputEvent('input', { bubbles: true }));
                  }
                  r = { target: 'contenteditable', via, candidates: { contenteditable: ces.length, textarea: tas.length } };
                  setTimeout(() => {
                    const held = (ce.innerText || '').includes(text); // 延迟回读：Lexical reconcile 异步
                    stateRef.lastPrime = { at: startedAt, verifiedAt: new Date().toISOString(), ok: held, target: 'contenteditable', via };
                    if (!held) say('warn', '会话输入框提示写入未保持（Lexical 未接受 insertText？）');
                  }, 350);
                }
              }
              if (!r) {
                r = { error: '未找到会话输入框', candidates: { textarea: tas.length, contenteditableAny: document.querySelectorAll('[contenteditable]').length } };
                stateRef.lastPrime = { at: startedAt, ...r };
                say('warn', `会话输入框提示失败：${r.error}`);
                return r;
              }
              stateRef.lastPrime = { at: startedAt, ...r, ok: null, note: '已写入，延迟回读校验中' };
              say('info', `提交提示已写入会话输入框（${r.target}${r.via ? '/' + r.via : ''}；回读校验稍后完成，结果见 kit-status lastPrime）`);
              return { ok: true, pending: true, ...r };
            } catch (e) {
              stateRef.lastPrime = { at: startedAt, ok: false, error: msgOf(e) };
              say('warn', `会话输入框提示失败：${msgOf(e)}`);
              return { ok: false, error: msgOf(e) };
            }
          };

          /** ZCode 式胶囊（用户指定形态）：**输入框卡片内部**左上角「N 条批注 ×」。
           *  - 会话进行中：实时计数（st.annot.count，syncPanes 维护）；× = 清空全部成员批注
           *    （clearAll 全量进删除日志，广播所有窗口同步移除）；
           *  - 提交成功后：saved 模型（stateRef.chip），显示「N 条批注 · 已保存」；× = 撤回
           *    （face 第 8 方法 deleteAnnotations：删文件 + 清索引行，仅限 annotations/ 目录）。
           *  胶囊挂在 document.body（fixed 定位，React 重渲染不吞），锚定 data-composerCard
           *  内侧左上；找不到输入框则不锚定，saved 模型保留，下一轮 tick 输入框出现再挂。
           *  绝不写入/清理用户输入框内容（P30 纪律）。
           *  会话指纹（P31）：DSH 把当前会话标题写进 document.title（后缀 " — DeepSeek Harness"），
           *  切会话即变——胶囊只在与创建时相同的会话显示，跨会话不再泄漏（用户实测反馈）。 */
          const CHIP_ID = 'dsh-kit-annot-chip';
          const convoTitle = () => (document.title || '').replace(/\s*[—–-]\s*DeepSeek Harness\s*$/, '').trim();
          const findComposer = () => {
            const ces = Array.from(document.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"],[contenteditable=""]')).filter(isVisibleEl);
            return ces[ces.length - 1] || null;
          };
          const removeAnnotChip = () => {
            stateRef.chip = null;
            const old = document.getElementById(CHIP_ID);
            if (old) old.remove();
            removeChipSpacer();
          };
          /** ZCode 式布局（用户指定）：胶囊独占卡片内第一行，正文在下不重叠——
           *  往输入框卡片里 data-inputScroll 滚动区之前插一个 30px 占位行，卡片自然变高、
           *  文本被推到下方；胶囊悬浮在这一行上。框架重渲染吞掉占位行时由 tick 重插
           *  （与工具条按钮同款守卫）；胶囊消失时占位行一并移除、卡片还原。 */
          const SPACER_ID = 'dsh-kit-annot-spacer';
          const removeChipSpacer = () => {
            const s = document.getElementById(SPACER_ID);
            if (s) s.remove();
          };
          const ensureChipSpacer = (ce) => {
            let spacer = document.getElementById(SPACER_ID);
            const scrollEl = ce.closest('[data-inputScroll]') || (ce.closest('[data-composer-card]') || ce).querySelector('[data-inputScroll]') || ce;
            if (!spacer || !spacer.isConnected || (scrollEl.parentElement && spacer.parentElement !== scrollEl.parentElement)) {
              if (spacer) spacer.remove();
              spacer = document.createElement('div');
              spacer.id = SPACER_ID;
              spacer.style.cssText = 'height:30px;flex:none;pointer-events:none;';
              if (scrollEl.parentElement) scrollEl.parentElement.insertBefore(spacer, scrollEl);
            }
            return spacer;
          };
          const ensureAnnotChip = () => {
            try {
              const st = stateRef.annot;
              const saved = (stateRef.chip && stateRef.chip.mode === 'saved') ? stateRef.chip : null;
              const liveCount = (st && st.active && typeof st.count === 'number') ? st.count : 0;
              const liveModel = (liveCount > 0 && st.convo) ? { mode: 'live', count: liveCount, convo: st.convo } : null;
              const model = saved || liveModel;
              const existing = document.getElementById(CHIP_ID);
              /* P37 多实例共存：toggle 热换后旧实例的 interval 不被清理（clientModules.rebuilt
               *  不触发旧 effect dispose；removespy 实证三 rev 并存互删）——胶囊认领制：
               *  dataset.ownerBoot = 挂载者 clientBootAt（ISO 字符串可比），仅最新实例可
               *  挂/改/删；旧实例见到别人的胶囊一律退让，消除「挂上即被删」的拉锯。 */
              const ownerBootOf = (el) => (el && el.dataset && el.dataset.ownerBoot) || '';
              const iAmNewer = (el) => !ownerBootOf(el) || String(stateRef.clientBootAt) >= ownerBootOf(el);
              if (!model) {
                if (existing && iAmNewer(existing)) { existing.remove(); removeChipSpacer(); }
                return;
              }
              // P31 会话门控：胶囊只属于创建它的那个会话（标题指纹），切会话即隐藏
              if (model.convo && model.convo !== convoTitle()) {
                try { stateRef.chipGate = { at: new Date().toISOString(), titleNow: document.title, convoNow: convoTitle(), modelConvo: model.convo }; } catch { /* 诊断字段不影响主流程 */ }
                if (existing && iAmNewer(existing)) { existing.remove(); removeChipSpacer(); }
                return;
              }
              const ce = findComposer();
              if (!ce) return; // 输入框暂不可见：不锚定（saved 模型保留，下轮再试）
              if (existing && !iAmNewer(existing)) return; // 更新实例的胶囊在场：本实例退让
              const spacer = ensureChipSpacer(ce); // 胶囊独占一行：正文被推到下方（ZCode 布局）
              let chip = existing;
              if (!chip) {
                chip = document.createElement('div');
                chip.id = CHIP_ID;
                // 双主题适配：只走 DSH 主题令牌（定义在 body 上，胶囊是其子元素直接继承；
                // 明暗切换由令牌重解析自动跟随，零字面色值——与面板/工具条同一纪律）
                chip.style.cssText = 'position:fixed;z-index:2147483646;display:inline-flex;align-items:center;gap:6px;'
                  + 'background:' + T.bg + ';border:1px solid ' + T.border + ';border-radius:999px;'
                  + 'padding:4px 6px 4px 10px;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;'
                  + 'color:' + T.text + ';box-shadow:' + T.shadow + ';user-select:none;';
                const label = document.createElement('span');
                label.setAttribute('data-role', 'label');
                chip.appendChild(label);
                const close = document.createElement('button');
                close.type = 'button';
                close.setAttribute('data-role', 'close');
                close.textContent = '×';
                close.title = '删除批注';
                close.style.cssText = 'border:0;background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.14));'
                  + 'color:var(--dsw-alias-label-primary, #e5e7eb);border-radius:999px;'
                  + 'width:16px;height:16px;line-height:1;font-size:12px;cursor:pointer;display:inline-flex;'
                  + 'align-items:center;justify-content:center;padding:0;';
                chip.appendChild(close);
                if (!document.getElementById('dsh-kit-annot-chip-style')) {
                  // × 的 hover 态（内联样式写不了伪类）：悬停转危险色，令牌随主题
                  const st = document.createElement('style');
                  st.id = 'dsh-kit-annot-chip-style';
                  st.textContent = '#dsh-kit-annot-chip [data-role=close]:hover{'
                    + 'background:var(--dsw-alias-state-error-primary, rgba(220,38,38,0.85))!important;'
                    + 'color:var(--dsw-alias-label-primary-foreground, #ffffff)!important}';
                  document.head.appendChild(st);
                }
                close.addEventListener('click', () => {
                  const m = stateRef.chip;
                  const stNow = stateRef.annot;
                  const isSaved = m && m.mode === 'saved';
                  const liveOn = stNow && stNow.active && typeof stNow.count === 'number' && stNow.count > 0;
                  if (isSaved) {
                    // 撤回：删已保存文件 + 索引行（face 第 8 方法；P29 教训——client/host 两端都已装配）
                    waitSvc().then((svc) => (svc ? svc.deleteAnnotations(m.path) : { ok: false, error: 'host 远端面未就绪' })).then((r) => {
                      if (r && r.ok) {
                        removeAnnotChip();
                        say('info', `已撤回批注文件：${m.path}`);
                      } else {
                        say('warn', `撤回失败：${(r && r.error) || '未知'}`);
                      }
                    }).catch((e) => say('warn', `撤回失败：${msgOf(e)}`));
                  } else if (liveOn) {
                    // 会话中：清空全部成员批注（clearAll 全量进删除日志，广播所有窗口同步移除）
                    for (const p of stNow.panes) {
                      try {
                        p.executeJavaScript('(window.__dshKitAnnotator && window.__dshKitAnnotator.clearAll ? window.__dshKitAnnotator.clearAll() : undefined)', true).catch(() => {});
                      } catch { /* 死面板由同步循环自愈 */ }
                    }
                    say('info', '已清除全部批注（所有窗口同步移除）');
                  }
                });
                // 悬浮富提示（saved 模型才有 items；live 模型只有计数提示）
                chip.addEventListener('mouseenter', () => {
                  const mm = stateRef.chip;
                  if (mm && mm.mode === 'saved') showAnnTip(chip, mm);
                  else chip.title = '点 × 清除全部批注';
                });
                chip.addEventListener('mouseleave', hideAnnTip);
                document.body.appendChild(chip);
              }
              chip.dataset.ownerBoot = String(stateRef.clientBootAt); // P37 认领（新建/接管无主胶囊都要盖戳）
              const label = chip.querySelector('[data-role="label"]');
              const text = model.mode === 'saved' ? `${model.count} 条批注 · 已保存` : `${model.count} 条批注`;
              if (label.textContent !== text) label.textContent = text;
              chip.title = model.mode === 'saved' ? `已保存：${model.path}（× 撤回）` : '点 × 清除全部批注';
              // 定位：胶囊放进占位行（卡片第一行）——与正文互不遮挡；每轮 tick 重定位
              const sr = spacer.getBoundingClientRect();
              chip.style.left = `${Math.max(8, sr.left + 12)}px`;
              chip.style.top = `${Math.max(8, sr.top + 3)}px`;
            } catch { /* 胶囊失败不影响主流程 */ }
          };

          /* ─────────────── 发送前防呆横条（用户需求 2026-10-06，规格 .local/feature-send-guard.md） ───────────────
           *  待发胶囊（saved 模型）不在其归属会话时，在**当前会话**的输入框卡片 spacer 行上
           *  叠一条被动横条，提醒「该批注属于别的会话」——防切会话后遗忘待发批注。归属会话
           *  内显示胶囊、非归属显示横条（convo 判定天然互斥，两者从不同时出现）；胶囊被消耗
           *  或撤回后横条随之消失。锚定复用 ensureChipSpacer + spacer rect（与 ensureAnnotChip
           *  同构：模型→挂载→重定位→P37 认领戳）；绝不写入输入框内容（P30 纪律）。
           *  实机验收（切会话观察横条出现/消失、toggle 热换、多实例）由实施会话负责。 */
          const AWAY_ID = 'dsh-kit-annot-away';
          const ensureAwayBanner = () => {
            try {
              const existing = document.getElementById(AWAY_ID);
              /* P37 认领制（与胶囊同款）：ownerBoot 盖戳、新者胜旧者让——旧实例见到更新实例
               *  的横条一律退让，不挂不改不删。 */
              const ownerBootOf = (el) => (el && el.dataset && el.dataset.ownerBoot) || '';
              const iAmNewer = (el) => !ownerBootOf(el) || String(stateRef.clientBootAt) >= ownerBootOf(el);
              const m = stateRef.chip;
              // 渲染条件（规格钉死，无需新状态）：saved 模型在场且当前不在归属会话
              const away = m && m.mode === 'saved' && m.convo !== convoTitle();
              if (!away) {
                // 无待发胶囊 / 已回归属会话：移除（仅本实例或无主横条可移——P37）
                if (existing && iAmNewer(existing)) existing.remove();
                return;
              }
              if (existing && !iAmNewer(existing)) return; // 更新实例的横条在场：本实例退让
              const ce = findComposer();
              if (!ce) return; // 输入框暂不可见：不锚定（模型保留，下轮再试）
              const spacer = ensureChipSpacer(ce);
              let banner = existing;
              if (!banner) {
                banner = document.createElement('div');
                banner.id = AWAY_ID;
                // 双主题：只走 T 令牌（零字面色值）；纯提示无交互 → pointer-events:none 不挡输入框
                banner.style.cssText = 'position:fixed;z-index:2147483646;display:inline-flex;align-items:center;'
                  + 'pointer-events:none;user-select:none;background:' + T.bg + ';border:1px solid ' + T.border
                  + ';border-radius:999px;padding:4px 10px;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;'
                  + 'color:' + T.text + ';box-shadow:' + T.shadow + ';';
                document.body.appendChild(banner);
              }
              banner.dataset.ownerBoot = String(stateRef.clientBootAt); // P37 认领戳
              // 文案模板（规格钉死；count 容错取数）
              const text = `⏸ 会话「${stateRef.chip.convo}」有 ${Number(stateRef.chip.count) || 0} 条批注待发送`;
              if (banner.textContent !== text) banner.textContent = text; // 幂等：内容不变不重排
              // 定位：与胶囊同位不同时——叠在 spacer 行上（每轮 tick 重定位）
              const sr = spacer.getBoundingClientRect();
              banner.style.left = `${Math.max(8, sr.left + 12)}px`;
              banner.style.top = `${Math.max(8, sr.top + 3)}px`;
            } catch { /* 横条失败不影响主流程 */ }
          };

          /* ─────────────── 发送消耗 + 会话内消息胶囊（用户需求 2026-10-05） ───────────────
           *  批注为单次消耗：输入框胶囊是「待发送」态；检测到用户**发出了新消息**（会话内
           *  userRow 行数增长/末行变化）→ 输入框胶囊消耗移除，改为在该条消息气泡尾部挂
           *  会话胶囊「N 条批注」，hover 出富提示（延续悬浮提示），× 仍撤回（删已保存文件）。
           *  常规流中协议块只进剪贴板（用户手动粘贴），消息文本不含标记——故发送信号用
           *  userRow 结构（CSS-module 哈希前缀 + 稳定后缀 `_userRow`），不依赖消息内容。
           *  配对规则：本会话模型按提交顺序 ↔ 末尾 N 条 userRow（消息恒追加在末尾，按序
           *  稳定；DSH 重渲染吞掉胶囊后由 tick 幂等重挂；撤回的模型占位不配对错位）。
           *  会话门控（P31 同款标题指纹）：模型只在其创建会话内消耗/显示，跨会话不配对。 */
          /** 会话流里的用户消息行（后缀稳定；哈希前缀随构建变化，勿按全类名匹配）。 */
          const userRows = () => Array.from(document.querySelectorAll('[class*="_userRow"]'));
          /** 共享悬浮提示（延续页面徽标 hover 提示；主题令牌配色，pointer-events 关闭）。 */
          const ANN_TIP_ID = 'dsh-kit-ann-tip';
          /** 选择器美化显示（仅悬浮提示；文件里保持精确原值）：截末两级 + 剔哈希类
           *  （CSS-module 纯 hex/下划线短 token，如 ._4c2065e/.c994dda2）+ 剔 :nth-of-type 噪音。 */
          const prettySel = (sel) => {
            const tail = String(sel || '').split(' > ').slice(-2).join(' > ');
            const out = tail
              .replace(/:nth-of-type\(\d+\)/g, '')
              .replace(/\.([0-9A-Za-z_-]+)/g, (m0, cls) => (/^_?[0-9a-f]{6,}$/i.test(cls) ? '' : m0))
              .replace(/\s+/g, ' ')
              .trim();
            return out || String(sel || '');
          };
          const hideAnnTip = () => {
            const t = document.getElementById(ANN_TIP_ID);
            if (t) t.style.display = 'none';
          };
          const showAnnTip = (anchor, model) => {
            let tip = document.getElementById(ANN_TIP_ID);
            if (!tip || !tip.isConnected) {
              tip = document.createElement('div');
              tip.id = ANN_TIP_ID;
              tip.style.cssText = 'position:fixed;z-index:2147483647;display:none;max-width:380px;'
                + 'background:' + T.bg + ';border:1px solid ' + T.border + ';border-radius:8px;'
                + 'padding:8px 10px;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;'
                + 'color:' + T.text + ';box-shadow:' + T.shadow + ';pointer-events:none;user-select:none;';
              document.body.appendChild(tip);
            }
            tip.textContent = '';
            const head = document.createElement('div');
            head.style.cssText = 'font-weight:600;margin-bottom:4px;';
            head.textContent = `已提交 ${model.count} 条批注`;
            tip.appendChild(head);
            for (const it of (model.items || []).slice(0, 8)) {
              const row = document.createElement('div');
              row.style.cssText = 'display:flex;gap:6px;align-items:baseline;white-space:nowrap;overflow:hidden;';
              const no = document.createElement('span');
              no.style.cssText = 'color:' + T.accent + ';flex:none;';
              no.textContent = `${it.index}.`;
              const sel = document.createElement('span');
              sel.style.cssText = 'font-family:' + T.mono + ';color:' + T.text2 + ';flex:none;max-width:60%;overflow:hidden;text-overflow:ellipsis;';
              sel.textContent = prettySel(it.selector) || '(无选择器)';
              const txt = String(it.text || '');
              if (txt) {
                const txtEl = document.createElement('span');
                txtEl.style.cssText = 'color:' + T.text3 + ';overflow:hidden;text-overflow:ellipsis;';
                txtEl.textContent = txt;
                row.appendChild(no);
                row.appendChild(sel);
                row.appendChild(txtEl);
              } else {
                row.appendChild(no);
                row.appendChild(sel);
              }
              tip.appendChild(row);
            }
            const rest = (model.items || []).length - 8;
            if (rest > 0) {
              const more = document.createElement('div');
              more.style.cssText = 'color:' + T.text3 + ';margin-top:2px;';
              more.textContent = `…共 ${model.count} 条`;
              tip.appendChild(more);
            }
            tip.style.display = 'block';
            tip.style.visibility = 'hidden';
            const r = anchor.getBoundingClientRect();
            let left = Math.min(Math.max(8, r.left), window.innerWidth - tip.offsetWidth - 8);
            let top = r.top - tip.offsetHeight - 8;
            if (top < 8) top = r.bottom + 8;
            tip.style.left = `${Math.max(8, left)}px`;
            tip.style.top = `${Math.max(8, top)}px`;
            tip.style.visibility = 'visible';
          };
          /** 撤回共用（输入框/会话两处胶囊同源）：删已保存文件，文件已不在也视为撤回。 */
          const retractSaved = (model) => {
            waitSvc().then((svc) => (svc ? svc.deleteAnnotations(model.path) : { ok: false, error: 'host 远端面未就绪' })).then((r) => {
              if (r && r.ok) say('info', `已撤回批注文件：${model.path}`);
              else if (r && /不存在/.test(String(r.error || ''))) say('info', `批注文件已不在（视为撤回）：${model.path}`);
              else say('warn', `撤回失败：${(r && r.error) || '未知'}`);
            }).catch((e) => say('warn', `撤回失败：${msgOf(e)}`));
          };
          /** 在消息 holder 尾部挂「N 条批注」胶囊（幂等：已挂即跳过）。 */
          const attachMsgChip = (holder, model) => {
            const wrap = document.createElement('span');
            wrap.setAttribute('data-dsh-kit-ann-msg', String(model.count));
            wrap.style.cssText = 'display:flex;width:100%;margin:2px 0 10px 0;'; // 下 10px：与消息文本拉开间距（用户 2026-10-05 反馈）
            const chip = document.createElement('span');
            chip.style.cssText = 'display:inline-flex;width:fit-content;align-items:center;gap:6px;'
              + 'background:' + T.bg + ';border:1px solid ' + T.border + ';border-radius:999px;'
              + 'padding:3px 6px 3px 10px;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;'
              + 'color:' + T.text + ';box-shadow:' + T.shadow + ';user-select:none;';
            const label = document.createElement('span');
            label.textContent = `${model.count} 条批注`;
            chip.appendChild(label);
            const close = document.createElement('button');
            close.type = 'button';
            close.setAttribute('data-role', 'close');
            close.textContent = '×';
            close.title = '撤回（删除已保存批注文件）';
            close.style.cssText = 'border:0;background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.14));'
              + 'color:var(--dsw-alias-label-primary, #e5e7eb);border-radius:999px;'
              + 'width:16px;height:16px;line-height:1;font-size:12px;cursor:pointer;display:inline-flex;'
              + 'align-items:center;justify-content:center;padding:0;';
            chip.appendChild(close);
            if (!document.getElementById('dsh-kit-ann-msg-style')) {
              // × 的 hover 危险色（伪类走 style 标签，与输入框胶囊同款纪律）
              const st = document.createElement('style');
              st.id = 'dsh-kit-ann-msg-style';
              st.textContent = '[data-dsh-kit-ann-msg] [data-role=close]:hover{'
                + 'background:var(--dsw-alias-state-error-primary, rgba(220,38,38,0.85))!important;'
                + 'color:var(--dsw-alias-label-primary-foreground, #ffffff)!important}';
              document.head.appendChild(st);
            }
            chip.addEventListener('mouseenter', () => showAnnTip(chip, model));
            chip.addEventListener('mouseleave', hideAnnTip);
            close.addEventListener('click', () => {
              model.retracted = true; // 占住配对位（防下轮 tick 重挂），不删除模型本身
              wrap.remove();
              hideAnnTip();
              retractSaved(model);
            });
            wrap.appendChild(chip);
            // 插入位置（用户需求 2026-10-05）：消息文本上方——跳过开头的纯图片节点（图片最上），
            // 插到首个含文本的子节点之前；无子节点时兜底插到最前。
            let anchor = null;
            for (const child of holder.children) {
              if ((child.textContent || '').trim()) { anchor = child; break; }
            }
            if (anchor) holder.insertBefore(wrap, anchor);
            else if (holder.firstChild) holder.insertBefore(wrap, holder.firstChild);
            else holder.appendChild(wrap);
          };
          /** 行身份键（归属跟踪用；空白归一，取前 120 字）。 */
          const rowKey = (row) => (row && row.textContent ? row.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : '');
          /** 每轮 tick：发送消耗检测 + 归属行补挂（幂等）。
           *  消耗判定（视图签名防跨会话误耗）：顶行键未变（同一会话视图）且「行数增长或末行键
           *  变化」才算发送；顶行键变了 = 切了会话/视图被虚拟化重组 → **重置基线**、胶囊保留
           *  待命（用户 2026-10-05 报告：跨会话误耗带入旧批注，根因正是末行键跨视图比对）。
           *  挂载：消耗瞬间定位归属行（末行）并记 attachedKey；此后只补【归属行】缺失的胶囊，
           *  绝不再做「末尾 N 条」配对——否则同一模型随新消息一路扩散（同报告第二症状）。 */
          const ensureConvoChips = () => {
            try {
              const convo = convoTitle();
              const queue = (stateRef.sentChips = stateRef.sentChips || []);
              if (queue.length > 100) queue.splice(0, queue.length - 100);
              const rows = userRows();
              const sig = { n: rows.length, first: rowKey(rows[0] || null), last: rowKey(rows[rows.length - 1] || null) };
              // 1) 发送消耗检测（视图签名基线）
              const m = stateRef.chip;
              if (m && m.mode === 'saved' && m.convo === convo) {
                const base = m.base || { n: rows.length, first: sig.first, last: sig.last };
                const sameView = sig.first === base.first;
                if (sameView && (sig.n > base.n || (sig.last !== base.last && sig.n >= base.n))) {
                  queue.push(m);
                  stateRef.chip = null;
                  removeAnnotChip();
                  const target = rows[rows.length - 1];
                  if (target) {
                    m.attachedKey = sig.last; // 锁定归属行：此后只补这一条
                    const holder = target.querySelector('[class*="_bubble"]') || target;
                    if (!holder.querySelector('[data-dsh-kit-ann-msg]')) attachMsgChip(holder, m);
                  }
                } else if (!sameView) {
                  m.base = sig; // 视图变更（切会话/虚拟化重组）：重置基线，胶囊保留待命
                }
              }
              // 2) 归属行补挂（只认 attachedKey；撤回模型/他会话模型一律跳过，不外溢）
              for (const model of queue) {
                if (!model.attachedKey || model.retracted || model.convo !== convo) continue;
                const target = rows.find((r) => rowKey(r) === model.attachedKey);
                if (!target) continue; // 归属行不在 DOM（虚拟化/他会话）：跳过
                const holder = target.querySelector('[class*="_bubble"]') || target;
                if (holder.querySelector('[data-dsh-kit-ann-msg]')) continue;
                attachMsgChip(holder, model);
              }
            } catch { /* 失败不影响主流程 */ }
          };

          /* ─────────────── 消息引用插入（用户需求 2026-10-06，规格 .local/feature-message-quote.md） ───────────────
           *  悬浮历史消息行（用户行/assistant 行）→ 行内浮出「引用」按钮 → 点击把引用块
           *  `> [发送者 · 时间] 摘录` 追加进会话输入框（走 primeSessionInput 只追加管线，
           *  P30 纪律：绝不清空/改写草稿，光标由管线落在末尾；连续引用 = 追加多个块）。
           *  按钮仅存在于 hover 态行（不做全量常驻），React 重渲染吞掉后由 tick 幂等补挂；
           *  P37 认领戳防多实例互删。assistant 行结构未实机确认——按规格兜底（语义后缀
           *  _body/_content + userRow 平级兄弟），实机复核与选择器修正为实施会话专责。 */
          const QUOTE_BTN_ID = 'dsh-kit-quote-btn';
          const QUOTE_MAX_CHARS = 300;
          /** 行文本内首个 HH:MM 时间戳（规格正则；无则空串）。 */
          const extractTime = (rowText) => {
            const m = /\b([01]?\d|2[0-3]):[0-5]\d\b/.exec(String(rowText || ''));
            return m ? m[0] : '';
          };
          /** 引用块组装（纯函数）：摘录 = rowText 去掉尾部时间戳后的纯文本（空白归一），
           *  300 字截断带 …；输出 `> [发送者 · 时间] 摘录\n`（时间可缺席；末尾单换行、
           *  不带空行——拼接由调用方控制）；摘录为空 → ''（调用方跳过追加）。 */
          const buildQuoteBlock = (rowText, senderLabel, timeText) => {
            const raw = String(rowText || '');
            let excerpt = raw.replace(/\s*\b(?:[01]?\d|2[0-3]):[0-5]\d\b\s*$/, '');
            excerpt = excerpt.replace(/\s+/g, ' ').trim();
            if (!excerpt) return '';
            const clipped = excerpt.length > QUOTE_MAX_CHARS ? excerpt.slice(0, QUOTE_MAX_CHARS) + '…' : excerpt;
            const head = `${String(senderLabel || '')}${timeText ? ' · ' + timeText : ''}`;
            return `> [${head}] ${clipped}\n`;
          };
          /** 消息行识别：userRow 已知稳定；assistant 行按语义后缀兜底——自 target 向上取
           *  最外层含 _content 的 _body 行（勿按全类名匹配，哈希前缀随构建变化）。 */
          const quoteRowOf = (el) => {
            if (!el || el.nodeType !== 1 || !el.closest) return null;
            const ur = el.closest('[class*="_userRow"]');
            if (ur) return ur;
            let best = null;
            for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
              const cls = (cur.getAttribute && cur.getAttribute('class')) || '';
              if (cls.includes('_body') && cur.querySelector('[class*="_content"]')) best = cur;
            }
            return best && !best.closest('[class*="_userRow"]') ? best : null;
          };
          const quoteOwnerOf = (el) => (el && el.dataset && el.dataset.ownerBoot) || '';
          const quoteIAmNewer = (el) => !quoteOwnerOf(el) || String(stateRef.clientBootAt) >= quoteOwnerOf(el);
          let quoteHoverRow = null; // 当前 hover 的消息行（引用按钮的唯一宿主，单例按钮随之挪动）
          /** 按钮挂进 hover 行（幂等单例：换行即挪；P37：更新实例的按钮在场则退让）。 */
          const mountQuoteBtn = (row) => {
            if (!row || !row.isConnected) return;
            const existing = document.getElementById(QUOTE_BTN_ID);
            if (existing && !quoteIAmNewer(existing)) return; // P37 退让
            if (existing && existing.parentElement === row) {
              existing.dataset.ownerBoot = String(stateRef.clientBootAt);
              return;
            }
            if (existing) existing.remove();
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = QUOTE_BTN_ID;
            btn.textContent = '❝ 引用';
            btn.style.cssText = 'position:absolute;top:4px;right:6px;z-index:2147483646;border:1px solid ' + T.border
              + ';background:' + T.bg + ';color:' + T.text + ';border-radius:999px;padding:2px 8px;cursor:pointer;'
              + 'font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;box-shadow:' + T.shadow + ';';
            btn.dataset.ownerBoot = String(stateRef.clientBootAt); // P37 认领戳
            btn.addEventListener('click', (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              const rowNow = ev.currentTarget.parentElement;
              if (!rowNow) return;
              const label = ((rowNow.getAttribute('class') || '').includes('_userRow')) ? '用户' : 'AI';
              const rowText = rowNow.textContent || '';
              // 引用点击时即时取行文本（规格：无需持久状态）；非空先补空行（§3.2），P30 只追加
              const block = buildQuoteBlock(rowText, label, extractTime(rowText));
              if (block) primeSessionInput(quoteLeadIfNeeded(block));
            });
            if (getComputedStyle(row).position === 'static') row.style.position = 'relative'; // 行内 absolute 锚定
            row.appendChild(btn);
          };
          const removeQuoteBtn = () => {
            const btn = document.getElementById(QUOTE_BTN_ID);
            if (btn && quoteIAmNewer(btn)) btn.remove(); // 仅本实例（或无主）可移除（P37）
          };
          /** 输入框非空先补一个空行再写引用块（primeSessionInput 的 join 是单换行）。
           *  探测只读 contenteditable——DSH 会话输入框实测形态；textarea 场景按空输入处理。 */
          const quoteLeadIfNeeded = (block) => {
            try {
              const ce = findComposer();
              if (ce && String(ce.innerText || '').trim()) return `\n${block}`;
            } catch { /* 探测失败按空输入处理 */ }
            return block;
          };
          /** hover 事件委托（capture：页面 stopPropagation 也拦得住）。 */
          const onQuoteOver = (e) => {
            const row = quoteRowOf(e.target);
            if (row === quoteHoverRow) return;
            quoteHoverRow = row;
            if (row) mountQuoteBtn(row);
            else removeQuoteBtn();
          };
          const onQuoteOut = (e) => {
            const row = quoteHoverRow;
            if (!row) return;
            const to = e.relatedTarget;
            if (to && row.contains(to)) return; // 行内移动不触发
            quoteHoverRow = null;
            removeQuoteBtn();
          };
          /** tick repair（规格：仅 hover 态行补挂，不做全量常驻）：React 重渲染吞按钮的兜底。 */
          const ensureQuoteButtons = () => {
            try {
              const btn = document.getElementById(QUOTE_BTN_ID);
              if (btn && !quoteIAmNewer(btn)) return; // P37 退让
              const row = quoteHoverRow;
              if (!row || !row.isConnected || !row.matches(':hover')) {
                quoteHoverRow = null; // 事件漏网兜底：以 :hover 真值为准
                if (btn) btn.remove();
                return;
              }
              if (!btn || btn.parentElement !== row) mountQuoteBtn(row);
            } catch { /* 失败不影响主流程 */ }
          };
          document.addEventListener('mouseover', onQuoteOver, true);
          document.addEventListener('mouseout', onQuoteOut, true);
          if (typeof ctx !== 'undefined' && ctx && typeof ctx.effect === 'function') {
            ctx.effect(() => () => { // 实例 dispose：摘除委托监听与按钮（旧实例 interval 永生不受此控，P37）
              document.removeEventListener('mouseover', onQuoteOver, true);
              document.removeEventListener('mouseout', onQuoteOut, true);
              removeQuoteBtn();
            });
          }

          /** 提交成功 → 挂「N 条批注 · 已保存」胶囊（× 可撤回）；输入框找不到才退回文本提示。 */
          const announceSubmission = (r) => {
            if (!r || r.ok !== true || !r.path) return;
            const n = Number(r.count);
            const rowsNow = userRows(); // 发送检测基线（视图签名：行数 + 顶/末行键，提交时点快照）
            stateRef.chip = {
              mode: 'saved',
              count: Number.isFinite(n) && n > 0 ? n : 0,
              path: r.path,
              convo: convoTitle(),
              items: Array.isArray(r.items) ? r.items : [], // 会话胶囊 hover 提示数据
              bornAt: new Date().toISOString(),
              base: { n: rowsNow.length, first: rowKey(rowsNow[0] || null), last: rowKey(rowsNow[rowsNow.length - 1] || null) },
            };
            ensureAnnotChip();
            if (!document.getElementById(CHIP_ID)) {
              const c = Number.isFinite(n) && n > 0 ? n : 0;
              primeSessionInput(`${c > 0 ? `已提交 ${c} 条元素批注` : '元素批注已提交'}：${r.path}`);
            }
          };

          const sessionSettled = async (winner) => {
            const st = stateRef.annot;
            if (!st || !st.active) return;
            st.pending = (st.pending || []).filter((e) => e.pane !== winner.pane);
            if (winner.how === 'submitted') {
              const r = await mergeAndSave();
              // 单次消耗（用户需求 2026-10-05）：提交即全窗口清空——逐面板 stop + clearAll
              // （clearAll 全量 gid 进删除日志），随后趁 st.active 仍真跑一轮 syncPanes 把
              // 删除广播到所有窗口。旧实现 stopAllPanes(true) 的 clear() 在 stop 之后
              // session=null（removeBadges 已由 endSession 兜住）且**不写删除日志**，若
              // 1.5s 同步圈恰好落在逐面板清空中段，会把成员批注从其他窗口推回来。
              for (const p of st.panes) {
                try {
                  await p.executeJavaScript('(function(){ var a = window.__dshKitAnnotator; if (!a) return 0; if (a.stop) a.stop(); if (a.clearAll) a.clearAll(); return 1; })()', true);
                } catch { /* 面板已关闭等：死面板由后续刷新自愈 */ }
              }
              try { await syncPanes(); } catch { /* 广播失败：删除日志仍在，后续自愈 */ }
              st.active = false;
              st.panes = [];
              st.lastSaved = r && r.ok ? r : null;
              if (r && r.ok === false) st.error = r.error;
              st.origins = {}; // 编号来源表随会话结束清空
              st.originUrls = {}; // 来源页 URL 表（同页门控用）随会话结束清空
              st.pending = [];
              if (st.leftIds) st.leftIds.clear(); // 显式退出记忆随会话结束清空
              announceSubmission(r); // 会话输入框提示（N 条 + 路径）
              say('info', `共享批注会话提交完成（单次消耗，批注已全窗口清空）：${r && r.ok ? r.path : r.error}`);
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
          const mergeAndSave = async () => {
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
                  meta = metaOf(await p.executeJavaScript(GUEST_META_JS, true));
                } catch { /* 元数据失败不拦合并 */ }
                if (lst.length > 0) sets.push({ url: (meta && meta.url) || null, title: (meta && meta.title) || null, annotations: lst });
              } catch { /* 成员不可达：跳过 */ }
            }
            if (sets.length === 0) return { ok: false, error: '无可提交批注' };
            // 摘要（会话胶囊 hover 提示用）：编号/gid/选择器/文本片段，按编号排序。
            // 与 host saveMerged 同款 gid 去重——共享会话下同一批注会同步进多个面板，
            // 原始 sets 含重复条目（实测：count=1 但悬浮提示出 2 行重复，用户 2026-10-05 报告）。
            const items = [];
            const seenGids = {};
            for (const s of sets) {
              for (const a of s.annotations || []) {
                if (a.gid) {
                  if (seenGids[a.gid]) continue;
                  seenGids[a.gid] = true;
                }
                items.push({
                  index: Number(a.index) || 0,
                  gid: a.gid || null,
                  selector: String((a.element && a.element.selector) || ''),
                  text: String((a.element && a.element.text) || (a.element && a.element.accessibleName) || '').slice(0, 60),
                  url: s.url || null,
                });
              }
            }
            items.sort((x, y) => x.index - y.index);
            return Object.assign({}, unwrap(await svc.saveMerged(sets, null)), { items });
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
            stateRef.annot = { active: true, panes: [target], pending: [], origins: {}, originUrls: {}, leftIds: new Set(), count: 0, convo: convoTitle(), startedAt: new Date().toISOString(), lastSaved: null, error: null };
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
          /* @annotator-sync-canonical-begin（A1：与 src/annotator-sync.mjs 的 planPaneSync 同源，
           * test/annotator-sync-parity 双实现对拍防漂移；本文件是普通脚本不能 import ESM。
           * 身份约定：states[].id = paneIdOf(webview)，origins 值域同域（C4）。） */
          const planPaneSync = (states, origins, originUrls) => {
            const nextOrigins = { ...origins };
            const nextOriginUrls = { ...originUrls };
            // 登记新 gid 的来源面板与来源页 URL（首次出现处）
            for (const s of states) {
              for (const a of s.list || []) {
                if (a.gid && !(a.gid in nextOrigins)) {
                  nextOrigins[a.gid] = s.id;
                  nextOriginUrls[a.gid] = s.url || '';
                }
              }
            }
            // 删除判定：gid 出现在任意删除日志，或来源面板已无此 gid（dead 面板不参与判定）
            const removedGids = {};
            for (const s of states) {
              for (const g of s.deleted || []) removedGids[g] = true;
            }
            for (const gid of Object.keys(nextOrigins)) {
              const origin = nextOrigins[gid];
              const originState = states.find((s) => s.id === origin);
              if (originState && !originState.dead && !(originState.list || []).some((a) => a.gid === gid)) {
                removedGids[gid] = true;
              }
            }
            // 合并视图（未被删除的 gid；先到先得去重——顺序即 states 顺序）
            const union = [];
            const seen = {};
            for (const s of states) {
              for (const a of s.list || []) {
                if (a.gid && !seen[a.gid] && !removedGids[a.gid]) {
                  seen[a.gid] = true;
                  union.push({ item: a, origin: nextOrigins[a.gid] || null });
                }
              }
            }
            // 推送计划：每个面板缺的、且来源不是它自己的项（附 _originUrl 供同页门控）
            const pushes = [];
            for (const s of states) {
              if (s.dead) continue;
              const mine = {};
              for (const a of s.list || []) if (a.gid) mine[a.gid] = true;
              const items = union
                .filter((u) => u.origin !== s.id && !mine[u.item.gid])
                .map((u) => ({ ...u.item, _originUrl: nextOriginUrls[u.item.gid] || null }));
              if (items.length > 0) pushes.push({ id: s.id, items });
            }
            // 删除广播计划 + 来源表清理（originUrls 一并清，防泄漏）
            const removals = [];
            for (const gid of Object.keys(removedGids)) {
              const targets = [];
              for (const s of states) {
                if (s.dead) continue;
                if ((s.list || []).some((a) => a.gid === gid)) targets.push(s.id);
              }
              if (targets.length > 0) removals.push({ gid, targets });
              delete nextOrigins[gid];
              delete nextOriginUrls[gid];
            }
            return { union, removedGids, pushes, removals, nextOrigins, nextOriginUrls };
          };
          /* @annotator-sync-canonical-end */

          let syncBusy = false;
          const syncPanes = async () => {
            const st = stateRef.annot;
            if (!st || !st.active || syncBusy) return;
            refreshPanes(); // 重渲染换节点后按 webContentsId 映射回活节点
            if (st.panes.length < 1) return;
            // 单面板也走完整同步：count/union 需要更新（C3——旧守卫 <2 使单窗口会话
            // 恒 count=0，面板徽标与 live 胶囊永不出现）；<2 时仅跳过跨面板推送段
            syncBusy = true;
            try {
              const states = [];
              for (const p of st.panes) {
                try {
                  // url+list+deleted 一次往返取回；url 用于同页门控（徽标只渲染在 origin 同页，防串窗）
                  const snap = await p.executeJavaScript('({ href: location.href, list: (window.__dshKitAnnotator ? window.__dshKitAnnotator.list() : []), deleted: (window.__dshKitDeletedGids || []) })', true);
                  const o = (snap && typeof snap === 'object') ? snap : {};
                  states.push({ pane: p, id: paneIdOf(p), url: String(o.href || ''), list: Array.isArray(o.list) ? o.list : [], deleted: Array.isArray(o.deleted) ? o.deleted : [] });
                } catch {
                  states.push({ pane: p, id: paneIdOf(p), url: '', list: [], deleted: [], dead: true });
                  continue;
                }
              }
              // 同步判定抽为纯函数（A1，src/annotator-sync.mjs 正典 + 此处内嵌副本，parity 测试防漂移）：
              // 登记/删除判定/合并/推送/广播计划全部可单测；此处只做 I/O 执行。C4：origins 值域 = paneId。
              const plan = planPaneSync(
                states.map((s) => ({ id: s.id, url: s.url, list: s.list, deleted: s.deleted, dead: !!s.dead })),
                st.origins || {},
                st.originUrls || {},
              );
              st.origins = plan.nextOrigins;
              st.originUrls = plan.nextOriginUrls;
              // 执行推送（addExternal 按 gid 幂等；_originUrl 供同页门控防串窗）
              for (const push of plan.pushes) {
                const target = states.find((s) => s.id === push.id);
                if (!target) continue;
                try {
                  await target.pane.executeJavaScript('window.__dshKitAnnotator.addExternal(' + JSON.stringify(push.items) + ')', true);
                } catch { /* 推送失败下轮重试 */ }
              }
              // 执行删除广播
              for (const rm of plan.removals) {
                for (const tid of rm.targets) {
                  const target = states.find((s) => s.id === tid);
                  if (!target) continue;
                  try {
                    await target.pane.executeJavaScript('window.__dshKitAnnotator.removeExternal(' + JSON.stringify(rm.gid) + ')', true);
                  } catch { /* 下轮重试 */ }
                }
              }
              st.count = plan.union.length;
              st.syncDiag = {
                at: new Date().toISOString(),
                panes: states.map((s) => ({ dead: !!s.dead, count: s.list.length })),
                unionLen: plan.union.length,
                removed: Object.keys(plan.removedGids).length,
              };
            } finally {
              syncBusy = false;
            }
          };
          trackInterval(setInterval(() => { syncPanes().catch(() => {}); }, 1500));

          /* ─────────────── MVP-4 种子：命令通道（实施会话写 .data/command.json 驱动） ─────────────── */

          let cmdBusy = false;
          let cmdEpoch = 0; // 看门狗代际（C14）：强制复位推进代际，过期 finally 不清新 busy
          /** guest 内取「自动化目标文档」：优先 kit 沙箱 iframe（page-open 建立），否则顶层。 */
          const TARGET_DOC_SNIPPET =
            'var DOC = (function () { var f = document.querySelector("iframe[data-dsh-kit-frame]"); try { return f && f.contentDocument ? f.contentDocument : document; } catch (e) { return document; } })();';
          /* 命令处理器分域清单（C2 拆表）：action → async (svc, c) => result。
           * 动作全量清单与唯一性由静态契约钉死（plugin-impl §3.9）；case 体与拆表前逐字一致。 */
          const commandHandlers = {
            'inject-annotator': async function (svc, c) {
                  await ensureAnnotator(svc);
                  return { ok: true, injected: true };
                }
            ,
            'start-annotator': async function (svc, c) {
                  // 不能 await：会话直到提交/Esc 才结束，await 会卡死命令轮询（cmdBusy）
                  const target = pickGuestEl();
                  togglePaneAnnot(target).then((r) => {
                    say('info', `批注（命令触发）：${JSON.stringify(r).slice(0, 120)}`);
                  }).catch(() => {});
                  return { ok: true, started: true };
                }
            ,
            'toggle-pane': async function (svc, c) {
                  // 指定面板加入/退出共享会话（tab 0 起；省略 = 第一个）
                  const els = Array.from(document.querySelectorAll('webview'));
                  const pane = els[Number(c.tab) || 0];
                  if (!pane) return { ok: false, error: 'no pane: tab=' + c.tab };
                  togglePaneAnnot(pane).then((r) => {
                    say('info', `面板 ${c.tab} 批注：${JSON.stringify(r).slice(0, 120)}`);
                  }).catch((e) => { stateRef.lastToggleError = msgOf(e); });
                  return { ok: true, toggling: true };
                }
            ,
            'stop-annotator': async function (svc, c) {
                  const target = pickGuestEl();
                  await leavePane(target);
                  if (stateRef.annot) {
                    // 按 webContentsId 比对（P27 同族：元素身份在重渲染换节点后会失配）
                    const tid = paneIdOf(target);
                    stateRef.annot.panes = stateRef.annot.panes.filter((p) => paneIdOf(p) !== tid);
                    if (stateRef.annot.panes.length === 0) stateRef.annot.active = false;
                  }
                  return { ok: true };
                }
            ,
            'annotator-status': async function (svc, c) {
                  const target = pickGuestEl();
                  const st = await target.executeJavaScript('(function(){ if (typeof window.__dshKitAnnotator === "undefined") return { injected: false }; return { injected: true, count: window.__dshKitAnnotator.list().length, first: window.__dshKitAnnotator.list()[0] || null }; })()', true);
                  return { ok: true, ...st };
                }
            ,
            'guest-eval': async function (svc, c) {
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
            ,
            'page-open': async function (svc, c) {
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
            ,
            'kit-status': async function (svc, c) {
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
                    lastSaved: (stateRef.annot && stateRef.annot.lastSaved) || null,
                    lastPrime: stateRef.lastPrime || null, // 提交提示写入输入框的结果（含回读校验与候选诊断）
                    panelHidden: readPanelHidden(),
                    cardRender: stateRef.cardRender || null, // 插件管理卡片最近一次渲染取证
                    toolbarBtnCount: typeof stateRef.toolbarBtnCount === 'number' ? stateRef.toolbarBtnCount : null,
                    panelRootInDom: !!document.getElementById('dsh-kit-panel'),
                    panelError: typeof window.__dshKitPanelError === 'string' ? window.__dshKitPanelError : null,
                    remoteSvcReady: !!(stateRef.getRemote && stateRef.getRemote()),
                    mountOk: stateRef.mountOk === true,
                    mountError: stateRef.mountError || null,
                    webviewCount: document.querySelectorAll('webview').length,
                  };
                }
            ,
            'report-now': async function (svc, c) {
                  // 诊断：立即跑一轮探测并刷新 probe-report.json（含 gui/syncDiag 诊断）
                  probeAndPublish('command').then(() => reportNow()).catch(() => {});
                  return { ok: true, reporting: true };
                }
            ,
            'gui-eval': async function (svc, c) {
                  // GUI 文档内求值（诊断输入框/面板 DOM 等 client 侧问题；guest 侧用 guest-eval）。
                  // 只应实施会话使用：表达式在 GUI 页全局作用域执行。
                  const expr = String(c.expr || '');
                  if (!expr) return { ok: false, error: '需要 expr' };
                  const v = await (0, eval)(`(${expr})`);
                  let out;
                  if (v === undefined) out = null;
                  else if (typeof v === 'object' && v !== null) {
                    try { out = JSON.parse(JSON.stringify(v)); } catch { out = String(v); }
                  } else out = v;
                  return { ok: true, value: out };
                }
            ,
            'panel-toggle': async function (svc, c) {
                  // 调试面板显隐切换（默认隐藏、功能保留；持久化跨刷新）
                  const next = readPanelHidden() ? '0' : '1';
                  try { localStorage.setItem(PANEL_HIDDEN_KEY, next); } catch { /* 持久化失败仅本次生效 */ }
                  window.dispatchEvent(new CustomEvent(PANEL_TOGGLE_EVENT));
                  return { ok: true, hidden: next === '1' };
                }
            ,
            'toolbar-probe': async function (svc, c) {
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
            ,
            'panes-probe': async function (svc, c) {
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
            ,
            'page-close': async function (svc, c) {
                  const target = pickGuestEl();
                  const value = await target.executeJavaScript(
                    `(function () { var old = document.querySelector('iframe[data-dsh-kit-frame]'); if (old) old.remove(); return { closed: true }; })()`,
                    true,
                  );
                  return { ok: true, ...(value || {}) };
                }
            ,
            'dom-scan': async function (svc, c) {
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
            ,
            'snapshot': async function (svc, c) {
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
            ,
            'click': async function (svc, c) {
                  const target = pickGuestEl();
                  const sel = c.ref != null ? `[data-dsh-kit-ref="${Number(c.ref)}"]` : String(c.selector || '');
                  if (!sel) return { ok: false, error: '需要 ref 或 selector' };
                  const value = await target.executeJavaScript(
                    `(function () { ${TARGET_DOC_SNIPPET} var el = DOC.querySelector(${JSON.stringify(sel)}); if (!el) return { ok: false, error: 'no element' }; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 })); return { ok: true, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 60) }; })()`,
                    true,
                  );
                  return { ok: true, ...(value || {}) };
                }
            ,
            'type': async function (svc, c) {
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
            ,
            'page-inject': async function (svc, c) {
                  // MVP-4：整页 HTML 注入 guest 顶层文档。innerHTML 原语（同步赋值）替代
                  // document.write——后者在页面资源未静止时 executeJavaScript 会永久悬挂
                  // （cmd-41/63 实测，P22）；实测在活跃 SPA 页面上持久可靠（v2 注入存活 30min+）；
                  // iframe srcdoc 会被宿主 CSP 拦成空文档（本轮实测）。
                  // 注意：页面自身的 SPA 框架在响应式刷新后可能重绘覆盖注入内容（公网 Vue 站点实测一次），
                  // 注入后应立即使用/截图。历史教训：本 case 曾被复制成重复分支（switch 首个匹配生效，
                  // 第二个是死代码、改它不生效）——case 唯一性已由静态契约钉死（§3.9）。
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
            ,
            'reload': async function (svc, c) {
                  // 同源刷新（不跨白名单）；不 await 完成事件（P19：跨导航的 Promise 永不决）
                  const target = pickGuestEl();
                  target.executeJavaScript('location.reload()', true).catch(() => {});
                  return { ok: true, reloading: true };
                }
            ,
            'navigate': async function (svc, c) {
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
            ,
            'screenshot': async function (svc, c) {
                  return await captureShot();
                }
            ,
            'submit-annotations': async function (svc, c) {
                  // 多面板共享会话：收集全部成员批注 → host saveMerged（重编号 + 合并构建）
                  if (stateRef.annot && stateRef.annot.active && stateRef.annot.panes.length > 0) {
                    const r = await mergeAndSave();
                    if (r && r.ok) announceSubmission(r);
                    return r && r.ok ? { ok: true, path: r.path, bytes: r.bytes, count: r.count } : { ok: false, error: (r && r.error) || '保存失败' };
                  }
                  const target = await ensureAnnotator(svc);
                  const r = await target.executeJavaScript('(window.__dshKitAnnotator && window.__dshKitAnnotator.submit ? window.__dshKitAnnotator.submit() : null)', true);
                  if (!r || typeof r.markdown !== 'string') return { ok: false, error: '无可打包批注' };
                  if (!(r.annotations || []).length) return { ok: false, error: '无可打包批注（0 条）' };
                  let meta = null;
                  try {
                    meta = metaOf(await target.executeJavaScript(GUEST_META_JS, true));
                  } catch { /* 元数据失败不拦保存 */ }
                  const sr = unwrap(await svc.saveAnnotations(r.markdown, meta));
                  if (sr && sr.ok) announceSubmission({ ok: true, path: sr.path, count: (r.annotations || []).length });
                  return sr && sr.ok ? { ok: true, path: sr.path, bytes: sr.bytes, count: (r.annotations || []).length } : { ok: false, error: (sr && sr.error) || '保存失败' };
                }

          };

          /** 命令分发：查表执行；未知 action 显式报错（不静默）。 */
          const executeCommand = async (svc, command) => {
            const c = command && typeof command === 'object' ? command : {};
            const action = String(c.action || '');
            try {
              const handler = commandHandlers[action];
              if (!handler) return { ok: false, error: `未知命令 action=${action}` };
              return await handler(svc, c);
            } catch (e) {
              return { ok: false, error: msgOf(e) };
            }
          };
          const pollCommands = async () => {
            if (cmdBusy) return;
            const svc = stateRef.getRemote ? stateRef.getRemote() : null;
            if (!svc || typeof svc.takeCommand !== 'function') return;
            cmdBusy = true;
            const myEpoch = cmdEpoch; // C14：看门狗强制复位会推进代际——过期轮询的 finally 不许清掉新一轮的 busy
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
              if (myEpoch === cmdEpoch) cmdBusy = false;
            }
          };
          trackInterval(setInterval(() => { pollCommands().catch(() => {}); }, 2500));
          /* 看门狗：单条命令最长占用 30s（race 上限），45s 仍未释放视为卡死，强制复位
           * cmdBusy，避免一次挂起饿死整条命令队列（P20）。复位推进 cmdEpoch 代际，
           * 卡死轮询的 finally 只清自己那一代的 busy（C14）。 */
          trackInterval(setInterval(() => {
            if (cmdBusy) {
              cmdEpoch += 1;
              cmdBusy = false;
              say('warn', '看门狗：命令轮询超 45s 未释放，已强制复位 cmdBusy');
            }
          }, 45000));

          const reportNow = async () => {
            if (!stateRef.findings) await probeAndPublish('report');
            stateRef.report = await reportToHost(stateRef, stateRef.findings);
            say(stateRef.report.error ? 'warn' : 'info',
              `host 上报：${stateRef.report.error || JSON.stringify(stateRef.report.response)}`);
            return stateRef.report;
          };

          /** 等 svc 就绪（C13：与 reportToHost 共用模块级 waitForSvc 实现）。 */
          const waitSvc = async () => waitForSvc(stateRef);

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

          /* ---- 诊断句柄（gui-eval 可达；state 只读视图 + ensureAnnotChip 供胶囊自检） ---- */
          try {
            window.__dshKitClientDiag = {
              get state() { return stateRef; },
              ensureAnnotChip,
              ensureConvoChips,
            };
          } catch { /* 全局诊断句柄挂载失败不影响 */ }

          /* 槽位注册（list 型：id 必填；order 排在 zcode-dispatch 之后） */
          ctx.slots.inject(SLOT, () => ctx.slots.register(
            { name: SLOT, id: PANEL_ID, order: 30 },
            () => h(PanelBoundary, null, h(ProbePanel, {
              stateRef,
              getState: () => ({ findings: stateRef.findings, report: stateRef.report, lastShot: stateRef.lastShot, annot: stateRef.annot, collapsed: stateRef.panelCollapsed }),
              actions: {
                collapse: () => {
                  // 折叠是会话内视觉态（历史写入的 localStorage 键从未被读回——C11：删掉假持久化）
                  stateRef.panelCollapsed = !stateRef.panelCollapsed;
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

          /* ---- 插件管理面板卡片（plugins.bundle.config 插槽，形态参照 dsh-connect-zcode）：
           *  批注/截图的数量与字节占用 + 一键清除（face getStats / clearArtifacts）。
           *  插槽契约（Cordis Inspect 取证）：ownerProps = { view: 'summary'|'page' }，
           *  仅 view==='page' 时在 bundle 详情页渲染；无参组件曾致占用未被采用（active:false）。 ---- */
          try {
            const BUNDLE_KEY = '@local/dsh-browser-kit';
            const fmtBytes = (n) => {
              const v = Number(n) || 0;
              if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
              if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
              return `${v} B`;
            };
            function KitPanelCard({ view }) {
              const [stats, setStats] = useState(null);
              const [msg, setMsg] = useState(null);
              const [busy, setBusy] = useState(false);
              // 自证留痕（卡片渲染真机取证）：渲染入参/数据/异常挂到诊断句柄，实施会话经 gui-eval 读取
              useEffect(() => {
                try {
                  stateRef.cardRender = { at: new Date().toISOString(), view: String(view), stats: null };
                } catch { /* ignore */ }
                say('info', `插件卡片渲染 view=${String(view)}`);
              }, [view]);
              const refresh = () => {
                const svc = stateRef.getRemote ? stateRef.getRemote() : null;
                if (!svc || typeof svc.getStats !== 'function') { setStats({ error: 'host 远端面未就绪' }); return; }
                // face 代理返回 {ok,value} 信封——必须 unwrap（漏了 = 永远显示「—」，实测踩坑）
                svc.getStats().then((raw) => {
                  const r = unwrap(raw);
                  setStats(r && r.ok ? r : { error: (r && r.error) || '统计失败' });
                  try { stateRef.cardRender = { at: new Date().toISOString(), view: String(view), stats: r }; } catch { /* ignore */ }
                }).catch((e) => {
                  setStats({ error: msgOf(e) });
                  try { stateRef.cardRender = { at: new Date().toISOString(), view: String(view), error: msgOf(e) }; } catch { /* ignore */ }
                });
              };
              useEffect(() => {
                if (view && view !== 'page') return; // summary 视图不需要数据
                refresh();
              }, [view]);
              const clear = (kind, label) => {
                if (busy) return;
                setMsg(null);
                setBusy(true);
                const svc = stateRef.getRemote ? stateRef.getRemote() : null;
                const run = svc && typeof svc.clearArtifacts === 'function'
                  ? Promise.resolve(svc.clearArtifacts(kind)).then((raw) => unwrap(raw))
                  : Promise.resolve({ ok: false, error: 'host 远端面未就绪' });
                run.then((r) => {
                  setBusy(false);
                  if (r && r.ok) {
                    setMsg(`${label}已清空（${Object.entries(r.removed || {}).map(([k, v]) => `${k} ${v} 个`).join('、') || '0 个文件'}）`);
                    refresh();
                  } else {
                    setMsg(`清除失败：${(r && r.error) || '未知'}`);
                  }
                }).catch((e) => { setBusy(false); setMsg(`清除失败：${msgOf(e)}`); });
              };
              const ok = stats && stats.ok === true;
              const statOf = (k) => (ok && stats[k] && typeof stats[k].count === 'number' ? stats[k] : null);
              // view==='summary'：仅渲染一行摘要（详情页顶部一行）；'page' 才给完整表单
              if (view === 'summary') {
                const a = statOf('annotations');
                const sh = statOf('shots');
                return h('span', { style: { color: T.text2, fontSize: 12 } },
                  ok ? `批注 ${a ? a.count : 0} 个 · 截图 ${sh ? sh.count : 0} 张` : '统计加载中…');
              }
              const row = (label, stat, kind, clearLabel) => h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' } },
                h('span', { style: { width: 52, color: T.text2 } }, label),
                stat
                  ? h('span', { style: { color: T.text, fontFamily: T.mono, fontSize: 11 } }, `${stat.count} 个 · ${fmtBytes(stat.bytes)}`)
                  : h('span', { style: { color: T.text3, fontSize: 11 } }, '—'),
                h('button', {
                  onClick: () => clear(kind, clearLabel),
                  disabled: busy || !ok || (stat && stat.count === 0),
                  title: `清空全部${label}文件（不可恢复）`,
                  style: {
                    marginLeft: 'auto', border: `1px solid ${T.border}`, borderRadius: 6,
                    background: 'transparent', color: T.danger, cursor: 'pointer', fontSize: 11, padding: '1px 8px',
                  },
                }, clearLabel),
              );
              return h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0' } },
                h('div', { style: { fontWeight: 700, fontSize: 12, color: T.text } }, '浏览器工件（dsh-browser-kit）'),
                row('批注', statOf('annotations'), 'annotations', '清除批注'),
                row('截图', statOf('shots'), 'shots', '清除截图'),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('button', {
                    onClick: () => { setMsg(null); refresh(); },
                    style: { border: `1px solid ${T.border}`, borderRadius: 6, background: T.hover, color: T.text, cursor: 'pointer', fontSize: 11, padding: '1px 8px' },
                  }, '刷新统计'),
                  msg ? h('span', { style: { color: T.text2, fontSize: 11, wordBreak: 'break-all' } }, msg) : null,
                ),
              );
            }
            const CARD_BOUNDARY = function KitCardBoundary(props) {
              // 错误边界（zcode/trae 同款纪律）：渲染异常只留痕，绝不冒泡打崩插件详情页
              try {
                return h(KitPanelCard, props);
              } catch (e) {
                try {
                  stateRef.cardRender = { at: new Date().toISOString(), view: String(props && props.view), renderError: msgOf(e) };
                  console.warn(`${LOG_PREFIX} 插件管理卡片渲染失败:`, e && e.message);
                } catch { /* ignore */ }
                return null;
              }
            };
            // 双注册（参照 dsh-connect-trae）：
            //  - plugins.bundle.config：bundle 页「描述与行之间」的配置区（key = 包名）
            //  - plugins.row.config：bundle 行的「配置」入口（key = `<包名>#<patch 行 id>`；
            //    行 id 是本插件 cordis.patch.yml 声明的 `dsh-browser-kit`，不是包名——写错则挂不上）
            const BUNDLE_ROW_ID = 'dsh-browser-kit';
            ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
              { name: 'plugins.bundle.config', key: BUNDLE_KEY, priority: 40, inject: () => ({}) },
              CARD_BOUNDARY,
            ));
            try {
              ctx.slots.inject('plugins.row.config', () => ctx.slots.register(
                { name: 'plugins.row.config', key: `${BUNDLE_KEY}#${BUNDLE_ROW_ID}`, priority: 40, inject: () => ({}) },
                CARD_BOUNDARY,
              ));
            } catch (e) {
              say('warn', `row.config 卡片注册失败（bundle.config 不受影响）：${msgOf(e)}`);
            }
            say('info', '插件管理卡片已注册（plugins.bundle.config + plugins.row.config）');
          } catch (e) {
            say('warn', `插件管理卡片注册失败（不影响其他功能）：${msgOf(e)}`);
          }

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
                const owned = form.querySelector('#dsh-kit-toolbar-btn');
                if (owned) {
                  /* P37 认领制（与胶囊同款）：click 闭包归属创建实例——不接管则批注动作永远
                   * 路由进旧实例（旧代码旧状态）。自己/更新实例的按钮保留；无戳（P37 前旧按钮）
                   * 或更旧实例的按钮拆除重挂，让动作路由进最新实例。 */
                  const owner = (owned.dataset && owned.dataset.ownerBoot) || '';
                  const myBoot = String(stateRef.clientBootAt);
                  if (owner === myBoot || (owner && owner > myBoot)) { attached += 1; continue; }
                  owned.remove();
                }
                const pane = webviewOfForm(form);
                if (!pane) continue;
                const btn = document.createElement('button');
                btn.id = 'dsh-kit-toolbar-btn';
                btn.dataset.ownerBoot = String(stateRef.clientBootAt); // P37 认领戳
                btn.type = 'button';
                btn.title = '元素批注（点击本窗口加入/退出共享批注）';
                btn.style.cssText = 'margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;flex:none;';
                btn.innerHTML = ANNOT_ICON_SVG;
                btn.addEventListener('click', () => {
                  try {
                    // 即时视觉反馈（2s 同步循环随后校正）；面板点击时现取，
                    // 避免闭包持有重渲染前的旧 webview 节点（身份失配 = 永不点亮）
                    const pane = webviewOfForm(form);
                    if (!pane) return;
                    btn.style.background = TOOLBAR_ACCENT;
                    btn.style.color = TOOLBAR_ACCENT_TEXT;
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
            //（去抖会让按钮肉眼可见地消失重现=闪烁；微任务级重挂肉眼无感）。
            // P32（review 发现）：tbLeft 曾未声明——观察器回调首次读取即抛 ReferenceError，
            // 「同步重挂」快速路径整体失效，全靠 3s setInterval 兜底（新标签最长 3s 无图标）。
            // 现声明为无限预算：observer 生命周期即预算（ctx.effect 已挂 disconnect）。
            let tbLeft = Infinity;
            const tbObserver = new MutationObserver(() => {
              if (tbLeft <= 0) return;
              tbLeft -= 1;
              try { ensureToolbarButtons(); } catch { /* ignore */ }
            });
            tbObserver.observe(document.body, { childList: true, subtree: true });
            if (typeof ctx?.effect === 'function') {
              ctx.effect(() => () => { try { tbObserver.disconnect(); } catch { /* ignore */ } });
            }
            const tbGuardTimer = setInterval(() => {
              try { ensureToolbarButtons(); } catch { /* ignore */ }
            }, 3000);
            trackInterval(tbGuardTimer);
            // 各按钮激活态外观同步（2s，按 webContentsId 比对成员）+ 会话自动拉齐：
            //  - 会话活跃时，未入册且未被显式退出的面板 → 自动加入（用户核心诉求：
            //    「窗口1开启批注 → 窗口2直接显示已开启」，无需再点图标）；
            //  - 成员面板 guest 导航后批注层丢失（API 消失；主动取消不丢 API）→ 自动重注入续编号。
            let autoJoinBusy = false;
            const withTimeout = (p, ms, tag) => Promise.race([
              Promise.resolve(p),
              new Promise((_, rej) => setTimeout(() => rej(new Error(`${tag || 'op'} 超时(${ms}ms)`)), ms)),
            ]);
            trackInterval(setInterval(async () => {
              try { stateRef.tickAt = new Date().toISOString(); } catch { /* 诊断字段不影响主流程 */ }
              const st = stateRef.annot;
              refreshPanes();
              ensureAnnotChip(); // 胶囊：实时计数 / saved 模型 / 重定位（不依赖会话活跃）
              ensureConvoChips(); // 消息胶囊：发送消耗检测 + 会话内配对挂载（幂等）
              ensureAwayBanner(); // 发送前防呆：待发胶囊不在归属会话时的被动横条（.local/feature-send-guard.md）
              ensureQuoteButtons(); // 消息引用：hover 行的引用按钮补挂/移除（.local/feature-message-quote.md）
              const activeIds = (st && st.active && Array.isArray(st.panes))
                ? new Set(st.panes.map(paneIdOf))
                : new Set();
              for (const form of toolbarForms()) {
                const btn = form.querySelector('#dsh-kit-toolbar-btn');
                if (!btn) continue;
                const pane = webviewOfForm(form);
                const active = pane != null && activeIds.has(paneIdOf(pane));
                // 固定高对比配色（蓝底白标）——字面色豁免：主题令牌在工具条上下文里可能
                // 解析成浅色，叠加 color:inherit 的浅色描边 → 白底白标隐形（用户实测反馈）
                btn.style.background = active ? TOOLBAR_ACCENT : 'transparent';
                btn.style.color = active ? TOOLBAR_ACCENT_TEXT : '';
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
            }, 2000));
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
                  h('span', {
                    style: { display: 'inline-flex', alignItems: 'center' },
                    dangerouslySetInnerHTML: { __html: ANNOT_ICON_SVG }, // C9：共享图标常量
                  }),
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
