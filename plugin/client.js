/**
 * @local/dsh-browser-kit —— Client 半边（GUI 文档侧）。分区导航（按出现顺序）：
 *
 *  ① 常量与主题令牌 T / 探测核心（webview 能力实测）/ host 上报（remote face 拆包）
 *  ② stateRef 运行期状态（字段总览见声明处注释块）
 *  ③ 面板刷新与编号交接（livePane / refreshPanes / joinFloorIndex / sessionMaxIndex）
 *  ④ 批注层注入与输入框管线（ensureAnnotator / isVisibleEl / primeSessionInput）
 *  ⑤ 自绘浮层族：认领制助手（ownerBootOf/iAmNewer）→ 输入框胶囊（ensureAnnotChip）
 *     → 防呆横条（ensureAwayBanner）→ 消息胶囊（attachMsgChip / ensureConvoChips）
 *  ⑥ 共享会话提交流（joinPane/leavePane/sessionSettled/mergeAndSave/syncPanes）
 *  ⑦ 命令通道（commandHandlers 23 action 映射表 + 分发器；A6 契约钉死全量清单）
 *  ⑧ 诊断命令（kit-status/gui-eval/guest-eval/panes-probe/toolbar-probe 等）
 *  ⑨ 截图与探测出口（captureShot / probeAndPublish / 面板与 Slots 注册 / 插件管理卡片）
 *  ⑩ 工具条按钮注入（ensureToolbarButtons + P37 接管）+ 2s tick（tickChipLifecycle /
 *     tickToolbarStyles / tickSelfHealAndAutoJoin）+ 诊断句柄 window.__dshKitClientDiag
 *
 * 总纪律（任何异常不许冒泡——冒泡 = 条目激活失败 = web boot 失败）：
 *  - 全部兜底 try/catch；激活期零抛；
 *  - 样式只走主题令牌（--dsw-alias-* / --dsw-shadow-lv3 / --ds-font-family-code）与
 *    唯一的字面出口 T，零散落字面色值（工具条 accent 为已记录的字面豁免）；
 *  - 纯逻辑抽取走 A1 模式（src 正典 + 内嵌副本 canonical 标记 + parity 对拍）——
 *    client 侧不支持相对 import（评审报告研究项 A 已证）。
 *
 * 形态照抄 @local/zcode-dispatch/client.js（本机已验证）：window.__ModuleLoader__.load +
 * React.createElement + inject ['slots','remote','typert']（typert 是 $mount 的硬依赖）。
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
    /* ★作用域坑（实测）：这两个图标既要给内层工具条用、又要给外层自持窗口用，
     *  必须声明在**模块外层**——先前误放进工具条所在的函数作用域，导致自持窗口 open 抛
     *  `SHOT_ICON_SVG is not defined`。 */
    const SIZE_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 20.5h8M12 17v3.5"/></svg>';
    const SHOT_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 5l1.3-2h4.4L15.5 5"/><rect x="2.5" y="5" width="19" height="14.5" rx="2.5"/><circle cx="12" cy="12.2" r="3.4"/></svg>';
    /** ↘ 箭头（与 DSH「系统浏览器打开」的 ↗ 图标镜像）：把当前页以**同登录态**开进自持浏览器。 */
    const OWN_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12"/><path d="M18 8.5V18H8.5"/></svg>';
    /** R-OWN v14：**激活态**批注图标 = 「原来那枚图标的白色描边整体改成蓝色」（用户要求：
     *  不是填充蓝块，只是把白色换成蓝色）。仍用"换图标"表达激活（背景色会被覆盖 → 闪烁，见 P60/P64）。 */
    const ANNOT_ICON_ACTIVE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">'
      + '<path d="M4 4h16v12H9l-5 4V4z" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"/>'
      + '<path d="M12 7.5v5M9.5 10h5" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round"/>'
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
        // ── HID 桥（R-HID：与 wire.host.mjs FACE_METHOD_TABLE 逐字对账）──
        ['hidList', [], 'hidList(): Promise<{ok:true, devices:[{path,vendorId,productId,serialNumber,product,manufacturer,usagePage,usage}]}|{ok:false, error}>（枚举系统全部 HID 设备）', []],
        ['hidOpen', ['path'], 'hidOpen(path): Promise<{ok:true, handleId}|{ok:false, error}>（独占打开设备）', []],
        ['hidRead', ['handleId', 'timeoutMs'], 'hidRead(handleId, timeoutMs?): Promise<{ok:true, data:number[]}|{ok:false, error}>（读一次上报，超时返回 timeout）', ['timeoutMs']],
        ['hidWrite', ['handleId', 'data'], 'hidWrite(handleId, data): Promise<{ok:true, written}|{ok:false, error}>（写入字节数组）', []],
        ['hidClose', ['handleId'], 'hidClose(handleId): Promise<{ok:true}|{ok:false, error}>（关闭句柄）', []],
        ['getHidShim', [], 'getHidShim(): Promise<{ok:true, source, mtime, bytes}|{ok:false, error}>（WebHID shim 注入源）', []],
        ['hidTrace', [], 'hidTrace(): Promise<{ok:true, trace:[{at,dir,handleId,hex}]}|{ok:false, error}>（桥收发 trace）', []],
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
      /* 系统字体栈（非主题令牌，字面出口同位）：自绘浮层的两档字号字重共用 */
      font: '12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif',
      fontLh: '12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif',
    };
    const STYLE_ID = 'dsh-browser-kit-probe-style';

    /* ── 批注图标点亮：**属性 + !important CSS**（R-OWN v11，★实测必需）──
     * 先前用内联 `style.background` 点亮，但内联天生"谁后写谁赢"：热重载遗留实例 / DSH 重渲染
     * 都可能在其后把内联清成 transparent ⇒ 图标一闪一闪（实测：活实例写值回执是 rgb(37,99,235)，
     * 读回却是 transparent）。改为只切一个属性，样式由 !important 规则决定 —— 谁也压不掉。 */
    const ANNOT_ON_STYLE_ID = 'dsh-kit-annot-on-style';
    const ensureAnnotOnStyle = () => {
      try {
        const css = '#dsh-kit-toolbar-btn[data-kit-annot-on="1"],[data-dsh-kit-agent-view-annot][data-kit-annot-on="1"]'
          + '{background:transparent !important;box-shadow:none !important;}';
        const old = document.getElementById(ANNOT_ON_STYLE_ID);
        if (old && old.textContent === css) return; // 幂等：内容没变不重建
        if (old) old.remove();
        const el = document.createElement('style');
        el.id = ANNOT_ON_STYLE_ID;
        // ★用户要求：**删除蓝色背景**；激活只用"蓝色批注图标"表示。
        //  仍保留一条 !important 规则把背景钉成透明（防其它写者给它加底色）。
        el.textContent = css;
        (document.head || document.documentElement).appendChild(el);
      } catch { /* 忽略 */ }
    };
    /** 按会话状态点亮/熄灭所有批注图标：**切换图标**（普通 ↔ 蓝色激活），不碰背景色。 */
    const applyAnnotBtnState = (stateRef2) => {
      try {
        ensureAnnotOnStyle();
        const ref = stateRef2 || (typeof stateRef !== 'undefined' ? stateRef : null);
        const on = !!(ref && ref.annot && ref.annot.active);
        const list = document.querySelectorAll('#dsh-kit-toolbar-btn,[data-dsh-kit-agent-view-annot]');
        for (const b of Array.from(list)) {
          if (on) b.setAttribute('data-kit-annot-on', '1');
          else b.removeAttribute('data-kit-annot-on');
          const want = on ? ANNOT_ICON_ACTIVE_SVG : ANNOT_ICON_SVG;
          if (b.innerHTML !== want) b.innerHTML = want; // 换图标：幂等、无闪烁
        }
        if (ref) { try { ref.annotBtnAt = new Date().toISOString(); } catch { /* 忽略 */ } }
      } catch { /* 忽略 */ }
    };

    /* ── 实例围栏（R-OWN v11，★实测必需）──
     * 客户端热重载会留下**旧实例仍在跑定时器**：新旧实例各自 2s 写同一个工具条按钮，
     * 新实例按"会话活跃"写蓝色、旧实例按自己的空状态写透明 ⇒ 用户看到图标**一闪一闪**
     * （实测定位：`styleTickCount` 在涨、`styleTickBtnCount=1`，但内联值被反复覆盖成 transparent）。
     * 故：全局登记"当前活跃实例"，只有它允许操作 DOM / 周期任务；旧实例一律提前退出。 */
    const claimClientInstance = (bootAt) => {
      try {
        const mine = String(bootAt || '');
        const cur = globalThis.__dshKitLiveInstance || null;
        if (!cur || String(cur.bootAt || '') <= mine) {
          globalThis.__dshKitLiveInstance = { bootAt: mine, at: new Date().toISOString() };
          return true;
        }
        return false;
      } catch { return true; }
    };
    const isLiveInstance = (bootAt) => {
      try {
        const cur = globalThis.__dshKitLiveInstance;
        if (!cur) return true;
        return String(cur.bootAt || '') === String(bootAt || '');
      } catch { return true; }
    };

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
          /* ---- stateRef 字段总览（运行期状态单一出口；后置字段一并登记）----
           *  探测/上报：findings(探测结果) / report(落盘报告) / lastShot(最近截图)
           *  批注会话：annot { active, count, startedAt, lastSaved, error, panes[], origins,
           *             originUrls, pending[], leftIds, base? } —— 共享会话全部运行态
           *  胶囊/横条：chip(saved 待发模型 {mode,count,path,items,convo,bornAt,base,
           *             attachedKey?,retracted?}) / sentChips[](已随消息发出的模型 FIFO) /
           *             chipGate(P37 门控诊断，触发时写)；横条渲染条件直接读 chip.convo
           *             与当前会话标题比对，无独立字段
           *  输入框管线：lastPrime(primeSessionInput 回读校验结果)
           *  工具条：lastToggleError / toolbarBtnCount(已挂按钮数)
           *  诊断：clientBootAt(实例身份，P37 认领戳数据源) / tickAt(2s tick 心跳) /
           *        mountOk / mountError / panelCollapsed
           *  探测节奏：autoLeft(自动补测余量) / autoShotLeft(自动截图余量) / autoProbeTimer(补测防抖定时器)
           *  远端 face：remoteSvc + getRemote()
           */
          const stateRef = {
            findings: null,
            report: null,
            lastShot: null,
            annot: null, // { active, count, startedAt, lastSaved, error }
  /* R-OWN v23：批注镜像面板的诊断计数（kit-status 暴露）。
   * 起因：「批注开着但右下角没有面板」此前完全无从定位 —— 镜像同步里的失败被
   * `catch{忽略}` 与单飞 busy 一起吞掉。现在每次调用都记账，卡死/未注入一眼可见。 */
  mirrorDiag: { calls: 0, injected: 0, skippedBusy: 0, skippedNoPane: 0, skippedNoHtml: 0, resetForced: 0, lastError: null, lastAt: null },
            chip: null, // 批注胶囊 saved 模型 { mode:'saved', count, path, items, convo, bornAt, base, attachedKey?, retracted? }（live 模式由 annot 派生）
            sentChips: [], // 已随消息发出的胶囊模型 FIFO（发送检测后自 chip 迁入；tick 按归属行补挂）
            lastToggleError: null,
            clientBootAt: new Date().toISOString(),
            liveInstance: true, // 由 claimClientInstance 在启动时裁定（旧实例会置 false 并停止周期任务）
            agentGlow: { until: 0, label: '', count: 0, sticky: false, timer: 0, sessionId: null }, // Agent 操作光效（见 ensureAgentGlow 注释块）
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
          /* 实例围栏裁定：启动时登记"谁是活跃实例"。旧实例（客户端热重载留下的僵尸）保持 false，
           * 其 2s tick / 1s 空闲 tick 会立即提前退出 —— 这是「批注图标一闪一闪」的根治手段：
           * 新旧实例原本各自 2s 写同一个按钮（活实例写蓝、僵尸写透明）⇒ 肉眼看到闪烁。 */
          stateRef.liveInstance = claimClientInstance(stateRef.clientBootAt);
          if (!stateRef.liveInstance) {
            say('warn', '检测到更新的插件客户端实例：本实例停止 DOM 操作，避免双写/闪烁（正常现象，见实例围栏）');
          }
          stateRef.isLiveInstance = () => isLiveInstance(stateRef.clientBootAt);
          try {
            if (typeof ctx?.effect === 'function') {
              ctx.effect(() => {
                for (const id of trackedIntervals.splice(0)) {
                  try { clearInterval(id); } catch { /* ignore */ }
                }
                // R-OWN：插件卸载时释放自持视图的租约（避免租约泄漏；面板也一并移除）
                try { releaseAgentView(); } catch { /* ignore */ }
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
              tickAt: stateRef.tickAt || null, // 2s tick 心跳（诊断：tick 卡死时该字段会停更）
              styleTickCount: stateRef.styleTickCount || 0,
              styleTickBtnCount: typeof stateRef.styleTickBtnCount === 'number' ? stateRef.styleTickBtnCount : null,
              styleTickWrite: stateRef.styleTickWrite || null,
              liveInstanceBootAt: (globalThis.__dshKitLiveInstance && globalThis.__dshKitLiveInstance.bootAt) || null,
              annotActive: !!(stateRef.annot && stateRef.annot.active),
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

          /** 把成员表里的陈旧节点映射回当前文档的同 id 节点（DSH 重渲染会替换 webview 节点）。
           *  R4.1：webviews 可选参数——tick 顶部一次查询逐参复用（非 tick 调用点缺省自取）。 */
          const livePane = (el, webviews) => {
            const id = paneIdOf(el);
            if (typeof id === 'number') {
              for (const w of webviews || document.querySelectorAll('webview')) {
                if (paneIdOf(w) === id) return w;
              }
            }
            return el;
          };
          const refreshPanes = (webviews) => {
            const st = stateRef.annot;
            if (st && Array.isArray(st.panes)) st.panes = st.panes.map((p) => livePane(p, webviews)).filter(Boolean);
          };

          /** 编号交接下限（P26 契约钉死）：加入面板 indexBase = maxUsed → 首个新批注 = maxUsed+1。
           *  首个成员传 0 → 首批注 = 1。绝不要再 +1（那是 annotator nextIndex 自己加的）。 */
          const joinFloorIndex = (maxUsed) => (Number(maxUsed) || 0);

          const sessionMaxIndex = async () => {
            refreshPanes(); // R1-08：与 mergeAndSave 同款纪律——死节点 executeJavaScript 抛错被静默跳过会致取号偏小
            let max = 0;
            for (const p of stateRef.annot.panes) {
              try {
                const lst = await p.executeJavaScript('(window.__dshKitAnnotator ? window.__dshKitAnnotator.list().map(function (a) { return a.index; }) : [])', true);
                if (Array.isArray(lst)) for (const n of lst) if (typeof n === 'number' && n > max) max = n;
              } catch { /* 面板已关闭等：跳过 */ }
            }
            // v26：草稿里可能已有更高编号（页面跳转后 guest 记录为空）⇒ 取两者较大值，保证续号
            return Math.max(max, draftMaxIndex());
          };

          /** 确保批注层已注入目标面板（版本不匹配自动重注入，旧实例由注入头 stop 清理）。 */
          const EXPECTED_ANNOT_VERSION = '1.9.0';
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
          /** R1-05：可见 contenteditable 候选单点化（选择器曾两份散落——P36 的重命名漏改
           *  正是这种重复的必然结局）。primeSessionInput 与 findComposer 共用。 */
          const CE_SEL = '[contenteditable="true"],[contenteditable="plaintext-only"],[contenteditable=""]';
          const visibleCEs = () => Array.from(document.querySelectorAll(CE_SEL)).filter(isVisibleEl);
          /** R1-06：宿主结构契约选择器/标记单点化（CSS-module 哈希前缀随构建变化，
           *  只匹配稳定语义后缀；改一处即全局生效）。 */
          const BUBBLE_SEL = '[class*="_bubble"]';
          const MSG_CHIP_MARK = '[data-dsh-kit-ann-msg]';
          const TOOLBAR_SEL = 'form[class*="toolbar"]';

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
                const ces = visibleCEs(); // P36：曾误写 `visible`（未定义标识符）→ 整个 primeSessionInput 抛错、输入框提示永远失败——现已随 R1-05 单点化
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

          /* P37 认领制共享助手：dataset.ownerBoot 记挂载者 clientBootAt（ISO 字符串可比），
           *  新者胜旧者让——多实例（P37：toggle 热换旧实例 interval 永生）各自 tick 时，
           *  只有最新实例可挂/改/删自绘浮层，旧实例一律退让。胶囊/横条同源复用；
           *  例外：工具条按钮对「无主/更旧」按钮拆除重挂以接管 click 路由，不走退让分支。 */
          const ownerBootOf = (el) => (el && el.dataset && el.dataset.ownerBoot) || '';
          const iAmNewer = (el) => !ownerBootOf(el) || String(stateRef.clientBootAt) >= ownerBootOf(el);
          /** R2.2：× 关闭按钮单点构造（胶囊/消息胶囊同款形态）。 */
          const makeCloseButton = (title) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('data-role', 'close');
            btn.textContent = '×';
            btn.title = title;
            btn.style.cssText = 'border:0;background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.14));'
              + 'color:var(--dsw-alias-label-primary, #e5e7eb);border-radius:999px;'
              + 'width:16px;height:16px;line-height:1;font-size:12px;cursor:pointer;display:inline-flex;'
              + 'align-items:center;justify-content:center;padding:0;';
            return btn;
          };
          /** R2.2：× hover 危险色样式标签单点化（伪类内联写不了；选择器通配两种容器）。 */
          const ensureChipDangerStyle = () => {
            if (document.getElementById('dsh-kit-annot-chip-style')) return;
            const st = document.createElement('style');
            st.id = 'dsh-kit-annot-chip-style';
            st.textContent = '#dsh-kit-annot-chip [data-role=close]:hover,'
              + '[data-dsh-kit-ann-msg] [data-role=close]:hover{'
              + 'background:var(--dsw-alias-state-error-primary, rgba(220,38,38,0.85))!important;'
              + 'color:var(--dsw-alias-label-primary-foreground, #ffffff)!important}';
            document.head.appendChild(st);
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
            const ces = visibleCEs();
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
              /* P37 多实例共存（机制详见共享助手 ownerBootOf 处注释）：认领制，
               *  仅最新实例可挂/改/删；旧实例见到别人的胶囊一律退让。 */
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
                  + 'padding:4px 6px 4px 10px;font:' + T.font + ';'
                  + 'color:' + T.text + ';box-shadow:' + T.shadow + ';user-select:none;';
                const label = document.createElement('span');
                label.setAttribute('data-role', 'label');
                chip.appendChild(label);
                const close = makeCloseButton('删除批注');
                ensureChipDangerStyle();
                chip.appendChild(close);
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
              /* P37 认领制（与胶囊同款，机制见共享助手处注释）：新者胜旧者让。 */
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
                  + ';border-radius:999px;padding:4px 10px;font:' + T.font + ';'
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

          /* ─────────────── Agent 操作光效（2026-10-09 用户需求） ───────────────
           * 需求原文：「Agent 在执行自动化操作浏览器时，窗口四边要有光效提升，让用户知道 Agent 在操作中」。
           * 形态：贴住目标 webview（尽量上扩到含工具条的浏览器窗口容器）**四边描边 + 双层外发光 + 呼吸动画**，
           *       左上角胶囊「🤖 Agent 操作中 · <动作>」；纯提示 → `pointer-events:none`（不挡点击/批注/选择）。
           * 触发：由命令分发器统一打点（navigate/reload/click/type/page-inject/screenshot/snapshot/
           *       browser-open/browser-close/browser-panel），每次 pulse 续期 AGENT_GLOW_MS，末次后自动淡出。
           * 开关：localStorage 持久（默认开）；`agent-glow {op:on|off|pulse|status}` 命令给用户/agent 控制。
           * 配色：**字面色豁免**（同 TOOLBAR_ACCENT 的理由）——主题令牌在浮层上下文可能解析成不可见色，
           *       而「正在被操作」必须一眼可见，故用固定亮青蓝 + 暗色描边兜底。
           */
          const AGENT_GLOW_ID = 'dsh-kit-agent-glow';
          const AGENT_GLOW_STYLE_ID = 'dsh-kit-agent-glow-style';
          const AGENT_GLOW_KEY = 'dsh-browser-kit:agent-glow:v1';
          const AGENT_GLOW_MS = 3500;
          const AGENT_GLOW_TICK = 200;
          const agentGlowEnabled = () => { try { return localStorage.getItem(AGENT_GLOW_KEY) !== '0'; } catch { return true; } };
          const setAgentGlowEnabled = (on) => { try { localStorage.setItem(AGENT_GLOW_KEY, on ? '1' : '0'); } catch { /* 尽力而为 */ } };
          /** 目标面板：优先包含焦点的 webview，其次首个可见 webview（= 用户正在看的那个）。
           *  R-SCOPE：若本次操作来自某个具体会话，只在该会话的面板里选——绝不把光效/操作画到别的会话窗口上。 */
          const agentGlowTarget = () => {
            const sid = stateRef.agentGlow ? stateRef.agentGlow.sessionId : null;
            const all = scopedWebviews(sid);
            const focused = all.find((el) => el.contains(document.activeElement));
            if (focused) return focused;
            return all.find((el) => { const r = el.getBoundingClientRect(); return r.width > 80 && r.height > 80; }) || null;
          };
          /** 取「浏览器窗口」矩形：尽量上扩到含工具条的小容器；容器过大（整列/整窗）则退回 webview 本体。 */
          const agentGlowRect = (target) => {
            const r = target.getBoundingClientRect();
            let best = { left: r.left, top: r.top, width: r.width, height: r.height };
            let node = target.parentElement;
            for (let i = 0; i < 4 && node; i += 1, node = node.parentElement) {
              const pr = node.getBoundingClientRect();
              if (pr.width < r.width - 2 || pr.height < r.height - 2) break; // 不含目标：放弃
              if (pr.height - r.height > 96) break;                         // 过大（整列/整窗）：放弃
              best = { left: pr.left, top: pr.top, width: pr.width, height: pr.height };
            }
            return best;
          };
          const ensureAgentGlowEl = () => {
            if (!document.getElementById(AGENT_GLOW_STYLE_ID)) {
              const style = document.createElement('style');
              style.id = AGENT_GLOW_STYLE_ID;
              // 呼吸（四边亮度起伏）。z-index 仅低于批注横条/选择器（2147483646+），不与它们抢层。
              style.textContent = '@keyframes dshKitAgentGlowPulse{0%,100%{opacity:.55}50%{opacity:1}}';
              document.head.appendChild(style);
            }
            let el = document.getElementById(AGENT_GLOW_ID);
            if (!el) {
              el = document.createElement('div');
              el.id = AGENT_GLOW_ID;
              el.setAttribute('data-dsh-kit-agent-glow', '');
              el.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;box-sizing:border-box;'
                + 'border-radius:10px;border:2px solid #38bdf8;'
                + 'box-shadow:0 0 0 1px rgba(8,20,32,.55),0 0 12px 2px rgba(56,189,248,.75),0 0 34px 8px rgba(56,189,248,.35);'
                + 'animation:dshKitAgentGlowPulse 1.5s ease-in-out infinite;';
              const pill = document.createElement('div');
              pill.id = AGENT_GLOW_ID + '-pill';
              pill.style.cssText = 'position:absolute;left:-2px;top:-26px;display:inline-flex;align-items:center;gap:6px;'
                + 'padding:3px 10px;border-radius:999px;background:rgba(8,20,32,.88);color:#e0f2fe;'
                + 'border:1px solid rgba(56,189,248,.85);font:' + T.font + ';white-space:nowrap;box-shadow:' + T.shadow + ';';
              el.appendChild(pill);
              document.body.appendChild(el);
            }
            if (!el.dataset.ownerBoot) el.dataset.ownerBoot = String(stateRef.clientBootAt); // P37 认领戳
            return el;
          };
          const stopAgentGlow = () => {
            const st = stateRef.agentGlow;
            st.until = 0; st.sticky = false; st.count = 0; st.label = '';
            if (st.timer) { clearInterval(st.timer); st.timer = 0; }
            const el = document.getElementById(AGENT_GLOW_ID);
            if (el) el.remove();
          };
          const renderAgentGlow = () => {
            const st = stateRef.agentGlow;
            if (!(st.sticky || Date.now() < st.until)) { stopAgentGlow(); return; }
            const target = agentGlowTarget();
            if (!target) return;
            const r = agentGlowRect(target);
            if (r.width < 80 || r.height < 80) return;
            const el = ensureAgentGlowEl();
            const pad = 3;
            el.style.left = `${Math.round(r.left) - pad}px`;
            el.style.top = `${Math.round(r.top) - pad}px`;
            el.style.width = `${Math.round(r.width) + pad * 2}px`;
            el.style.height = `${Math.round(r.height) + pad * 2}px`;
            const pill = document.getElementById(AGENT_GLOW_ID + '-pill');
            const text = `${st.sticky ? '🟢' : '🤖'} Agent 操作中 · ${st.label}${st.count > 1 ? `（${st.count} 次）` : ''}`;
            if (pill && pill.textContent !== text) pill.textContent = text;
          };
          /** 打一次「Agent 正在操作」脉冲：续期 + 点亮（label 显示在胶囊上）。 */
          const pulseAgentActivity = (label, ms) => {
            try {
              if (!agentGlowEnabled()) return;
              const st = stateRef.agentGlow;
              if (Date.now() >= st.until) st.count = 0; // 上一轮已淡出：计数重新开始
              st.until = Date.now() + (Number(ms) > 0 ? Number(ms) : AGENT_GLOW_MS);
              st.label = String(label || '操作').slice(0, 24);
              st.count += 1;
              renderAgentGlow();
              if (!st.timer) st.timer = trackInterval(setInterval(renderAgentGlow, AGENT_GLOW_TICK));
            } catch { /* 光效失败不影响操作 */ }
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
                + 'padding:8px 10px;font:' + T.fontLh + ';'
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
              + 'padding:3px 6px 3px 10px;font:' + T.font + ';'
              + 'color:' + T.text + ';box-shadow:' + T.shadow + ';user-select:none;';
            const label = document.createElement('span');
            label.textContent = `${model.count} 条批注`;
            chip.appendChild(label);
            const close = makeCloseButton('撤回（删除已保存批注文件）');
            ensureChipDangerStyle();
            chip.appendChild(close);
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
          /* @annotator-consume-canonical-begin —— 与 src/annotator-consume.mjs parity 锁定
           *  （R3-1：判定规则见正典文件头注；纯函数，DOM/状态副作用全部留在调用侧）。 */
          const planChipConsume = (sig, base) => {
            if (!sig || !base) return 'idle';
            if (sig.first !== base.first) return 'reset';
            if (sig.n > base.n || (sig.last !== base.last && sig.n >= base.n)) return 'consume';
            return 'idle';
          };
          /* @annotator-consume-canonical-end */
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
              const rowKeys = rows.map(rowKey); // R1-03：键数组单次计算——消耗判定与补挂共用，勿逐模型重算
              const sig = { n: rows.length, first: rowKeys[0] || '', last: rowKeys[rows.length - 1] || '' };
              // 1) 发送消耗检测（视图签名基线；判定纯函数见上方内嵌副本）
              /* ★v26（用户指定）：**发送即消费** —— 草稿存在时，用户在会话输入框发出消息
               * 即消费批注（落盘 + 挂胶囊 + 清空页面与草稿 + 会话结束，下一轮从 1 开始）。
               * 基线与"已保存胶囊"那套分开记（`draftBase`），避免两条路径互相重置基线。 */
              if (draftCount() > 0) {
                if (!stateRef.draftBase) stateRef.draftBase = sig;
                else {
                  const act = planChipConsume(sig, stateRef.draftBase);
                  if (act === 'consume') {
                    stateRef.draftBase = null;
                    consumeDraft(sig.last).catch(() => {});
                  } else if (act === 'reset') {
                    stateRef.draftBase = sig;
                  }
                }
              } else if (stateRef.draftBase) {
                stateRef.draftBase = null; // 草稿清空（清除/消费）：基线一并清
              }
              const m = stateRef.chip;
              if (m && m.mode === 'saved' && m.convo === convo) {
                const action = planChipConsume(sig, m.base || { n: rows.length, first: sig.first, last: sig.last });
                if (action === 'consume') {
                  queue.push(m);
                  stateRef.chip = null;
                  removeAnnotChip();
                  const target = rows[rows.length - 1];
                  if (target) {
                    m.attachedKey = sig.last; // 锁定归属行：此后只补这一条
                    const holder = target.querySelector(BUBBLE_SEL) || target;
                    if (!holder.querySelector(MSG_CHIP_MARK)) attachMsgChip(holder, m);
                  }
                } else if (action === 'reset') {
                  m.base = sig; // 视图变更（切会话/虚拟化重组）：重置基线，胶囊保留待命
                }
              }
              // 2) 归属行补挂（只认 attachedKey；撤回模型/他会话模型一律跳过，不外溢）
              for (const model of queue) {
                if (!model.attachedKey || model.retracted || model.convo !== convo) continue;
                const idx = rowKeys.indexOf(model.attachedKey);
                const target = idx >= 0 ? rows[idx] : null;
                if (!target) continue; // 归属行不在 DOM（虚拟化/他会话）：跳过
                const holder = target.querySelector(BUBBLE_SEL) || target;
                if (holder.querySelector(MSG_CHIP_MARK)) continue;
                attachMsgChip(holder, model);
              }
            } catch { /* 失败不影响主流程 */ }
          };
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

          /** v22（审计）：会话状态复位**唯一来源**——收尾两条路径（提交 / 显式结束）都走它，
           *  避免两处手写字面量字段集漂移（审计发现 finishSubmit 漏复位 count/startedAt/convo，
           *  导致提交后诊断仍报旧 count）。 */
          const resetAnnotState = (reason, keepLastSaved) => {
            const st = stateRef.annot || {};
            const saved = keepLastSaved ? (st.lastSaved || null) : null;
            const err = (reason === 'submit' && st.error) ? st.error : null;
            stateRef.annot = {
              active: false, panes: [], pending: [], origins: {}, originUrls: {},
              leftIds: new Set(), count: 0, convo: null, startedAt: null,
              lastSaved: saved, error: err,
            };
            annotMetricCache.clear(); // 指标缓存随会话清空（元素换代后不残留）
            annotMirrorSubmitBusy = false;
            removeAnnotMirror();
          };
          /* ── ★R-OWN v26：**批注草稿箱**（按 DSH 对话隔离 + localStorage 持久）──────────────
           * 用户实测两问：①登录页批注→提交→**跳转内页**后，前面的批注不见了、编号从 1 重排 ✗；
           * ②批注了但**没提交**→关闭批注→做别的事→再打开，批注应像**草稿箱**一样还在 ✗。
           * 共同根因：批注只活在 **guest 文档内存**里 ⇒ 页面导航=新文档 ⇒ 记录全丢、编号归零。
           * 因此把真值**上移到 client**：`gid → item`（含 `_originUrl` 供同页门控），
           * 未提交的在关闭/跳转/热更新后都还在；**提交即消费清空**；换对话按 key 天然隔离。 */
          const DRAFT_LS_PREFIX = 'dsh-kit-annot-draft:';
          /** v26 修订：草稿 key 用**会话 id**（`currentSurfaceSession()`），而不是对话标题 ——
           *  标题会变/会空（实测：按标题落盘的草稿在跳页后取不回来 ✗）；取不到 id 才退回标题。 */
          const draftKeyOf = () => {
            try {
              const sid = currentSurfaceSession();
              return DRAFT_LS_PREFIX + (sid || convoTitle() || 'unknown');
            } catch { return DRAFT_LS_PREFIX + 'unknown'; }
          };
          let annotDraft = {}; // { gid: item } —— 本会话的草稿
          let draftLoaded = false; // v26 修订：**首次访问时懒加载**（模块初始化时 sidebar 服务可能未就绪；
          //  且"key 相等就跳过加载"是个坑：key 相同但内存还是空的 ⇒ 草稿永远读不出来，实测踩过）
          let draftKeyUsed = '';
          /** 懒加载 + 会话切换检测（所有读写入口都先过它）。 */
          const draftEnsure = () => {
            try {
              const k = draftKeyOf();
              if (!draftLoaded || k !== draftKeyUsed) {
                draftLoaded = true;
                draftKeyUsed = k;
                annotDraft = draftLoad();
              }
            } catch { /* 忽略 */ }
            return annotDraft;
          };
          const draftLoad = () => {
            try {
              const raw = localStorage.getItem(draftKeyOf());
              const j = raw ? JSON.parse(raw) : null;
              return (j && j.items && typeof j.items === 'object') ? j.items : {};
            } catch { return {}; }
          };
          const draftSave = () => { try { localStorage.setItem(draftKeyOf(), JSON.stringify({ at: new Date().toISOString(), items: annotDraft })); } catch { /* 配额/隐私模式：忽略 */ } };
          const draftList = () => { draftEnsure(); return Object.keys(annotDraft).map((g) => annotDraft[g]); };
          const draftMerge = (list, url) => {
            draftEnsure();
            let changed = false;
            for (const it of list || []) {
              if (!it || !it.gid) continue;
              const item = it._originUrl ? it : Object.assign({}, it, { _originUrl: url || null });
              if (JSON.stringify(annotDraft[it.gid] || null) !== JSON.stringify(item)) { annotDraft[it.gid] = item; changed = true; }
            }
            if (changed) draftSave();
            return changed;
          };
          const draftRemove = (gids) => {
            let changed = false;
            for (const g of gids || []) { if (annotDraft[g]) { delete annotDraft[g]; changed = true; } }
            if (changed) draftSave();
            return changed;
          };
          const draftClear = () => { annotDraft = {}; try { localStorage.removeItem(draftKeyOf()); } catch { /* 忽略 */ } };
          const draftMaxIndex = () => draftList().reduce((m, it) => Math.max(m, Number(it.index) || 0), 0);
          const draftCount = () => draftList().length;
          const draftReload = () => { draftLoaded = false; draftEnsure(); return draftList().length; };
          /** v26：关闭批注时调用 —— 保留草稿（localStorage 那份已是最新，这里只把内存视图与存储对齐）。 */
          const draftReloadKeep = () => { draftLoaded = false; draftEnsure(); return draftList().length; };
          /** v26：**把草稿补进面板**（页面跳转 / 重注入后 guest 记录为空时用）。
           *  同页条目在 guest 里重新钉标；不同页条目只进列表（`pageOk=false` 防串窗）。 */
          const hydrateDraftIntoPanes = async () => {
            const st = stateRef.annot;
            if (!st || !st.active) return;
            const items = draftList();
            if (items.length === 0) return;
            for (const p of st.panes) {
              try {
                const have = await p.executeJavaScript('(window.__dshKitAnnotator ? window.__dshKitAnnotator.list().map(function (a) { return a.gid; }) : [])', true);
                const set = new Set(Array.isArray(have) ? have : []);
                const missing = items.filter((it) => it.gid && !set.has(it.gid));
                if (missing.length === 0) continue;
                await p.executeJavaScript('window.__dshKitAnnotator.addExternal(' + JSON.stringify(missing) + ')', true);
              } catch { /* 面板不可达：下轮再试 */ }
            }
          };
          /** ★R-OWN v26（用户指定）：**发送即消费** —— 面板不再有「提交」按钮；
           *  用户把消息在会话输入框**发送出去**时，草稿被消费：落盘 → 挂到刚发出的那条消息上 →
           *  **清空页面批注与草稿** → 会话结束（下一轮批注从 1 重新开始）。
           *  `rowKeyOfSentRow` = 刚出现的用户行键（用于把胶囊补挂到该行）。 */
          let annotConsumeBusy = false;
          let hydrateBusy = false; // v26：草稿水合单飞（与镜像同步同款护栏）
          const consumeDraft = async (sentRowKey) => {
            const st = stateRef.annot;
            const items = draftList();
            if (annotConsumeBusy) return null;
            annotConsumeBusy = true;
            try {
              const r = await mergeAndSave();
              for (const p of ((st && st.panes) || [])) {
                try {
                  await p.executeJavaScript('(function(){ var a = window.__dshKitAnnotator; if (!a) return 0; if (a.stop) a.stop(); if (a.clearAll) a.clearAll(); return 1; })()', true);
                } catch { /* 面板已关闭等：忽略 */ }
              }
              draftClear(); // 消费草稿
              if (st) { st.error = (r && r.ok === false) ? r.error : null; if (r && r.ok) st.lastSaved = r; }
              resetAnnotState('submit', true);
              // 挂到刚发出的那条消息上（不再往输入框塞文本——用户已经发出去了）
              if (r && r.ok) {
                const n = Number(r.count);
                stateRef.chip = {
                  mode: 'saved',
                  count: Number.isFinite(n) && n > 0 ? n : items.length,
                  path: r.path,
                  convo: convoTitle(),
                  items: Array.isArray(r.items) ? r.items : [],
                  bornAt: new Date().toISOString(),
                  attachedKey: sentRowKey || null,
                  base: null,
                };
                if (sentRowKey) {
                  const rows = userRows();
                  const idx = rows.map(rowKey).indexOf(sentRowKey);
                  const target = idx >= 0 ? rows[idx] : null;
                  if (target) {
                    const holder = target.querySelector(BUBBLE_SEL) || target;
                    if (!holder.querySelector(MSG_CHIP_MARK)) attachMsgChip(holder, stateRef.chip);
                    (stateRef.sentChips = stateRef.sentChips || []).push(stateRef.chip);
                  }
                }
              }
              say('info', `批注已随消息发送（${r && r.ok ? r.path : (r && r.error) || '落盘失败'}）；页面批注与草稿已清空`);
              return r;
            } finally {
              annotConsumeBusy = false;
            }
          };
          /** R-OWN v20：提交收尾（保留：命令/API 路径仍可显式提交；UI 已无「提交」按钮）。
           *  v22：加**重入护栏**（审计发现双击镜像「提交」会落盘两次 + 重复提示）。 */
          let annotMirrorSubmitBusy = false;
          const finishSubmit = async () => {
            const st = stateRef.annot;
            if (!st) return null;
            if (annotMirrorSubmitBusy) return null; // 提交进行中：忽略重复点击
            annotMirrorSubmitBusy = true;
            try {
              const r = await mergeAndSave();
              /* v26：提交/消费语义统一为"发送即消费" ⇒ 这里也**清空**（页面 + 草稿），
               * 与 consumeDraft 一致（旧 v24 的"保留"语义已被用户否决）。 */
              for (const p of st.panes) {
                try {
                  await p.executeJavaScript('(function(){ var a = window.__dshKitAnnotator; if (!a) return 0; if (a.stop) a.stop(); if (a.clearAll) a.clearAll(); return 1; })()', true);
                } catch { /* 面板已关闭等：死面板由后续刷新自愈 */ }
              }
              draftClear();
              st.error = (r && r.ok === false) ? r.error : null;
              if (r && r.ok) st.lastSaved = r;
              announceSubmission(r);
              resetAnnotState('submit', true);
              say('info', `批注已消费（页面批注与草稿已清空，下一轮从 1 开始）：${r && r.ok ? r.path : r.error}`);
              return r;
            } finally {
              annotMirrorSubmitBusy = false;
            }
          };

          const sessionSettled = async (winner) => {
            const st = stateRef.annot;
            if (!st || !st.active) return;
            st.pending = (st.pending || []).filter((e) => e.pane !== winner.pane);
            if (winner.how === 'submitted') {
              // 单次消耗（用户需求 2026-10-05）：提交即全窗口清空（见 finishSubmit 注释）
              await finishSubmit();
            } else {
              // 取消/Esc/重启动：**成员身份保留**（退出必须走 leavePane 显式开关）——
              // 否则 drive 自愈式 start 重启会把自己踢出成员表，跨面板同步随即失效。
              runSessionLoop(); // 其余 pending 继续
            }
          };

          /** 这个 pane **实际可见**的 guest 宽度（px）——提示条(toast)据此锚定在可见区内。
           *  两种被裁场景：①侧栏套了设备尺寸 + 外层 `transform: scale`（可见带 = 容器宽 / 缩放）；
           *  ②自持窗口 100% 显示时 guest 视口比舞台更宽（可见带 = 舞台宽，右侧被裁）。
           *  ★v22：面板已改**宿主渲染**，此值现在只服务提示条（面板定位在宿主坐标系里做）。 */
          const paneVisibleWidth = (pane) => {
            try {
              const host = pane.parentElement || pane;
              const hostW = host.getBoundingClientRect().width;          // 容器可见宽（屏幕 px）
              const rectW = pane.getBoundingClientRect().width;          // 元素可见宽（= CSS 宽 × 缩放）
              const k = scaleOf(pane);
              return Math.max(0, Math.round(Math.min(hostW, rectW) / (k > 0 ? k : 1)));
            } catch { return 0; }
          };

          /** guest→屏幕的放大倍数（提示条按 1/uiScale 反向缩放 ⇒ 视觉尺寸恒定）。
           *  ★不要用 `getZoomFactor()`——它把**显示器缩放**也算进来（实测侧栏被放大 ~1.23 倍）。
           *  改为**几何测量 + 我们自己设过的缩放**：元素可见宽 / 元素 CSS 宽 × 我们设的页面缩放。 */
          const paneUiScale = (pane) => {
            try {
              const rectW = pane.getBoundingClientRect().width || 0;
              const cssW = pane.offsetWidth || rectW || 1;
              const geom = cssW > 0 ? rectW / cssW : 1;
              let z = 1;
              try { z = Number((pane.dataset && pane.dataset.kitZoomFactor) || 1) || 1; } catch { z = 1; }
              return Math.max(0.05, geom * z);
            } catch { return 1; }
          };
          /** v22 收敛：指标推送**带缓存**——值没变就不再发起跨进程 executeJavaScript
           *  （先前 1s tick 无条件推 6 个字段 × 每个成员面板，纯属浪费）。 */
          const annotMetricCache = new Map(); // pane → "band|scale"
          const syncAnnotMetrics = (pane) => {
            try {
              if (!pane) return;
              const band = paneVisibleWidth(pane);
              const s = Number(paneUiScale(pane).toFixed(4));
              const key = `${band}|${s}`;
              if (annotMetricCache.get(pane) === key) return; // 无变化：不发
              annotMetricCache.set(pane, key);
              pane.executeJavaScript(`(window.__dshKitAnnotator && window.__dshKitAnnotator.setPaneMetrics) ? window.__dshKitAnnotator.setPaneMetrics({ visibleWidth: ${band}, uiScale: ${s} }) : 0`, true).catch(() => {});
            } catch { /* 忽略 */ }
          };

          /* ── R-OWN v20：**宿主镜像批注面板** ────────────────────────────────────────
           * 为什么不让面板留在 guest：guest 内的 `position:fixed` 浮层**出不了 guest 视口**
           * （= 页面底边）；页面顶部对齐后它必然压在网页内容上（用户实测反馈）。
           * 做法：guest 侧以 `mirror:true` 启动，只保留状态/徽标；宿主把面板 DOM **镜像**过来，
           * 在**屏幕坐标**里定位（右缘贴板块、下缘贴自持小窗上沿），按钮改由宿主调用批注器 API。 */
          const ANNOT_MIRROR_ID = 'dsh-kit-annot-mirror';
          const ANNOT_PANEL_W = 264; // 与 src/element-annotator.js 的 PANEL_W 对齐（面板基准宽）
          const ANNOT_GAP = 12;      // 面板与板块右缘 / 小窗上沿的间距（屏幕 px）
          const annotMirror = { html: '', rev: null, bound: false, root: null, busy: false, listOpen: false };
          const annotAnchorPane = () => {
            try {
              const list = (stateRef.annot && stateRef.annot.panes) || [];
              return list.find((p) => paneOwnerLabel(p).kind === 'session') || list[0] || null;
            } catch { return null; }
          };
          /** 镜像面板落位（规则唯一真值在 src/annot-mirror-anchor.mjs，此处内嵌 canonical 副本对拍）。
           *  历史坑：先前"贴 bar 上沿"没有状态判断，自持窗口**展开态**（bar.top≈46）时面板被顶出屏幕。 */
          /* @annot-mirror-anchor-canonical-begin */
          function mirrorPlacement(o) {
            const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
            const winW = Math.max(1, num(o.winW, 1024));
            const winH = Math.max(1, num(o.winH, 768));
            const gap = Math.max(0, num(o.gap, 12));
            const panelH = Math.max(0, num(o.panelH, 82));
            /* ★R-OWN v23（实测 bug）：锚点 rect **退化为 0** 时不能当有效锚点 ——
             * 实测 `paneRight≈0`（面板此刻不可见/零面积）⇒ right = winW − 0 + gap = 2572
             * ⇒ 面板被推到屏幕外（rect.left = −276）。非正数一律视为"无锚点"。 */
            const paneRight = num(o.paneRight, NaN);
            const barTop = num(o.barTop, NaN);
            const right = (Number.isFinite(paneRight) && paneRight > 0) ? Math.max(gap, Math.round(winW - paneRight + gap)) : gap;
            const dockToBar = Number.isFinite(barTop) && barTop > winH * 0.5;
            let bottom = dockToBar ? Math.max(gap, Math.round(winH - barTop + gap)) : gap;
            const maxBottom = winH - panelH - gap;
            let clipped = false;
            if (bottom > maxBottom) {
              bottom = Math.max(gap, Math.round(maxBottom));
              clipped = true;
            }
            return { right, bottom, clipped };
          }
          /* @annot-mirror-anchor-canonical-end */
          const positionAnnotMirror = () => {
            try {
              const host = document.getElementById(ANNOT_MIRROR_ID);
              if (!host) return;
              const pane = annotAnchorPane();
              const er = pane ? pane.getBoundingClientRect() : null;
              const bar = (agentView.panel && document.contains(agentView.panel)) ? agentView.panel.getBoundingClientRect() : null;
              const root = annotMirror.root;
              const place = mirrorPlacement({
                paneRight: er ? er.right : NaN,
                barTop: bar && bar.top > 0 ? bar.top : NaN,
                winW: window.innerWidth,
                winH: window.innerHeight,
                gap: ANNOT_GAP,
                panelH: root ? Math.round(root.getBoundingClientRect().height) || 82 : 82,
              });
              host.style.right = `${place.right}px`;
              host.style.bottom = `${place.bottom}px`;
            } catch { /* 忽略 */ }
          };
          const removeAnnotMirror = () => {
            try {
              const host = document.getElementById(ANNOT_MIRROR_ID);
              if (host) host.remove();
              annotMirror.html = '';
              annotMirror.rev = null;
              annotMirror.bound = false;
              annotMirror.root = null;
            } catch { /* 忽略 */ }
          };
          const bindAnnotMirror = (root, pane) => {
            try {
              Array.from(root.querySelectorAll('button')).forEach((b) => {
                // 按**稳定属性**绑定（不再按按钮文案：文案改字就会静默失联）
                if (b.hasAttribute('data-dsh-kit-panel-toggle')) {
                  // v26（用户指定）：底部「展开列表 / 收起列表」
                  b.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    annotMirror.listOpen = !annotMirror.listOpen; // 宿主侧状态，重镜像后由 applyAnnotMirrorListState 恢复
                    applyAnnotMirrorListState();
                  });
                  return;
                }
                if (b.hasAttribute('data-dsh-kit-panel-close')) {
                  // v26（用户指定）：头部 ✕ = 关闭批注（**草稿保留**，下次打开还在）
                  b.addEventListener('click', (ev) => { ev.stopPropagation(); endAnnotSession(pane).catch(() => {}); });
                  return;
                }
                if (b.hasAttribute('data-dsh-kit-panel-clear')) {
                  b.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    for (const p of ((stateRef.annot && stateRef.annot.panes) || [])) {
                      p.executeJavaScript('(window.__dshKitAnnotator && window.__dshKitAnnotator.clearAll) ? window.__dshKitAnnotator.clearAll() : 0', true).catch(() => {});
                    }
                    draftClear(); // v26：清除 = 真丢弃（连草稿一起清，否则重开会"复活"）
                    say('info', '已清除全部批注（所有窗口同步移除）');
                  });
                  return;
                }
              });
            } catch { /* 忽略 */ }
          };
          /** 镜像里的「列表」显示由**宿主**决定（guest 的 listExpanded 只影响那个隐藏的页内面板）。
           *  重新镜像会换掉整个 DOM ⇒ 每次都要把宿主的展开态重新贴回去，否则展开状态会莫名回弹。 */
          const applyAnnotMirrorListState = () => {
            try {
              const root = annotMirror.root;
              if (!root) return;
              const body = root.children[1];
              if (!body) return;
              body.style.display = annotMirror.listOpen ? '' : 'none';
              // v26：展开/收起状态由底部整宽按钮表达（头部已无 ▸ 图标）
              const tg = root.querySelector('[data-dsh-kit-panel-toggle]');
              if (tg) tg.textContent = annotMirror.listOpen ? '收起列表 ▴' : '展开列表 ▾';
            } catch { /* 忽略 */ }
          };
          const syncAnnotMirror = async () => {
            const dg = stateRef.mirrorDiag;
            dg.calls += 1;
            dg.lastAt = new Date().toISOString();
            if (annotMirror.busy) { dg.skippedBusy += 1; return; } // 单飞护栏：guest 若不 settle，也不累积悬挂 IPC
            annotMirror.busy = true;
            try {
              if (!(stateRef.annot && stateRef.annot.active)) { removeAnnotMirror(); return; }
              const pane = annotAnchorPane();
              if (!pane) { dg.skippedNoPane += 1; removeAnnotMirror(); return; }
              let host = document.getElementById(ANNOT_MIRROR_ID);
              if (!host) {
                host = document.createElement('div');
                host.id = ANNOT_MIRROR_ID;
                host.setAttribute('data-dsh-kit-annot-mirror', '');
                host.style.cssText = 'position:fixed;z-index:2147483647;display:block;';
                document.body.appendChild(host);
              }
              const snap = await pane.executeJavaScript('(window.__dshKitAnnotator && window.__dshKitAnnotator.mirrorSnapshot) ? window.__dshKitAnnotator.mirrorSnapshot() : null', true);
              // v22（审计）：guest 侧带回 rev；rev 未变时 html 为空字符串 ⇒ 每秒只搬一个小对象，
              //   不再无条件搬运整份面板 outerHTML（含全部内联样式）。
              if (!snap) { dg.skippedNoHtml += 1; return; }
              // ★v22（审计）：缓存要能自证有效——host 被外部移除/重建时，仅比较 html 会永远跳过填充
              //   （root 指向已脱离的旧节点）⇒ 校验 isConnected/归属，失联时调 mirrorReset() 取全量。
              if (!host.firstElementChild || !annotMirror.root || !annotMirror.root.isConnected || annotMirror.root.parentElement !== host) {
                dg.resetForced += 1;
                try { await pane.executeJavaScript('(window.__dshKitAnnotator && window.__dshKitAnnotator.mirrorReset) ? window.__dshKitAnnotator.mirrorReset() : 0', true); } catch { /* 忽略 */ }
                annotMirror.rev = null;
                const again = await pane.executeJavaScript('(window.__dshKitAnnotator && window.__dshKitAnnotator.mirrorSnapshot) ? window.__dshKitAnnotator.mirrorSnapshot() : null', true);
                if (again && again.html) { snap.html = again.html; snap.rev = again.rev; }
              }
              if (!snap.html) dg.skippedNoHtml += 1; // 内容未变（rev 未推进）——正常路径，非错误
              // ★注意：`snap.html === ''` 表示"内容未变"（rev 未推进），**不是**"没有面板"——
              //   若在此处无条件赋值会把镜像清空（自己踩过）。只有拿到非空 HTML 才替换。
              if (annotMirror.html !== snap.html && snap.html) {
                dg.injected += 1;
                annotMirror.html = snap.html;
                if (snap.rev != null) annotMirror.rev = snap.rev;
                host.innerHTML = snap.html;
                const root = host.firstElementChild;
                if (root) {
                  // 覆盖 guest 的定位/显隐（改为由宿主容器定位；`display` 用 !important 压过 mirror 隐藏）
                  root.style.setProperty('display', 'flex', 'important');
                  root.style.setProperty('position', 'static', 'important');
                  root.style.setProperty('left', 'auto', 'important');
                  root.style.setProperty('right', 'auto', 'important');
                  root.style.setProperty('top', 'auto', 'important');
                  root.style.setProperty('bottom', 'auto', 'important');
                  root.style.setProperty('transform', 'none', 'important');
                  root.style.setProperty('width', `${ANNOT_PANEL_W}px`, 'important');
                  root.style.setProperty('max-height', '60vh', 'important');
                  annotMirror.root = root;
                  annotMirror.bound = false;
                }
              }
              if (annotMirror.root && !annotMirror.bound) {
                bindAnnotMirror(annotMirror.root, pane);
                annotMirror.bound = true;
              }
              applyAnnotMirrorListState();
              positionAnnotMirror();
            } catch (e) {
              dg.lastError = msgOf(e); // v23：不再静默——错误经 kit-status.annotMirror.lastError 可查
            } finally { annotMirror.busy = false; }
          };

          const startPaneInSession = async (target, startIndex) => {
            const howPromise = (async () => {
              let how = 'cancelled';
              try {
                const vw = paneVisibleWidth(target);
                const us = Number(paneUiScale(target).toFixed(4));
                // v22 简化：start 只带 mirror/startIndex + 提示条需要的两个指标
                // （面板本体由宿主镜像渲染；宿主提交走 finishSubmit → mergeAndSave，直接拉 list()，
                //   所以不再需要 onSubmit 回写 window.__dshKitLastSubmit）
                how = await target.executeJavaScript(
                  `window.__dshKitAnnotator.start({ mirror: true, startIndex: ${Number(startIndex) || 0}, visibleWidth: ${Number(vw) || 0}, uiScale: ${us} })`,
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

          // （旧实现 stopAllPanes 已删：其 stop()+clear() 组合在 stop 后 session=null 时
          //   不写删除日志，1.5s 同步圈会从其他窗口把成员批注推回——单次消耗改造后由
          //   sessionSettled 的逐面板 stop+clearAll + syncPanes 广播取代，见上）

          /** R-OWN v11：判断某个 guest 属于**哪个窗口**——批注落盘时逐条标注来源，
           *  让 Agent 能分清"DSH 自带浏览器的哪个窗口"与"自持浏览器的哪个窗口"。 */
          const paneOwnerLabel = (pane) => {
            try {
              const tabs = (typeof agentView !== 'undefined' && agentView && agentView.tabs) ? agentView.tabs : [];
              const tab = tabs.find((t) => t.el === pane);
              if (tab) {
                let title = tab.title || null;
                let url = tab.url || null;
                try { if (tab.el && tab.el.getTitle) title = tab.el.getTitle() || title; } catch { /* 忽略 */ }
                try { if (tab.el && tab.el.getURL) url = tab.el.getURL() || url; } catch { /* 忽略 */ }
                return {
                  kind: 'owned',
                  label: `自持浏览器 ${tab.id}${title ? ` · ${String(title).slice(0, 24)}` : ''}`,
                  tabId: tab.id, url, title,
                };
              }
              // DSH 侧栏窗口：用 closest 精确上溯（先前手写 8 层循环取不到 → 标签成"未知窗口"）
              let host = null;
              try { host = pane.closest ? pane.closest('[data-sidebar-right-session]') : null; } catch { host = null; }
              if (!host) {
                let node = pane;
                for (let i = 0; i < 20 && node; i += 1, node = node.parentElement) {
                  if (node.getAttribute && node.getAttribute('data-sidebar-right-session')) { host = node; break; }
                }
              }
              if (host) {
                const sid = host.getAttribute('data-sidebar-right-session');
                const all = Array.from(document.querySelectorAll(`[data-sidebar-right-session="${sid}"] webview`));
                const idx = all.indexOf(pane) + 1;
                return { kind: 'session', label: `DSH 浏览器窗口 ${idx || 1}（会话 ${String(sid).slice(-6)}）`, sessionId: sid, paneIndex: idx || 1 };
              }
            } catch { /* 忽略 */ }
            return { kind: 'unknown', label: '未知窗口' };
          };

          /** 收集全部成员批注 → host saveMerged 合并落盘。 */
          const mergeAndSave = async () => {
            const svc = await waitSvc();
            if (!svc) return { ok: false, error: 'host 远端面未就绪' };
            refreshPanes(); // 重渲染换节点后按 webContentsId 映射回活节点
            const sets = [];
            for (const p of stateRef.annot.panes) {
              try {
                const lstAll = await p.executeJavaScript('(window.__dshKitAnnotator ? window.__dshKitAnnotator.list() : [])', true);
                if (!Array.isArray(lstAll)) continue;
                /* ★R-OWN v24：v24 起提交后**保留**批注 ⇒ 再次提交只发**新增/改过**的条目
                 * （`dirty !== false`；老版本 annotator 不带该字段 ⇒ 视为 dirty，行为不变）。 */
                const lst = lstAll.filter((a) => !a || a.dirty !== false);
                if (lst.length === 0) continue;
                let meta = null;
                try {
                  meta = metaOf(await p.executeJavaScript(GUEST_META_JS, true));
                } catch { /* 元数据失败不拦合并 */ }
                {
                  // R-OWN v11：逐条标注**来源窗口**（Agent 据此分辨是哪个浏览器窗口的元素）
                  const owner = paneOwnerLabel(p);
                  sets.push({
                    url: (meta && meta.url) || null,
                    title: (meta && meta.title) || null,
                    owner: owner.label,
                    ownerKind: owner.kind,
                    annotations: lst.map((a) => Object.assign({}, a, { window: owner.label, windowKind: owner.kind })),
                  });
                }
              } catch { /* 成员不可达：跳过 */ }
            }
            if (sets.length === 0) return { ok: false, error: '无可提交批注' };
            /* @annotations-summary-canonical-begin —— 与 src/annotations-summary.mjs parity 锁定
             *  摘要（hover 提示用）：gid 去重（共享会话同批注同步进多面板，原始 sets 含重复）
             *  + 字段映射（text 回退 accessibleName，60 字截断）+ index 升序。 */
            const summarizeSets = (sets) => {
              const items = [];
              const seenGids = {};
              for (const s of sets) {
                for (const a of (s && s.annotations) || []) {
                  const gid = (a && a.gid) || null;
                  if (gid) {
                    if (seenGids[gid]) continue;
                    seenGids[gid] = true;
                  }
                  items.push({
                    index: Number(a && a.index) || 0,
                    gid,
                    selector: String((a && a.element && a.element.selector) || ''),
                    text: String((a && a.element && a.element.text) || (a && a.element && a.element.accessibleName) || '').slice(0, 60),
                    url: (s && s.url) || null,
                    window: String((a && a.window) || (s && s.owner) || ''),
                  });
                }
              }
              items.sort((x, y) => x.index - y.index);
              return items;
            };
            /* @annotations-summary-canonical-end */
            const items = summarizeSets(sets);
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

          /** 图标/菜单开关语义（R-OWN v11：**会话级总开关**）：
           *  · 会话未开 → 开会话（本窗口为首个成员，**立即把其余所有窗口拉进来**：侧栏各面板 + 自持各标签）；
           *  · 会话已开 → **整个会话关闭**（所有成员 stop+clearAll，st.active=false）。
           *  为什么改成会话级：先前按"单窗口成员身份"点亮图标，成员表会因 settle/自愈重注入而变动，
           *  图标随之亮灭闪烁（用户实测反馈）；且用户要的是"两处浏览器同步开关"。 */
          const togglePaneAnnot = async (targetEl) => {
            const target = targetEl || pickGuestEl();
            const st = stateRef.annot;
            if (st && st.active) return endAnnotSession(target);
            // 新会话：点击者为其首个成员
            const svc = await waitSvc();
            if (!svc) return { ok: false, error: 'host 远端面未就绪' };
            await ensureAnnotator(svc, target);
            stateRef.annot = { active: true, panes: [target], pending: [], origins: {}, originUrls: {}, leftIds: new Set(), count: 0, convo: convoTitle(), startedAt: new Date().toISOString(), lastSaved: null, error: null };
            draftReload(); // v26：开会话时先加载本会话草稿（编号续用 + 面板列出旧批注）
            // R-OWN v23：会话一开就立刻拉一次镜像（不等 2s tick）——用户点开批注后要马上看到面板
            try { setTimeout(() => { syncAnnotMirror().catch(() => {}); }, 300); } catch { /* 忽略 */ }
            startPaneInSession(target, joinFloorIndex(0)); // 首个成员：编号从 1 起（下限 0，annotator +1）
            // R-OWN v11：立即拉齐其余窗口（不等 2s tick）——侧栏各面板 + 自持各标签，编号延续
            try {
              for (const wv of Array.from(document.querySelectorAll('webview'))) {
                if (!wv.isConnected) continue;
                if (paneIdOf(wv) === paneIdOf(target)) continue;
                if (stateRef.annot.panes.some((p) => paneIdOf(p) === paneIdOf(wv))) continue;
                try { await joinPane(wv); } catch { /* 页面未就绪：tick 会再试 */ }
              }
            } catch { /* 忽略 */ }
            runSessionLoop();
            say('info', '共享批注会话开始（所有浏览器窗口自动加入，编号实时同步；点图标=总开关）');
            return { ok: true, started: true, sessionActive: true, panes: stateRef.annot.panes.length };
          };

          /** 结束共享批注会话（**所有窗口**一起停），并把状态复位。
           *  ★R-OWN v26（用户指定）：关闭 = **保留为草稿**（重开/跳页/热更新后都还在）；
           *  提交不再由面板发起 —— 用户把消息**发送出去**即消费并清空（见 consumeDraft）；
           *  想丢弃请用面板的「清除」。 */
          const endAnnotSession = async (target) => {
            const st = stateRef.annot;
            const paneIds = (st && st.panes) ? st.panes.slice() : [];
            if (target) paneIds.push(target);
            // v26：关闭**之前**先做一次最终草稿同步——否则"批注后立刻关闭再跳页"会丢掉最后几秒的批注
            for (const p of paneIds) {
              try {
                const lst = await p.executeJavaScript('(window.__dshKitAnnotator ? window.__dshKitAnnotator.list() : [])', true);
                if (Array.isArray(lst)) draftMerge(lst, null);
              } catch { /* 草稿同步失败：下次会话仍可从 guest 取回 */ }
            }
            for (const p of paneIds) {
              try {
                await p.executeJavaScript('(function(){ var a = window.__dshKitAnnotator; if (!a) return 0; if (a.stop) a.stop(); return 1; })()', true);
              } catch { /* 面板已关闭等：忽略 */ }
            }
            resetAnnotState('end', true); // v22：与提交共用同一复位逻辑（单一真值来源；保留 lastSaved）
            draftReloadKeep(); // v26：关闭 = 保留草稿（重开/跳页/热更新后都还在）
            say('info', '批注已关闭（内容保留为草稿；要丢弃请点「清除」）');
            return { ok: true, ended: true, sessionActive: false };
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
              /* v26：草稿箱 = 各面板列表的并集（按 gid），并带上来源页 URL 供同页门控。
               * 这样**跳转页面**（新文档）后，草稿仍在；而删除日志命中的条目同时从草稿剔除。 */
              /* v28（用户实测跨会话泄漏）：**只并本会话面板的列表** —— 别的会话残留的批注
               * 会被吸进本会话草稿，从而"在别的会话里看到本会话的批注"✗。 */
              try {
                const sidNow = currentSurfaceSession();
                for (const s2 of states) {
                  if (s2.dead) continue;
                  if (sidNow) {
                    let inScope = true;
                    try { inScope = !!s2.pane.closest(`[data-sidebar-right-session="${String(sidNow)}"]`); } catch { inScope = true; }
                    if (!inScope) continue;
                  }
                  draftMerge(s2.list, s2.url);
                }
                draftRemove(Object.keys(plan.removedGids || {}));
              } catch { /* 草稿合并失败不影响同步 */ }
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
          /* P43：face 外层信封 {ok, value} 剥离（**只看信封形状，不用业务键**）——
           * 曾有谓词以「ok 字段存在」为终止条件，而外层信封自己就带 ok → 内层业务结果被吞。 */
          const faceUnwrap = (x) => {
            let cur = x;
            for (let i = 0; i < 4; i++) {
              if (cur && typeof cur === 'object' && !Array.isArray(cur) && cur.value !== undefined && cur.ok !== undefined) cur = cur.value;
              else break;
            }
            return cur;
          };
          /* R-BROWSER（2026-10-09）：侧栏浏览器服务句柄。
           * **用 ctx.inject 惰性取，不写进顶层 inject**——`sidebarRight` 不在 typert 服务目录里
           * （运行期探测：no catalogued Service named "sidebarRight"），若写进顶层 inject 而服务缺失，
           * 会把整个 client 插件卡在「未就绪」= 批注/截图/命令通道全废。惰性 inject 失败只降级 browser-*。
           * 契约来源：dsh-client-ui-sidebar-browser/lib/client.js L1537-1542（inject 清单）、
           * L157-159（openTab）、L1596（openTabs）。 */
          let sidebarRightSvc = null;
          try {
            ctx.inject(['sidebarRight'], (scope) => {
              sidebarRightSvc = scope && scope.sidebarRight ? scope.sidebarRight : null;
              scope.effect(() => () => { sidebarRightSvc = null; });
            });
          } catch { /* 服务缺失：browser-* 命令走 DOM 枚举降级 */ }
          /* R-BROWSER：面板级开合服务（右侧栏整列）——`ctx.layout.{openRightbar,closeRightbar,toggleSidebar}`，
           * 与标签页级的 sidebarRight 分工：layout 管「浏览器窗口/面板」的显隐，sidebarRight 管「标签」。
           * 同样惰性取（顶层 inject 失败会拖垮整个 client 插件）。 */
          let layoutSvc = null;
          try {
            ctx.inject(['layout'], (scope) => {
              layoutSvc = scope && scope.layout ? scope.layout : null;
              scope.effect(() => () => { layoutSvc = null; });
            });
          } catch { /* 服务缺失：browser-panel 命令降级报错 */ }
          /* ── R-INPUT（2026-10-09 实测解锁）：**可信输入** —— `<webview>.sendInputEvent` 发 Chromium 级事件 ──
           * 事实（本轮页面内探针实测）：mousemove / mousedown / mouseup / keydown / char / keyup 全部投递，
           * 且页面侧 `isTrusted === true`（DOM 合成 `el.dispatchEvent` 永远是 false），且**没有** capturePage
           * 那种崩溃。可信事件对 React 受控组件、反自动化检测、拖拽/文件/快捷键等 native 行为都成立。
           * 坐标换算：页面 CSS px × zoomFactor = webview 局部 px（sendInputEvent 用后者，且要整数）。
           * 遮挡检测：点击前 `document.elementFromPoint(中心)`，命中不是目标（且非其祖先/后代）即判遮挡，
           * 默认拒绝并回报遮挡者（抄 agent-browser 的稳定性设计：宁可提前失败也不点错东西）。 */
          /* ── R-OWN（2026-10-10）：**插件自持浏览器视图**（不依赖会话/侧栏） ──
           * 契约（实测钉死，docs §3.8）：
           *   dshDesktop.browser.acquire(storageIdentity: string) → { lease, partition }
           *   webview 必须 name=<lease> + partition=<partition> + src='about:blank#<lease>'，
           *   才会被 main 的 will-attach-webview 放行（照抄 dsh-client-ui-sidebar-browser 的
           *   `createElement(reservation)`：name/partition/allowpopups/src 四个属性）。
           * 价值：视图归插件所有 ⇒ **会话隔离天然成立**（不碰任何会话的侧栏），且后台会话也能持续
           * 自动化（不再受「用户停在其他会话 ⇒ 本会话面板未挂载」限制）。
           * 生命周期：面板移除/插件卸载时 release 租约；崩溃时靠 localStorage 里的租约记录做清理提示。 */
          const AGENT_VIEW_ID = 'dsh-kit-agent-view';
          const AGENT_VIEW_LEASE_KEY = 'dsh-browser-kit:agent-view-lease:v1';
          const agentView = { lease: null, partition: null, el: null, panel: null, stage: null, lastPopup: null, acquiredAt: null, openErr: null, ui: null, identity: null, identityFrom: null, sharedWithSidebar: null, resizeObserver: null, boot: null, idleTimer: null, lastOpAt: 0, idleReleaseMs: 0, releasedForIdle: null };
          const agentViewWebview = () => (agentView.el && document.contains(agentView.el) ? agentView.el : null);
          const agentViewCarrier = () => {
            const carrier = globalThis.dshDesktop;
            return carrier && carrier.protocolVersion === 1 && carrier.browser ? carrier.browser : null;
          };
          /** 释放租约并移除面板（幂等）。 */
          const releaseAgentView = () => {
            const b = agentViewCarrier();
            try { if (agentView.resizeObserver && agentView.resizeObserver.disconnect) agentView.resizeObserver.disconnect(); } catch { /* 忽略 */ }
            try { if (agentView.idleTimer) clearInterval(agentView.idleTimer); } catch { /* 忽略 */ }
            // 多窗口：逐个释放租约并移除元素
            for (const t of (agentView.tabs || [])) {
              try { if (t.el && t.el.remove) t.el.remove(); } catch { /* 忽略 */ }
              try { if (b && t.lease) b.release(t.lease).catch(() => {}); } catch { /* 忽略 */ }
            }
            try { if (agentView.el && agentView.el.remove) agentView.el.remove(); } catch { /* 忽略 */ }
            try { if (agentView.panel && agentView.panel.remove) agentView.panel.remove(); } catch { /* 忽略 */ }
            agentView.el = null; agentView.panel = null; agentView.stage = null; agentView.lease = null;
            agentView.partition = null; agentView.lastPopup = null; agentView.resizeObserver = null; agentView.ui = null;
            agentView.idleTimer = null; agentView.lastOpAt = 0;
            agentView.tabs = []; agentView.activeId = null; agentView.tabStrip = null; agentView.addr = null; agentView.urlText = null;
            try { localStorage.removeItem(AGENT_VIEW_LEASE_KEY); } catch { /* 忽略 */ }
            return { ok: true };
          };
          /** 建/复用自持视图（面板 + webview），返回 agentView。 */
          /* ── 分辨率预设（参考 Chrome DevTools 设备模式；**默认 1920×1080**，用户 2026-10-10 指定）──
           * guest 视口 = webview 自身的 CSS 尺寸；展开时用 `transform: scale(k)` **只缩放显示**，
           * 不改 guest 视口（页面按目标分辨率布局，屏幕不够大也能看全）。dpr 走 setZoomFactor
           * （≈ 设备像素比；同时让 sendInputEvent 的坐标换算保持一致——inputZoom 会读到它）。 */
          const AGENT_VIEW_PRESETS = {
            '1080p': { w: 1920, h: 1080, dpr: 1, label: 'Desktop · 1920×1080' },
            '2K': { w: 2560, h: 1440, dpr: 1, label: '2K · 2560×1440' },
            '4K': { w: 3840, h: 2160, dpr: 1, label: '4K · 3840×2160' },
            '1440x900': { w: 1440, h: 900, dpr: 1, label: 'Laptop · 1440×900' },
            '1280x720': { w: 1280, h: 720, dpr: 1, label: 'Laptop · 1280×720' },
            'iPad Pro': { w: 1024, h: 1366, dpr: 2, label: 'iPad Pro · 1024×1366' },
            'iPad mini': { w: 768, h: 1024, dpr: 2, label: 'iPad mini · 768×1024' },
            'iPhone 15 Pro': { w: 393, h: 852, dpr: 3, label: 'iPhone 15 Pro · 393×852' },
            'iPhone 15 Pro Max': { w: 430, h: 932, dpr: 3, label: 'iPhone 15 Pro Max · 430×932' },
            'Pixel 7': { w: 412, h: 915, dpr: 2.6, label: 'Pixel 7 · 412×915' },
            'Galaxy S20': { w: 360, h: 800, dpr: 3, label: 'Galaxy S20 · 360×800' },
          };
          const agentViewResolvePreset = (spec) => {
            const key = spec == null ? '' : String(spec).trim();
            if (AGENT_VIEW_PRESETS[key]) return { key, ...AGENT_VIEW_PRESETS[key] };
            const m = key.match(/^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i);
            if (m) return { key, w: Number(m[1]), h: Number(m[2]), dpr: 1, label: `自定义 · ${m[1]}×${m[2]}` };
            return { key: '1080p', ...AGENT_VIEW_PRESETS['1080p'] };
          };

          /* ── R-OWN-ID：**登录态复用** —— 找出侧栏窗口用的 storage identity，让自持窗口共享同一分区 ──
           * 官方公式（dsh-client-ui-sidebar-browser L1425）：`cwd:<workspace.path>`，无 workspace 时
           * `session:<sessionId>`。我们**不猜公式**：用 `acquire(候选).partition` 与**现有侧栏 webview 的
           * partition 逐字比对**来验证——分区相等 ⇒ 同一存储 ⇒ 共享登录态。候选路径从 DOM 扫（DSH UI
           * 会显示 workspace 路径），命中后缓存。全不命中才退回隔离默认值（并在状态里如实说明）。 */
          const AGENT_VIEW_IDENTITY_KEY = 'dsh-browser-kit:agent-view-identity:v1';
          const sidebarPartitions = () => {
            const out = [];
            try {
              // 精确识别侧栏 guest：官方 createElement 会给 `data-sidebar-browser-frame="webview"`；
              // 退化时用「非自持标记」兜底。**不能只看"没有我们的标记"**——旧版遗留元素会误判（实测）。
              const marked = Array.from(document.querySelectorAll('webview[data-sidebar-browser-frame="webview"]'));
              const list = marked.length ? marked : Array.from(document.querySelectorAll('webview'));
              for (const el of list) {
                if (el.hasAttribute && el.hasAttribute('data-dsh-kit-agent-view')) continue;
                if (agentView.panel && agentView.panel.contains(el)) continue;
                const p = el.getAttribute && el.getAttribute('partition');
                if (p && out.indexOf(String(p)) < 0) out.push(String(p));
              }
            } catch { /* 忽略 */ }
            return out;
          };
          const domPathCandidates = () => {
            const out = [];
            try {
              const re = /[A-Za-z]:\\[^\s"'<>|]{2,140}/g;
              const push = (s) => {
                if (!s) return;
                const m = String(s).match(re);
                if (!m) return;
                for (const x of m) { const t = x.replace(/[\\/.,;:]+$/, ''); if (out.indexOf(t) < 0 && out.length < 8) out.push(t); }
              };
              push(document.title);
              for (const el of Array.from(document.querySelectorAll('[title],[aria-label],[data-workspace-path]')).slice(0, 500)) {
                push(el.getAttribute && el.getAttribute('title'));
                push(el.getAttribute && el.getAttribute('aria-label'));
                push(el.getAttribute && el.getAttribute('data-workspace-path'));
              }
              push(document.body && document.body.innerText ? document.body.innerText.slice(0, 4000) : '');
            } catch { /* 忽略 */ }
            return out;
          };
          /** 探测可用 identity（命中即刻释放试探租约）。返回 { identity, from, partition?, tried? }。
           * @param sessionId 调用会话 id（无 workspace 时官方身份是 `session:<id>`）
           * @param workspacePath 调用会话的 workspace 路径（来自 exec.agent.session.header.cwd；
           *   官方身份是 `cwd:<path>`——**这是登录态复用的关键输入**，别只靠 DOM 扫路径） */
          const discoverStorageIdentity = async (sessionId, workspacePath) => {
            const b = agentViewCarrier();
            if (!b || typeof b.acquire !== 'function') return { identity: null, reason: 'no-carrier' };
            const targets = sidebarPartitions();
            try {
              const cached = JSON.parse(localStorage.getItem(AGENT_VIEW_IDENTITY_KEY) || 'null');
              if (cached && cached.identity) {
                if (!targets.length || (Array.isArray(cached.partitions) && cached.partitions.some((p) => targets.indexOf(p) >= 0))) {
                  return { identity: cached.identity, from: 'cache', partition: cached.partition || null };
                }
              }
            } catch { /* 忽略 */ }
            if (!targets.length) return { identity: null, reason: 'no-sidebar-window' };
            const cands = [];
            if (sessionId) cands.push(`session:${sessionId}`);
            if (workspacePath) cands.push(`cwd:${workspacePath}`);
            for (const p of domPathCandidates()) cands.push(`cwd:${p}`);
            const tried = [];
            for (const id of cands) {
              if (tried.some((t) => t.id === id)) continue;
              try {
                const r = await b.acquire(id);
                const part = String(r.partition);
                try { await b.release(r.lease); } catch { /* 忽略 */ }
                tried.push({ id, partition: part });
                if (targets.indexOf(part) >= 0) {
                  try { localStorage.setItem(AGENT_VIEW_IDENTITY_KEY, JSON.stringify({ identity: id, partition: part, partitions: [part], at: new Date().toISOString() })); } catch { /* 忽略 */ }
                  return { identity: id, from: 'probe', partition: part, tried };
                }
              } catch (e) { tried.push({ id, error: msgOf(e).slice(0, 90) }); }
            }
            return { identity: null, reason: 'no-match', tried, targets };
          };

          /* ── R-OWN 主题适配（2026-10-10 用户要求）──
           * 面板自身的配色走主题 CSS 变量（`T.*`，天然跟随明暗主题）；但**原生 `<select>` 的弹出列表**
           * 不吃页面的 CSS 变量——它按 `color-scheme` 渲染，深色主题下会变成「白底白字」（实测截图）。
           * 故：按面板**实际解析出来的背景色**判断明暗 → 给面板与所有控件设 `color-scheme`，
           * 并给每个 `<option>` 显式上色；主题一变（每秒自检）立刻重刷。 */
          const colorLuminance = (color) => {
            const m = String(color || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i);
            if (!m) return null;
            const a = m[4] === undefined ? 1 : Number(m[4]);
            if (a < 0.5) return null; // 透明/半透明：不算数，继续找父级
            const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
            return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          };
          /** 从面板往上找第一个不透明背景，判断当前 DSH 是深色还是浅色。 */
          const detectUiDark = () => {
            let node = agentView.panel;
            for (let i = 0; i < 6 && node; i += 1, node = node.parentElement) {
              try {
                const lum = colorLuminance(getComputedStyle(node).backgroundColor);
                if (lum !== null) return lum < 0.5;
              } catch { /* 忽略 */ }
            }
            return true; // 兜底：DSH 桌面默认深色
          };
          const agentViewThemeKey = { key: null };
          /** 应用主题到面板与其原生控件（force=true 忽略缓存）。 */
          const agentViewApplyTheme = (force) => {
            const panel = agentView.panel;
            if (!panel) return null;
            let fg = null;
            try { fg = getComputedStyle(panel).color || null; } catch { fg = null; }
            const dark = detectUiDark();
            const key = `${dark}|${fg || ''}`;
            if (!force && agentViewThemeKey.key === key) return { dark, changed: false };
            agentViewThemeKey.key = key;
            try {
              panel.style.colorScheme = dark ? 'dark' : 'light';
              // 浮层上下文里主题令牌可能解析成 transparent（实测面板背景 rgba(0,0,0,0)）⇒ 用显式兜底色，
              // 保证无论令牌是否可用，顶栏在两种主题下都清晰可读
              let panelBg = null;
              try { panelBg = colorLuminance(getComputedStyle(panel).backgroundColor); } catch { panelBg = null; }
              if (panelBg === null) panel.style.background = dark ? 'rgba(30, 32, 38, 0.98)' : 'rgba(250, 250, 252, 0.98)';
              const optBg = dark ? '#22262e' : '#ffffff';
              const optFg = dark ? '#e7e9ee' : '#16181d';
              const ctrlBg = dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
              for (const el of Array.from(panel.querySelectorAll('select'))) {
                el.style.colorScheme = dark ? 'dark' : 'light';
                el.style.background = ctrlBg;
                el.style.color = optFg;
                for (const opt of Array.from(el.options)) {
                  opt.style.background = optBg;
                  opt.style.color = optFg;
                }
              }
              for (const el of Array.from(panel.querySelectorAll('input'))) {
                el.style.colorScheme = dark ? 'dark' : 'light';
                el.style.background = ctrlBg;
                el.style.color = optFg;
              }
            } catch { /* 忽略 */ }
            agentView.theme = { dark, at: new Date().toISOString() };
            return { dark, changed: true };
          };

          /** 临时状态提示（6s 后自动清空）——**不再用来显示网址**（用户要求：地址栏已有网址，
           *  标签旁边那串网址去掉）。 */
          const AGENT_STATUS_MS = 6000;
          const agentStatus = (msg) => {
            try {
              const el = agentView.urlText;
              if (!el) return;
              el.textContent = msg || '';
              if (agentView.statusTimer) clearTimeout(agentView.statusTimer);
              if (msg) agentView.statusTimer = setTimeout(() => { try { el.textContent = ''; } catch { /* 忽略 */ } }, AGENT_STATUS_MS);
            } catch { /* 忽略 */ }
          };

          const ensureAgentView = async (opts = {}) => {
            const b0 = agentViewCarrier();
            if (!b0 || typeof b0.acquire !== 'function') {
              throw new Error('dshDesktop.browser 不可用（非桌面端或协议版本不符）——自持视图无法创建');
            }
            // 身份优先级：显式 storageIdentity > 探测（登录态复用）> 隔离默认值
            let identity = opts && opts.storageIdentity ? String(opts.storageIdentity) : null;
            let identityFrom = identity ? 'explicit' : null;
            let identityDiag = null;
            if (!identity) {
              identityDiag = await discoverStorageIdentity(
                opts && opts.sessionId ? String(opts.sessionId) : null,
                opts && opts.workspacePath ? String(opts.workspacePath) : null,
              );
              if (identityDiag && identityDiag.identity) { identity = identityDiag.identity; identityFrom = identityDiag.from; }
            }
            if (!identity) { identity = 'dsh-browser-kit:agent-view'; identityFrom = 'isolated-default'; }
            // 已在场：**只有身份一致才复用**；身份变了（如从隔离切到共享登录态）→ 重建
            const existing = !!(agentView.panel && document.contains(agentView.panel));
            if (existing && opts.recreate !== true && agentView.identity === identity) {
              if (!(agentView.tabs || []).length) await newAgentTab({}); // 面板在但窗口被关光 ⇒ 补一个
              if (opts.resolution) agentView.ui = { ...(agentView.ui || {}), preset: String(opts.resolution) };
              if (opts.dpr != null) agentView.ui = { ...(agentView.ui || {}), dpr: Number(opts.dpr) };
              if (opts.state) agentView.ui = { ...(agentView.ui || {}), state: String(opts.state) };
              if (opts.fit != null) agentView.ui = { ...(agentView.ui || {}), fit: opts.fit === true };
              if (opts.zoom != null) agentView.ui = { ...(agentView.ui || {}), zoom: Math.min(5, Math.max(0.25, Number(opts.zoom) || 1)) };
              if (opts.idleReleaseMs != null) agentView.idleReleaseMs = Math.max(0, Number(opts.idleReleaseMs));
              applyAgentViewLayout();
              return agentView;
            }
            if (existing) releaseAgentView(); // 身份变化/显式重建：先释放旧租约与面板
            agentView.identity = identity;
            agentView.identityFrom = identityFrom;
            agentView.identityDiag = identityDiag;
            agentView.tabs = [];
            agentView.activeId = null;
            agentView.tabSeq = agentView.tabSeq || 0;
            const b = b0;
            // 旧面板/旧租约先清（recreate 场景）——多窗口：releaseAgentView 会释放所有窗口租约
            if (agentView.panel) releaseAgentView();
            agentView.acquiredAt = new Date().toISOString();
            agentView.identity = identity;
            agentView.identityFrom = identityFrom;
            agentView.identityDiag = identityDiag;
            try { localStorage.setItem(AGENT_VIEW_LEASE_KEY, JSON.stringify({ identity, at: agentView.acquiredAt })); } catch { /* 忽略 */ }

            const panel = document.createElement('div');
            panel.id = AGENT_VIEW_ID;
            // ★属性名必须与收养/清理的选择器**逐字一致**：`dataset.kitAgentViewPanel` 生成的是
            //   `data-kit-agent-view-panel`（无 dsh-），而选择器写的是 `data-dsh-kit-…` ⇒ 永远匹配不上，
            //   孤儿面板会一直堆积（实测踩坑）。统一用显式 setAttribute 的 `data-dsh-kit-*`。
            panel.setAttribute('data-dsh-kit-agent-view-panel', '');
            panel.setAttribute('data-dsh-kit-ui', ''); // 我们自己的 UI：snapshot 会跳过
            panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;'
              + 'overflow:hidden;border-radius:10px;box-sizing:border-box;'
              // 边框默认**中性色**（不显示青色）：只在 Agent 操作中才变青色（touchAgentView）——用户可协作使用
              + `background:${T.bg};color:${T.text};border:2px solid ${T.border};box-shadow:${T.shadow};`;
            // 顶部条（收起态=小窗；展开态才显示全部控件）
            const head = document.createElement('div');
            head.style.cssText = `flex:none;display:flex;align-items:center;gap:6px;padding:3px 8px;font:${T.font};`
              + 'border-bottom:1px solid ' + T.border + ';';
            const title = document.createElement('span');
            title.textContent = '🤖 Agent 浏览器';
            title.title = '点击展开 / 收起';
            title.style.cssText = 'flex:none;white-space:nowrap;cursor:pointer;';
            title.addEventListener('click', () => {
              agentView.ui = { ...(agentView.ui || {}), state: (agentView.ui && agentView.ui.state === 'expanded') ? 'collapsed' : 'expanded' };
              applyAgentViewLayout();
            });
            const urlText = document.createElement('span');
            urlText.setAttribute('data-dsh-kit-agent-view-url', '');
            urlText.textContent = ''; // 只作临时状态提示；网址由地址栏显示（用户要求）
            // 收窄：给右侧按钮组留位（auto 会把标签条挤到最右，DSH 同款是标签紧邻标题）
            urlText.style.cssText = 'flex:0 1 auto;max-width:230px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.8;';
            const mkBtn = (labelText, tip, onClick) => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.textContent = labelText;
              btn.title = tip;
              // 统一的「方框图标按钮」：固定尺寸 + flex 居中（截图/批注/最小化/关闭共用）
              btn.style.cssText = 'flex:none;display:inline-flex;align-items:center;justify-content:center;'
                + 'width:26px;height:22px;box-sizing:border-box;padding:0;line-height:1;'
                + 'cursor:pointer;border:1px solid ' + T.border + ';background:transparent;color:'
                + T.text + ';border-radius:6px;font:' + T.font + ';';
              btn.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch { /* 忽略 */ } onClick(); });
              return btn;
            };
            const mkSelect = (values, title) => {
              const sel = document.createElement('select');
              sel.title = title;
              sel.style.cssText = 'flex:none;border:1px solid ' + T.border + ';background:transparent;color:' + T.text
                + ';border-radius:6px;padding:1px 4px;font:' + T.font + ';';
              for (const v of values) {
                const opt = document.createElement('option');
                opt.value = v.value;
                opt.textContent = v.label;
                sel.appendChild(opt);
              }
              return sel;
            };
            // ①分辨率选择框（Chrome DevTools 同款预设 + 自定义）
            const presetSel = mkSelect(
              Object.keys(AGENT_VIEW_PRESETS).map((k) => ({ value: k, label: AGENT_VIEW_PRESETS[k].label })),
              '分辨率预设（默认 1920×1080；装不下可滚动）',
            );
            presetSel.setAttribute('data-dsh-kit-agent-view-preset', '');
            presetSel.addEventListener('change', () => {
              agentView.ui = { ...(agentView.ui || {}), preset: presetSel.value };
              applyAgentViewLayout();
            });
            // ②缩放选择框（紧随尺寸选择框；等同 Chrome 页面缩放 setZoomFactor）
            const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
            const zoomSel = mkSelect(
              ZOOM_STEPS.map((z) => ({ value: String(z), label: `${Math.round(z * 100)}%` })).concat([{ value: 'custom', label: '自定义…' }]),
              '缩放（等同 Chrome 页面缩放）',
            );
            zoomSel.setAttribute('data-dsh-kit-agent-view-zoom', '');
            const zoomInput = document.createElement('input');
            zoomInput.type = 'number';
            zoomInput.setAttribute('data-dsh-kit-agent-view-zoom-input', '');
            zoomInput.min = '25';
            zoomInput.max = '500';
            zoomInput.step = '5';
            zoomInput.title = '自定义缩放百分比（25–500）';
            zoomInput.style.cssText = 'flex:none;display:none;width:56px;border:1px solid ' + T.border + ';background:transparent;color:'
              + T.text + ';border-radius:6px;padding:1px 4px;font:' + T.font + ';';
            const applyZoom = (z) => {
              const v = Math.min(5, Math.max(0.25, Number(z) || 1));
              agentView.ui = { ...(agentView.ui || {}), zoom: v };
              applyAgentViewLayout();
            };
            zoomSel.addEventListener('change', () => {
              if (zoomSel.value === 'custom') { zoomInput.style.display = ''; zoomInput.focus(); return; }
              zoomInput.style.display = 'none';
              applyZoom(zoomSel.value);
            });
            const commitZoomInput = () => {
              const pct = Number(zoomInput.value);
              if (!Number.isFinite(pct) || pct <= 0) return;
              applyZoom(pct / 100);
              if (agentView.ui && agentView.ui.zoom) zoomInput.value = String(Math.round(agentView.ui.zoom * 100));
            };
            zoomInput.addEventListener('change', commitZoomInput);
            zoomInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commitZoomInput(); } });
            // ③截图（**同款图标**，与侧栏工具条一致）——落盘 + **直接输入到输入框**（用户 2026-10-10 要求）
            const shootBtn = mkBtn('', '截图当前窗口并直接插入输入框（同时落盘供 Agent 分析）', async () => {
              try {
                const r = await captureShot({ target: 'agent', insertToComposer: true });
                const cp = r && r.composer;
                agentStatus(r && r.ok
                  ? (cp && cp.verified ? '已插入输入框（图片附件）+ 落盘' : '已提交插入（请确认输入框）')
                  : `截图失败：${(r && (r.error || (cp && cp.error))) || '未知'}`);
              } catch (e) { agentStatus(`截图失败：${msgOf(e)}`); }
            });
            shootBtn.innerHTML = SHOT_ICON_SVG;
            // ④批注（R-OWN v8）：把**当前自持窗口**加入共享批注成员表——与会话浏览器**共用同一批注**
            //   图标与 DSH 浏览器的批注图标一致（同一枚 ANNOT_ICON_SVG）
            const annotBtn = mkBtn('', '批注总开关（当前窗口/全部窗口同步，与会话浏览器共用同一批注）', async () => {
              try {
                const el2 = agentViewWebview();
                if (!el2) { agentStatus('无活动窗口'); return; }
                const r = await togglePaneAnnot(el2);
                const on = !!(stateRef.annot && stateRef.annot.active);
                applyAnnotBtnState(stateRef);
              try { syncToolbarIconColor(); } catch { /* 忽略 */ } // 主题切换后图标颜色跟上
                agentStatus(r && r.ok
                  ? (on ? `批注已开启（${(stateRef.annot.panes || []).length} 个窗口参与）` : '批注已关闭（所有窗口同步停止）')
                  : `批注失败：${(r && r.error) || '未知'}`);
              } catch (e) { agentStatus(`批注失败：${msgOf(e)}`); }
            });
            annotBtn.innerHTML = ANNOT_ICON_SVG; // 与 DSH 批注图标同款
            annotBtn.setAttribute('data-dsh-kit-agent-view-annot', '');
            // ⑤最小化（"-"，在 ✕ 左侧；收起态显示为 ▣ 用于展开）
            const minBtn = mkBtn('▣', '最小化为右下角小窗 / 展开', () => {
              agentView.ui = { ...(agentView.ui || {}), state: (agentView.ui && agentView.ui.state === 'expanded') ? 'collapsed' : 'expanded' };
              applyAgentViewLayout();
            });
            minBtn.setAttribute('data-dsh-kit-agent-view-min', '');
            minBtn.style.marginLeft = 'auto'; // 右侧按钮组钉在行尾（DSH 同款右对齐）
            const closeBtn = mkBtn('✕', '关闭面板（释放全部窗口租约）', () => releaseAgentView());
            // ── 行 1：标题 + 标签条（多窗口）+ 最小化/关闭（**布局参考 DSH 浏览器**）──
            const railIcons = [presetSel, zoomSel, zoomInput, shootBtn, annotBtn];
            // R-OWN v16：**小窗状态也要能看到/点到图标**（用户要求"图标保持可见"）——
            //  所以截图/批注两个图标改为**两种形态都显示**；分辨率/缩放这类占宽控件仍只在展开态。
            for (const el of railIcons) markExpandedOnly(el);
            for (const el of [shootBtn, annotBtn]) {
              el.removeAttribute('data-dsh-kit-agent-view-expanded-only'); // v16：小窗里也保留（不再加无消费者的 always 标记）
            }
            head.appendChild(title);
            markExpandedOnly(urlText); // 小窗（260px）里让位给图标：状态文本只在展开态显示
            head.appendChild(urlText);
            const tabStrip = head; // 标签 chip 直接落在这行里（DSH 同款：标签在上，地址栏在下）
            head.appendChild(minBtn);
            head.appendChild(closeBtn);
            // R-OWN v16：截图/批注图标放进**常显的标题行**（小窗状态下也能看到并点击；
            //  放在 addrRow 里会随整行一起被隐藏——实测踩过）
            head.insertBefore(annotBtn, minBtn);
            head.insertBefore(shootBtn, annotBtn);
            // ── 行 2：← → ↻ + **加宽地址栏** + 尺寸/缩放/截图/批注图标（DSH 同款排布）──
            const addrRow = document.createElement('div');
            addrRow.style.cssText = `flex:none;display:flex;align-items:center;gap:6px;padding:3px 8px;font:${T.font};`
              + 'border-bottom:1px solid ' + T.border + ';';
            markExpandedOnly(addrRow); // ★必须在 cssText 之后：否则存到的是 block（见 markExpandedOnly 注释）
            const mkNav = (labelText, tip, onClick) => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.textContent = labelText;
              btn.title = tip;
              // 与截图/批注同款**方框**：固定 26×22 + flex 居中（图标/字形都居中）
              btn.style.cssText = 'flex:none;display:inline-flex;align-items:center;justify-content:center;'
                + 'width:26px;height:22px;box-sizing:border-box;padding:0;line-height:1;font-size:14px;'
                + 'cursor:pointer;border:1px solid ' + T.border + ';background:transparent;color:'
                + T.text + ';border-radius:6px;font-family:inherit;';
              btn.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch { /* 忽略 */ } onClick(); });
              return btn;
            };
            const navBack = mkNav('‹', '后退', () => { try { const w = agentViewWebview(); if (w && w.canGoBack && w.canGoBack()) w.goBack(); } catch { /* 忽略 */ } });
            const navFwd = mkNav('›', '前进', () => { try { const w = agentViewWebview(); if (w && w.canGoForward && w.canGoForward()) w.goForward(); } catch { /* 忽略 */ } });
            const navReload = mkNav('↻', '刷新', () => { try { const w = agentViewWebview(); if (w && w.reload) w.reload(); } catch { /* 忽略 */ } });
            navBack.setAttribute('data-dsh-kit-agent-nav', 'back');
            navFwd.setAttribute('data-dsh-kit-agent-nav', 'forward');
            navReload.setAttribute('data-dsh-kit-agent-nav', 'reload');
            const addr = document.createElement('input');
            addr.type = 'text';
            addr.setAttribute('data-dsh-kit-agent-address', '');
            addr.placeholder = '输入网址后回车（当前窗口）';
            // 加宽：唯一弹性项，占满整行剩余空间
            addr.style.cssText = 'flex:1 1 auto;min-width:120px;border:1px solid ' + T.border + ';background:transparent;color:'
              + T.text + ';border-radius:6px;padding:2px 8px;font:' + T.font + ';';
            const goAddr = async () => {
              const url = String(addr.value || '').trim();
              if (!url) return;
              const withScheme = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
              try { await navigateAgentView(withScheme, {}); addr.value = withScheme; }
              catch (e) { addr.value = `导航失败：${msgOf(e)}`; }
            };
            addr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); goAddr(); } });
            addrRow.appendChild(navBack);
            addrRow.appendChild(navFwd);
            addrRow.appendChild(navReload);
            addrRow.appendChild(addr);
            addrRow.appendChild(presetSel);
            addrRow.appendChild(zoomSel);
            addrRow.appendChild(zoomInput);
            // 舞台：裁切容器；webview 自身保持目标分辨率尺寸，靠 transform 缩放显示
            const stage = document.createElement('div');
            stage.setAttribute('data-dsh-kit-agent-view-stage', '');
            stage.style.cssText = 'flex:none;overflow:hidden;position:relative;margin:0 auto;';
            panel.appendChild(head);
            panel.appendChild(addrRow);
            panel.appendChild(addrRow);
            panel.appendChild(stage);
            document.body.appendChild(panel);
            agentView.panel = panel;
            agentView.stage = stage;
            agentView.tabStrip = tabStrip;
            agentView.addr = addr;
            agentView.addrRow = addrRow;
            agentView.urlText = urlText;
            agentView.ui = {
              state: (opts && opts.state === 'expanded') ? 'expanded' : 'collapsed',
              preset: (opts && opts.resolution) ? String(opts.resolution) : '1080p',
              dpr: opts && opts.dpr != null ? Number(opts.dpr) : null,
              fit: opts && opts.fit === true, // 默认 false = 100% 显示不缩放
              zoom: opts && opts.zoom != null ? Math.min(5, Math.max(0.25, Number(opts.zoom) || 1)) : 1, // 页面缩放，默认 100%
            };
            // 空闲释放：默认 10 分钟（0 = 不自动释放）；Agent 操作中会不断续期（touchAgentView）
            agentView.idleReleaseMs = opts && opts.idleReleaseMs != null ? Math.max(0, Number(opts.idleReleaseMs)) : 10 * 60 * 1000;
            agentView.lastOpAt = Date.now();
            startAgentViewIdleTick();
            try {
              if (typeof ResizeObserver === 'function') {
                const ro = new ResizeObserver(() => { try { applyAgentViewLayout(); } catch { /* 忽略 */ } });
                ro.observe(panel);
                agentView.resizeObserver = ro;
              }
            } catch { /* 忽略 */ }
            // 首个窗口（每个窗口各自持租约；同一 identity ⇒ 共享登录态）
            const firstTab = await newAgentTab({ url: (opts && opts.url) || null });
            agentView.sharedWithSidebar = sidebarPartitions().indexOf(String(firstTab.partition)) >= 0;
            applyAgentViewLayout();
            return agentView;
          };

          /** 应用布局：guest 视口 = 目标分辨率；**默认 100% 显示、不缩放**（用户 2026-10-10 要求），
           * 超出窗口的部分由 stage 滚动查看；只有显式 fit:true 才缩放到可用空间。
           * 边框：空闲=中性色（不显示青色、不暗示 Agent 在操作），Agent 操作中=青色（见 touchAgentView）。 */
          const applyAgentViewLayout = () => {
            const panel = agentView.panel;
            const frame = agentView.el;
            if (!panel || !frame) return null;
            const ui = agentView.ui = agentView.ui || { state: 'collapsed', preset: '1080p', dpr: null, fit: false, zoom: 1 };
            const res = agentViewResolvePreset(ui.preset);
            const dpr = Number(ui.dpr || res.dpr || 1) || 1;
            const zoom = Math.min(5, Math.max(0.25, Number(ui.zoom || 1) || 1)); // 页面缩放（Chrome 语义）
            frame.style.width = `${res.w}px`;
            frame.style.height = `${res.h}px`;
            // 设备像素比与页面缩放共用 setZoomFactor ⇒ 取两者乘积（inputZoom 读到的就是它，坐标换算自洽）
            try { if (typeof frame.setZoomFactor === 'function') frame.setZoomFactor(zoom * dpr); } catch { /* 忽略 */ }
            try { frame.dataset.kitZoomFactor = String(zoom * dpr); } catch { /* 忽略 */ } // v13：批注面板反缩放用（勿读 getZoomFactor）
            const expanded = ui.state === 'expanded';
            const barH = expanded ? 60 : 32; // 展开态两行：标签行 + 地址/工具栏行（DSH 同款布局）
            const fit = ui.fit === true;
            /* 展开态**必须让开 DSH 自己的标题栏**（右上角那三个窗口按钮），否则最大化时会盖住它们
             * （用户实测反馈）。故展开时从 topOffset 起算，并把面板抬到最顶层 z-index。 */
            const topOffset = 46;
            const maxW = Math.max(320, Math.floor(window.innerWidth) - 24);
            const maxH = Math.max(240, Math.floor(window.innerHeight) - topOffset - 12);
            const k = (expanded && fit) ? Math.min(1, maxW / res.w, maxH / res.h) : 1;
            const panelW = Math.min(Math.round(res.w * k) + 16, maxW);
            const panelH = Math.min(Math.round(res.h * k) + barH + 10, maxH);
            const stageW = expanded ? panelW - 16 : 0;
            const stageH = expanded ? panelH - barH - 10 : 0;
            if (agentView.stage) {
              agentView.stage.style.width = `${stageW}px`;
              agentView.stage.style.height = `${stageH}px`;
              agentView.stage.style.overflow = 'auto'; // 100% 显示时装不下就滚动看
            }
            frame.style.transform = `scale(${expanded ? k : 0.0001})`;
            panel.style.width = expanded ? `${panelW}px` : '260px';
            panel.style.height = expanded ? `${panelH}px` : `${barH + 12}px`;
            // R-OWN v17：小窗停靠在**侧栏浏览器板块的右下角**（不是整个窗口右下角）——
            //   guest 内的批注面板只能在板块范围内，这样它正好落在小窗**正上方**（用户指定布局）。
            panel.style.top = expanded ? `${topOffset}px` : 'auto';
            let dockBottom = 16;
            try {
              if (!expanded) {
                const paneEl = ((stateRef.annot && stateRef.annot.panes) || []).find((p) => paneOwnerLabel(p).kind === 'session')
                  || scopedWebviews(currentSurfaceSession()).find(captureVisible) || null;
                if (paneEl) {
                  // ★参考**容器**（板块可视区）的底边，而不是 webview 元素本身——设备尺寸下元素只有
                  //   res.h×k 那么高，用元素会把它钉到"缩放后页面的底边"（用户实测：跑到上面去了）。
                  const hostEl = paneEl.parentElement || paneEl;
                  const hr2 = hostEl.getBoundingClientRect();
                  if (hr2.height > 80 && hr2.bottom > 40) dockBottom = Math.max(12, Math.round(window.innerHeight - hr2.bottom + 12));
                }
              }
            } catch { dockBottom = 16; }
            panel.style.bottom = expanded ? 'auto' : `${dockBottom}px`;
            panel.style.right = expanded ? '12px' : '16px';
            panel.style.left = 'auto';
            panel.style.zIndex = '2147483647'; // 置顶
            panel.dataset.kitAgentViewState = ui.state;
            // 控件可见性/文案随形态切换（用属性选择器，收养后也有效；display 用**记住的原值**恢复）
            for (const el of Array.from(panel.querySelectorAll('[data-dsh-kit-agent-view-expanded-only]'))) {
              if (el.hasAttribute('data-dsh-kit-agent-view-zoom-input')) continue; // 自定义缩放输入框单独管理
              const want = expanded ? (el.getAttribute('data-kit-own-display') || '') : 'none';
              if (el.style.display !== want) el.style.display = want;
            }
            const minBtn = panel.querySelector('[data-dsh-kit-agent-view-min]');
            if (minBtn) minBtn.textContent = expanded ? '−' : '▣';
            // 结构性保障：地址/工具行**必须 flex**（不依赖记忆值——旧实例/收养面板可能已丢值）
            if (agentView.addrRow) {
              const wantRow = expanded ? 'flex' : 'none';
              if (agentView.addrRow.style.display !== wantRow) agentView.addrRow.style.display = wantRow;
            }
            const zsel = panel.querySelector('[data-dsh-kit-agent-view-zoom]');
            if (zsel) {
              const zs = String(zoom);
              const known = Array.from(zsel.options).some((o) => o.value === zs);
              zsel.value = known ? zs : 'custom';
            }
            const zin = panel.querySelector('[data-dsh-kit-agent-view-zoom-input]');
            if (zin) {
              zin.value = String(Math.round(zoom * 100));
              // 只有「自定义…」才露出来（否则展开态也会一直显示一个数字框）
              const wantZ = (expanded && zsel && zsel.value === 'custom') ? '' : 'none';
              if (zin.style.display !== wantZ) zin.style.display = wantZ;
            }
            const sel = panel.querySelector('[data-dsh-kit-agent-view-preset]');
            if (sel && sel.value !== ui.preset && AGENT_VIEW_PRESETS[ui.preset]) sel.value = ui.preset;
            // 把面板级 state 与窗口级 ui 回写：窗口记录持有自己的预设/缩放/适配（多窗口互不影响）
            const act = activeAgentTab();
            if (act) act.ui = { preset: ui.preset, dpr: ui.dpr, fit, zoom };
            // 地址栏随活动窗口刷新（**不再把网址写到标题旁**——用户要求）
            try { renderAgentAddress(); } catch { /* 忽略 */ }
            // 主题适配（面板 + 原生控件；主题变了也在这里立刻跟上）
            let theme = null;
            try { theme = agentViewApplyTheme(); } catch { theme = null; }
            // R-OWN v12/v13/v16：把"舞台可见带 + 放大倍数"告知批注器（面板固定尺寸且不被裁）；
            //  同时**给侧栏成员面板也重推一次**（调整分辨率/展开收起后，抬升量要跟着小窗走，
            //  否则批注面板会"跑掉"——用户实测反馈）
            try {
              syncAnnotMetrics(agentViewWebview());
              for (const p of (stateRef.annot && stateRef.annot.panes) || []) {
                if (paneOwnerLabel(p).kind === 'session') syncAnnotMetrics(p);
              }
            } catch { /* 忽略 */ }
            return {
              state: ui.state, preset: ui.preset, resolution: `${res.w}×${res.h}`, dpr, fit, zoom,
              scale: Number(k.toFixed(3)), stageW, stageH, topOffset, theme: theme ? theme.dark : null,
              activeTabId: agentView.activeId || null, tabCount: (agentView.tabs || []).length,
            };
          };

          /* ── R-OWN 空闲/协作（2026-10-10 用户要求）──
           * 「没有操作自持浏览器时，应该释放，让用户操作」+「边框不显示青色边框，可以用户协作」：
           *  · 空闲（距上次 Agent 操作 > AGENT_VIEW_IDLE_MS）⇒ 边框回到中性色，窗口完全交给用户操作；
           *  · Agent 每次操作（inputTargetOf 命中自持窗口）⇒ touchAgentView() 亮青色边框并续期；
           *  · 空闲超过 idleReleaseMs（默认 10 分钟，可设 0 关闭）⇒ **自动释放租约并关闭窗口**，
           *    把浏览器还给用户（分区共享意味着登录态不丢，重新 open 即回）。 */
          const AGENT_VIEW_IDLE_MS = 4000;
          const agentViewSetBorder = (active) => {
            try {
              if (!agentView.panel) return;
              const want = active ? '2px solid #38bdf8' : `2px solid ${T.border}`;
              if (agentView.panel.style.border !== want) agentView.panel.style.border = want;
            } catch { /* 忽略 */ }
          };
          const touchAgentView = () => {
            if (!agentViewWebview()) return;
            agentView.lastOpAt = Date.now();
            agentViewSetBorder(true);
          };
          const agentViewIdleTick = () => {
            if (!isLiveInstance(stateRef.clientBootAt)) return; // 实例围栏（旧实例停止一切 DOM 操作）
            /* ★R-OWN v23（实测 bug）：批注面板的宿主镜像**不能**放在自持窗口的门之后。
             * `if (!agentViewWebview()) return;` 会在**没开自持窗口**时让整个 tick 直接返回 ⇒
             * `syncAnnotMirror()` 永不执行；而页内面板又被 `mirror:true` 隐藏 ⇒ 两头都空
             * = 用户点开批注**看不到任何面板**（2026-10-10 实测：ownedBar=false / mirrorNode=false）。
             * 所以：批注相关（镜像节点 + 指标）先于该门执行，与自持窗口是否存在无关。 */
            try { applyAnnotBtnState(stateRef); } catch { /* 忽略 */ } // 批注图标 = 会话级总开关（属性驱动）
            try {
              if (stateRef.annot && stateRef.annot.active) {
                syncAnnotMirror().catch(() => {}); // ①宿主镜像面板（不依赖自持窗口）
                for (const p of (stateRef.annot.panes || [])) {
                  if (paneOwnerLabel(p).kind === 'session') syncAnnotMetrics(p); // ②可见带/缩放（提示条用）
                }
              } else {
                removeAnnotMirror();
              }
            } catch { /* 忽略 */ }
            // ── 以下需要自持窗口存在 ──
            if (!agentViewWebview()) return;
            try { agentViewApplyTheme(); } catch { /* 主题自检失败不影响空闲逻辑 */ } // 主题切换后 1s 内跟上
            // v22：批注开关状态变化 → 重排停靠位置 + 重推指标（指标值可能因布局变化而变，缓存会自行判定是否发出）
            try {
              const on = !!(stateRef.annot && stateRef.annot.active);
              if (agentView.lastAnnotOn !== on) {
                agentView.lastAnnotOn = on;
                applyAgentViewLayout();
                const targets = new Set();
                for (const p of (stateRef.annot && stateRef.annot.panes) || []) targets.add(p);
                targets.add(agentViewWebview());
                for (const w of Array.from(document.querySelectorAll('webview'))) {
                  if (!targets.has(w)) continue;
                  syncAnnotMetrics(w);
                }
              }
            } catch { /* 忽略 */ }
            const idle = Date.now() - (agentView.lastOpAt || 0);
            if (idle > AGENT_VIEW_IDLE_MS) agentViewSetBorder(false); // 空闲：撤掉青色边框
            const limit = Number(agentView.idleReleaseMs || 0);
            if (limit > 0 && idle > limit) {
              agentView.releasedForIdle = new Date().toISOString();
              releaseAgentView(); // 空闲释放：窗口还给用户
            }
          };
          const startAgentViewIdleTick = () => {
            if (agentView.idleTimer) return;
            agentView.idleTimer = trackInterval(setInterval(agentViewIdleTick, 1000));
          };
          /** 标记「仅展开态可见」的控件，并**记住它的原始 display**。
           *  ★踩坑（实测）：先前用 `el.style.display = ''` 来恢复，会**清掉 cssText 里设的 display:flex**
           *  ⇒ 地址栏容器退回 `block`，其内部 `flex:1 1 auto` 失效、地址栏缩成 163px。 */
          const markExpandedOnly = (el) => {
            try {
              el.setAttribute('data-dsh-kit-agent-view-expanded-only', '');
              let d = el.style && el.style.display ? el.style.display : '';
              if (!d) { try { d = getComputedStyle(el).display || ''; } catch { d = ''; } }
              if (d && d !== 'none') el.setAttribute('data-kit-own-display', d);
            } catch { /* 忽略 */ }
            return el;
          };

          /* ── R-OWN v8：自持浏览器**多窗口（标签）**（2026-10-10 用户要求）──
           * 面板级：panel/stage/tabStrip/addr/ui.state（展开收起）；窗口级：tabs[]（各持自己的租约与 webview）。
           * `agentView.el/lease/partition/ui` 始终**镜像当前活动窗口**，这样既有的截图/输入/布局代码无需改动。 */
          const activeAgentTab = () => (agentView.tabs || []).find((t) => t.id === agentView.activeId) || null;
          const agentTabShell = () => {
            const tabs = (agentView.tabs || []).filter((t) => t.el && document.contains(t.el));
            return tabs.length ? tabs[tabs.length - 1] : null;
          };
          /** 切到某个窗口：镜像字段 + 可见性 + 标签条/地址栏刷新。 */
          const setActiveAgentTab = (id) => {
            const tab = (agentView.tabs || []).find((t) => t.id === id) || null;
            if (!tab) return null;
            const keepState = (agentView.ui && agentView.ui.state) || 'collapsed';
            agentView.activeId = tab.id;
            agentView.el = tab.el;
            agentView.lease = tab.lease;
            agentView.partition = tab.partition;
            agentView.ui = { ...(tab.ui || {}), state: keepState };
            for (const t of agentView.tabs) {
              if (!t.el || !t.el.style) continue;
              const on = t.id === tab.id;
              t.el.style.visibility = on ? '' : 'hidden';
              t.el.style.pointerEvents = on ? '' : 'none';
              if (on) t.el.removeAttribute('data-dsh-kit-agent-view-inactive');
              else t.el.setAttribute('data-dsh-kit-agent-view-inactive', '');
            }
            renderAgentTabStrip();
            renderAgentAddress();
            applyAgentViewLayout();
            return tab;
          };
          /** 标签条：每个窗口一个 chip（标题 + ×），末尾「+」新建。 */
          const renderAgentTabStrip = () => {
            const strip = agentView.tabStrip;
            if (!strip) return;
            try {
              // 只清掉上一次渲染的标签/＋（不动标题、状态文本与右侧按钮）
              for (const old of Array.from(strip.querySelectorAll('[data-dsh-kit-agent-tab], [data-dsh-kit-agent-tabadd]'))) {
                try { old.remove(); } catch { /* 忽略 */ }
              }
              const anchor = strip.querySelector('[data-dsh-kit-agent-view-min]'); // chip 插在右侧按钮组之前
              const put = (el) => {
                markExpandedOnly(el);
                if (anchor && anchor.parentElement === strip) strip.insertBefore(el, anchor);
                else strip.appendChild(el);
              };
              for (const t of agentView.tabs || []) {
                const chip = document.createElement('span');
                chip.setAttribute('data-dsh-kit-agent-tab', '');
                chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;max-width:150px;padding:1px 4px;border-radius:6px;'
                  + 'cursor:pointer;white-space:nowrap;'
                  + (t.id === agentView.activeId ? 'background:rgba(56,189,248,.20);' : 'opacity:.75;');
                const label = document.createElement('span');
                const title2 = t.title || t.url || '新窗口';
                label.textContent = String(title2).replace(/^https?:\/\//, '').slice(0, 18);
                label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;max-width:118px;';
                label.addEventListener('click', () => setActiveAgentTab(t.id));
                const x = document.createElement('span');
                x.textContent = '×';
                x.title = '关闭此窗口（释放其租约）';
                x.style.cssText = 'cursor:pointer;opacity:.8;padding:0 2px;';
                x.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch { /* 忽略 */ } closeAgentTab(t.id); });
                chip.appendChild(label);
                chip.appendChild(x);
                put(chip);
              }
              const plus = document.createElement('span');
              plus.setAttribute('data-dsh-kit-agent-tabadd', '');
              plus.textContent = '＋';
              plus.title = '新建浏览器窗口（同登录态）';
              plus.style.cssText = 'cursor:pointer;padding:0 6px;opacity:.85;';
              plus.addEventListener('click', () => { newAgentTab().catch(() => {}); });
              put(plus);
            } catch { /* 忽略 */ }
          };
          /** 地址栏：显示/编辑当前窗口地址（回车即导航）。 */
          const renderAgentAddress = () => {
            const inp = agentView.addr;
            if (!inp || document.activeElement === inp) return;
            const t = activeAgentTab();
            let url = (t && t.url) || '';
            try { if (t && t.el && typeof t.el.getURL === 'function') url = t.el.getURL() || url; } catch { /* 忽略 */ }
            inp.value = url;
          };
          /** 新建一个自持窗口（各自 acquire 一份租约，同一 storage identity ⇒ 共享登录态）。 */
          const newAgentTab = async (opts = {}) => {
            if (!agentView.panel) throw new Error('自持面板未创建');
            const b = agentViewCarrier();
            if (!b || typeof b.acquire !== 'function') throw new Error('dshDesktop.browser 不可用');
            const identity = agentView.identity || 'dsh-browser-kit:agent-view';
            const reservation = await b.acquire(identity);
            if (!reservation || typeof reservation.lease !== 'string' || typeof reservation.partition !== 'string') {
              throw new Error(`acquire 返回形状异常：${JSON.stringify(reservation).slice(0, 120)}`);
            }
            agentView.tabSeq = (agentView.tabSeq || 0) + 1;
            const tab = {
              id: `tab${agentView.tabSeq}`,
              lease: reservation.lease,
              partition: reservation.partition,
              el: null,
              url: null,
              title: null,
              ui: { preset: '1080p', dpr: null, fit: false, zoom: 1 },
              createdAt: new Date().toISOString(),
            };
            const frame = document.createElement('webview');
            frame.setAttribute('data-dsh-kit-agent-view', '');
            frame.setAttribute('name', reservation.lease);
            frame.setAttribute('partition', reservation.partition);
            frame.setAttribute('allowpopups', '');
            frame.setAttribute('src', `about:blank#${reservation.lease}`);
            frame.style.cssText = 'position:absolute;left:0;top:0;border:0;transform-origin:top left;';
            tab.el = frame;
            agentView.stage.appendChild(frame);
            try {
              if (typeof b.onOpenRequested === 'function') {
                b.onOpenRequested(reservation.lease, (url) => { agentView.lastPopup = String(url || ''); });
              }
            } catch { /* 订阅失败不影响主流程 */ }
            const syncMeta = () => {
              try { tab.url = frame.getURL() || tab.url; } catch { /* 忽略 */ }
              try { tab.title = frame.getTitle() || tab.title; } catch { /* 忽略 */ }
              renderAgentTabStrip();
              renderAgentAddress();
            };
            frame.addEventListener('did-navigate', syncMeta);
            frame.addEventListener('did-navigate-in-page', syncMeta);
            frame.addEventListener('page-title-updated', syncMeta);
            agentView.tabs.push(tab);
            setActiveAgentTab(tab.id);
            // 批注会话进行中新建窗口 ⇒ **立即加入**（编号延续），不等 2s tick
            try {
              if (stateRef.annot && stateRef.annot.active) await joinPane(frame);
            } catch { /* 页面未就绪：tick 会再试 */ }
            try { if (opts.url) await navigateAgentTab(tab, String(opts.url)); } catch { /* 导航失败由调用方判断 */ }
            return tab;
          };
          /** 关闭某个窗口并释放其租约；关掉最后一个则整面板收起为空壳。 */
          const closeAgentTab = (id) => {
            const idx = (agentView.tabs || []).findIndex((t) => t.id === id);
            if (idx < 0) return { ok: true, closed: false };
            const tab = agentView.tabs[idx];
            const b = agentViewCarrier();
            if (b && tab.lease) b.release(tab.lease).catch(() => { /* 忽略 */ });
            try { if (tab.el && tab.el.remove) tab.el.remove(); } catch { /* 忽略 */ }
            agentView.tabs.splice(idx, 1);
            if (agentView.activeId === id) {
              const next = agentView.tabs[Math.min(idx, agentView.tabs.length - 1)] || null;
              if (next) setActiveAgentTab(next.id);
              else {
                agentView.activeId = null; agentView.el = null; agentView.lease = null; agentView.partition = null; agentView.ui = null;
                renderAgentTabStrip(); renderAgentAddress();
              }
            } else {
              renderAgentTabStrip();
            }
            return { ok: true, closed: true, remaining: agentView.tabs.length };
          };
          /** 在**指定窗口**里导航（不改变活动窗口）。 */
          const navigateAgentTab = async (tab, url) => {
            const el = tab && tab.el;
            if (!el) throw new Error('窗口不存在');
            await waitAgentViewReady(el);
            await el.loadURL(url);
            tab.url = url;
            renderAgentTabStrip();
            renderAgentAddress();
            return { ok: true, tabId: tab.id, url, title: (() => { try { return el.getTitle(); } catch { return null; } })() };
          };
          /** 工具条「↘」用：把会话窗口当前页面**以同登录态**开进自持浏览器。 */
          const openUrlInAgentView = async (url, opts = {}) => {
            const v = await ensureAgentView({ sessionId: opts.sessionId || null, state: 'expanded' });
            const tab = activeAgentTab() || agentTabShell();
            if (!tab) {
              const created = await newAgentTab({ url });
              return { ok: true, tabId: created.id, url, status: agentViewStatus() };
            }
            await navigateAgentTab(tab, url);
            return { ok: true, tabId: tab.id, url, status: agentViewStatus() };
          };
          /** 等自持视图的 webview 完成挂载（`dom-ready` / 拿到 webContentsId）——
           *  **没有这一步 `loadURL` 会报「must be attached to the DOM and dom-ready emitted」**（实测）。 */
          const waitAgentViewReady = (el, timeoutMs = 6000) => new Promise((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(true); } };
            try { el.addEventListener('dom-ready', finish, { once: true }); } catch { /* 忽略 */ }
            const t0 = Date.now();
            const iv = setInterval(() => {
              let ok = false;
              try { ok = typeof el.getWebContentsId === 'function' && Number.isFinite(el.getWebContentsId()); } catch { ok = false; }
              if (ok || Date.now() - t0 > timeoutMs) { clearInterval(iv); finish(); }
            }, 120);
            trackInterval(iv);
          });
          /** 在自持视图里导航（不存在就先建）。 */
          const navigateAgentView = async (url, opts) => {
            const v = await ensureAgentView(opts || {});
            const el = v.el;
            await waitAgentViewReady(el);
            try {
              await el.loadURL(url);
            } catch (e) {
              // loadURL 的 Promise 在跨导航/被中断时会 reject，但导航通常已发生——不当作失败
              const cur = (() => { try { return el.getURL(); } catch { return null; } })();
              if (!cur || cur === 'about:blank') throw e;
            }
            await new Promise((r) => setTimeout(r, 400));
            return { ...agentViewStatus() };
          };
          const agentViewStatus = () => {
            const el = agentViewWebview();
            const ui = agentView.ui || {};
            const res = agentViewResolvePreset(ui.preset);
            const s = {
              open: !!el,
              partition: agentView.partition,
              leaseId: agentView.lease ? String(agentView.lease).slice(0, 8) : null,
              acquiredAt: agentView.acquiredAt,
              lastPopup: agentView.lastPopup,
              // R-OWN-ID：登录态复用情况（identity 来源 + 是否与侧栏窗口同分区）
              identity: agentView.identity,
              identityFrom: agentView.identityFrom,
              sharedWithSidebar: agentView.partition ? sidebarPartitions().indexOf(String(agentView.partition)) >= 0 : false,
              // R-OWN v8：多窗口
              tabs: (agentView.tabs || []).map((t) => {
                let u = t.url || null; let ti = t.title || null;
                try { if (t.el && typeof t.el.getURL === 'function') u = t.el.getURL() || u; } catch { /* 忽略 */ }
                try { if (t.el && typeof t.el.getTitle === 'function') ti = t.el.getTitle() || ti; } catch { /* 忽略 */ }
                return { id: t.id, url: u, title: ti, active: t.id === agentView.activeId };
              }),
              activeTabId: agentView.activeId || null,
              tabCount: (agentView.tabs || []).length,
              // 分辨率与窗口形态
              state: ui.state || null,
              preset: ui.preset || null,
              resolution: `${res.w}×${res.h}`,
              dpr: Number(ui.dpr || res.dpr || 1) || 1,
              zoom: Number(ui.zoom || 1) || 1,
              uiDark: agentView.theme ? agentView.theme.dark : detectUiDark(),
            };
            if (el) {
              try { s.url = el.getURL(); } catch { s.url = null; }
              try { s.title = el.getTitle(); } catch { s.title = null; }
              try { s.loading = el.isLoading(); } catch { s.loading = null; }
              try { s.wcId = el.getWebContentsId(); } catch { s.wcId = null; }
            }
            return s;
          };
          /** 面板本地位置/尺寸（供工具报告与排障）。 */
          const agentViewRect = () => {
            try {
              if (!agentView.panel) return null;
              const r = agentView.panel.getBoundingClientRect();
              return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
            } catch { return null; }
          };
          /** R-OWN 自愈（★实测必需）：client 热换/重载会让**模块态归零而 DOM 与租约残留**
           *（现象：status 报 open:false，却能看到游离的 agent webview，且重复 open 会再建一个）。
           * 启动时收养「面板 + 其 webview 都在场」的实例（租约就在 webview 的 `name` 属性里、
           * partition 在 `partition` 属性里，无需外部记录），其余重复/游离实例连同租约一起清掉；
           * 若什么都没有但 localStorage 还记着上次的租约 → best-effort 释放（避免租约泄漏）。 */
          const adoptOrCleanAgentView = () => {
            let adopted = null; let removed = 0; let released = 0;
            try {
              const frames = Array.from(document.querySelectorAll('webview[data-dsh-kit-agent-view]'));
              const panels = Array.from(document.querySelectorAll('[data-dsh-kit-agent-view-panel]'));
              const carrier = agentViewCarrier();
              const releaseLease = (lease) => {
                if (!lease || !carrier) return;
                try { carrier.release(lease).catch(() => { /* 已失效：忽略 */ }); released += 1; } catch { /* 忽略 */ }
              };
              // 候选：面板内确实有我们的 webview，且属性齐全；**非 about:blank 的优先**（更有用）
              const cands = [];
              for (const panel of panels) {
                const frame = panel.querySelector('webview[data-dsh-kit-agent-view]');
                if (!frame) continue;
                const lease = frame.getAttribute('name');
                const partition = frame.getAttribute('partition');
                if (!lease || !partition) continue;
                let url = null;
                try { url = frame.getURL(); } catch { url = null; }
                cands.push({ panel, frame, lease, partition, blank: !url || url.indexOf('about:blank') === 0 });
              }
              cands.sort((a, b) => Number(a.blank) - Number(b.blank));
              if (cands.length) {
                adopted = cands[0];
                for (const c of cands.slice(1)) {
                  // 多窗口：被丢弃的面板里**所有**窗口的租约都要释放（否则泄漏）
                  for (const f2 of Array.from(c.panel.querySelectorAll('webview[data-dsh-kit-agent-view]'))) {
                    releaseLease(f2.getAttribute('name'));
                  }
                  try { c.panel.remove(); } catch { /* 忽略 */ }
                  removed += 1;
                }
              }
              // 无主的游离 frame（不在被收养的面板里）一律清掉
              for (const frame of frames) {
                if (adopted && (frame === adopted.frame || adopted.panel.contains(frame))) continue;
                const lease = frame.getAttribute('name');
                try { frame.remove(); } catch { /* 忽略 */ }
                removed += 1;
                releaseLease(lease);
              }
              if (adopted) {
                agentView.panel = adopted.panel;
                agentView.stage = adopted.panel.querySelector('[data-dsh-kit-agent-view-stage]') || null;
                agentView.tabStrip = adopted.panel.querySelector('[data-dsh-kit-agent-tabstrip]') || null;
                agentView.addr = adopted.panel.querySelector('[data-dsh-kit-agent-address]') || null;
                agentView.addrRow = agentView.addr ? agentView.addr.parentElement : null;
                agentView.urlText = adopted.panel.querySelector('[data-dsh-kit-agent-view-url]') || null;
                agentView.acquiredAt = agentView.acquiredAt || 'adopted-on-boot';
                // R-OWN v8：把面板里**所有**自持 webview 收养为窗口（各自 name=租约、partition）
                try {
                  const frames2 = Array.from(adopted.panel.querySelectorAll('webview[data-dsh-kit-agent-view]'));
                  agentView.tabs = frames2.map((el2, i2) => ({
                    id: `tab-adopt-${i2 + 1}`,
                    lease: el2.getAttribute('name') || null,
                    partition: el2.getAttribute('partition') || null,
                    el: el2,
                    url: (() => { try { return el2.getURL(); } catch { return null; } })(),
                    title: (() => { try { return el2.getTitle(); } catch { return null; } })(),
                    ui: { preset: '1080p', dpr: null, fit: false, zoom: 1 },
                    createdAt: 'adopted-on-boot',
                  }));
                  agentView.tabSeq = agentView.tabs.length;
                  const sel2 = adopted.panel.querySelector('[data-dsh-kit-agent-view-preset]');
                  const uiState = adopted.panel.dataset.kitAgentViewState === 'expanded' ? 'expanded' : 'collapsed';
                  if (agentView.tabs.length) {
                    agentView.tabs[0].ui = { ...(agentView.tabs[0].ui || {}), preset: (sel2 && sel2.value) || '1080p' };
                    agentView.activeId = agentView.tabs[0].id;
                    agentView.ui = { ...agentView.tabs[0].ui, state: uiState };
                    setActiveAgentTab(agentView.activeId);
                  }
                } catch { /* 忽略 */ }
                // 收养的老面板没有 `data-kit-own-display`（旧版没记），此时内联 display 还在 ⇒ 补记
                try {
                  for (const el3 of Array.from(adopted.panel.querySelectorAll('[data-dsh-kit-agent-view-expanded-only]'))) {
                    if (!el3.getAttribute('data-kit-own-display')) markExpandedOnly(el3);
                  }
                } catch { /* 忽略 */ }
                try { localStorage.setItem(AGENT_VIEW_LEASE_KEY, JSON.stringify({ identity: agentView.identity || null, at: agentView.acquiredAt })); } catch { /* 忽略 */ }
                // 收养后接回 onOpenRequested 订阅（每个窗口的租约都接）
                try {
                  if (carrier && typeof carrier.onOpenRequested === 'function') {
                    for (const t of agentView.tabs) {
                      if (t.lease) carrier.onOpenRequested(t.lease, (url) => { agentView.lastPopup = String(url || ''); });
                    }
                  }
                } catch { /* 忽略 */ }
                if (agentView.stage) applyAgentViewLayout();
              } else {
                try {
                  const raw = localStorage.getItem(AGENT_VIEW_LEASE_KEY);
                  if (raw) {
                    const rec = JSON.parse(raw);
                    if (rec && rec.lease) releaseLease(rec.lease);
                    localStorage.removeItem(AGENT_VIEW_LEASE_KEY);
                  }
                } catch { /* 忽略 */ }
              }
            } catch { /* 自愈失败不影响主流程 */ }
            return {
              adopted: !!adopted, removed, released,
              url: adopted ? (() => { try { return adopted.frame.getURL(); } catch { return null; } })() : null,
            };
          };
          try { agentView.boot = adoptOrCleanAgentView(); } catch { /* 忽略 */ }

          const inputTargetOf = (c) => {
            // R-SCOPE/R-OWN：target=agent 强制自持视图；target=session 强制本会话面板；
            // 缺省顺序 = **自持窗口优先**（用户要求：默认不碰他的窗口）→ 没有自持窗口才退回本会话面板。
            const want = c && c.target ? String(c.target) : null;
            if (want === 'agent') { touchAgentView(); return agentViewWebview(); }
            const els = scopedWebviews(c && c.sessionId);
            const idx = Number(c && c.tab);
            const fromSession = (Number.isFinite(idx) && els[idx]) || els.find(captureVisible) || els[0] || null;
            if (want === 'session') return fromSession;
            const av = agentViewWebview();
            if (av) { touchAgentView(); return av; } // 命中自持窗口 ⇒ 续期「Agent 操作中」（亮边框 + 推迟空闲释放）
            return fromSession;
          };
          const inputZoom = (el) => {
            try { const z = typeof el.getZoomFactor === 'function' ? Number(el.getZoomFactor()) : 1; return Number.isFinite(z) && z > 0 ? z : 1; } catch { return 1; }
          };
          /** 在页面内解析目标几何 + 遮挡情况（ref / selector / 无参=文档根）。 */
          const resolveInputBox = async (target, c) => {
            const sel = c && c.ref != null ? `[data-dsh-kit-ref="${Number(c.ref)}"]` : String((c && c.selector) || '');
            const raw = await target.executeJavaScript(
              `(function () {\n`
              + `  var sel = ${JSON.stringify(sel)};\n`
              + `  var el = sel ? document.querySelector(sel) : null;\n`
              + `  if (sel && !el) return JSON.stringify({ ok: false, error: 'no element: ' + sel });\n`
              + `  var node = el || document.documentElement;\n`
              + `  var r = node.getBoundingClientRect();\n`
              + `  if (r.width === 0 && r.height === 0) return JSON.stringify({ ok: false, error: 'element zero size' });\n`
              + `  var cx = r.left + r.width / 2, cy = r.top + r.height / 2;\n`
              + `  var hit = null; try { hit = document.elementFromPoint(cx, cy); } catch (e) { hit = null; }\n`
              + `  var occluded = false, occluder = null;\n`
              + `  if (hit === null) { occluded = true; occluder = { reason: 'elementFromPoint=null（中心在视口外）' }; }\n`
              + `  else if (el && hit !== el && !el.contains(hit) && !hit.contains(el)) { occluded = true; occluder = { tag: hit.tagName, id: hit.id || null, cls: String(hit.className || '').slice(0, 60) }; }\n`
              + `  return JSON.stringify({ ok: true, x: cx, y: cy, w: r.width, h: r.height, top: r.top, left: r.left, inViewport: r.top < innerHeight && r.left < innerWidth && r.bottom > 0 && r.right > 0, tag: el ? el.tagName.toLowerCase() : null, text: el ? String(el.textContent || '').trim().slice(0, 60) : null, occluded: occluded, occluder: occluder });\n`
              + `})()`,
              true,
            );
            try { return typeof raw === 'string' ? JSON.parse(raw) : (raw || { ok: false, error: 'box 无返回' }); } catch { return { ok: false, error: 'box 解析失败' }; }
          };
          const sendMouse = (el, type, x, y, extra) => el.sendInputEvent({ type, x, y, ...(extra || {}) });
          /** 让 guest 视图拿到焦点：**纯键盘事件（press）必须先把焦点交给 webview**，否则
           *  keyDown 到了页面但焦点不动（实测 Tab 无效、activeElement 仍 BODY）。鼠标事件会顺带聚焦。
           *  R-SCOPE：操作后**把焦点还给原元素**——用户可能在别的会话输入框里打字，别把焦点留在 guest。 */
          const focusGuest = (el) => {
            let prev = null;
            try { prev = document.activeElement || null; } catch { prev = null; }
            try { if (el && typeof el.focus === 'function') el.focus(); } catch { /* 聚焦失败不影响鼠标路径 */ }
            if (prev && prev !== el && prev !== document.body) {
              setTimeout(() => {
                try { if (document.contains(prev) && typeof prev.focus === 'function') prev.focus(); } catch { /* 忽略 */ }
              }, 60);
            }
          };
          /* ── R-SCOPE（2026-10-10 用户需求）：**自动化只作用于本会话的浏览器窗口** ──
           * 背景（实测）：本插件在 GUI 里是单实例，而 `ctx.sidebarRight` 作用于**当前显示的那个会话**——
           * 后台会话下命令会动到用户前台会话的窗口；`webview.focus()` 还会抢走用户输入框的焦点
           * （用户在别的会话打字被影响）。因此：
           *  ①页面类命令必须只在 `[data-sidebar-right-session="<调用会话>"]` 子树里选 webview；
           *  ②面板类命令（开/关标签、开合面板）先比对「当前前台会话」== 调用会话，不等就拒绝；
           *  ③交互类命令在用户正聚焦可编辑元素时拒绝（除非 force:true）；操作后归还焦点（见 focusGuest）。 */
          /** 当前前台的会话 id（公开 API：sidebarRight.commandTarget(null) 返回 {sessionId,...}）。 */
          const currentSurfaceSession = () => {
            try {
              const t = sidebarRightSvc && typeof sidebarRightSvc.commandTarget === 'function' ? sidebarRightSvc.commandTarget(null) : null;
              return (t && t.sessionId) || null;
            } catch { return null; }
          };
          /** 指定会话下的 webview（sessionId 缺省 = 全局，兼容裸命令通道探针）。 */
          const scopedWebviews = (sessionId) => {
            const all = Array.from(document.querySelectorAll('webview'));
            if (!sessionId) return all;
            try { return Array.from(document.querySelectorAll(`[data-sidebar-right-session="${String(sessionId)}"] webview`)); } catch { return []; }
          };
          /** 用户正在输入守卫：焦点在可编辑元素上、且不在本次目标会话的面板里 → 拒绝（除非 force）。 */
          const typingGuard = (c) => {
            if (c && c.force === true) return null;
            let ae = null;
            try { ae = document.activeElement || null; } catch { ae = null; }
            if (!ae) return null;
            const tag = String(ae.tagName || '').toLowerCase();
            const editable = tag === 'input' || tag === 'textarea' || ae.isContentEditable === true;
            if (!editable) return null;
            const sid = c && c.sessionId ? String(c.sessionId) : null;
            if (sid) {
              try { if (ae.closest && ae.closest(`[data-sidebar-right-session="${sid}"]`)) return null; } catch { /* 忽略 */ }
            }
            return {
              ok: false,
              guard: 'user-typing',
              error: '检测到用户正在输入（焦点在输入框上）——为避免打断用户已拒绝自动化；确需继续请传 force:true',
            };
          };
          /** 分发器前置检查：返回非 null 即拒绝执行（并如实说明原因）。 */
          const scopeCheck = (action, c) => {
            const sid = c && c.sessionId ? String(c.sessionId) : null;
            if (!sid) return null; // 裸命令通道（探针/实施会话）：保持既有全局行为
            if (PANEL_ACTIONS.has(action)) {
              const cur = currentSurfaceSession();
              if (cur && cur !== sid) {
                return {
                  ok: false, scoped: true, sessionId: sid, currentSession: cur,
                  error: `当前前台显示的是会话 ${cur}，而调用方是 ${sid}——为避免影响其他会话，本次操作已拒绝（请在本会话前台时重试）`,
                };
              }
              return null;
            }
            if (PAGE_ACTIONS.has(action) && !scopedWebviews(sid).length && !agentViewWebview()) {
              return {
                ok: false, scoped: true, sessionId: sid,
                error: `本会话（${sid}）当前没有已挂载的浏览器面板，也没有自持视图——为避免动到其他会话的窗口，本次操作已拒绝。可先调 browser_agent_window {op:"open", url} 开一个属于 Agent 自己的窗口（不占会话、不影响其他会话）。`,
              };
            }
            if (INTERACTIVE_ACTIONS.has(action)) {
              const g = typingGuard(c);
              if (g) return { ...g, scoped: true, sessionId: sid };
            }
            return null;
          };
          const PANEL_ACTIONS = new Set(['browser-open', 'browser-close', 'browser-panel']);
          /* 只读盘点：不要求前台（读全局清单无害），但 DOM 侧只列本会话的面板 + 回显前后台会话便于核对 */
          const READONLY_ACTIONS = new Set(['browser-tabs']);
          const PAGE_ACTIONS = new Set(['snapshot', 'state', 'history', 'wait', 'select', 'element', 'check', 'input', 'click', 'type', 'page-inject', 'reload', 'navigate', 'screenshot', 'console-observer', 'storage', 'upload', 'find']);
          const INTERACTIVE_ACTIONS = new Set(['input', 'click', 'type', 'select', 'check']);
          /** 操作页面元信息（多标签时「我到底点了哪个页面」的判据）。 */
          const inputPageMeta = (el) => {
            const out = { url: null, title: null };
            try { out.url = typeof el.getURL === 'function' ? el.getURL() : null; } catch { /* 忽略 */ }
            try { out.title = typeof el.getTitle === 'function' ? el.getTitle() : null; } catch { /* 忽略 */ }
            return out;
          };
          /** 可信点击（含可选遮挡检查）；返回统一结果对象。 */
          const trustedClick = async (target, c, op) => {
            focusGuest(target);
            const box = await resolveInputBox(target, c);
            if (!box.ok) return { ok: false, op, error: box.error, hint: 'DOM 可能已变化：请重新 browser_snapshot 取新 ref' };
            if (box.occluded && c.force !== true) {
              return { ok: false, op, occluded: true, occluder: box.occluder, box, error: `目标中心被遮挡（${box.occluder && box.occluder.tag === 'html' ? '文档根' : (box.occluder && (box.occluder.id || box.occluder.cls || box.occluder.tag)) || '未知'}）——如确认无误可 force:true` };
            }
            const zoom = inputZoom(target);
            const x = Math.round(box.x * zoom);
            const y = Math.round(box.y * zoom);
            try {
              sendMouse(target, 'mouseMove', x, y);
              if (op === 'hover') return { ok: true, op, mode: 'trusted', x, y, box, ...inputPageMeta(target) };
              const button = op === 'rightclick' ? 'right' : 'left';
              const times = op === 'dblclick' ? 2 : 1;
              for (let i = 1; i <= times; i += 1) {
                sendMouse(target, 'mouseDown', x, y, { button, clickCount: i });
                sendMouse(target, 'mouseUp', x, y, { button, clickCount: i });
              }
              return { ok: true, op, mode: 'trusted', x, y, zoom, box, occluded: !!box.occluded, ...inputPageMeta(target) };
            } catch (e) { return { ok: false, op, error: msgOf(e) }; }
          };
          /** 可信打字：可选中/清空元素 → 逐字符 keyDown/char/keyUp → 可选回车提交。 */
          const trustedType = async (target, c) => {
            focusGuest(target);
            const text = String((c && c.text) ?? '');
            let focused = false;
            if (c && (c.ref != null || c.selector)) {
              const box = await resolveInputBox(target, c);
              if (!box.ok) return { ok: false, op: 'type', error: box.error, hint: 'DOM 可能已变化：请重新 browser_snapshot 取新 ref' };
              if (box.occluded && c.force !== true) return { ok: false, op: 'type', occluded: true, occluder: box.occluder, error: '输入框被遮挡（可 force:true 强制）' };
              const zoom = inputZoom(target);
              const x = Math.round(box.x * zoom);
              const y = Math.round(box.y * zoom);
              sendMouse(target, 'mouseMove', x, y);
              sendMouse(target, 'mouseDown', x, y, { button: 'left', clickCount: 1 });
              sendMouse(target, 'mouseUp', x, y, { button: 'left', clickCount: 1 });
              focused = true;
            }
            if (c && c.clear === true) {
              // 清空用 DOM（原生 setter + input 事件），比选全删更可靠
              await target.executeJavaScript(
                `(function () { var el = document.activeElement; if (!el) return 'no-active'; if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { var p = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); return 'cleared'; } if (el.isContentEditable) { el.textContent = ''; el.dispatchEvent(new Event('input', { bubbles: true })); return 'cleared'; } return 'not-editable'; })()`,
                true,
              );
            }
            const chars = Array.from(text);
            for (const ch of chars) {
              try {
                target.sendInputEvent({ type: 'keyDown', keyCode: ch });
                target.sendInputEvent({ type: 'char', keyCode: ch });
                target.sendInputEvent({ type: 'keyUp', keyCode: ch });
              } catch (e) { return { ok: false, op: 'type', typed: chars.indexOf(ch), error: msgOf(e) }; }
            }
            let submitted = false;
            if (c && c.submit === true) {
              target.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
              target.sendInputEvent({ type: 'char', keyCode: '\r' });
              target.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
              submitted = true;
            }
            return { ok: true, op: 'type', mode: 'trusted', len: chars.length, focused, clear: !!(c && c.clear), submitted, ...inputPageMeta(target) };
          };

          /* 命令处理器分域清单（C2 拆表）：action → async (svc, c) => result。
           * 动作全量清单与唯一性由静态契约钉死（plugin-impl §3.9）；case 体与拆表前逐字一致。 */
          const commandHandlers = {
            'inject-annotator': async function (svc, c) {
              await ensureAnnotator(svc);
              return { ok: true, injected: true };
            },
            'start-annotator': async function (svc, c) {
              // 不能 await：会话直到提交/Esc 才结束，await 会卡死命令轮询（cmdBusy）
              const target = pickGuestEl();
              togglePaneAnnot(target).then((r) => {
                say('info', `批注（命令触发）：${JSON.stringify(r).slice(0, 120)}`);
              }).catch(() => {});
              return { ok: true, started: true };
            },
            'toggle-pane': async function (svc, c) {
              // 指定面板加入/退出共享会话（tab 0 起；省略 = 第一个）
              const els = Array.from(document.querySelectorAll('webview'));
              const pane = els[Number(c.tab) || 0];
              if (!pane) return { ok: false, error: 'no pane: tab=' + c.tab };
              togglePaneAnnot(pane).then((r) => {
                say('info', `面板 ${c.tab} 批注：${JSON.stringify(r).slice(0, 120)}`);
              }).catch((e) => { stateRef.lastToggleError = msgOf(e); });
              return { ok: true, toggling: true };
            },
            /* R-OWN v11：批注会话诊断已合并进上面的 'annotator-status'（同一命令，勿重复注册）。 */
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
            },
            'annotator-status': async function (svc, c) {
              const target = pickGuestEl();
              const st = await target.executeJavaScript('(function(){ if (typeof window.__dshKitAnnotator === "undefined") return { injected: false }; return { injected: true, count: window.__dshKitAnnotator.list().length, first: window.__dshKitAnnotator.list()[0] || null }; })()', true);
              // R-OWN v11：会话诊断（是否活跃 + 每个成员窗口的归属/URL/条数）——验证「两处同步开关」与「归属可分辨」
              const as = stateRef.annot || null;
              const panes = [];
              for (const p of (as && as.panes) || []) {
                const owner = paneOwnerLabel(p);
                let count = null;
                let url = null;
                try { count = await withTimeout(p.executeJavaScript('(window.__dshKitAnnotator && window.__dshKitAnnotator.list ? window.__dshKitAnnotator.list().length : null)', true), 4000, 'annot-count'); } catch { count = null; }
                try { url = p.getURL ? p.getURL() : null; } catch { url = null; }
                panes.push({ owner: owner.label, kind: owner.kind, tabId: owner.tabId || null, sessionId: owner.sessionId || null, url, count });
              }
              return {
                ok: true, ...st,
                sessionActive: !!(as && as.active),
                sessionPaneCount: panes.length,
                sessionPanes: panes,
                sessionOwners: panes.map((x) => x.owner),
              };
            },
            'guest-eval': async function (svc, c) {
              // MVP-4：agent 侧任意求值；frame:true 时在 kit 沙箱文档内执行；
              // tab（0 起）指定目标面板（默认第一个）——多浏览器窗口分别驱动。
              // R-OWN/R-SCOPE：目标解析统一走 inputTargetOf（本会话面板优先 → 自持窗口兜底；
              // 绝不落到别的会话）；**不能再直接用 document.querySelectorAll('webview')**——那会把
              // 别的会话/别的面板的 webview 也选进来（实测：browser_eval 打到了用户会话的页面）。
              // 注意：document 必须经【函数参数】传入（参数遮蔽安全）；函数体内 var document
              // 会因提升让全函数体的 document 变 undefined（cmd-72/73 实测自坑，P23）。
              const target = inputTargetOf(c) || pickGuestEl();
              const docPre = c.frame ? TARGET_DOC_SNIPPET : '';
              const docExpr = c.frame ? 'DOC' : 'document';
              const code = String(c.code || '');
              const value = await target.executeJavaScript(
                `(function () { ${docPre} return (function (document) {\n${code}\n})(${docExpr}); })()`,
                true,
              );
              return { ok: true, value };
            },
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
            },
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
              tickAt: stateRef.tickAt || null, // 2s tick 心跳（诊断：tick 卡死时该字段会停更）
              styleTickCount: stateRef.styleTickCount || 0,
              styleTickBtnCount: typeof stateRef.styleTickBtnCount === 'number' ? stateRef.styleTickBtnCount : null,
              styleTickWrite: stateRef.styleTickWrite || null,
              liveInstanceBootAt: (globalThis.__dshKitLiveInstance && globalThis.__dshKitLiveInstance.bootAt) || null,
              annotActive: !!(stateRef.annot && stateRef.annot.active),
                /* R-OWN v23：镜像面板**可查诊断** —— 先前 `catch{忽略}` + 单飞 busy 让"面板不出现"
                 * 完全无从定位（用户实测：批注开着但右下角什么都没有）。字段语义见 syncAnnotMirror。 */
                annotMirror: {
                  node: !!document.getElementById(ANNOT_MIRROR_ID),
                  calls: stateRef.mirrorDiag.calls,
                  injected: stateRef.mirrorDiag.injected,
                  skippedBusy: stateRef.mirrorDiag.skippedBusy,
                  skippedNoPane: stateRef.mirrorDiag.skippedNoPane,
                  skippedNoHtml: stateRef.mirrorDiag.skippedNoHtml,
                  resetForced: stateRef.mirrorDiag.resetForced,
                  lastError: stateRef.mirrorDiag.lastError,
                  lastAt: stateRef.mirrorDiag.lastAt,
                  idleTimerOn: !!agentView.idleTimer,
                },
                /* v26：草稿箱现场（"跳页后续号/列出旧批注"出问题时的第一手判据） */
                annotDraft: (() => {
                  try {
                    return { key: draftKeyOf(), keyUsed: draftKeyUsed, loaded: draftLoaded, count: draftCount(), maxIndex: draftMaxIndex(), inPanes: (stateRef.annot && stateRef.annot.panes) ? stateRef.annot.panes.length : 0 };
                  } catch (e) { return { error: msgOf(e) }; }
                })(),
                panelRootInDom: !!document.getElementById('dsh-kit-panel'),
                panelError: typeof window.__dshKitPanelError === 'string' ? window.__dshKitPanelError : null,
                remoteSvcReady: !!(stateRef.getRemote && stateRef.getRemote()),
                mountOk: stateRef.mountOk === true,
                mountError: stateRef.mountError || null,
                webviewCount: document.querySelectorAll('webview').length,
                // R-CAP：截图护栏现场（inFlight/冷却/上次崩溃标记）
                capture: {
                  inFlight: captureInFlight,
                  cooldownMs: Math.max(0, captureCooldownUntil - Date.now()),
                  crashMarker: stateRef.captureCrashMarker || null,
                  autoShotLeft: stateRef.autoShotLeft,
                },
                // R-GLOW：Agent 操作光效现场（visible=浮层在场；sticky=常亮标记；label=最近一次动作）
                agentGlow: {
                  enabled: agentGlowEnabled(),
                  visible: !!document.getElementById(AGENT_GLOW_ID),
                  sticky: !!stateRef.agentGlow.sticky,
                  label: stateRef.agentGlow.label || null,
                  count: stateRef.agentGlow.count || 0,
                },
              };
            },
            'report-now': async function (svc, c) {
              // 诊断：立即跑一轮探测并刷新 probe-report.json（含 gui/syncDiag 诊断）
              probeAndPublish('command').then(() => reportNow()).catch(() => {});
              return { ok: true, reporting: true };
            },
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
            },
            'panel-toggle': async function (svc, c) {
              // 调试面板显隐切换（默认隐藏、功能保留；持久化跨刷新）
              const next = readPanelHidden() ? '0' : '1';
              try { localStorage.setItem(PANEL_HIDDEN_KEY, next); } catch { /* 持久化失败仅本次生效 */ }
              window.dispatchEvent(new CustomEvent(PANEL_TOGGLE_EVENT));
              return { ok: true, hidden: next === '1' };
            },
            'toolbar-probe': async function (svc, c) {
              // 诊断：直接测 ensureToolbarButton 的每一步判定
              const bySelector = !!document.querySelector(TOOLBAR_SEL);
              const allForms = Array.from(document.querySelectorAll('form')).map((f) => f.className.slice(0, 60));
              const btnById = !!document.getElementById('dsh-kit-toolbar-btn');
              let formEl = document.querySelector(TOOLBAR_SEL);
              let rootHasWebview = null, rootCls = null;
              if (formEl && formEl.parentElement) {
                rootCls = String(formEl.parentElement.className || '').slice(0, 60);
                rootHasWebview = !!formEl.parentElement.querySelector('webview');
              }
              return { ok: true, bySelector, allForms, btnById, rootHasWebview, rootCls };
            },
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
            },
            'browser-tabs': async function (svc, c) {
              // R-BROWSER：枚举当前窗口**全部已开网页**——侧栏服务快照（权威：含 sessionId/tabId/标题/URL）
              // + DOM 侧 webview 实测补充（wcId / 实际 URL / DevTools 态）。
              // R-SCOPE：清单是全局只读（允许任何会话读），但 **DOM 侧只列本会话的面板**，
              //   并回显「调用会话 / 当前前台会话」——让 agent 一眼看清自己能看到谁、能不能操作。
              const out = { tabs: [], tabsError: null, webviews: [] };
              const reqSid = c && c.sessionId ? String(c.sessionId) : null;
              out.requestedSession = reqSid;
              out.currentSession = currentSurfaceSession();
              try {
                const store = sidebarRightSvc && sidebarRightSvc.openTabs;
                const snap = store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : null;
                if (Array.isArray(snap)) {
                  out.tabs = snap.map((t) => ({
                    sessionId: (t && t.sessionId) || null,
                    tabId: (t && t.tabId) || null,
                    type: (t && (t.type || t.kind)) || null,
                    title: (t && t.title) || null,
                    url: (t && t.url) || null,
                  }));
                } else {
                  out.tabsError = sidebarRightSvc ? 'openTabs.getSnapshot 不可用' : 'sidebarRight 服务不可用（降级：仅 DOM 枚举）';
                }
              } catch (e) { out.tabsError = msgOf(e); }
              // DOM 侧：只列**本会话**已挂载的面板（无 sessionId 时才是全量，兼容探针）
              const myEls = scopedWebviews(reqSid);
              out.scopedWebviewCount = myEls.length;
              for (const el of myEls) {
                const one = {};
                try { one.src = el.getAttribute('src') || null; } catch { /* 忽略 */ }
                try { one.url = typeof el.getURL === 'function' ? el.getURL() : null; } catch { /* 忽略 */ }
                try { one.title = typeof el.getTitle === 'function' ? el.getTitle() : null; } catch { /* 忽略 */ }
                try { one.wcId = typeof el.getWebContentsId === 'function' ? el.getWebContentsId() : null; } catch { /* 忽略 */ }
                try { one.devtoolsOpened = typeof el.isDevToolsOpened === 'function' ? el.isDevToolsOpened() : null; } catch { /* 忽略 */ }
                out.webviews.push(one);
              }
              // 我的标签（清单里属于本会话的项）与「当前前台会话是否就是我」
              out.myTabs = reqSid ? out.tabs.filter((t) => t.sessionId === reqSid) : null;
              out.isFrontSession = reqSid ? (out.currentSession === reqSid) : null;
              out.note = reqSid && out.currentSession && out.currentSession !== reqSid
                ? '当前前台是别的会话：可读清单，但「会动窗口」的操作会被拒绝以避免影响用户'
                : null;
              return { ok: true, count: out.tabs.length, ...out };
            },
            'browser-open': async function (svc, c) {
              // R-BROWSER：**自己打开指定网页**（新开侧栏 Browser 标签）。策略与 DSH 地址栏一致：
              // 只放行 http/https、拒绝凭据、拒绝 DSH 应用自身 origin（官方 README「Protocol policy」）。
              const raw = String((c && c.url) || '').trim();
              if (!raw) return { ok: false, error: 'url 必填' };
              let parsed = null;
              try { parsed = new URL(raw); } catch { return { ok: false, error: `URL 解析失败：${raw.slice(0, 80)}` }; }
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return { ok: false, error: `只支持 http/https（收到 ${parsed.protocol}）——file:/data:/blob: 与本地文件由 Document Preview 负责` };
              }
              if (parsed.username || parsed.password) return { ok: false, error: '拒绝带凭据的 URL' };
              if (parsed.host === location.host) return { ok: false, error: '拒绝打开 DSH 应用自身地址' };
              if (!sidebarRightSvc || typeof sidebarRightSvc.openTab !== 'function') {
                return { ok: false, error: 'sidebarRight.openTab 不可用（服务缺失或尚未就绪）' };
              }
              try { sidebarRightSvc.openTab('browser', { params: { url: parsed.href } }); }
              catch (e) { return { ok: false, error: msgOf(e) }; }
              await new Promise((r) => setTimeout(r, 1200)); // 等面板挂载，回报最新页面清单
              const after = Array.from(document.querySelectorAll('webview')).map((el) => {
                try { return el.getAttribute('src') || null; } catch { return null; }
              });
              return { ok: true, opened: parsed.href, webviewsAfter: after };
            },
            'browser-close': async function (svc, c) {
              // R-BROWSER：**关闭网页标签**（自己开、自己关）。契约：sidebarRight.close(tabId)
              // → 内部 closeIn(当前 session, tabId)，且「唯一的 docked guide 会保留」（官方注释）。
              // 省略 tabId = 关当前活动标签（sidebarRight.active().id）。
              if (!sidebarRightSvc || typeof sidebarRightSvc.close !== 'function') {
                return { ok: false, error: 'sidebarRight.close 不可用（服务缺失或尚未就绪）' };
              }
              let tabId = String((c && c.tabId) || '').trim();
              let resolvedFrom = 'param';
              if (!tabId) {
                try {
                  const act = typeof sidebarRightSvc.active === 'function' ? sidebarRightSvc.active() : null;
                  tabId = (act && act.id) || '';
                  resolvedFrom = 'active';
                } catch (e) { return { ok: false, error: `取活动标签失败：${msgOf(e)}` }; }
              }
              if (!tabId) return { ok: false, error: '没有可关闭的标签（未给 tabId 且取不到活动标签）' };
              /* tabId 是**会话内**编号（不同会话可能同名 tab3/tab14），必须把前后比较都钉在
               * 「被关标签所属会话」上——否则别的会话里有同名标签就会误报 stillOpen:true（实测）。 */
              const snapshot = () => {
                try {
                  const store = sidebarRightSvc.openTabs;
                  const s = store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : null;
                  return Array.isArray(s) ? s : null;
                } catch { return null; }
              };
              const beforeSnap = snapshot();
              const beforeEntry = beforeSnap ? (beforeSnap.find((t) => t && t.tabId === tabId) || null) : null;
              const scopeSession = beforeEntry ? beforeEntry.sessionId : null;
              const countIn = (list) => (Array.isArray(list)
                ? (scopeSession ? list.filter((t) => t && t.sessionId === scopeSession).length : list.length)
                : null);
              try { sidebarRightSvc.close(tabId); }
              catch (e) { return { ok: false, error: `close 抛错：${msgOf(e)}` }; }
              await new Promise((r) => setTimeout(r, 600));
              const afterSnap = snapshot();
              const stillOpen = Array.isArray(afterSnap)
                ? (scopeSession
                  ? afterSnap.some((t) => t && t.tabId === tabId && t.sessionId === scopeSession)
                  : afterSnap.some((t) => t && t.tabId === tabId))
                : null;
              return {
                ok: true,
                closed: tabId,
                resolvedFrom,
                sessionId: scopeSession,
                tabsBefore: countIn(beforeSnap),
                tabsAfter: countIn(afterSnap),
                tabsBeforeAll: beforeSnap ? beforeSnap.length : null,
                tabsAfterAll: afterSnap ? afterSnap.length : null,
                stillOpen,
              };
            },
            'browser-panel': async function (svc, c) {
              // R-BROWSER：**开/关「浏览器窗口」本体**（右侧栏面板）。
              // 首选 sidebarRight.{isExpanded,toggleExpanded}（右侧栏自己的收起/展开；
              // README：Desktop Browser tabs declare keepMounted，「collapse」是 sidebar-right 的概念），
              // 缺失时回退 ctx.layout.{closeRightbar,openRightbar}（shell 级右栏开合）。
              // 注意参数名必须是 `op`：命令信封的 `action` 键已被「命令名」占用（c.action === 'browser-panel'）。
              const act = String((c && c.op) || 'toggle').toLowerCase();
              if (act !== 'open' && act !== 'close' && act !== 'toggle') return { ok: false, error: `未知 op=${act}（open|close|toggle）` };
              const hasSidebarToggle = !!sidebarRightSvc
                && typeof sidebarRightSvc.toggleExpanded === 'function'
                && typeof sidebarRightSvc.isExpanded === 'function';
              if (!hasSidebarToggle && !layoutSvc) return { ok: false, error: 'sidebarRight.toggleExpanded 与 layout 都不可用' };
              const expandedBefore = (() => { try { return hasSidebarToggle ? sidebarRightSvc.isExpanded() : null; } catch { return null; } })();
              let via = '';
              try {
                if (hasSidebarToggle) {
                  const want = act === 'toggle' ? !expandedBefore : act === 'open';
                  if (act === 'toggle' || want !== expandedBefore) { sidebarRightSvc.toggleExpanded(); via = 'sidebarRight.toggleExpanded'; }
                  else via = 'noop(already-target)';
                } else if (act === 'close') { layoutSvc.closeRightbar(); via = 'layout.closeRightbar'; }
                else if (act === 'open') { layoutSvc.openRightbar(true, false); via = 'layout.openRightbar'; }
                else { layoutSvc.toggleSidebar(); via = 'layout.toggleSidebar'; }
              } catch (e) { return { ok: false, error: `${act} 抛错：${msgOf(e)}` }; }
              await new Promise((r) => setTimeout(r, 700));
              const expandedAfter = (() => { try { return hasSidebarToggle ? sidebarRightSvc.isExpanded() : null; } catch { return null; } })();
              return { ok: true, action: act, via, expandedBefore, expandedAfter };
            },
            'console-observer': async function (svc, c) {
              /* R-CONSOLE：页内控制台通道（DSH 拿不到 CDP/DevTools 的现实解，见 docs 评估 §5.0）。
               * 设计要点：**源码随命令下发**（host 侧读 src/console-observer.js 塞进 params.source）——
               * hook 随页面销毁，页面刷新/新开标签后无需人工重装：本命令在 dump/clear/mark/stats 前
               * 先探测 `window.__dshKitConsole`，缺失就用下发源码补注入（自愈）。 */
              const op = String((c && c.op) || 'dump').toLowerCase();
              const els = Array.from(document.querySelectorAll('webview'));
              const tabIdx = Number(c.tab);
              const target = (Number.isFinite(tabIdx) && els[tabIdx]) || pickGuestEl();
              if (!target) return { ok: false, error: '无 webview（先打开内置浏览器）' };
              const src = String(c.source || '');
              const parse = (v) => {
                if (typeof v === 'string') { try { return JSON.parse(v); } catch { return { raw: v }; } }
                return v && typeof v === 'object' ? v : { raw: v };
              };
              const call = (body) => target.executeJavaScript(
                `(function () { try { ${body} } catch (e) { return JSON.stringify({ __error: String((e && e.message) || e) }); } })()`,
                true,
              );
              if (op === 'install' || op === 'dump' || op === 'clear' || op === 'mark' || op === 'stats') {
                let missing = false;
                try {
                  missing = await target.executeJavaScript('typeof window.__dshKitConsole === "undefined" || typeof window.__dshKitConsole.dump !== "function"', true);
                } catch { missing = true; }
                if (missing) {
                  if (!src) return { ok: false, error: '观察器未注入且未提供 source（host 侧应随命令下发 console-observer 源码）' };
                  await target.executeJavaScript(src, true);
                }
              }
              if (op === 'install') {
                const r = parse(await call('var o = window.__dshKitConsole; return JSON.stringify({ installed: !!o, version: o ? o.version : null, stats: o ? o.stats() : null });'));
                return { ok: true, op, ...r };
              }
              if (op === 'uninstall') {
                const r = parse(await call('var o = window.__dshKitConsole; return JSON.stringify(o && o.uninstall ? o.uninstall() : { ok: false, error: "观察器未安装" });'));
                return { ok: true, op, ...r };
              }
              if (op === 'clear') {
                const r = parse(await call('var o = window.__dshKitConsole; return JSON.stringify({ cleared: o && o.clear ? o.clear() : 0 });'));
                return { ok: true, op, ...r };
              }
              if (op === 'mark') {
                const label = String((c && c.label) || 'mark').slice(0, 60);
                const r = parse(await call(`var o = window.__dshKitConsole; return JSON.stringify(o && o.mark ? o.mark(${JSON.stringify(label)}) : null);`));
                return { ok: true, op, label, mark: r };
              }
              if (op === 'stats') {
                const r = parse(await call('var o = window.__dshKitConsole; return JSON.stringify(o && o.stats ? o.stats() : null);'));
                return { ok: true, op, stats: r };
              }
              // dump（默认）：默认只回最近 50 条（省 token）；可 level/filter/net/since/limit 过滤
              const opts = { limit: Number(c.limit) || 50, level: String(c.level || 'all') };
              if (c.since) opts.since = Number(c.since);
              if (c.filter) opts.filter = String(c.filter);
              if (c.net === true) opts.net = true;
              const dumpRaw = parse(await call(`var o = window.__dshKitConsole; return JSON.stringify({ entries: o.dump(${JSON.stringify(opts)}), stats: o.stats() });`));
              return { ok: true, op, options: opts, count: Array.isArray(dumpRaw.entries) ? dumpRaw.entries.length : null, entries: dumpRaw.entries || null, stats: dumpRaw.stats || null };
            },
            'agent-glow': async function (svc, c) {
              // R-GLOW：用户/agent 手动控制「Agent 操作光效」——on=常亮标记（直到 off）、off=关闭并清除、
              // pulse=打一次脉冲、status=查状态。enabled 持久在 localStorage（默认开）。
              const op = String((c && c.op) || 'status').toLowerCase();
              const st = stateRef.agentGlow;
              if (op === 'off') { setAgentGlowEnabled(false); stopAgentGlow(); return { ok: true, enabled: false, visible: false }; }
              if (op === 'enable') { setAgentGlowEnabled(true); stopAgentGlow(); return { ok: true, enabled: true, visible: false }; }
              if (op === 'on') {
                setAgentGlowEnabled(true);
                st.sticky = true; st.until = Date.now() + 60000; st.label = String((c && c.label) || '常亮标记').slice(0, 24); st.count = 1;
                renderAgentGlow();
                if (!st.timer) st.timer = trackInterval(setInterval(renderAgentGlow, AGENT_GLOW_TICK));
                return { ok: true, enabled: true, sticky: true, label: st.label };
              }
              if (op === 'pulse') {
                setAgentGlowEnabled(true);
                pulseAgentActivity((c && c.label) || '手动脉冲', c && c.ms);
                return { ok: true, until: st.until, label: st.label, count: st.count };
              }
              return {
                ok: true, enabled: agentGlowEnabled(), visible: !!document.getElementById(AGENT_GLOW_ID),
                sticky: !!st.sticky, until: st.until, label: st.label, count: st.count,
              };
            },
            'page-close': async function (svc, c) {
              const target = pickGuestEl();
              const value = await target.executeJavaScript(
                `(function () { var old = document.querySelector('iframe[data-dsh-kit-frame]'); if (old) old.remove(); return { closed: true }; })()`,
                true,
              );
              return { ok: true, ...(value || {}) };
            },
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
            },
            'snapshot': async function (svc, c) {
              // MVP-4：可交互元素快照（ref 手柄落在 data-dsh-kit-ref，供 click/type 引用）
              // R-INPUT：目标选择与输入层统一（**可见面板优先** + 支持 tab 指定）——原来用 pickGuestEl()
              // 取「DOM 里第一个」，多标签时可能在快照 A 页、点击落在 B 页，ref 对不上。
              // R-TOKEN：支持 compact（只留 ref/tag/text，截断更短）与 limit（默认 60 / 上限 120）——
              //   大页面全量快照很吃 token，工具侧默认 compact。
              const target = inputTargetOf(c) || pickGuestEl();
              const compact = c && c.compact === true;
              const limit = Math.min(120, Math.max(1, Number((c && c.limit) || (compact ? 60 : 120))));
              const maxText = Math.min(120, Math.max(8, Number((c && c.maxText) || (compact ? 40 : 60))));
              const value = await target.executeJavaScript(
                '(function () {\n' +
                `  ${TARGET_DOC_SNIPPET}\n` +
                `  var COMPACT = ${compact ? 'true' : 'false'};\n` +
                `  var LIMIT = ${limit};\n` +
                `  var MAXTEXT = ${maxText};\n` +
                "  var SELS = 'a[href],button,input,textarea,select,[role=\"button\"],[role=\"link\"],[role=\"checkbox\"],[role=\"tab\"],h1,h2,h3,h4';\n" +
                '  var els = Array.prototype.slice.call(DOC.querySelectorAll(SELS));\n' +
                '  var out = [];\n' +
                '  for (var i = 0; i < els.length && out.length < LIMIT; i++) {\n' +
                '    var el = els[i];\n' +
                '    var r = el.getBoundingClientRect();\n' +
                '    if (r.width === 0 && r.height === 0) continue;\n' +
                '    if (el.closest && el.closest("[data-dsh-kit-ui]")) continue;\n' +
                '    var ref = out.length + 1;\n' +
                '    el.setAttribute("data-dsh-kit-ref", String(ref));\n' +
                "    var item = { ref: ref, tag: el.tagName.toLowerCase(),\n" +
                "      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, MAXTEXT) };\n" +
                '    if (!COMPACT) {\n' +
                "      item.id = el.id || null;\n" +
                "      item.placeholder = el.getAttribute('placeholder') || null;\n" +
                "      item.type = el.getAttribute('type') || null;\n" +
                "      item.value = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? String(el.value || '').slice(0, 60) : null;\n" +
                '    } else if (el.id) item.id = el.id;\n' +
                '    out.push(item);\n' +
                '  }\n' +
                '  return { url: location.href, title: document.title, count: out.length, total: els.length, items: out };\n' +
                '})()',
                true,
              );
              return { ok: true, compact, limit, ...(value || {}) };
            },
            'state': async function (svc, c) {
              // R-STATE：页面状态一屏（agent 用它做「之前/之后」判断，或决定 back/forward）。
              const target = inputTargetOf(c) || pickGuestEl();
              const meta = inputPageMeta(target);
              const live = {
                loading: null, canGoBack: null, canGoForward: null, zoom: null,
              };
              try { live.loading = typeof target.isLoading === 'function' ? target.isLoading() : null; } catch { /* 忽略 */ }
              try { live.canGoBack = typeof target.canGoBack === 'function' ? target.canGoBack() : null; } catch { /* 忽略 */ }
              try { live.canGoForward = typeof target.canGoForward === 'function' ? target.canGoForward() : null; } catch { /* 忽略 */ }
              try { live.zoom = inputZoom(target); } catch { /* 忽略 */ }
              let page = null;
              try {
                page = JSON.parse(await target.executeJavaScript(
                  'JSON.stringify({ readyState: document.readyState, viewport: { w: window.innerWidth, h: window.innerHeight }, scroll: { x: window.scrollX, y: window.scrollY, maxY: Math.max(0, (document.body ? document.body.scrollHeight : 0) - window.innerHeight) }, active: (function () { var a = document.activeElement; return a ? { tag: a.tagName, id: a.id || null } : null; })(), console: (window.__dshKitConsole && window.__dshKitConsole.stats) ? window.__dshKitConsole.stats() : null })',
                  true,
                ));
              } catch { page = null; }
              return { ok: true, tab: Number.isFinite(Number(c && c.tab)) ? Number(c.tab) : null, ...meta, ...live, page };
            },
            'history': async function (svc, c) {
              // R-STATE：会话历史前进/后退（webview 原生历史；reload 用既有 reload 命令）
              const op = String((c && c.op) || 'back').toLowerCase();
              const target = inputTargetOf(c) || pickGuestEl();
              const before = inputPageMeta(target);
              try {
                if (op === 'back') { if (typeof target.canGoBack === 'function' && !target.canGoBack()) return { ok: false, op, error: '已在历史最早处（canGoBack=false）', ...before }; target.goBack(); }
                else if (op === 'forward') { if (typeof target.canGoForward === 'function' && !target.canGoForward()) return { ok: false, op, error: '已在历史最新处（canGoForward=false）', ...before }; target.goForward(); }
                else return { ok: false, op, error: `未知 op=${op}（back|forward）` };
              } catch (e) { return { ok: false, op, error: msgOf(e) }; }
              await new Promise((r) => setTimeout(r, 900));
              return { ok: true, op, before, after: inputPageMeta(target) };
            },
            'wait': async function (svc, c) {
              // R-WAIT：等待原语（agent 自动化必需）——selector / text / url / load / fn，带超时。
              // 实现：**页面内轮询**（一次 executeJavaScript 返回 Promise），避免命令通道往返放大延迟。
              const kind = String((c && c.waitFor) || (c && c.kind) || 'selector').toLowerCase();
              const value = String((c && (c.value != null ? c.value : c.selector)) || '');
              const timeoutMs = Math.min(60000, Math.max(200, Number((c && c.timeoutMs) || 8000)));
              const target = inputTargetOf(c) || pickGuestEl();
              if (kind !== 'load' && kind !== 'url' && !value) return { ok: false, error: `wait 类型 ${kind} 需要 value` };
              const expr = `(function () {\n`
                + `  var kind = ${JSON.stringify(kind)};\n`
                + `  var value = ${JSON.stringify(value)};\n`
                + `  var deadline = Date.now() + ${timeoutMs};\n`
                + `  function check() {\n`
                + `    try {\n`
                + `      if (kind === 'selector') return !!document.querySelector(value);\n`
                + `      if (kind === 'text') return ((document.body && document.body.innerText) || '').indexOf(value) >= 0;\n`
                + `      if (kind === 'url') return location.href.indexOf(value) >= 0;\n`
                + `      if (kind === 'load') return document.readyState === 'complete';\n`
                + `      if (kind === 'fn') return !!new Function('return (' + value + ')')();\n`
                + `      return false;\n`
                + `    } catch (e) { return false; }\n`
                + `  }\n`
                + `  return new Promise(function (resolve) {\n`
                + `    var t0 = Date.now();\n`
                + `    if (check()) { resolve({ ok: true, matched: true, waitedMs: 0, kind: kind, value: value, url: location.href }); return; }\n`
                + `    var iv = setInterval(function () {\n`
                + `      if (check()) { clearInterval(iv); resolve({ ok: true, matched: true, waitedMs: Date.now() - t0, kind: kind, value: value, url: location.href }); return; }\n`
                + `      if (Date.now() > deadline) { clearInterval(iv); resolve({ ok: true, matched: false, waitedMs: Date.now() - t0, kind: kind, value: value, url: location.href }); }\n`
                + `    }, 120);\n`
                + `  });\n`
                + `})()`;
              try {
                const r = await target.executeJavaScript(expr, true);
                // 页面被导航时 executeJavaScript 可能抛（旧文档销毁）：按「未匹配」回报，别当致命错误
                if (!r || typeof r !== 'object') return { ok: true, matched: false, kind, value, note: '页面执行未返回（可能正在导航）' };
                return { ...r, tab: Number.isFinite(Number(c && c.tab)) ? Number(c.tab) : null };
              } catch (e) {
                return { ok: true, matched: false, kind, value, error: msgOf(e) };
              }
            },
            'select': async function (svc, c) {
              // R-FORM：下拉选择（原生 setter + input/change，兼容受控组件）。
              const target = inputTargetOf(c) || pickGuestEl();
              const sel = c && c.ref != null ? `[data-dsh-kit-ref="${Number(c.ref)}"]` : String((c && c.selector) || '');
              if (!sel) return { ok: false, error: '需要 ref 或 selector' };
              const want = String((c && c.value) != null ? c.value : '');
              const raw = await target.executeJavaScript(
                `(function () { var el = document.querySelector(${JSON.stringify(sel)}); if (!el) return JSON.stringify({ ok: false, error: 'no element' }); if (el.tagName !== 'SELECT') return JSON.stringify({ ok: false, error: 'not a SELECT: ' + el.tagName }); var opt = null; for (var i = 0; i < el.options.length; i++) { var o = el.options[i]; if (o.value === ${JSON.stringify(want)} || o.text === ${JSON.stringify(want)}) { opt = o; break; } } if (!opt) return JSON.stringify({ ok: false, error: 'option not found: ' + ${JSON.stringify(want)} }); Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, opt.value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return JSON.stringify({ ok: true, value: el.value, text: opt.text, index: opt.index }); })()`,
                true,
              );
              try { return { ...(typeof raw === 'string' ? JSON.parse(raw) : raw) }; } catch { return { ok: false, error: '结果解析失败' }; }
            },
            'element': async function (svc, c) {
              // R-REF：按 ref/selector 读「元素档案」（点击/输入前的核对手段；对齐 ZCode BrowserCommand 的
              // elementInfo）。返回 tag/id/class/文本/值/禁用/勾选/属性 + 几何与**遮挡情况**。
              // 失效 ref 的语义：解析不到就明确报错并提示重取快照——**绝不猜、不点错东西**。
              const target = inputTargetOf(c) || pickGuestEl();
              const sel = c && c.ref != null ? `[data-dsh-kit-ref="${Number(c.ref)}"]` : String((c && c.selector) || '');
              if (!sel) return { ok: false, error: '需要 ref 或 selector' };
              const box = await resolveInputBox(target, c);
              const raw = await target.executeJavaScript(
                `(function () { var el = document.querySelector(${JSON.stringify(sel)}); if (!el) return JSON.stringify({ ok: false, error: 'no element: ' + ${JSON.stringify(sel)} }); var attrs = {}; for (var i = 0; i < el.attributes.length && i < 24; i++) { attrs[el.attributes[i].name] = String(el.attributes[i].value).slice(0, 80); } return JSON.stringify({ ok: true, tag: el.tagName.toLowerCase(), id: el.id || null, cls: String(el.className || '').slice(0, 120), text: String(el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120), value: ('value' in el) ? String(el.value).slice(0, 80) : null, disabled: !!el.disabled, checked: ('checked' in el) ? !!el.checked : null, snapRef: el.getAttribute('data-dsh-kit-ref') || null, attrs: attrs }); })()`,
                true,
              );
              let info = raw;
              try { if (typeof raw === 'string') info = JSON.parse(raw); } catch { info = { ok: false, error: '档案解析失败' }; }
              if (!info || info.ok === false) {
                return { ok: false, error: (info && info.error) || 'no element', hint: 'DOM 可能已变化：请重新 browser_snapshot 取新 ref（ref 只对最近一次快照有效）' };
              }
              return {
                ok: true,
                selector: sel,
                ...info,
                box: box && box.ok ? { x: box.x, y: box.y, w: box.w, h: box.h, inViewport: box.inViewport, occluded: box.occluded, occluder: box.occluder } : null,
                url: inputPageMeta(target).url,
              };
            },
            'check': async function (svc, c) {
              // R-FORM：勾选/取消勾选（含 radio：按组处理）。DOM 事件 + 可选可信点击。
              const target = inputTargetOf(c) || pickGuestEl();
              const sel = c && c.ref != null ? `[data-dsh-kit-ref="${Number(c.ref)}"]` : String((c && c.selector) || '');
              if (!sel) return { ok: false, error: '需要 ref 或 selector' };
              const want = c && typeof c.checked === 'boolean' ? c.checked : true;
              const raw = await target.executeJavaScript(
                `(function () { var el = document.querySelector(${JSON.stringify(sel)}); if (!el) return JSON.stringify({ ok: false, error: 'no element' }); if (!(el instanceof HTMLInputElement) || (el.type !== 'checkbox' && el.type !== 'radio')) return JSON.stringify({ ok: false, error: 'not checkbox/radio: ' + (el.tagName + '/' + (el.type || '')) }); var before = !!el.checked; if (before !== ${want ? 'true' : 'false'}) { el.click(); } return JSON.stringify({ ok: true, before: before, after: !!el.checked, value: el.value || null }); })()`,
                true,
              );
              try { return { ...(typeof raw === 'string' ? JSON.parse(raw) : raw) }; } catch { return { ok: false, error: '结果解析失败' }; }
            },
            'agent-view': async function (svc, c) {
              /* R-OWN：插件自持浏览器视图（**不占会话、不碰侧栏**）。
               * op: open（建/复用）| navigate | expand | collapse | toggle | resolution | screenshot | close | status | cleanup
               * 参数：url / resolution（预设名或 WxH）/ dpr / storageIdentity（登录态复用：缺省自动探测侧栏身份） */
              const op = String((c && c.op) || 'status').toLowerCase();
              const layoutInfo = () => { try { return applyAgentViewLayout(); } catch { return null; } };
              if (op === 'status') {
                return {
                  ok: true, op, ...agentViewStatus(), rect: agentViewRect(), layout: layoutInfo(),
                  carrier: !!agentViewCarrier(), boot: agentView.boot || null, openErr: agentView.openErr || null,
                  activity: {
                    operating: !!(agentView.lastOpAt && Date.now() - agentView.lastOpAt <= AGENT_VIEW_IDLE_MS),
                    idleMs: agentView.lastOpAt ? Date.now() - agentView.lastOpAt : null,
                    idleReleaseMs: agentView.idleReleaseMs,
                    releasedForIdle: agentView.releasedForIdle,
                  },
                  presets: Object.keys(AGENT_VIEW_PRESETS).map((k) => AGENT_VIEW_PRESETS[k].label),
                  sidebarPartitions: sidebarPartitions(),
                };
              }
              if (op === 'close') return { ok: true, op, ...releaseAgentView(), ...agentViewStatus() };
              // ── 多窗口（R-OWN v8）──
              if (op === 'tabs') return { ok: true, op, ...agentViewStatus() };
              if (op === 'tab-new') {
                try {
                  if (!agentView.panel) await ensureAgentView(c || {});
                  const tab = await newAgentTab({ url: (c && c.url) ? String(c.url) : null });
                  touchAgentView();
                  return { ok: true, op, tabId: tab.id, url: tab.url || null, ...agentViewStatus() };
                } catch (e) { return { ok: false, op, error: msgOf(e) }; }
              }
              if (op === 'tab-close') {
                const wantId = c && (c.tabId || c.tab);
                const id = wantId ? String(wantId) : (agentView.activeId || null);
                if (!id) return { ok: false, op, error: '没有可关闭的窗口' };
                if (!wantId && (agentView.tabs || []).length > 1) {
                  // 不带 tabId 时只关活动窗口
                }
                const r = closeAgentTab(id);
                return { ok: !!(r && r.ok), op, ...r, ...agentViewStatus() };
              }
              if (op === 'tab-select') {
                const id = c && (c.tabId || c.tab) ? String(c.tabId || c.tab) : null;
                if (!id) return { ok: false, op, error: '需要 tabId', tabs: (agentView.tabs || []).map((t) => t.id) };
                const tab = setActiveAgentTab(id);
                if (!tab) return { ok: false, op, error: `窗口不存在：${id}` };
                touchAgentView();
                return { ok: true, op, tabId: tab.id, ...agentViewStatus() };
              }
              if (op === 'annotate') {
                // 把当前自持窗口加入/退出**共享批注**（与会话浏览器同一批注）；on/off/toggle
                const el2 = agentViewWebview();
                if (!el2) return { ok: false, op, error: '自持窗口未打开（先 op:"open"）' };
                const want = c && c.on != null ? (c.on === true || c.on === 'true' ? 'on' : 'off') : 'toggle';
                const st = stateRef.annot;
                const joined = !!(st && st.active && (st.panes || []).some((p) => paneIdOf(p) === paneIdOf(el2)));
                if ((want === 'on' && joined) || (want === 'off' && !joined)) return { ok: true, op, joined, unchanged: true };
                const r = await togglePaneAnnot(el2);
                return { ok: !!(r && r.ok), op, joined: !!(r && (r.joined === true || r.started === true)), sessionActive: !!(stateRef.annot && stateRef.annot.active), error: r && r.error };
              }
              if (op === 'open') {
                try {
                  if (c && c.idleReleaseMs == null) { /* 保持默认 10 分钟 */ }
                  await ensureAgentView(c || {});
                  if (c && c.url) await navigateAgentView(String(c.url), c);
                  touchAgentView();
                  return { ok: true, op, ...agentViewStatus(), rect: agentViewRect(), layout: layoutInfo() };
                } catch (e) { agentView.openErr = msgOf(e); return { ok: false, op, error: msgOf(e) }; }
              }
              if (op === 'navigate') {
                const url = String((c && c.url) || '');
                if (!url) return { ok: false, op, error: '需要 url' };
                try { const r = await navigateAgentView(url, c); touchAgentView(); return { ok: true, op, ...r }; }
                catch (e) { return { ok: false, op, error: msgOf(e) }; }
              }
              if (op === 'expand' || op === 'collapse' || op === 'toggle') {
                if (!agentViewWebview()) return { ok: false, op, error: '自持窗口未打开（先 op:"open"）' };
                const cur = (agentView.ui && agentView.ui.state) || 'collapsed';
                const next = op === 'expand' ? 'expanded' : op === 'collapse' ? 'collapsed' : (cur === 'expanded' ? 'collapsed' : 'expanded');
                agentView.ui = { ...(agentView.ui || {}), state: next };
                return { ok: true, op, ...agentViewStatus(), layout: layoutInfo(), rect: agentViewRect() };
              }
              if (op === 'fit') {
                // 显示尺度：默认 100%（不缩放）；fit:true 缩放到装得下（兼容旧行为）
                if (!agentViewWebview()) return { ok: false, op, error: '自持窗口未打开（先 op:"open"）' };
                agentView.ui = { ...(agentView.ui || {}), fit: c && c.fit !== false };
                return { ok: true, op, fit: agentView.ui.fit, layout: layoutInfo(), rect: agentViewRect() };
              }
              if (op === 'zoom') {
                // 页面缩放（等同 Chrome 缩放，setZoomFactor；0.25–5）
                if (!agentViewWebview()) return { ok: false, op, error: '自持窗口未打开（先 op:"open"）' };
                const raw = c && (c.zoomPct != null ? Number(c.zoomPct) / 100 : Number(c.zoom));
                if (!Number.isFinite(raw) || raw <= 0) return { ok: false, op, error: '需要 zoom（如 1.25 或 zoomPct 125）' };
                agentView.ui = { ...(agentView.ui || {}), zoom: Math.min(5, Math.max(0.25, raw)) };
                const st = agentViewStatus();
                return { ok: true, op, zoom: st.zoom, layout: layoutInfo(), rect: agentViewRect() };
              }
              if (op === 'resolution') {
                if (!agentViewWebview()) return { ok: false, op, error: '自持窗口未打开（先 op:"open"）' };
                const want = String((c && c.resolution) || '');
                if (!want) return { ok: false, op, error: '需要 resolution（预设名如 2K/4K/1080p/iPhone 15 Pro，或自定义如 1440x900）', presets: Object.keys(AGENT_VIEW_PRESETS) };
                agentView.ui = {
                  ...(agentView.ui || {}),
                  preset: want,
                  dpr: c && c.dpr != null ? Number(c.dpr) : null,
                  fit: c && c.fit != null ? c.fit === true : (agentView.ui && agentView.ui.fit) === true,
                };
                const st = agentViewStatus();
                return { ok: true, op, resolution: st.resolution, preset: st.preset, dpr: st.dpr, layout: layoutInfo(), rect: agentViewRect() };
              }
              if (op === 'idle') {
                // 空闲释放策略（毫秒；0 = 不自动释放）
                if (c && c.idleReleaseMs != null) agentView.idleReleaseMs = Math.max(0, Number(c.idleReleaseMs));
                return { ok: true, op, idleReleaseMs: agentView.idleReleaseMs, releasedForIdle: agentView.releasedForIdle };
              }
              if (op === 'screenshot') {
                // R-OWN：**把自持窗口当前画面截下来**（供 Agent 视觉分析/布局复刻）——复用截图护栏；
                // clipboard:true 时同时写入系统剪贴板
                if (!agentViewWebview()) return { ok: false, op, error: '自持窗口未打开（先 op:"open"）' };
                const r = await captureShot({ target: 'agent', clipboard: c && c.clipboard === true, insertToComposer: c && c.insertToComposer === true });
                return { ok: !!(r && r.ok), op, path: r && r.path, bytes: r && r.bytes, clipboard: r && r.clipboard, composer: r && r.composer, error: r && r.error, resolution: agentViewStatus().resolution, dpr: agentViewStatus().dpr };
              }
              if (op === 'cleanup') {
                // 清理游离/重复的自持视图实例（热换残留），保留当前收养的那个
                const r = adoptOrCleanAgentView();
                agentView.boot = r;
                return { ok: true, op, ...r, ...agentViewStatus() };
              }
              return { ok: false, op, error: `未知 op=${op}（open|navigate|expand|collapse|toggle|resolution|zoom|fit|screenshot|idle|tabs|tab-new|tab-close|tab-select|annotate|close|status|cleanup）` };
            },
            'storage': async function (svc, c) {
              /* R-P2：页内存储读写（无 CDP 也能用）。op: get|set|remove|clear；kind: local|session|cookie。
               * cookie 只看得到非 HttpOnly 的（HttpOnly 需要 CDP，本环境不可达——如实说明）。 */
              const target = inputTargetOf(c) || pickGuestEl();
              const op = String((c && c.op) || 'get').toLowerCase();
              const kind = String((c && c.kind) || 'local').toLowerCase();
              const key = c && c.key != null ? String(c.key) : '';
              const value = c && c.value != null ? String(c.value) : '';
              if (!['get', 'set', 'remove', 'clear'].includes(op)) return { ok: false, error: `未知 op=${op}（get|set|remove|clear）` };
              if (!['local', 'session', 'cookie'].includes(kind)) return { ok: false, error: `未知 kind=${kind}（local|session|cookie）` };
              if ((op === 'set' || op === 'remove') && !key) return { ok: false, error: `op=${op} 需要 key` };
              const raw = await target.executeJavaScript(
                `(function () {\n`
                + `  var kind = ${JSON.stringify(kind)}, op = ${JSON.stringify(op)}, key = ${JSON.stringify(key)}, value = ${JSON.stringify(value)};\n`
                + `  if (kind === 'cookie') {\n`
                + `    var readCookies = function () { var out = {}; String(document.cookie || '').split(';').forEach(function (p) { var i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }); return out; };\n`
                + `    var del = function (k) { document.cookie = encodeURIComponent(k) + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'; };\n`
                + `    if (op === 'get') { var all = readCookies(); return JSON.stringify({ ok: true, kind: kind, count: Object.keys(all).length, cookies: all, note: 'HttpOnly cookie 不可见（需 CDP）' }); }\n`
                + `    if (op === 'set') { document.cookie = encodeURIComponent(key) + '=' + encodeURIComponent(value) + '; path=/'; }\n`
                + `    if (op === 'remove') { del(key); }\n`
                + `    if (op === 'clear') { var ks = Object.keys(readCookies()); ks.forEach(del); return JSON.stringify({ ok: true, kind: kind, cleared: ks.length }); }\n`
                + `    return JSON.stringify({ ok: true, kind: kind, op: op, count: Object.keys(readCookies()).length });\n`
                + `  }\n`
                + `  var s = kind === 'session' ? window.sessionStorage : window.localStorage;\n`
                + `  if (!s) return JSON.stringify({ ok: false, error: kind + ' 不可用' });\n`
                + `  if (op === 'get') {\n`
                + `    if (key) { var v = s.getItem(key); return JSON.stringify({ ok: true, kind: kind, key: key, value: v, found: v !== null }); }\n`
                + `    var out = {}; for (var i = 0; i < s.length && i < 200; i++) { var k = s.key(i); out[k] = String(s.getItem(k)).slice(0, 200); }\n`
                + `    return JSON.stringify({ ok: true, kind: kind, count: s.length, items: out });\n`
                + `  }\n`
                + `  if (op === 'set') { s.setItem(key, value); return JSON.stringify({ ok: true, kind: kind, key: key, value: s.getItem(key) }); }\n`
                + `  if (op === 'remove') { s.removeItem(key); return JSON.stringify({ ok: true, kind: kind, removed: key }); }\n`
                + `  var n = s.length; s.clear(); return JSON.stringify({ ok: true, kind: kind, cleared: n });\n`
                + `})()`,
                true,
              );
              let info = raw;
              try { if (typeof raw === 'string') info = JSON.parse(raw); } catch { info = { ok: false, error: '结果解析失败' }; }
              return { ...info, url: inputPageMeta(target).url };
            },
            'upload': async function (svc, c) {
              /* R-P2：文件上传——**DOM 注入 File + DataTransfer**（等价 CDP 的 DOM.setFileInputFiles，
               * 本环境没有 CDP，但这条路径对多数框架有效）。base64 上限 4MB（命令通道是本地文件，不占模型 token）。 */
              const target = inputTargetOf(c) || pickGuestEl();
              const sel = c && c.ref != null ? `[data-dsh-kit-ref="${Number(c.ref)}"]` : String((c && c.selector) || '');
              if (!sel) return { ok: false, error: '需要 ref 或 selector' };
              const b64 = String((c && c.base64) || '');
              if (!b64) return { ok: false, error: '需要 base64（文件内容）' };
              if (b64.length > 4 * 1024 * 1024) return { ok: false, error: `文件过大：base64 ${b64.length} 字节 > 4MB 上限` };
              const name = String((c && c.name) || 'upload.bin').slice(0, 120);
              const mime = String((c && c.mimeType) || 'application/octet-stream').slice(0, 120);
              const raw = await target.executeJavaScript(
                `(function () {\n`
                + `  var el = document.querySelector(${JSON.stringify(sel)});\n`
                + `  if (!el) return JSON.stringify({ ok: false, error: 'no element: ' + ${JSON.stringify(sel)} });\n`
                + `  if (el.tagName !== 'INPUT' || el.type !== 'file') return JSON.stringify({ ok: false, error: 'not a file input: ' + el.tagName + '/' + (el.type || '') });\n`
                + `  try {\n`
                + `    var bin = atob(${JSON.stringify(b64)});\n`
                + `    var arr = new Uint8Array(bin.length);\n`
                + `    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);\n`
                + `    var file = new File([arr], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });\n`
                + `    var dt = new DataTransfer(); dt.items.add(file); el.files = dt.files;\n`
                + `    el.dispatchEvent(new Event('input', { bubbles: true }));\n`
                + `    el.dispatchEvent(new Event('change', { bubbles: true }));\n`
                + `    return JSON.stringify({ ok: true, name: file.name, size: file.size, filesCount: el.files.length, accept: el.getAttribute('accept') || null });\n`
                + `  } catch (e) { return JSON.stringify({ ok: false, error: String((e && e.message) || e) }); }\n`
                + `})()`,
                true,
              );
              let info = raw;
              try { if (typeof raw === 'string') info = JSON.parse(raw); } catch { info = { ok: false, error: '结果解析失败' }; }
              return { ...info, url: inputPageMeta(target).url };
            },
            'find': async function (svc, c) {
              /* R-P2：页内查找（**省 token**）——大页面里按文本/选择器只回匹配项与其路径，
               * 而不是把整份快照丢进上下文。mode: elements（默认，带 ref）| text | links。 */
              const target = inputTargetOf(c) || pickGuestEl();
              const q = String((c && c.query) || '');
              if (!q) return { ok: false, error: '需要 query' };
              const mode = String((c && c.mode) || 'elements').toLowerCase();
              if (!['elements', 'text', 'links'].includes(mode)) return { ok: false, error: `未知 mode=${mode}（elements|text|links）` };
              const limit = Math.min(50, Math.max(1, Number((c && c.limit) || 10)));
              const raw = await target.executeJavaScript(
                `(function () {\n`
                + `  var q = ${JSON.stringify(q)}, mode = ${JSON.stringify(mode)}, LIMIT = ${limit};\n`
                + `  var re = null; try { re = new RegExp(q, 'i'); } catch (e) { re = null; }\n`
                + `  function match(s) { s = String(s || ''); return re ? re.test(s) : s.toLowerCase().indexOf(q.toLowerCase()) >= 0; }\n`
                + `  function path(el) { var out = []; var n = el; var d = 0; while (n && n.nodeType === 1 && d < 4) { var seg = n.tagName.toLowerCase() + (n.id ? '#' + n.id : ''); out.unshift(seg); n = n.parentElement; d++; } return out.join(' > '); }\n`
                + `  if (mode === 'links') {\n`
                + `    var ls = Array.prototype.slice.call(document.querySelectorAll('a[href]')).filter(function (a) { return match(a.textContent) || match(a.getAttribute('href')); }).slice(0, LIMIT);\n`
                + `    return JSON.stringify({ ok: true, mode: mode, query: q, count: ls.length, items: ls.map(function (a) { return { text: String(a.textContent || '').trim().slice(0, 80), href: a.href }; }) });\n`
                + `  }\n`
                + `  if (mode === 'text') {\n`
                + `    var body = (document.body && document.body.innerText) || '';\n`
                + `    var items = []; var idx = 0; var lower = q.toLowerCase(); var hay = body.toLowerCase();\n`
                + `    while (items.length < LIMIT) { var at = hay.indexOf(lower, idx); if (at < 0) break; items.push({ at: at, context: body.slice(Math.max(0, at - 60), at + 90).replace(/\\s+/g, ' ') }); idx = at + Math.max(1, lower.length); }\n`
                + `    return JSON.stringify({ ok: true, mode: mode, query: q, count: items.length, items: items, textLength: body.length });\n`
                + `  }\n`
                + `  var SEL = 'a[href],button,input,textarea,select,[role],h1,h2,h3,h4,[data-testid],[aria-label]';\n`
                + `  var els = Array.prototype.slice.call(document.querySelectorAll(SEL));\n`
                + `  var out = [];\n`
                + `  for (var i = 0; i < els.length && out.length < LIMIT; i++) {\n`
                + `    var el = els[i];\n`
                + `    if (el.closest && el.closest('[data-dsh-kit-ui]')) continue;\n`
                + `    var hay2 = [el.textContent, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('name')].join(' ');\n`
                + `    if (!match(hay2)) continue;\n`
                + `    var ref = out.length + 1; el.setAttribute('data-dsh-kit-ref', String(ref));\n`
                + `    var r = el.getBoundingClientRect();\n`
                + `    out.push({ ref: ref, tag: el.tagName.toLowerCase(), id: el.id || null, text: String(el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60), path: path(el), inViewport: r.top < innerHeight && r.bottom > 0 });\n`
                + `  }\n`
                + `  return JSON.stringify({ ok: true, mode: mode, query: q, count: out.length, scanned: els.length, items: out });\n`
                + `})()`,
                true,
              );
              let info = raw;
              try { if (typeof raw === 'string') info = JSON.parse(raw); } catch { info = { ok: false, error: '结果解析失败' }; }
              return { ...info, url: inputPageMeta(target).url };
            },
            'input': async function (svc, c) {
              // R-INPUT：可信输入统一入口（sendInputEvent）。op: click|dblclick|rightclick|hover|type|press|scroll
              const op = String((c && c.op) || 'click').toLowerCase();
              const target = inputTargetOf(c);
              if (!target) return { ok: false, op, error: '无 webview（先打开内置浏览器）' };
              if (typeof target.sendInputEvent !== 'function') return { ok: false, op, error: 'webview 不支持 sendInputEvent（Electron 版本？）' };
              focusGuest(target);
              if (op === 'click' || op === 'dblclick' || op === 'rightclick' || op === 'hover') return await trustedClick(target, c, op);
              if (op === 'type') return await trustedType(target, c);
              if (op === 'press') {
                // 键名映射到 Electron keyCode；未知名原样下发（字母/数字直接用 'a'/'1'）
                const map = { Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Space: 'Space' };
                const key = String((c && c.key) || 'Enter');
                const keyCode = map[key] || key;
                const modifiers = Array.isArray(c && c.modifiers) ? c.modifiers : null;
                try {
                  target.sendInputEvent({ type: 'keyDown', keyCode, ...(modifiers ? { modifiers } : {}) });
                  target.sendInputEvent({ type: 'keyUp', keyCode, ...(modifiers ? { modifiers } : {}) });
                  return { ok: true, op, mode: 'trusted', key, keyCode, modifiers };
                } catch (e) { return { ok: false, op, error: msgOf(e) }; }
              }
              if (op === 'scroll') {
                const dx = Number((c && c.dx) || 0);
                const dy = Number((c && c.dy) || 0);
                const zoom = inputZoom(target);
                let x = Number(c && c.x);
                let y = Number(c && c.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                  let v = { w: 800, h: 600 };
                  try { v = JSON.parse(await target.executeJavaScript('JSON.stringify({ w: window.innerWidth, h: window.innerHeight })', true)); } catch { /* 用默认 */ }
                  x = v.w / 2; y = v.h / 2;
                }
                try {
                  /* 实测（Windows）：Electron `mouseWheel` 的 deltaY 与网页 `WheelEvent.deltaY` **符号相反**——
                   * 发 dy:+220 页面收到 -220（不往下滚）；发 -220 页面收到 +220 并下滚。这里统一翻正，
                   * 让对外语义保持「dy 正数 = 向下」（与浏览器/工具描述一致）。 */
                  target.sendInputEvent({ type: 'mouseWheel', x: Math.round(x * zoom), y: Math.round(y * zoom), deltaX: -dx, deltaY: -dy, canScroll: true });
                  let pos = null;
                  try { pos = JSON.parse(await target.executeJavaScript('JSON.stringify({ sx: window.scrollX, sy: window.scrollY })', true)); } catch { /* 忽略 */ }
                  return { ok: true, op, mode: 'trusted', dx, dy, scroll: pos };
                } catch (e) { return { ok: false, op, error: msgOf(e) }; }
              }
              return { ok: false, op, error: `未知 op=${op}（click|dblclick|rightclick|hover|type|press|scroll）` };
            },
            'click': async function (svc, c) {
              // R-INPUT：mode='trusted' 走 Chromium 级真事件（框架/反爬都认）；否则保持既有 DOM 合成语义
              if (String((c && c.mode) || '') === 'trusted') {
                const t = inputTargetOf(c);
                if (!t) return { ok: false, error: '无 webview（先打开内置浏览器）' };
                if (typeof t.sendInputEvent !== 'function') return { ok: false, error: 'webview 不支持 sendInputEvent' };
                return await trustedClick(t, c, 'click');
              }
              const target = pickGuestEl();
              const sel = c.ref != null ? `[data-dsh-kit-ref="${Number(c.ref)}"]` : String(c.selector || '');
              if (!sel) return { ok: false, error: '需要 ref 或 selector' };
              const value = await target.executeJavaScript(
                `(function () { ${TARGET_DOC_SNIPPET} var el = DOC.querySelector(${JSON.stringify(sel)}); if (!el) return { ok: false, error: 'no element' }; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 })); return { ok: true, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 60) }; })()`,
                true,
              );
              return { ok: true, ...(value || {}) };
            },
            'type': async function (svc, c) {
              // R-INPUT：mode='trusted' 走真键盘事件（含 clear/submit）；否则保持既有 DOM 写入语义
              if (String((c && c.mode) || '') === 'trusted') {
                const t = inputTargetOf(c);
                if (!t) return { ok: false, error: '无 webview（先打开内置浏览器）' };
                if (typeof t.sendInputEvent !== 'function') return { ok: false, error: 'webview 不支持 sendInputEvent' };
                return await trustedType(t, c);
              }
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
            },
            'page-inject': async function (svc, c) {
              // MVP-4：整页 HTML 注入 guest 顶层文档。innerHTML 原语（同步赋值）替代
              // document.write——后者在页面资源未静止时 executeJavaScript 会永久悬挂
              // （cmd-41/63 实测，P22）；实测在活跃 SPA 页面上持久可靠（v2 注入存活 30min+）；
              // iframe srcdoc 会被宿主 CSP 拦成空文档（本轮实测）。
              // 注意：页面自身的 SPA 框架在响应式刷新后可能重绘覆盖注入内容（公网 Vue 站点实测一次），
              // 注入后应立即使用/截图。历史教训：本 case 曾被复制成重复分支（switch 首个匹配生效，
              // 第二个是死代码、改它不生效）——case 唯一性已由静态契约钉死（§3.9）。
              const target = inputTargetOf(c) || pickGuestEl();
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
            },
            'reload': async function (svc, c) {
              // 同源刷新（不跨白名单）；不 await 完成事件（P19：跨导航的 Promise 永不决）
              const target = inputTargetOf(c) || pickGuestEl();
              target.executeJavaScript('location.reload()', true).catch(() => {});
              return { ok: true, reloading: true };
            },
            'navigate': async function (svc, c) {
              // 白名单内的源才可能成功（实测跨源被宿主静默拒绝）；fire-and-forget，两秒后回报 href
              const url = String(c.url || '');
              if (!url) return { ok: false, error: '需要 url' };
              const target = inputTargetOf(c) || pickGuestEl();
              target.executeJavaScript(`location.href = ${JSON.stringify(url)}`, true).catch(() => {});
              await sleep(2000);
              let href = null;
              try {
                href = await target.executeJavaScript('location.href', true);
              } catch { /* 导航成功时旧上下文已销毁，取不到属正常 */ }
              return { ok: true, requested: url, currentHref: href, note: '跨源导航受宿主白名单限制，可能被静默拒绝（须用户在 DSH UI 手动导航）' };
            },
            'screenshot': async function (svc, c) {
              return await captureShot(c);
            },
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
            },
            'hid-enumerate': async function (svc, c) {
              // R-HID：HID 桥诊断——host 侧 node-hid 枚举（绕开 select-hid-device 宿主缺口的系统层直连）。
              // 信封防御拆包：typert 信封 {ok,value} 可能双层（face 自己的 {ok,devices} 外再包一层），
              // 一路下钻到 devices 字段为止（P29 家族：形状假设错 = 静默失败）。
              const peel = (x) => (x && typeof x === 'object' && !Array.isArray(x) && x.devices ? x : x && typeof x === 'object' && x.value ? peel(x.value) : null);
              const r = peel(await svc.hidList());
              if (!r || r.ok !== true) return { ok: false, error: (r && r.error) || 'hidList 失败（信封形状见 kit-status hidPeek）' };
              return { ok: true, count: r.devices.length, devices: r.devices.slice(0, 40) };
            },
            'hid-open': async function (svc, c) {
              // R-HID：按 vendorId/productId 打开第一个匹配设备（诊断/调试用；正式流程走 polyfill）。
              // P43：统一走 faceUnwrap（信封剥离只看 {ok,value} 形状）——此前 hidRead 以「ok 字段存在」
              // 当拆包谓词，命中外层信封导致 firstRead 永远「无 data」，诊断结论被带偏。
              const list = faceUnwrap(await svc.hidList());
              if (!list || list.ok !== true) return { ok: false, error: 'hidList 失败' };
              const vid = Number(c && c.vendorId), pid = Number(c && c.productId);
              const dev = list.devices.find((d) => d.vendorId === vid && d.productId === pid);
              if (!dev) return { ok: false, error: 'no matching device (vid=' + c.vendorId + ' pid=' + c.productId + ')' };
              const opened = faceUnwrap(await svc.hidOpen(dev.path));
              if (!opened || opened.ok !== true) return opened || { ok: false, error: 'hidOpen 失败' };
              const read = faceUnwrap(await svc.hidRead(opened.handleId, Number(c && c.readMs) || 300));
              return { ok: true, handleId: opened.handleId, device: dev.product, firstRead: read && read.data ? read.data : read };
            },
            'hid-trace': async function (svc, c) {
              // R-COMM：桥收发十六进制 trace（通讯调试——写/读字节流按序回放）
              const r = faceUnwrap(await svc.hidTrace());
              if (!r || r.ok !== true) return { ok: false, error: 'hidTrace 失败' };
              return { ok: true, count: r.trace.length, trace: r.trace.slice(-60), handles: r.handles || [] };
            }

          };

          /* Agent 操作光效打点集合（R-GLOW）：**在分发器统一打点**，新增浏览器命令无需逐个改 handler。
           * 只收「会动页面 / Agent 在操作浏览器」的动作；纯盘点类（browser-tabs/panes-probe/dom-scan/
           * kit-status/toolbar-probe/hid-*）不打点，免得用户屏幕上一直闪。 */
          const AGENT_GLOW_ACTIONS = new Set(['navigate', 'reload', 'click', 'type', 'page-inject', 'screenshot', 'snapshot', 'browser-open', 'browser-close', 'browser-panel', 'input', 'history', 'select', 'check', 'storage', 'upload', 'find']);

          /** 命令分发：查表执行；未知 action 显式报错（不静默）。 */
          const executeCommand = async (svc, command) => {
            const c = command && typeof command === 'object' ? command : {};
            const action = String(c.action || '');
            try {
              const handler = commandHandlers[action];
              if (!handler) return { ok: false, error: `未知命令 action=${action}` };
              // R-SCOPE：会话隔离/用户输入守卫（拒绝时如实说明，不静默、不误伤别的会话）
              const denied = scopeCheck(action, c);
              if (denied) return denied;
              if (AGENT_GLOW_ACTIONS.has(action)) { stateRef.agentGlow.sessionId = c && c.sessionId ? String(c.sessionId) : null; pulseAgentActivity(action); }
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
          /* 注（R-OWN v23 实测）：不要在此处启动 1s 的 `startAgentViewIdleTick` —— 它定义在
           * 「自持窗口 open 路径」的作用域里，此处**取不到**（`typeof` 为 undefined，静默无效）；
           * 而批注镜像已改由**必定在跑**的 2s tick 驱动（见主 tick 内 syncAnnotMirror 注释），
           * 因此不需要它也必须在。这里保留一行说明，避免后来者再走一次弯路。 */
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
          /* ── R-CAP（2026-10-09 止血）：`<webview>.capturePage()` 的 V8 FATAL 防护 ──
           * 事实：ZCode 源码注释「走 CDP Page.captureScreenshot（**规避 renderer webContents.capturePage
           *   的 V8 FATAL**）」；本机实测裸调后 DSH 进程崩溃重启（pitfalls P47-B）。
           * 防护四件套：①**单飞**（并发 capture 是最危险形态）；②**最小间隔冷却**；③**只截可见且足够大
           *   的面板**（隐藏/未挂载 surface 是已知挂死场景）；④**超时竞速**——挂住的 capture 不许拖死插件。
           * 外挂**崩溃回环断路器**：capture 前落 attempt 标记、成功后清除；下次 client 启动若见标记
           *   = 上一进程死于截图 → 关掉「自动截图」（手动截图仍可用，由人不带循环地试）。
           */
          const CAPTURE_MIN_GAP = 1500;
          const CAPTURE_TIMEOUT = 8000;
          const CAPTURE_ATTEMPT_KEY = 'dsh-browser-kit:capture-attempt:v1';
          let captureInFlight = false;
          let captureCooldownUntil = 0;
          const captureVisible = (el) => {
            try {
              const r = el.getBoundingClientRect();
              return r.width >= 80 && r.height >= 80 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
            } catch { return false; }
          };
          // 断路器：上次进程死于截图 → 本次启动不自动截
          try {
            const att = localStorage.getItem(CAPTURE_ATTEMPT_KEY);
            if (att) {
              stateRef.autoShotLeft = 0;
              stateRef.captureCrashMarker = att;
              try { console.warn(`${LOG_PREFIX} 上次截图未完成（疑似 capturePage 崩溃）：已关闭自动截图`, att); } catch { /* 静默 */ }
            }
          } catch { /* localStorage 不可用：跳过断路器 */ }

          /* ── 截图复制到剪贴板（2026-10-10 用户要求）──
           * 实测（本机 Electron）：`new ClipboardItem({'image/png': blob})` 若 blob 来自
           * `fetch(dataURL)` 或手搓 `new Blob([Uint8Array])` 会报
           * `DataError: Failed to read or decode ClipboardItemData`；而
           * ①`canvas.toBlob` 得到的 blob → `clipboard.write` **可用**；
           * ②选中 `<img>` 后 `document.execCommand('copy')` **也可用**。
           * 已用 PowerShell `[Windows.Forms.Clipboard]::GetImage()` 独立核验剪贴板确为图片。
           * 故按 ①→② 顺序回退。 */
          const copyPngToClipboard = async (dataUrl) => {
            const u = String(dataUrl || '');
            if (u.indexOf('data:image') !== 0) return { ok: false, error: '不是图片 dataURL' };
            let img = null;
            try {
              img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error('图片解码失败'));
                el.src = u;
              });
            } catch (e) { return { ok: false, error: msgOf(e) }; }
            // 路径①：canvas.toBlob → ClipboardItem
            try {
              const cv = document.createElement('canvas');
              cv.width = img.naturalWidth || img.width;
              cv.height = img.naturalHeight || img.height;
              const ctx2d = cv.getContext('2d');
              ctx2d.drawImage(img, 0, 0);
              const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
              if (blob && navigator.clipboard && typeof ClipboardItem === 'function') {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                return { ok: true, method: 'clipboard-write', size: `${cv.width}×${cv.height}`, bytes: blob.size };
              }
            } catch { /* 落到路径② */ }
            // 路径②：execCommand('copy') 选中 <img>
            try {
              const host = document.createElement('div');
              host.setAttribute('contenteditable', 'true');
              host.style.cssText = 'position:fixed;left:-9999px;top:0;';
              const im = document.createElement('img');
              im.src = u;
              host.appendChild(im);
              document.body.appendChild(host);
              const range = document.createRange();
              range.selectNodeContents(host);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              const ok = document.execCommand('copy');
              sel.removeAllRanges();
              host.remove();
              if (ok) return { ok: true, method: 'execCommand', size: `${img.naturalWidth || img.width}×${img.naturalHeight || img.height}` };
            } catch (e) { return { ok: false, error: msgOf(e) }; }
            return { ok: false, error: '剪贴板写入失败（两条路径均不可用）' };
          };

          /* ── 截图「直接输入到输入框」（2026-10-10 用户要求：不再走剪贴板）──
           * ① 首选：把 PNG 包成 `File`，构造 `ClipboardEvent('paste')` 派发到会话输入框
           *   （DSH 输入框是 Lexical，粘贴图片即成为附件；synthetic 事件在 contenteditable 上实测可用）；
           * ② 回退：把落盘路径当文本追加进输入框（`primeSessionInput`，P30 纪律：只追加不覆盖）。
           * 校验**必须延迟**（Lexical 异步 reconcile，同步回读必误报，同 P30）。
           * 绝不清理/覆盖用户已有内容。 */
          const composerImageCount = () => {
            try {
              const ce = findComposer();
              if (!ce) return 0;
              const scope = ce.closest('[data-composer-card]') || ce.parentElement || ce;
              let n = 0;
              /* ★实测坑：输入框卡片里本来就有 DSH 自己的图标（`data:image/svg+xml…`，18×18），
               * 先前把它们也计入 ⇒ 「粘贴成功」被判成失败 ⇒ 又补发一次 drop ⇒ **一次点击插入 2 张**
               * （用户实测反馈）。故：排除 svg 图标，并把背景图/附件 chip 也计进来。 */
              for (const im of Array.from(scope.querySelectorAll('img'))) {
                const src = String(im.getAttribute('src') || '');
                if (!src || /^data:image\/svg/i.test(src)) continue;
                n += 1;
              }
              n += scope.querySelectorAll('[data-attachment], [class*="attachment"], [style*="background-image"]').length;
              return n;
            } catch { return 0; }
          };
          /** 同一时刻只允许一次插入（防连点/防重复派发）。 */
          let composerInsertAt = 0;
          const insertImageToComposer = async (dataUrl, fileName) => {
            const out = { ok: false, via: null, verified: false, imagesBefore: 0, imagesAfter: 0, error: null };
            try {
              if (Date.now() - composerInsertAt < 1500) {
                out.error = '插入过于频繁（1.5s 内已插入过一次，已忽略以防重复插图）';
                return out;
              }
              out.imagesBefore = composerImageCount();
              const blob = await (await fetch(dataUrl)).blob();
              const file = new File([blob], fileName || `dsh-shot-${Date.now()}.png`, { type: 'image/png' });
              const ce = findComposer();
              const target = ce || document.activeElement || document.body;
              try { if (ce && ce.focus) ce.focus(); } catch { /* 忽略 */ }
              /** 只用于**报告**，绝不据此补发第二次插入（补发 = 双插，实测踩过）。 */
              const waitForImage = async () => {
                const t0 = Date.now();
                while (Date.now() - t0 < 4000) {
                  await new Promise((r) => setTimeout(r, 250));
                  out.imagesAfter = composerImageCount();
                  if (out.imagesAfter > out.imagesBefore) return true;
                }
                return false;
              };
              /* 路径①：paste。`dispatchEvent` 返回 false 表示编辑器 `preventDefault()` = **已接管**，
               * 此时**绝不再发 drop**；只有返回 true（没人处理）或抛错才尝试路径②。 */
              let handled = false;
              try {
                const dt = new DataTransfer();
                dt.items.add(file);
                const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
                handled = target.dispatchEvent(ev) === false;
                out.via = 'paste-image';
              } catch { handled = false; }
              if (!handled) {
                try {
                  const dt2 = new DataTransfer();
                  dt2.items.add(new File([blob], file.name, { type: 'image/png' }));
                  const root = (ce && (ce.closest('[data-lexical-editor]') || ce)) || target;
                  root.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
                  handled = true;
                  out.via = 'drop-image';
                } catch { handled = false; }
              }
              composerInsertAt = Date.now();
              if (!handled) {
                out.error = '图片插入输入框失败（paste/drop 均未被编辑器接管）';
                return out;
              }
              out.ok = true;
              out.verified = await waitForImage(); // 仅观测
              return out;
            } catch (e) {
              out.error = msgOf(e);
              return out;
            }
          };

          const captureShot = async (ctxCmd) => {
            const out = { ok: false, error: null, path: null, bytes: null };
            let restoreCollapsed = false;
            try {
              if (captureInFlight) { out.error = '已有截图在进行（单飞护栏）'; return out; }
              const nowAt = Date.now();
              if (nowAt < captureCooldownUntil) { out.error = `截图冷却中（剩 ${captureCooldownUntil - nowAt}ms）`; return out; }
              /* R-OWN v16：**小窗状态下也能截图**（用户要求：保持小窗即可完成打开网址/调分辨率/自动化/截图）。
               * capturePage 对隐藏/零尺寸面高危（P47-B），且"可见性检查"在**选目标时就执行**——
               * 所以必须**先临时展开**再选目标，截完再收回小窗。 */
              try {
                const wantAgent = (ctxCmd && ctxCmd.target === 'agent')
                  || (ctxCmd && ctxCmd.el && ctxCmd.el === agentViewWebview());
                if (wantAgent && agentView.panel && agentView.ui && agentView.ui.state === 'collapsed') {
                  agentView.ui = { ...agentView.ui, state: 'expanded' };
                  applyAgentViewLayout();
                  restoreCollapsed = true;
                  await new Promise((r) => setTimeout(r, 320)); // 等一帧渲染，避免截到空白
                }
              } catch { restoreCollapsed = false; }
              // R-SCOPE/R-OWN：候选=自持窗口（默认优先）+ 本会话面板；target 可强制其一
              const wantShot = ctxCmd && ctxCmd.target ? String(ctxCmd.target) : null;
              const sessionEls = scopedWebviews(ctxCmd && ctxCmd.sessionId);
              const avShot = agentViewWebview();
              let cands;
              if (ctxCmd && ctxCmd.el) cands = [ctxCmd.el]; // 指定元素（UI 按钮用：精确截用户点的那块）
              else if (wantShot === 'agent') cands = avShot ? [avShot] : [];
              else if (wantShot === 'session') cands = sessionEls;
              else cands = (avShot ? [avShot] : []).concat(sessionEls.filter((x) => x !== avShot));
              // 只在**可见**面板上截：隐藏/后台 surface 是 capturePage 挂死/崩溃的高危场景
              const target = cands.find(captureVisible) || null;
              if (!target) {
                out.error = cands.length
                  ? '目标浏览器面板当前不可见（已拒绝：隐藏 surface 截图高危；自持窗口收起时请先 op:"expand"）'
                  : '无可见浏览器（可先调 browser_agent_window {op:"open", url} 开一个 Agent 自己的窗口）';
                return out;
              }
              captureInFlight = true;
              captureCooldownUntil = nowAt + CAPTURE_MIN_GAP;
              let meta = { url: null, title: null };
              try {
                // R2.2：复用 C8 共用表达式与归一化（曾自写 href 变体一份）
                meta = metaOf(await target.executeJavaScript(GUEST_META_JS, true)) || { url: null, title: null };
              } catch { /* 元数据失败不拦截图 */ }
              const attempt = JSON.stringify({ at: new Date().toISOString(), url: meta && meta.url ? meta.url : null });
              try { localStorage.setItem(CAPTURE_ATTEMPT_KEY, attempt); } catch { /* 尽力而为 */ }
              let img = null;
              try {
                img = await Promise.race([
                  target.capturePage(),
                  new Promise((_, rej) => setTimeout(() => rej(new Error('capturePage 超时（8s）——已放弃，防拖死插件')), CAPTURE_TIMEOUT)),
                ]);
              } catch (e) {
                // 超时的底层 promise 无法取消：额外冷却，避免与僵尸 capture 并发
                captureCooldownUntil = Date.now() + 10000;
                throw e;
              } finally {
                captureInFlight = false;
              }
              if (!img || typeof img.toDataURL !== 'function') throw new Error('capturePage 未返回图像');
              try { localStorage.removeItem(CAPTURE_ATTEMPT_KEY); } catch { /* 尽力而为 */ }
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
              out.url = meta && meta.url ? meta.url : null;
              // 复制到系统剪贴板（两条实测可用路径，见 copyPngToClipboard）
              if (ctxCmd && ctxCmd.clipboard) {
                out.clipboard = await copyPngToClipboard(dataUrl);
                if (!out.ok && out.clipboard && out.clipboard.ok) out.ok = true; // 落盘失败但剪贴板成功也算部分成功
              }
              // 直接输入到会话输入框（用户要求：截图不走剪贴板，进输入框）
              if (ctxCmd && ctxCmd.insertToComposer) {
                const fname = out.path ? String(out.path).split('\\').pop() : null;
                out.composer = await insertImageToComposer(dataUrl, fname);
                if (!out.ok && out.composer && out.composer.ok) out.ok = true;
              }
            } catch (e) {
              out.error = msgOf(e);
            }
            // R-OWN v16：截图完成 → 收回小窗（保持用户原来的"小窗状态"）
            if (restoreCollapsed) {
              try {
                agentView.ui = { ...(agentView.ui || {}), state: 'collapsed' };
                applyAgentViewLayout();
                out.restoredCollapsed = true;
              } catch { /* 忽略 */ }
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
              clearTimeout(stateRef.autoProbeTimer);
              stateRef.autoProbeTimer = setTimeout(() => {
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
              ensureAwayBanner,
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
            const toolbarForms = () => Array.from(document.querySelectorAll(TOOLBAR_SEL))
              .filter((f) => f.parentElement && f.parentElement.querySelector('webview'));
            const webviewOfForm = (form) => form.parentElement.querySelector('webview');
            /** 该面板所属会话 id（沿 DOM 上溯 `data-sidebar-right-session`）——用于身份探测。 */
            const sessionIdOfForm = (form) => {
              try {
                let n = form;
                for (let i = 0; i < 8 && n; i += 1, n = n.parentElement) {
                  const sid = n.getAttribute && n.getAttribute('data-sidebar-right-session');
                  if (sid) return sid;
                }
              } catch { /* 忽略 */ }
              return null;
            };
            /* ── 会话面板「设备尺寸」（2026-10-10 用户要求）──
             * 把 guest 视口设成预设分辨率，显示缩放**按当前浏览器板块的尺寸计算**（fit 到板块内）。 */
            const applyPaneDeviceSize = (pane, presetKey) => {
              if (!pane) return { ok: false, error: '无面板' };
              try {
                if (!presetKey || presetKey === 'reset') {
                  for (const p of ['width', 'height', 'min-width', 'max-width', 'transform', 'transform-origin']) {
                    try { pane.style.removeProperty(p); } catch { /* 忽略 */ }
                  }
                  pane.style.flex = '';
                  pane.style.transformOrigin = '';
                  try { delete pane.dataset.kitDevicePreset; } catch { /* 忽略 */ }
                  try { if (typeof pane.setZoomFactor === 'function') pane.setZoomFactor(1); } catch { /* 忽略 */ }
                  try { pane.dataset.kitZoomFactor = '1'; } catch { /* 忽略 */ }
                  syncAnnotMetrics(pane); // R-OWN v12/v13：重置后重新同步（回到按视口宽 + 缩放）
                  return { ok: true, reset: true };
                }
                const res = agentViewResolvePreset(presetKey);
                const host = pane.parentElement || pane;
                const hr = host.getBoundingClientRect();
                const availW = Math.max(200, Math.round(hr.width) - 2);
                const availH = Math.max(160, Math.round(hr.height) - 2);
                const k = Math.min(1, availW / res.w, availH / res.h);
                /* ★R-OWN v20：视口**严格等于预设**且元素**顶部对齐**（用户要求：页面保持在顶部，
                 *  下方留黑区给批注面板与自持小窗，避免遮挡网页内容）。 */
                /* ★实测坑：DSH 侧栏 webview 的宽度由 flex/百分比决定，普通 inline width 会被压回
                 * 面板原宽（style 写 393px，getBoundingClientRect 仍 1149px）⇒ 必须 `!important`。 */
                pane.style.setProperty('width', `${res.w}px`, 'important');
                pane.style.setProperty('height', `${res.h}px`, 'important'); // v19：**严格等于预设**，不做高度填充
                pane.style.setProperty('min-width', '0', 'important');
                pane.style.setProperty('max-width', 'none', 'important');
                pane.style.flex = '0 0 auto';
                pane.style.transformOrigin = 'top left';
                pane.style.setProperty('transform', `scale(${k})`, 'important'); // v20：顶部对齐，不再做底对齐位移
                try { if (typeof pane.setZoomFactor === 'function') pane.setZoomFactor(Number(res.dpr) || 1); } catch { /* 忽略 */ }
                try { pane.dataset.kitZoomFactor = String(Number(res.dpr) || 1); } catch { /* 忽略 */ } // v13：面板反缩放用（勿读 getZoomFactor，含显示器缩放）
                pane.dataset.kitDevicePreset = res.key;
                syncAnnotMetrics(pane); // R-OWN v12/v13：同步可见带 + 放大倍数（面板固定尺寸并落在可见区）
                return { ok: true, preset: res.key, resolution: `${res.w}×${res.h}`, scale: Number(k.toFixed(3)), paneW: availW, paneH: availH };
              } catch (e) { return { ok: false, error: msgOf(e) }; }
            };
            let paneDeviceMenu = null;
            /** 尺寸选择弹层（点尺寸图标弹出；选完即应用并关闭）。 */
            const openPaneDeviceMenu = (btn, pane) => {
              try { if (paneDeviceMenu) paneDeviceMenu.remove(); } catch { /* 忽略 */ }
              const dark = detectUiDark();
              const menu = document.createElement('div');
              menu.setAttribute('data-dsh-browser-kit-device-menu', '');
              menu.setAttribute('data-dsh-kit-ui', '');
              menu.style.cssText = 'position:fixed;z-index:2147483647;min-width:198px;max-height:60vh;overflow:auto;padding:4px;'
                + 'border-radius:8px;box-sizing:border-box;'
                + `font:${T.font};color-scheme:${dark ? 'dark' : 'light'};`
                + `background:${dark ? 'rgba(30,32,38,.98)' : 'rgba(250,250,252,.98)'};`
                + `color:${dark ? '#e7e9ee' : '#16181d'};border:1px solid ${T.border};box-shadow:${T.shadow};`;
              const cur = pane && pane.dataset ? pane.dataset.kitDevicePreset : null;
              const items = Object.keys(AGENT_VIEW_PRESETS).map((k) => ({ key: k, label: AGENT_VIEW_PRESETS[k].label }))
                .concat([{ key: 'reset', label: '重置（恢复自适应面板）' }]);
              for (const it of items) {
                const row = document.createElement('button');
                row.type = 'button';
                row.textContent = (it.key === cur ? '✓ ' : '') + it.label;
                row.style.cssText = 'display:block;width:100%;text-align:left;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;'
                  + `background:${it.key === cur ? 'rgba(56,189,248,.18)' : 'transparent'};color:inherit;font:${T.font};`;
                row.addEventListener('mouseenter', () => { row.style.background = 'rgba(128,128,128,.18)'; });
                row.addEventListener('mouseleave', () => { row.style.background = it.key === cur ? 'rgba(56,189,248,.18)' : 'transparent'; });
                row.addEventListener('click', () => {
                  const r = applyPaneDeviceSize(pane, it.key);
                  btn.title = r && r.ok
                    ? (r.reset ? '尺寸：已重置（自适应面板）' : `尺寸：${r.resolution} · 缩放 ${Math.round(r.scale * 100)}%（按板块 ${r.paneW}×${r.paneH} 计算）`)
                    : `尺寸设置失败：${(r && r.error) || '未知'}`;
                  try { menu.remove(); } catch { /* 忽略 */ }
                  paneDeviceMenu = null;
                });
                menu.appendChild(row);
              }
              document.body.appendChild(menu);
              /* 弹层**向下展开**（用户 2026-10-10 要求）——向上会与 DSH 右上角那堆图标/窗口控件
               * 重叠遮挡；下方空间不足时才翻到上方。 */
              const br = btn.getBoundingClientRect();
              const mh = menu.offsetHeight;
              const below = window.innerHeight - br.bottom - 8;
              const openUp = below < Math.min(mh, 120);
              menu.style.left = `${Math.max(8, Math.min(br.left - 40, window.innerWidth - 214))}px`;
              menu.style.top = openUp
                ? `${Math.max(8, br.top - mh - 6)}px`
                : `${Math.min(window.innerHeight - mh - 8, br.bottom + 6)}px`;
              paneDeviceMenu = menu;
              const onDown = (ev) => {
                if (menu.contains(ev.target) || ev.target === btn) return;
                try { menu.remove(); } catch { /* 忽略 */ }
                paneDeviceMenu = null;
                try { document.removeEventListener('mousedown', onDown, true); } catch { /* 忽略 */ }
              };
              setTimeout(() => { try { document.addEventListener('mousedown', onDown, true); } catch { /* 忽略 */ } }, 0);
              return menu;
            };
            /** 工具条按钮（批注 / 尺寸 / 截图到输入框），带 P37 认领戳。 */
            const mkToolbarBtn = (id, title, svg, first) => {
              const btn = document.createElement('button');
              btn.id = id;
              btn.dataset.ownerBoot = String(stateRef.clientBootAt); // P37 认领戳
              btn.type = 'button';
              btn.title = title;
              btn.style.cssText = (first ? 'margin-left:auto;' : '')
                + 'display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;border:0;border-radius:6px;'
                + 'background:transparent;color:inherit;cursor:pointer;flex:none;';
              btn.innerHTML = svg;
              return btn;
            };
            /** DSH 自带的「系统浏览器打开」按钮（图标颜色参照物）。 */
            const sysBrowserBtnOf = (form) => {
              try {
                return Array.from(form.querySelectorAll('button')).find((bb) => {
                  if (bb.id && bb.id.indexOf('dsh-kit') === 0) return false;
                  const t = `${bb.getAttribute('title') || ''} ${bb.getAttribute('aria-label') || ''}`;
                  return /系统浏览器|浏览器中打开|浏览器打开|BROWSER/i.test(t);
                }) || null;
              } catch { return null; }
            };
            /** R-OWN v15：让我们注入的图标与 DSH 自带图标**同色**（两种主题都一致）。
             *  参照物 = DSH「系统浏览器打开」按钮的 computed color（主题切换后自动变化，2s tick 同步）。 */
            const syncToolbarIconColor = () => {
              try {
                for (const form of toolbarForms()) {
                  const src = sysBrowserBtnOf(form);
                  if (!src) continue;
                  // ★取**图标元素**（svg）的 computed 风格，而不是按钮的：DSH 图标常把颜色写在自己的
                  //   svg/主题令牌上，按钮的 color 未必等于字形颜色（实测：抄按钮颜色仍然明显偏亮）
                  const icon = src.querySelector('svg') || src;
                  const cs = getComputedStyle(icon);
                  const c = cs.color;
                  if (!c) continue;
                  const op = cs.opacity;
                  for (const id of ['dsh-kit-toolbar-size-btn', 'dsh-kit-toolbar-shot-btn', 'dsh-kit-toolbar-btn', 'dsh-kit-toolbar-own-btn']) {
                    const b = form.querySelector('#' + id);
                    if (!b) continue;
                    if (b.style.color !== c) b.style.color = c;
                    if (op && b.style.opacity !== op) b.style.opacity = op;
                  }
                }
              } catch { /* 忽略 */ }
            };
            const ensureToolbarButtons = () => {
              let attached = 0;
              const specs = [
                // 顺序（用户 2026-10-10 指定）：尺寸 → 截图 → 批注；首个取 margin-left:auto 右对齐
                { id: 'dsh-kit-toolbar-size-btn', title: '设备尺寸（选择分辨率；缩放按当前板块尺寸计算）', svg: SIZE_ICON_SVG, first: true },
                { id: 'dsh-kit-toolbar-shot-btn', title: '截图当前浏览器并直接插入输入框', svg: SHOT_ICON_SVG, first: false },
                { id: 'dsh-kit-toolbar-btn', title: '元素批注（点击开关共享批注：所有浏览器窗口同步）', svg: ANNOT_ICON_SVG, first: false },
                { id: 'dsh-kit-toolbar-own-btn', title: '在 Agent 自持浏览器中打开（同登录态）', svg: OWN_ICON_SVG, first: false, afterSystemBrowser: true },
              ];
              for (const form of toolbarForms()) {
                const pane0 = webviewOfForm(form);
                if (!pane0) continue;
                for (const spec of specs) {
                  const owned = form.querySelector('#' + spec.id);
                  if (owned) {
                    const owner = ownerBootOf(owned);
                    const myBoot = String(stateRef.clientBootAt);
                    if (owner === myBoot || (owner && owner > myBoot)) continue;
                    owned.remove();
                  }
                  const btn = mkToolbarBtn(spec.id, spec.title, spec.svg, spec.first);
                  if (spec.id === 'dsh-kit-toolbar-btn') {
                    btn.addEventListener('click', () => {
                      try {
                        // 即时视觉反馈（2s 同步循环随后校正）；面板点击时现取，
                        // 避免闭包持有重渲染前的旧 webview 节点（身份失配 = 永不点亮）
                        const pane = webviewOfForm(form);
                        if (!pane) return;
                        stateRef.lastToggleError = null; // 点亮交给 applyAnnotBtnState（属性 + !important CSS）
                        togglePaneAnnot(pane).then((r) => {
                          // R-OWN v11：**立即**按会话状态点亮（属性驱动，不等 2s tick）
                          try { applyAnnotBtnState(stateRef); } catch { /* 忽略 */ }
                          if (r && r.ok === false) {
                            stateRef.lastToggleError = r.error || null;
                            btn.title = '批注失败：' + (r.error || '');
                          }
                        }).catch((e) => { stateRef.lastToggleError = msgOf(e); });
                      } catch (e) {
                        stateRef.lastToggleError = msgOf(e);
                      }
                    });
                  } else if (spec.id === 'dsh-kit-toolbar-size-btn') {
                    btn.addEventListener('click', (ev) => {
                      try { ev.stopPropagation(); } catch { /* 忽略 */ }
                      const pane = webviewOfForm(form);
                      openPaneDeviceMenu(btn, pane);
                    });
                  } else if (spec.id === 'dsh-kit-toolbar-own-btn') {
                    // ↘：把该面板**当前页面**以同一 storage identity 开进自持浏览器（共享登录态）
                    btn.addEventListener('click', async () => {
                      const pane = webviewOfForm(form);
                      if (!pane) return;
                      let url = null;
                      try { url = pane.getURL(); } catch { url = null; }
                      if (!url || url.indexOf('about:blank') === 0) { btn.title = '当前页面还没有地址'; return; }
                      const sid = sessionIdOfForm(form) || currentSurfaceSession();
                      btn.style.background = TOOLBAR_ACCENT;
                      btn.style.color = TOOLBAR_ACCENT_TEXT;
                      try {
                        const r = await openUrlInAgentView(url, { sessionId: sid });
                        btn.title = r && r.ok
                          ? `已在自持浏览器打开（同登录态）：${String(url).slice(0, 70)}`
                          : `打开失败：${(r && r.error) || '未知'}`;
                      } catch (e) { btn.title = `打开失败：${msgOf(e)}`; }
                      setTimeout(() => { btn.style.background = 'transparent'; btn.style.color = 'inherit'; }, 900);
                    });
                  } else {
                    btn.addEventListener('click', async () => {
                      const pane = webviewOfForm(form);
                      if (!pane) return;
                      btn.style.background = TOOLBAR_ACCENT;
                      btn.style.color = TOOLBAR_ACCENT_TEXT;
                      // 截图 → **直接输入到输入框**（用户要求：不走剪贴板）
                      const r = await captureShot({ el: pane, insertToComposer: true });
                      setTimeout(() => { btn.style.background = 'transparent'; btn.style.color = 'inherit'; }, 700);
                      const cp = r && r.composer;
                      btn.title = r && r.ok
                        ? (cp && cp.verified ? '已插入输入框（图片附件）' : '已提交插入（请看一眼输入框确认）')
                        : `截图失败：${(r && (r.error || (cp && cp.error))) || '未知'}`;
                    });
                  }
                  // ↘ 按钮尽量**紧贴 DSH「系统浏览器打开」图标右侧**（找不到就退回追加到工具条末尾）
                  let host = null;
                  if (spec.afterSystemBrowser) {
                    try { host = sysBrowserBtnOf(form); } catch { host = null; } // 复用同一判定（避免两处正则漂移）
                  }
                  if (host && host.insertAdjacentElement) host.insertAdjacentElement('afterend', btn);
                  else form.appendChild(btn);
                  // R-OWN v11：**创建即上色**——DSH 会周期性重渲染工具条，按钮重建后若是等到 2s 的样式
                  // tick 才补色，就会出现"蓝→透明→蓝"的闪烁（用户实测反馈）。这里同步按会话状态着色。
                  if (spec.id === 'dsh-kit-toolbar-btn') {
                    // 创建即按会话状态点亮（属性驱动；**颜色统一交给 syncToolbarIconColor**，勿在此写 color，
                    //  否则会覆盖成 inherit（与 DSH 自带图标不同色）——实测踩过）
                    try { applyAnnotBtnState(stateRef); } catch { /* 忽略 */ }
                  }
                }
                attached += 1;
              }
              try { syncToolbarIconColor(); } catch { /* 忽略 */ } // R-OWN v15：与 DSH 自带图标同色
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
            /* tick 职责拆分（R1-02）：周期 2000ms 与执行顺序逐字不变；前半同步段无失败域
             *  交叉；后半自愈/自动加入段保留 autoJoinBusy 守卫与 withTimeout 语义原样。 */
            /* R-HID：WebHID shim 服务——每 webview 注入 shim（幂等，按 mtime）+ 消费 guest
             *  的桥请求队列（__dshKitHidQueue → face hidXxx → __dshKitHidResolve 回推）。
             *  face 未就绪时静默跳过（shim 队列积压到 face 就绪再消费，guest 侧 15s 超时自兜）。 */
            const hidShimCache = { mtime: null, source: null, themeJson: null };
            /** R-STYLE：从 GUI 文档取主题令牌实值（guest 页无 --dsh-alias-* 变量）——
             *  打包传给 shim 挂 guest CSS 变量，选择器随 DSH 两主题。 */
            const collectGuiTheme = () => {
              const cs = getComputedStyle(document.body);
              const pick = (name, fallback) => {
                const v = cs.getPropertyValue(name).trim();
                return v || fallback;
              };
              return {
                bg: pick('--dsw-alias-bg-layer-2', pick('--dsw-alias-bg-layer-1', '#243244')),
                border: pick('--dsw-alias-border-l2', pick('--dsw-alias-border-l1', '#3a4a5e')),
                text: pick('--dsw-alias-label-primary', '#e5e7eb'),
                text2: pick('--dsw-alias-label-secondary', pick('--dsw-alias-label-primary', 'rgba(255,255,255,0.65)')),
                hover: pick('--dsw-alias-interactive-bg-hover', 'rgba(255,255,255,0.08)'),
                shadow: pick('--dsw-shadow-lv3', '0 12px 40px rgba(0,0,0,0.5)'),
                danger: pick('--dsw-alias-state-error-primary', 'rgba(220,38,38,0.85)'),
                font: T.font,
                scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
              };
            };
            // R-HID：typert 信封可能双层（face 自身 {ok,devices} 外再包 {ok,value}）——
            // peelTo 按目标形状防御下钻（P41 家族：单层 unwrap 假设错 = 静默失败）。
            const peelTo = (x, done) => (x && typeof x === 'object' && !Array.isArray(x) && done(x) ? x : x && typeof x === 'object' && x.value !== undefined ? peelTo(x.value, done) : null);
            /* P43（2026-10-09 实机定论）：**信封剥离必须只看信封形状，不能用业务键当谓词**。
             *  hidRead 曾以「ok 字段存在」为终止谓词——而**外层信封自身就带 ok**
             *  （face #guard 返回 {ok:true, value:<业务结果>}），谓词在外层即刻命中，返回的
             *  是 `{ok:true, value:{ok:true,data:[...]}}`；shim 判 `Array.isArray(r.data)` 失败
             *  → 静默 return → 页面永远收不到 inputreport（现场：设备响应全到桥，页面全 timeout）。
             *  faceUnwrap 逐层剥 {ok,value}（含 value 才算信封），剥到非信封为止。 */
            const faceUnwrap = (x) => {
              let cur = x;
              for (let i = 0; i < 4; i++) {
                if (cur && typeof cur === 'object' && !Array.isArray(cur) && cur.value !== undefined && cur.ok !== undefined) cur = cur.value;
                else break;
              }
              return cur;
            };
            const HID_SHIM_PROBE = '(function(){ return { has: typeof window.__dshKitHidShimVersion, mtime: window.__dshKitHidShimMtime || null, q: (window.__dshKitHidQueue ? window.__dshKitHidQueue.length : -1) }; })()';
            const tickHidBridge = async (svc, webviews) => {
              if (!svc || typeof svc.getHidShim !== 'function') return;
              for (const el of webviews) {
                try {
                  const state = await withTimeout(el.executeJavaScript(HID_SHIM_PROBE, true), 3000, 'hid-shim-probe');
                  if (!state || typeof state !== 'object') continue;
                  // ① shim 注入判定：未注入（has!=='string'）必注；guest 有 shim 时比对
                  //   guest 记录的 mtime vs 当前源 mtime——两者有一方未知（client 刚重启缓存空）
                  //   也重注入一次以建立基线（幂等成本低：一个 IIFE + 一次 face 调用）。
                  const needInject = state.has !== 'string' || (function () {
                    if (!state.mtime || !hidShimCache.mtime) return true; // 基线未建立 → 重注建立基线
                    return state.mtime !== hidShimCache.mtime;
                  })();
                  if (needInject) {
                    if (!hidShimCache.source || hidShimCache.mtime !== null) {
                      // 每次重注都重新拉源（mtime 可能已变；face 调用便宜，不做双缓存假设）
                      const g = peelTo(await svc.getHidShim(), (x) => typeof x.source === 'string');
                      if (!g || g.ok !== true) continue;
                      hidShimCache.source = g.source;
                      hidShimCache.mtime = g.mtime;
                      say('info', `WebHID shim 源已获取（${g.bytes} 字节，mtime ${g.mtime}）`);
                    }
                    // 主题令牌实值随注入传入（R-STYLE：guest 页无 --dsh-alias-* 变量——
                    // 从 GUI computedStyle 取实值打包，shim 挂到 guest 的 documentElement 上）
                    const themeJson = JSON.stringify(collectGuiTheme());
                    await withTimeout(el.executeJavaScript('try { delete window.__dshKitHidShimVersion; } catch (_) {} try { delete window.__dshKitHidShimMtime; } catch (_) {} if (window.__dshKitHidShim && window.__dshKitHidShim.closeAllForReinject) { window.__dshKitHidShim.closeAllForReinject(); } window.__dshKitHidOldShim = navigator.hid; delete navigator.hid; window.__dshKitHidShimMtime = ' + JSON.stringify(hidShimCache.mtime) + '; window.__dshKitHidTheme = ' + themeJson + ';\n' + hidShimCache.source, true), 5000, 'hid-shim-inject');
                  }
                  // ② 主题翻转跟随（R-STYLE）：GUI 令牌实值变化 → 推新值进 guest（选择器开着也实时跟随）
                  const themeJsonNow = JSON.stringify(collectGuiTheme());
                  if (themeJsonNow !== hidShimCache.themeJson) {
                    hidShimCache.themeJson = themeJsonNow;
                    await withTimeout(el.executeJavaScript('window.__dshKitHidTheme = ' + themeJsonNow + '; if (window.__dshKitHidShim && window.__dshKitHidShim.applyTheme) window.__dshKitHidShim.applyTheme(window.__dshKitHidTheme);', true), 3000, 'hid-theme-push');
                  }
                  // ② 桥请求消费（guest 队列 → face → 回推）
                  if (state.q > 0) {
                    const reqs = await withTimeout(
                      el.executeJavaScript('JSON.stringify(window.__dshKitHidQueue.splice(0, window.__dshKitHidQueue.length))', true),
                      3000, 'hid-queue-take');
                    const list = JSON.parse(reqs || '[]');
                    // R-STOPGAP：每 tick 限流 4 个桥请求（多余留 guest 队列下轮取——
                    // 洪峰曾打爆宿主 face 通道，gui-eval 全超时）。取走的放回队首。
                    const batch = list.slice(0, 4);
                    const deferred = list.slice(4);
                    for (const req of batch) {
                      try {
                        let r = null;
                        if (req.method === 'hidList') r = faceUnwrap(await svc.hidList());
                        else if (req.method === 'hidOpen') r = faceUnwrap(await svc.hidOpen(req.params.path));
                        else if (req.method === 'hidRead') r = faceUnwrap(await svc.hidRead(req.params.handleId, req.params.timeoutMs));
                        else if (req.method === 'hidWrite') r = faceUnwrap(await svc.hidWrite(req.params.handleId, req.params.data));
                        else if (req.method === 'hidClose') r = faceUnwrap(await svc.hidClose(req.params.handleId));
                        else r = { ok: false, error: '未知桥方法：' + req.method };
                        await withTimeout(
                          el.executeJavaScript(`window.__dshKitHidResolve(${JSON.stringify(req.id)}, ${JSON.stringify(r)})`, true),
                          3000, 'hid-resolve');
                      } catch (e) {
                        await el.executeJavaScript(`window.__dshKitHidResolve(${JSON.stringify(req.id)}, { ok:false, error:${JSON.stringify(msgOf(e))} })`, true).catch(() => {});
                      }
                    }
                    if (deferred.length) {
                      // 限流溢出：放回 guest 队列**队首**（保持 FIFO 顺序），下轮 tick 优先处理
                      await withTimeout(
                        el.executeJavaScript(`window.__dshKitHidQueue = ${JSON.stringify(deferred)}.concat(window.__dshKitHidQueue || [])`, true),
                        3000, 'hid-queue-defer');
                    }
                  }
                } catch { /* 单面板失败不影响其他面板/主流程 */ }
              }
            };
            /* R-PUMP（1.2.0 实测定论）：**HID 专用快泵**——2s 主 tick 的往返延迟远超站点协议预算
             *  （EQ TagId 只等 1.5s、麦克风/offset 5s）：实测一次读往返 1.7–4.2s ⇒ 页面全 timeout。
             *  自适应循环：有活就快（下一轮 40ms），连续空闲退避到 600ms（闲时不打扰宿主）。
             *  一轮 = 2 次 guest 调用（取队列 + 批量回推）；face 调用并发（阻塞中的 hidRead 不拖住写）。 */
            const hidBridgeCall = async (svc, req) => {
              if (req.method === 'hidList') return faceUnwrap(await svc.hidList());
              if (req.method === 'hidOpen') return faceUnwrap(await svc.hidOpen(req.params.path));
              if (req.method === 'hidRead') return faceUnwrap(await svc.hidRead(req.params.handleId, req.params.timeoutMs));
              if (req.method === 'hidWrite') return faceUnwrap(await svc.hidWrite(req.params.handleId, req.params.data));
              if (req.method === 'hidClose') return faceUnwrap(await svc.hidClose(req.params.handleId));
              return { ok: false, error: '未知桥方法：' + req.method };
            };
            const HID_PUMP_MAX_BATCH = 24; // 单轮上限（远超实际并发：shim 侧单飞 = 同时最多 1 读 + 少量写）
            const pumpHidOnce = async () => {
              const svc = stateRef.getRemote ? stateRef.getRemote() : null;
              if (!svc || typeof svc.hidRead !== 'function') return false;
              let did = false;
              for (const el of Array.from(document.querySelectorAll('webview'))) {
                try {
                  const n = await withTimeout(el.executeJavaScript('(window.__dshKitHidQueue ? window.__dshKitHidQueue.length : 0)', true), 2000, 'hid-pump-q');
                  if (!n) continue;
                  const reqs = await withTimeout(el.executeJavaScript('JSON.stringify(window.__dshKitHidQueue.splice(0, window.__dshKitHidQueue.length))', true), 3000, 'hid-pump-take');
                  const list = JSON.parse(reqs || '[]');
                  if (!list.length) continue;
                  did = true;
                  const out = Object.create(null);
                  await Promise.all(list.slice(0, HID_PUMP_MAX_BATCH).map(async (req) => {
                    try { out[req.id] = await hidBridgeCall(svc, req); }
                    catch (e) { out[req.id] = { ok: false, error: msgOf(e) }; }
                  }));
                  const deferred = list.slice(HID_PUMP_MAX_BATCH);
                  const back = deferred.length
                    ? `window.__dshKitHidQueue = ${JSON.stringify(deferred)}.concat(window.__dshKitHidQueue || []);`
                    : '';
                  await withTimeout(el.executeJavaScript(`window.__dshKitHidResolveBatch(${JSON.stringify(out)});${back}`, true), 3000, 'hid-pump-resolve');
                } catch { /* 单面板失败（导航中/未就绪）：下轮再试 */ }
              }
              return did;
            };
            const startHidPump = () => {
              const loop = async () => {
                let did = false;
                try { did = await pumpHidOnce(); } catch { /* 下轮再试 */ }
                setTimeout(loop, did ? 40 : 400);
              };
              setTimeout(loop, 400);
            };
          /** R-OWN v25（用户实测：这个浮窗一直不消失）：提示条的**兜底回收**。
           *  根因：提示条只在胶囊自身的 mouseenter/mouseleave 上开关，而胶囊会被 2s tick、
           *  提交（live→saved 模型切换）、会话门控等**移除或重建** ⇒ mouseleave 永不触发
           *  ⇒ 提示条永久滞留（且它是 pointer-events:none，鼠标划过去也关不掉）。
           *  兜底判据（每轮 tick 跑一次）：**胶囊不在 DOM，或指针已不在胶囊上** ⇒ 收掉。 */
          const reapAnnTip = () => {
            try {
              const tip = document.getElementById(ANN_TIP_ID);
              if (!tip || tip.style.display === 'none') return;
              const chip = document.getElementById(CHIP_ID);
              let hovered = false;
              if (chip) {
                try { hovered = chip.matches(':hover'); } catch { hovered = false; }
              }
              if (!chip || !hovered) hideAnnTip();
            } catch { /* 忽略 */ }
          };
          /** ★R-OWN v28（用户实测的跨会话泄漏）：**清理必须与"是否活跃"解耦**。
           *  旧实现在 `!st.active` 时直接 return ⇒ 用户「删掉批注（清除后会话已不活跃）→ 切到别的会话」
           *  时，**残留的批注仍留在页面上** ⇒ 别的会话"看到"了本会话的批注 ✗（用户实测）。
           *  判据改为**会话 id**（比标题稳定）：id 变化 ⇒ 无论批注会话是否活跃，都清掉上一会话的页面批注
           *  + 复位状态 + 换草稿本（编号随之从 1 开始）。 */
          let annotScopeSessionId = null; // 上一次见到的 DSH 会话 id
          const enforceAnnotSessionScope = () => {
            let sid = null;
            try { sid = currentSurfaceSession(); } catch { sid = null; }
            if (annotScopeSessionId === null) { annotScopeSessionId = sid; return; } // 首次只登记
            if (sid === annotScopeSessionId) return;
            const prev = annotScopeSessionId;
            annotScopeSessionId = sid;
            // 上一会话的浏览器面板：无论批注会话是否 active，一律停掉并清空（否则新会话会"看到"旧批注）
            let targets = [];
            try { targets = scopedWebviews(prev); } catch { targets = []; }
            if (!targets.length) { try { targets = Array.from(document.querySelectorAll('webview')); } catch { targets = []; } }
            for (const p of targets) {
              try {
                p.executeJavaScript('(function(){ var a = window.__dshKitAnnotator; if (!a) return 0; if (a.stop) a.stop(); if (a.clearAll) a.clearAll(); return 1; })()', true).catch(() => {});
              } catch { /* 面板不可达：忽略 */ }
            }
            resetAnnotState('end', true);
            draftReload(); // 换会话即换草稿本（key = 会话 id）
            removeAnnotMirror();
            hideAnnTip();
            say('info', '已切换会话：上一会话的批注已清理（批注按会话隔离）');
          };
          const enforceAnnotConvoScope = enforceAnnotSessionScope; // 兼容旧命名（标题判据已被 id 取代）
          const tickChipLifecycle = (webviews) => {
            /* v26：会话身份（id）变化 ⇒ 换草稿本（并首次加载：模块初始化时 sidebar 服务可能未就绪） */
            try { draftEnsure(); } catch { /* 忽略 */ } // v26：懒加载 + 会话切换即换草稿本
            refreshPanes(webviews);
            ensureAnnotChip(); // 胶囊：实时计数 / saved 模型 / 重定位（不依赖会话活跃）
            reapAnnTip(); // v25：提示条兜底回收（胶囊被移除/重建后不永久滞留）
            ensureConvoChips(); // 消息胶囊：发送消耗检测 + 会话内配对挂载（幂等）
            ensureAwayBanner(); // 发送前防呆：待发胶囊不在归属会话时的被动横条（.local/feature-send-guard.md）
          };
            const tickToolbarStyles = (activeIds) => {
              // R-OWN v11：图标点亮 = **会话是否活跃**（会话级总开关，两处浏览器同步）
              //  —— 不再按"本面板是否在成员表里"判定：成员表会因 settle/自愈重注入而变动，
              //     图标随之亮灭（用户实测"一闪一闪"）。
              const sessionOn = !!(stateRef.annot && stateRef.annot.active);
              // 诊断计数（tick 是否真的跑到这里 / 找到几个按钮）
              try { stateRef.styleTickCount = (stateRef.styleTickCount || 0) + 1; stateRef.styleTickAt = new Date().toISOString(); } catch { /* 忽略 */ }
              // 直接遍历**我们自己的按钮**（不依赖 toolbarForms() 的父级 webview 过滤——DSH 重渲染
              // 瞬间父级可能探测不到 webview，那一轮就会漏样式化，表现为图标不亮/闪）
              const btns = Array.from(document.querySelectorAll('#dsh-kit-toolbar-btn'));
              try { stateRef.styleTickBtnCount = btns.length; } catch { /* 忽略 */ }
              void sessionOn;
              // 属性驱动点亮（!important CSS）——内联被清也压不掉，见 applyAnnotBtnState 注释
              applyAnnotBtnState(stateRef);
              try { syncToolbarIconColor(); } catch { /* 忽略 */ } // 主题切换后图标颜色跟上
            };
            const tickSelfHealAndAutoJoin = async (st, activeIds, webviews) => {
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
                for (const wv of webviews) {
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
            };
            trackInterval(setInterval(async () => {
              // 实例围栏：热重载后的旧实例不得再操作 DOM（否则与活实例互刷样式 → 图标闪烁）
              if (!isLiveInstance(stateRef.clientBootAt)) return;
              try { stateRef.tickAt = new Date().toISOString(); } catch { /* 诊断字段不影响主流程 */ }
              /* ★R-OWN v23（实测 bug 的最终修法）：批注镜像面板必须由这个**必定在跑**的 2s tick 驱动。
               * 教训：先前把 `syncAnnotMirror()` 放在 `agentViewIdleTick`（1s）里，而那个 tick **只在
               * "打开自持窗口"时才启动**（`startAgentViewIdleTick` 位于 open 路径）⇒ 不开自持窗口的会话里
               * 镜像永不创建，页内面板又被 `mirror:true` 隐藏 ⇒ 用户点开批注**看不到任何面板**。
               * 定位证据：`kit-status.annotMirror.idleTimerOn=false` + `calls` 停更 ⇒ 当场指认"tick 没跑"。 */
              try {
                if (stateRef.annot && stateRef.annot.active) {
                  syncAnnotMirror().catch(() => {});
                  for (const p of (stateRef.annot.panes || [])) {
                    if (paneOwnerLabel(p).kind === 'session') syncAnnotMetrics(p);
                  }
                  // v26：草稿补进面板（跳页/重注入后 guest 记录为空时恢复；同页条目会重新钉标）
                  if (!hydrateBusy) {
                    hydrateBusy = true;
                    hydrateDraftIntoPanes().catch(() => {}).finally(() => { hydrateBusy = false; });
                  }
                } else if (document.getElementById(ANNOT_MIRROR_ID)) {
                  removeAnnotMirror();
                }
              } catch { /* 忽略：镜像同步失败已在 mirrorDiag 记账 */ }
              const st = stateRef.annot;
              const webviews = Array.from(document.querySelectorAll('webview')); // R4.1：tick 内单次查询复用
              enforceAnnotConvoScope(); // v25：批注按 DSH 对话隔离（换对话即结束+清空，编号从 1 起）
              tickChipLifecycle(webviews);
              const activeIds = (st && st.active && Array.isArray(st.panes))
                ? new Set(st.panes.map(paneIdOf))
                : new Set();
              tickToolbarStyles(activeIds);
              // R-HID：WebHID shim 服务（独立失败域——face 未就绪/单面板失败不拖累 tick 主流程）
              try {
                const hidSvc = stateRef.getRemote ? stateRef.getRemote() : null;
                if (hidSvc) await withTimeout(tickHidBridge(hidSvc, webviews), 8000, 'hid-bridge-tick');
              } catch { /* 桥 tick 失败：下轮再试 */ }
              await tickSelfHealAndAutoJoin(st, activeIds, webviews);
            }, 2000));
            // R-PUMP：HID 快泵（自适应 40ms/400ms）——2s 主 tick 只负责注入/主题等低频职责。
            try { startHidPump(); } catch { /* 泵启动失败不拦主流程 */ }
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
