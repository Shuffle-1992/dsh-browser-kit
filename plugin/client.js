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
        ['saveAnnotations', ['markdown'], 'saveAnnotations(markdown): Promise<{ok:true, path, bytes}|{ok:false, error}>', []],
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
        ),
        h(
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
        ),
        h(
          'div',
          { style: { padding: '8px 10px', borderTop: `1px solid ${T.border}`, display: 'flex', gap: 8 } },
          h(
            'button',
            {
              onClick: actions.captureShot,
              style: {
                border: `1px solid ${T.border}`, borderRadius: 6, padding: '3px 10px',
                background: T.accent, color: T.onAccent, cursor: 'pointer', fontSize: 12,
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
            '上报 host',
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
            '重新探测',
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
              stateRef.autoShotLeft -= 1;
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
            () => h(ProbePanel, {
              stateRef,
              getState: () => ({ findings: stateRef.findings, report: stateRef.report, lastShot: stateRef.lastShot }),
              actions: {
                reprobe: () => { probeAndPublish('manual').catch(() => {}); },
                reportNow: () => { reportNow().catch(() => {}); },
                captureShot: () => {
                  captureShot().then((r) => {
                    stateRef.lastShot = r;
                    say(r.ok ? 'info' : 'warn', `截图：${r.ok ? r.path : r.error}`);
                  }).catch(() => {});
                },
              },
            }),
          ));
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
