# DSH 内置浏览器能力评估与缺口清单

> 调查日期：2026-10-09（session 70a55b1a / 由 38fe6ea4 的 HID 任务接续）
> 调查方式：app.asar 全库扫描 + 官方包源码阅读 + 运行期只读探测 + 项目既有调研文档（`browser-annotation-and-screenshot-research.md`）
> 结论一律附证据；未实测的标注「契约明确，未实测」。

---

## 0. 三问速答

| 问题 | 结论 | 关键证据 |
|---|---|---|
| 为什么打不开控制台/DevTools？ | **DSH 刻意不支持**：guest DevTools 被宿主策略拦死，且 DSH 自身代码里没有任何 DevTools/CDP/console 监听 | `<webview>.openDevTools()` 存在但调用后 `isDevToolsOpened()` 仍为 `false`；@deepseek-ai 全包扫描 `debugger.attach` / `webContents.debugger` / `console-message` **零命中** |
| Agent 的浏览器自动化完善吗？ | **不完善**：有 10 余条命令但①不是一等 agent 工具（走 `plugin/.data/command.json` 文件通道）②点击/输入是 DOM 合成（`isTrusted=false`）③无等待/断言/键盘/滚动/文件上传④截图走 `capturePage`，有 **V8 FATAL 崩溃**风险 | 命令表见 §3；`client.js` 的 click 用 `dispatchEvent(new MouseEvent(...))`；ZCode 源码注释「走 CDP Page.captureScreenshot **规避 renderer webContents.capturePage 的 V8 FATAL**」；2026-10-09 23:2x 实测 `capturePage` 调用后 DSH 崩溃重启 |
| Agent 能自己开网页、列出当前所有页面吗？ | **✅ 已实测可**（本轮已实现 `browser-open` / `browser-tabs`）：开页 `ctx.sidebarRight.openTab('browser', {params:{url}})`；枚举 `ctx.sidebarRight.openTabs.getSnapshot()`；自建独立视图 `globalThis.dshDesktop.browser.acquire/release` | 实测：`browser-open {url:'https://example.com'}` → `{ok:true, opened:'https://example.com/'}`，随后 `browser-tabs` 从 12 个标签变 13 个且 DOM webview 报 `url:'https://example.com/', title:'Example Domain', wcId:2`；护栏拒绝 `file://`（「只支持 http/https」）与带凭据 URL（「拒绝带凭据的 URL」）。契约：`dsh-client-ui-sidebar-browser/lib/client.js` L1537-1542 / L157-159 / L1596；`dshDesktop.browser` 形状见 §2 |

---

## 1. DSH 内置浏览器到底是什么

- **形态**：右侧栏（sidebar.right）的一种标签类型，注册方 `@deepseek-ai/dsh-client-ui-sidebar-browser`。
  - Desktop 用 Electron `<webview>`；Web 用 iframe + 应用自管历史。
  - 每个 workspace 一个 storage partition：实测属性 `partition="dsh-sidebar-browser-<uuid>"`、`name="<uuid>"`、`allowpopups`。
- **官方自述「对模型零暴露」**（README Model Experience 原文）：
  > "None, as Browser tabs are user-facing presentation state and **register no tool, prompt section, or Session event**." / "KV Cache effect: None; browsing does not enter a model request."
  → 这就是「DSH 内置浏览器没有 agent 能力」的根因：**能力是我们这类插件补的，不是 DSH 提供的**。
- **策略（README Known Limitations 原文摘录）**：
  - 地址栏只接受 http/https（含 loopback）；拒绝 `file:`、`script:`/`data:`/`blob:`、带凭据的 URL、DSH 应用自身 origin。
  - 沙箱默认开（可单次关闭）；"Guest permissions, downloads and native popups are denied"。
  - "Host-address filtering is not a general private-network or DNS-rebinding firewall"。

## 2. 我们够得着的宿主面（决定能力上限）

| 通道 | 可达性 | 实测/依据 | 能做什么 |
|---|---|---|---|
| **配置进程（client 插件）** | ✅ 我们就在这里 | `window.__ModuleLoader__.load({factory(require){...}})` | GUI DOM、`<webview>` 元素全部方法、`ctx.slots`、`ctx.tools`、`ctx.sidebarRight`、`globalThis.dshDesktop` |
| `<webview>` 元素 | ✅ 全部方法在 | 实测：`executeJavaScript` / `capturePage` / `getWebContentsId` / `openDevTools` / `closeDevTools` / `isDevToolsOpened` / `sendInputEvent` / `loadURL` / `getURL` / `getTitle` / `setZoomFactor` 均为 function | 页面内执行、截图（**有崩溃风险**）、真输入事件（待验）、导航、缩放 |
| **宿主插件（host 半边）** | ⚠️ 纯 Node 进程 | `RUN_AS_NODE=1`；`require('electron')` 四个候选根全失败（`probe-report.json`） | node-hid 等系统层直连（已用于 HID 桥）、文件、子进程；**拿不到 webContents / 不能 attach debugger** |
| `dshDesktop` 预加载桥 | ✅ 只读探测到形状 | `{protocolVersion:1, browser:{acquire,release,onOpenRequested}, keyboard, shortcuts, updates}` | 租约式自建浏览器视图、监听新开页请求 |
| 侧栏服务 `ctx.sidebarRight` | ✅（不在 typert 服务目录，属 sidebarRight 子系统） | 官方包 `inject` 清单 + `openTab/openTabFromTarget/commandTarget/openTabs` 用法 | 开页、枚举标签、定位命令目标 |
| DevTools / CDP | ❌ | 见 §0；asar 扫描零命中 | — |

## 3. 我们插件现有的浏览器能力（commandHandlers 实测清单）

`navigate` / `reload` / `page-open` / `page-close` / `panes-probe` / `dom-scan` / `snapshot`(交互元素快照) / `click` / `type` / `page-inject` / `guest-eval` / `gui-eval` / `screenshot`(capturePage) / `toolbar-probe` / `kit-status` / 批注族 / HID 族。

**缺口（对照 ZCode 的 BrowserCommand 与主流 MCP 项目）**

| 能力 | 现状 | ZCode / 主流做法 | 优先级 |
|---|---|---|---|
| 一等 agent 工具 | ❌ 文件命令通道 | `ctx.tools.register(defineTool(...))`（官方契约，`zcode-dispatch` 已验证） | **P0** |
| 开页 / 枚举页面 | 部分（DOM 枚举 webview） | `sidebarRight.openTab/openTabs` | **P0** |
| 控制台/报错流 | ❌ | CDP `Runtime.enable`+`Log.enable`（DSH 不可用）→ 退而求其次：**页内 hook** | **P0（页内 hook 方案）** |
| 点击/输入 | ⚠️ DOM 合成，`isTrusted=false` | CDP `Input.dispatchMouseEvent` / Playwright；或用 `<webview>.sendInputEvent`（真输入） | **P0** |
| 等待/断言 | ❌ | `waitFor`(selector/navigation/text/network idle) | P1 |
| 截图 | ⚠️ capturePage（**会崩**） | CDP `Page.captureScreenshot`（含 fullPage/clip） | **P0（先止血）** |
| 键盘/滚动/悬停/选择/勾选/拖拽 | ❌ | BrowserCommand 全有 | P1 |
| 后退/前进/历史 | ❌ | `back/forward/getState` | P1 |
| 网络观测 | ❌ | CDP `Network.enable` 或页内 fetch/XHR hook | P1 |
| 元素 ref 稳定性/失效语义 | 部分（snapshot 有 ref） | playwright/chrome-devtools-mcp 的 uid/ref + 失效重取 | P1 |
| cookie/storage/上传下载 | ❌ | CDP `Network.getCookies`、`DOM.setFileInputFiles` | P2 |
| 多页面并发/隔离 | 部分（panes 枚举） | 租约 + 会话隔离 | P2 |

## 3.1 本轮已实现并实测的两条命令（P0-D 提前落地）

代码：`plugin/client.js` → `browser-tabs` / `browser-open`（静态契约清单已同步，测试 132/132 全绿）。

| 命令 | 作用 | 实测输出（2026-10-09 23:44 / 23:5x） |
|---|---|---|
| `browser-tabs` | 枚举**全部**侧栏标签（跨会话：sessionId / tabId / 类型）＋ DOM 侧 `<webview>` 实时 URL/标题/wcId/DevTools 态 | `count:12`（7 个会话：browser/files/text/guide 各类），开页后 `count:13` |
| `browser-open {url}` | **自己打开指定网页**（新开侧栏 Browser 标签），策略与 DSH 地址栏一致 | `{ok:true, opened:'https://example.com/'}`，无需用户操作；随后 webviews 报 `{url:'https://example.com/', title:'Example Domain', wcId:3}` |
| `browser-close {tabId}` | **自己关闭网页标签**（省略 tabId = 关当前活动标签）。契约 `sidebarRight.close(tabId)` → 内部 `closeIn(session, tabId)`（官方注释：唯一的 docked guide 会保留） | 闭环实测：`tabsBefore:13 → tabsAfter:12`，`stillOpen:false`，webviews 归零 |
| `browser-panel {op}` | **开/关浏览器面板本体**（右侧栏收起/展开）。首选 `sidebarRight.toggleExpanded()/isExpanded()`，回退 `ctx.layout.{closeRightbar,openRightbar}` | `close`：`expanded true→false`；`open`：`false→true`（`via:sidebarRight.toggleExpanded`） |
| 护栏 | 只放行 http/https、拒绝凭据、拒绝 DSH 自身 origin | `file:///C:/Windows/win.ini` → `{ok:false, error:'只支持 http/https（收到 file:）…'}`；`https://u:p@example.com/` → `{ok:false, error:'拒绝带凭据的 URL'}` |

实现要点（复用时照抄）：
- **服务用惰性 `ctx.inject(['sidebarRight'], scope => …)` 取**，不写进顶层 `inject`——`sidebarRight` 不在 typert 服务目录（探测报 `no catalogued Service named "sidebarRight"`），写进顶层会让整个 client 插件卡在未就绪。
- **参数名不能叫 `action`**：命令信封用 `action` 表示命令名（`c.action === 'browser-panel'`），再拿它当业务参数会被分发器当成未知命令（本轮实测踩到，改用 `op`）。
- 「收起/展开右侧栏」的正主是 `sidebarRight.{isExpanded,toggleExpanded}`（官方 README 里 Desktop Browser tabs 的 `keepMounted` / collapse 语义）；`ctx.layout.closeRightbar()` 是 shell 级另一套，实测收起不生效——**别用错层**。
- `openTabs.getSnapshot()` 的条目**只有 sessionId/tabId/type**（title/url 为 null）；**页面级实时信息要从 `<webview>` 元素取**（`getURL()/getTitle()/getWebContentsId()`）——桌面侧标签 `keepMounted`，已挂载的标签才有活的 webview。
- 「当前会话窗口」的过滤：条目里带 `sessionId`，与当前会话 id 比对即可。

## 3.2 Agent 操作可视化（R-GLOW，用户需求 2026-10-09）

需求：「Agent 在执行自动化操作浏览器时，窗口四边要有光效提升，让用户知道 Agent 在操作中。」

实现（`plugin/client.js`，纯 client 侧，无宿主依赖）：
- 浮层 `#dsh-kit-agent-glow`：贴住目标 webview（尽量上扩到**含工具条的浏览器窗口容器**，容器过大则退回 webview 本体）的**四边描边 + 三层外发光 + 1.5s 呼吸动画**；`pointer-events:none`，不挡点击/批注/选择；P37 认领戳防多实例抢挂。
- 胶囊 `#dsh-kit-agent-glow-pill`：`🤖 Agent 操作中 · <动作>`（常亮态换 🟢，连续操作显示次数）。
- 触发：**命令分发器统一打点**（`AGENT_GLOW_ACTIONS = navigate/reload/click/type/page-inject/screenshot/snapshot/browser-open/browser-close/browser-panel`）——新增命令无需逐个改 handler；纯盘点类（browser-tabs/panes-probe/dom-scan/kit-status）不打点，免得屏幕常闪。每次 pulse 续期 3.5s，末次后自动淡出。
- 控制：`agent-glow {op: on|enable|off|pulse|status}`（on=常亮标记、enable=启用但不亮、off=关闭并清除、pulse=手动脉冲带 ms、status=查状态），enabled 持久在 localStorage（默认开）。

实测（2026-10-09 23:5x，真机 GUI）：
| 检查 | 结果 |
|---|---|
| `agent-glow on` | 浮层在场，几何 `{left:1495, top:75, w:1068, h:1328}`（含工具条），`border 2px rgb(56,189,248)`、三层 box-shadow、`animation: dshKitAgentGlowPulse 1.5s`、`pointer-events:none` |
| 胶囊文案 | `🟢 Agent 操作中 · 常亮验证` → 脉冲后 `… · 测试脉冲（2 次）` |
| `agent-glow enable/off` | 浮层移除，enabled 保持/置否（localStorage 持久） |
| **分发器自动打点** | 执行 `reload` 后 `kit-status.agentGlow = {enabled:true, visible:true, sticky:false, label:'reload', count:1}` |
| 无 webview 时 | 不创建浮层（`agentGlowTarget()` 为空则早退），不会在空面板上乱画 |

## 3.3 页内控制台/网络通道（R-CONSOLE，2026-10-09 已落地并实测）

DSH 侧无 DevTools/CDP（§0/§2 证据），唯一可行路径是**页内 hook**。落地形态：
- `src/console-observer.js`：纯 ES5 IIFE、零依赖、可重复注入（幂等）；hook `console.log/info/warn/error/debug`（**保留原行为**，不吞日志）、`error` / `unhandledrejection` 事件、`fetch`、`XMLHttpRequest`（记 method/url/status/durationMs，**不读 body**）；环形缓冲 500 条；防御性序列化（循环引用/BigInt/抛错 getter 都不冒泡）；`uninstall()` 全还原。
- 契约：`window.__dshKitConsole = { version, entries(), dump({level,since,limit,filter,net}), clear(), stats(), mark(label), uninstall() }`；条目字段 `{seq,t,kind,level,text,args,url?,method?,status?,durationMs?,source?,line?,col?}`。
- 传输：host 工具 `browser_console` **每次都把源码随命令下发**（`params.source`）→ client 侧 `console-observer` 命令先探测 `__dshKitConsole`，缺失即补注入 → **页面刷新/新开标签自愈**（hook 随页面销毁，这是页内方案最大的坑）。
- agent 工具：`browser_console {op: dump|install|clear|mark|stats|uninstall, level, limit, filter, net, since, label, tab}`。

实测（2026-10-10 00:5x，真机 GUI）：
| 检查 | 结果 |
|---|---|
| `op:install` | `{installed:true, version:'1.0.0', stats:{total:0}}` |
| 页面里 `console.warn('dbk-probe',{n:42})` + `console.error('dbk-err')` | dump 出两条：`kind:'console'`、`level:'warn'/'error'`、`text:"'dbk-probe' {n: 42}"` |
| 页面里 `fetch('https://example.com/__dbk_probe__')` → 404 | dump 出 `kind:'fetch'`、`method:'GET'`、`status:404`、`durationMs:13002` |
| 新开一个**没有 hook** 的标签后直接 `op:stats` | 自动重装：`stats{total:0, installedAt:刷新}`（自愈） |

## 3.4 可信输入（R-INPUT，2026-10-10 实测解锁）

`<webview>.sendInputEvent` 发的是 **Chromium 级真事件**——页面内探针确认 `isTrusted === true`（DOM 合成的 `el.dispatchEvent` 永远是 false），React 受控组件、反自动化检测、native 交互（拖拽/文件/快捷键）都认；**且不像 `capturePage` 那样崩**（连发鼠标+键盘+滚轮后 webview 数量不变）。

| 能力 | 实测证据 |
|---|---|
| 可信点击 | `browser_click {ref:11}`（夜黑）→ 站点 `body.className` 由 `light-theme` 变 `dark-theme`；页面探针 `{trusted:true, x:125, y:1256, id:'styleDark'}` |
| 可信打字（含中文） | 页面注入测试输入框 → `browser_type {ref:999, text:'Hello 可信 123'}` → `input.value === 'Hello 可信 123'`，12 个 `trusted:true` keydown |
| 可信滚动 | 可滚动容器探针：发 `dy:+220` → 容器收到 `deltaY:+220` 并下滚 198px（**修掉了 Electron 与网页 deltaY 符号相反**的坑） |
| 按键 | 补 `webview.focus()` 后 `browser_press {key:'Tab'}` 使焦点从 BODY → `BUTTON#connectDeviceBtn` |
| **遮挡检测** | 造遮罩盖住按钮：不带 `force` 的点击被**拒绝**（`occluded:true` + 回报遮挡者 `DIV#__dbk_overlay`）；`force:true` 才送达（遮罩命中 1 次） |

工具面：`browser_click / browser_dblclick / browser_hover / browser_type / browser_press / browser_scroll`（共 16 个 `browser_*` 工具）。`click`/`type` 保留 DOM 合成回退路径（`mode` 缺省不变），只有显式 `mode:'trusted'`（工具默认）才走真事件。

## 3.5 等待/状态/表单补全 + 快照省 token（2026-10-10）

| 能力 | 工具 | 实测 |
|---|---|---|
| 等待原语 | `browser_wait` | 页面内轮询（不放大通道往返）：不存在选择器 + 1200ms → `{matched:false, waitedMs:1205}`（**超时不报错**，以 matched 表达） |
| 状态一屏 | `browser_state` | `{url,title,loading:false,canGoBack:false,canGoForward:false,zoom:1,page:{readyState:'complete',viewport:1280×1284,scroll:{y:0,maxY:321},active:'BODY'}}` |
| 历史前进后退 | `browser_history` | `navigate ?dbk=hist2` → `back` → url 回到 `?dbk=hist1`（操作前后 url/title 都回报） |
| 下拉选择 | `browser_select` | 按选项**文本**匹配 → `{value:'c', text:'选项C', index:2}`（原生 setter + input/change） |
| 勾选 | `browser_check` | 勾选 `{before:false,after:true}` → 取消 `{before:true,after:false}` |
| 快照省 token | `browser_snapshot` | 默认 `compact`：只回 `ref/tag/text`（截断 40、上限 60 项）；需要 id/placeholder/type/value 时 `compact:false` |

工具总数达到 **22 个 `browser_*`**（含 §3.1-§3.4 的全部能力）。

## 3.6 会话隔离（R-SCOPE，2026-10-10 用户需求：自动化不得影响其他会话）

**用户现场**：「Agent 自动化时只应对本会话的浏览器窗口生效；我在别的会话打字好像被影响了。」

**根因（实测确认）**：client 插件在 GUI 里是**单实例**，`ctx.sidebarRight` 作用于**当前前台会话**——后台会话下命令会落到前台会话上；`webview.focus()` 还会抢走用户输入框焦点。

**修法**：
1. 工具层从 `exec.agent.session` 取**调用方会话 id**，随每条命令下发（结果里回显 `requestedSession`）；
2. client 只在 `[data-sidebar-right-session="<调用会话>"]` 子树里选 webview；
3. 面板类命令（`browser-open/close/panel`）要求前台会话 == 调用会话；只读清单（`browser-tabs`）放行并回显 `myTabs / isFrontSession / currentSession / scopedWebviewCount`；
4. 交互类命令加**用户正在输入守卫**（GUI 焦点在可编辑元素且不在本会话面板 ⇒ 拒绝，`force:true` 逃逸）；
5. 操作后**归还焦点**（60ms 把 activeElement 还回去）；光效目标也按会话过滤（不会把光画到别人窗口）。

**实测（2026-10-10 00:3x，用户在 session-1661… 前台、本会话 70a5… 后台）**：

| 检查 | 结果 |
|---|---|
| `browser_tabs`（只读） | `requestedSession:'session-70a5…'`、`currentSession:'session-1661…'`、`myTabs:[tab3(browser), tab11(text)]`、`scopedWebviewCount:0`、`isFrontSession:false` + 提示语 |
| `browser_state`（页面级） | 被拒：「本会话（session-70a5…）当前没有已挂载的浏览器面板——为避免动到其他会话的窗口，本次操作已拒绝」 |
| `browser-open`（面板级） | 被拒：「当前前台显示的是会话 session-1661…，而调用方是 session-70a5…」 |

→ 用户前台的窗口**不再被碰**；代价是：用户停在其他会话时本会话面板未挂载 ⇒ 本会话自动化被如实拒绝（诚实失败优于越界操作）。

## 3.7 P2 深化（2026-10-10）

| 能力 | 工具 | 实现 | 验证状态 |
|---|---|---|---|
| 存储读写 | `browser_storage` | 页内 `localStorage/sessionStorage`（get 单个或列全部、set/remove/clear）与 `document.cookie`（非 HttpOnly）。**HttpOnly cookie 与 storage 分区级操作需 CDP，本环境不可达**（如实回报） | 代码+静态契约绿；正向实机待面板挂载 |
| 文件上传 | `browser_upload` | DOM + `DataTransfer` 注入 `File` → 赋给 `input.files` 并派发 `input/change`（等价 CDP `DOM.setFileInputFiles`；对读 `e.target.files` 的框架有效），base64 ≤ 4MB | 同上 |
| 页内查找（省 token） | `browser_find` | `mode=elements`（子串/正则匹配文本·id·placeholder·aria-label·data-testid·name，命中项**分配 ref** 可直接点）/ `text`（全文子串 + ±60 字上下文）/ `links` | 同上 |

**仍需 DSH 宿主能力（本轮做不了，已列 §8）**：下载观测（session `will-download`）、整页/元素级截图（`Page.captureScreenshot`）、独立浏览器视图租约并发（`dshDesktop.browser.acquire/release` + 一个 UI 座位）、HttpOnly cookie 与 storage 分区级操作（CDP `Network.getCookies`/`Storage.*`）。

## 3.8 探索：`dshDesktop.browser` 租约契约（插件自持浏览器视图的钥匙）

实测（2026-10-10 00:3x，只读+成对释放，未遗留视图）：

```
dshDesktop.protocolVersion === 1
dshDesktop.browser = { acquire, release, onOpenRequested }

acquire(storageIdentity: string) → Promise<{ lease: string(uuid), partition: string }>
   例：acquire('dsh-browser-kit:probe-a')
     → { lease: '108cac36-…', partition: 'dsh-sidebar-browser-97c92b7d-…' }
release(lease: string) → 成功（**必须传 lease 本身**，传整个 {lease,partition} 对象报
   「desktop browser: invalid guest lease」——本轮踩过）
acquire({workspaceKey}|{identity}|{storageIdentity}) → 报错「a workspace storage identity is required」
   ⇒ 参数是**字符串**，不是对象
不同 storageIdentity ⇒ 不同 partition（按 identity 隔离存储）
acquire 本身**不创建 webview**（租约只是权限令牌；`<webview>` 仍需自己挂，且要带该 lease/partition
才会被 main 的 will-attach-webview 放行）
```

**架构含义（强烈建议的下一步）**：把 `browser_*` 从「侧栏面板」搬到 **插件自持视图**——`acquire` 拿租约 →
自建 `<webview>`（带该 partition）→ 挂在我们的浮层/面板里驱动。这样：
- **彻底解决会话隔离**（不依赖任何会话的前台/挂载状态，也不碰用户侧栏）；
- 后台会话也能持续自动化（不再受「用户停在别的会话 ⇒ 本会话面板未挂载」限制）；
- 代价：要自己实现视图生命周期（挂载/尺寸/关闭/崩溃回收）、`onOpenRequested` 处理与 UI 座位。

本轮只完成契约探测（未实现视图），因为它属于「新增一个自持浏览器面板」的独立特性。

## 3.9 Agent 自持浏览器窗口（R-OWN，2026-10-10 实测打通）

把 §3.8 的租约契约变成可用的**插件自有浏览器视图**：`acquire(storageIdentity)` 拿租约 → 自建 `<webview>`
（`name=<lease>` + `partition=<partition>` + `src='about:blank#<lease>'`）→ 挂在右下角浮层面板（标题 +
URL + 刷新/关闭按钮，`resize:both`）→ 全部页面级工具都能drive它。

**为什么这是会话隔离的根治方案**：视图归插件所有，**不占任何会话、不碰用户侧栏** ⇒ 后台会话也能持续
自动化（不再受「用户停在其他会话 ⇒ 本会话面板未挂载」限制），也不会因前台会话切换而中断。

工具与路由：
- `browser_agent_window {op: open|navigate|close|status|cleanup, url, width, height, storageIdentity}`；
- 页面级工具统一带 `target: 'agent' | 'session'`，缺省 = **本会话侧栏面板优先（用户在看着它）→ 自持窗口兜底**；
- 所有页面级 handler 统一走 `inputTargetOf(c)`（此前 `guest-eval/reload/navigate/page-inject/screenshot`
  各有一套解析，实测会让 `browser_eval` 打到别的会话页面——已改造）；
- **自愈**：client 热换/重激活后模块态归零，启动时按 DOM 标记**收养**已有面板（租约在 `name` 属性里）＋
  清理重复/游离实例并释放其租约＋best-effort 释放 localStorage 里记的旧租约。

实测（2026-10-10 00:4x，全程**不触碰任何用户会话页面**）：

| 检查 | 结果 |
|---|---|
| `open` | `{ok:true, partition:'dsh-sidebar-browser-7252dd29-…', leaseId:'…', url:'https://example.com/', title:'Example Domain', wcId:6, rect:{left:2020,top:960,w:524,h:424}}` |
| 跨站导航 | `navigate` → `https://www.iana.org/help/example-domains`（`title:'Example Domains'`）——**自持窗口可跨站** |
| 路由 | `target:'agent'` → example.com；`target:'session'` → keysion.cn（互不串台） |
| `find` 三模式 | elements `count:5/scanned:33`（带 ref/path/inViewport）；text `count:2`（±60 字上下文）；links 命中（example.com 的 Learn more → iana.org） |
| `snapshot` compact | `{compact:true, count:8, total:33}`（只回 ref/tag/text，省 token） |
| `element` / `state` | 元素档案含 box/遮挡；state 给出 `canGoBack:true`（自持窗口里历史同样可用） |
| `storage` 往返 | `set dbk_probe=hello-42` → `get` 命中 → `remove` ✓ |
| `upload` | 注入 `dbk.txt`（19B, text/plain）→ 页面 `input.files[0]` 读到 `{name,size,type}` ✓ |
| `close` | `{open:false}`；核对 DOM：`allWebviews:0 / agentFrames:0 / agentPanels:0 / leaseRecord:null` ✓ 租约释放 |

踩坑四条已记 P52（dom-ready 时序 / 热换残留需收养 / release 形参 / 目标解析必须统一）。

### 3.9.1 自持窗口 vs 会话侧栏窗口（对照与选择指南）

| 维度 | 会话侧栏窗口（原有） | 自持窗口（R-OWN） |
|---|---|---|
| 归属 | DSH 侧栏标签（会话语义） | 插件自持租约 + 右下角浮层面板 |
| **挂载/可用性** | 仅本会话前台时挂载；用户切到别的会话 → 本会话面板卸载（实测 `w=0/h=0`），自动化被如实拒绝 | **与任何会话无关**，跨会话切换/前台切换都一直可用 |
| 会话隔离 | 属于某个会话 ⇒ 必须做 R-SCOPE 作用域检查（否则动到前台会话） | **天然隔离**：不属于任何会话 |
| **存储/登录态** | 按 workspace（CWD）分区 ⇒ 与同 workspace 的会话共享 cookie/localStorage（用来自用户的登录态） | **独立分区**：实测写唯一键双向互读均 `found:false`、cookie 互不可见 ⇒ 默认**不带登录态** |
| 标签能力 | 完整（多标签 + 开/关/切换 + 面板开合：`browser_tabs/open/close/panel`） | 单视图；`onOpenRequested` 只记录（不自动开标签） |
| 地址栏 | 有（用户可输入导航） | 无（显示 URL + 刷新/关闭）；导航靠工具或页面内跳转 |
| 尺寸/位置 | 右侧栏（可折叠） | 右下角浮动，可拖动/缩放，可指定 width/height |
| 页面能力 | 同一套（executeJavaScript / 截图 / 可信输入 / 控制台 hook） | **完全相同** ⇒ `browser_*` 工具通用，靠 `target` 切换 |
| 关闭语义 | 关标签（DSH 侧栏状态） | 关面板 = **释放租约**（实测关闭后 `allWebviews:0 / agentPanels:0 / leaseRecord:null`） |

**选择指南**：要**在用户正看的那个页面**上帮忙（带他的登录态、批注他打开的站点）→ 会话侧栏窗口
（`target:'session'`，或缺省时它优先）；要**后台干活 / 不打扰用户 / 需要干净独立 profile / 跨站跑测试**
→ 自持窗口（`browser_agent_window {op:'open'}`，页面工具缺省会兜底到它）。

**注意**：判定「分区是否共享」必须**写唯一键双向互读**——同一站点在两个分区里各写一份默认键，键名会
看起来一样（本项目实测踩过，见 P53）。

### 3.9.2 R-OWN v2：登录态复用 / 多分辨率 / 右下角小窗 / 截图（2026-10-10 用户需求）

| 需求 | 实现 | 实测 |
|---|---|---|
| **登录态复用** | storage identity 默认按官方公式 `cwd:<workspace.path>` **自动探测**：工具层从 `exec.agent.session.header.cwd` 带路径下来，client 用 `acquire(候选).partition` 与侧栏 webview 的 partition **逐字比对**验证命中并缓存；身份变化时自动重建视图 | identity=`cwd:F:\My Code\dsh-browser-kit`、`sharedWithSidebar:true`、partition 与侧栏一致；**会话窗口写 `__dbk_login_probe=logged-in-token-42` → 自持窗口 `found:true` 读到**（同分区 ⇒ 同 cookie jar，含 HttpOnly） |
| **多分辨率（默认 2K）** | 预设同 Chrome DevTools 设备模式（2K/4K/1080p/1440×900/1280×720/iPad Pro/iPad mini/iPhone 15 Pro/iPhone 15 Pro Max/Pixel 7/Galaxy S20）+ 自定义 `WxH` + `dpr`（走 setZoomFactor）；**guest 视口=目标分辨率**，显示用 `transform:scale(k)` 只缩放显示 | 2K → `2560×1440`、展开 scale 0.62（stage 1587×893）；`iPhone 15 Pro` → `393×852 @3x`；自定义 `1440x900` ✓ |
| **右下角小窗 + 展开** | 默认 **collapsed 260×44**（只留顶部条，点条或按钮展开）；展开按 `min(62% 宽, 72% 高)` 自适应，避免遮挡 DSH | `rect {left:2284, top:1340, w:260, h:44}` → expand `{left:941, top:449, w:1603, h:935}` → collapse 回小窗 ✓ |
| **截图供视觉分析** | `browser_agent_window {op:'screenshot'}` / `browser_screenshot {target:'agent'}`；复用截图护栏（单飞/冷却/可见性/超时） | 2K 下 `shots/20261010-010315-KEYSION.png`：**2560×1440 / 1.37MB**，`read_image` 可直接看（已用于确认渲染与布局） |
| **默认作用目标** | 由「本会话面板优先」翻转为 **自持窗口优先**（没有自持窗口才退回本会话面板） | `inputTargetOf` 缺省 `return agentViewWebview() \|\| fromSession;` |

**边界（诚实说明）**：分区共享覆盖 **cookie（含 HttpOnly）+ localStorage**；**sessionStorage 天生按标签页
隔离、不可能跨窗口共享**——若某站点把登录令牌只放在 sessionStorage，就需要额外做「会话交接」（读源窗口的
sessionStorage 再写入自持窗口，同名键覆盖）。当前未实现，可按需补。

### 3.9.3 R-OWN v3：100% 显示 / 空闲释放 / 中性边框与协作（2026-10-10 用户要求）

| 要求 | 实现 | 实测 |
|---|---|---|
| **默认 100% 不缩放** | guest 视口=目标分辨率且按 1:1 显示（`fit` 默认 false）；装不下由 **stage 滚动**查看；`op:'fit', fit:true` 才缩放到窗口内 | `layout {fit:false, scale:1}`；frame 2560×1440；展开后面板 2536×1376@(8,8)、stage 2520×1334 可滚 |
| **空闲释放、让用户操作** | 距上次 Agent 操作 >4s ⇒ 边框回中性色；> `idleReleaseMs`（默认 **10 分钟**，`op:'idle'` 可调，0=不释放）⇒ **自动释放租约并关闭窗口** | 阈值设 6s 后实测：`open:false` + `releasedForIdle` 时间戳，DOM 0 面板/0 自持 webview |
| **不显示青色边框** | 默认边框 = 主题中性色 `rgba(255,255,255,.12)`；**仅 Agent 操作后 4 秒内**为青色 `#38bdf8` | 操作刚结束：`2px rgb(56,189,248)`；空闲 6s：`2px rgba(255,255,255,0.12)` |
| **人机协作同一窗口** | 用户可随时点击/滚动/输入（无遮罩、无 pointer-events 封锁）；Agent 操作前短暂取焦点、**60ms 后归还**；窗口默认小窗不遮挡 | 与 R-SCOPE 的输入守卫/焦点归还共用同一套机制 |

**顺带修掉一个静默大 bug（已记 P54）**：面板/舞台/webview 的标记属性用 `dataset.camelCase` 生成的是
`data-kit-agent-view*`（无 `dsh-`），而收养/清理的选择器写的是 `[data-dsh-kit-agent-view*]` ⇒ **永远匹配不上**，
历史面板（连同租约）一直堆积（实测堆了 3 个），清理逻辑还一直报「无需清理」。改为统一显式
`setAttribute('data-dsh-kit-…')` 后：`panels/frames/stages` 各为 1，`cleanup` 首次正确报 `adopted:true`。

### 3.9.4 R-OWN v4：顶栏重排 / 缩放选择框 / 最大化置顶（2026-10-10 用户要求）

顶栏最终形态（左→右）：`🤖 Agent 浏览器` · URL · **分辨率下拉** · **缩放下拉 + 自定义输入** · `截图` · `−` · `✕`
；收起态只留 `标题 · URL · ▣ · ✕`（其余控件 `display:none`）。

| 用户要求 | 实现 | 实测 |
|---|---|---|
| 删除尺寸与缩放的角标显示 | 移除 badge 元素与相关更新 | 顶栏子元素里已无 badge ✓ |
| 删除「收起」按钮 | 移除 toggle 按钮；改由标题点击切换 | 无 toggle 元素 ✓ |
| X 左侧加 `−` 最小化 | `minBtn` 插在 `closeBtn` 之前；收起态显示 `▣`（用于展开） | 展开态按钮序列 `截图 / − / ✕`；收起态 `▣ / ✕` ✓ |
| 截图图标改文字按钮 | `📷` → `截图` | ✓ |
| 尺寸框后加缩放框（常规比例 + 自定义） | `ZOOM_STEPS = 25/50/67/75/80/90/100/110/125/150/175/200/250/300/400/500%` + 「自定义…」+ 数字输入框（25–500） | `zoomPct:125` → `getZoomFactor() = 1.25`；`zoom:0.5` → 0.5 ✓（等同 Chrome 页面缩放） |
| 最大化时置顶、不被 DSH 右上三个窗口按钮遮挡 | 面板 `z-index: 2147483647`；展开态从 **top:46px** 起算（标题栏之下），高度按 `innerHeight - 46 - 12` 收敛 | 展开 `rect {left:12, top:46, w:2536, h:1342}`、`overlapsControls:false` ✓ |

**注**：`zoom` 与预设 `dpr` 共用 `setZoomFactor` ⇒ 取乘积 `zoom × dpr`（`inputZoom()` 读到的就是乘积，
可信输入的坐标换算自动自洽）。

### 3.9.5 R-OWN v5：主题适配（修下拉弹层不可读，2026-10-10 用户要求）

**问题**：面板本身用主题 CSS 变量（`T.*`）会跟随明暗主题，但**原生 `<select>` 的弹出列表不吃页面 CSS 变量**
——它按 `color-scheme` 渲染；深色主题下弹层是「白底 + 浅字」，几乎看不清（用户截图）。

**修法**：
1. `colorLuminance()` 解析 `rgb()/rgba()`；`detectUiDark()` 从面板向上找**第一个不透明背景**判明暗（浮层里
   令牌可能解析成 `transparent`，所以要向上找，兜底深色）；
2. `agentViewApplyTheme()`：给面板设 `color-scheme`，给每个 `select`/`input` 设 `color-scheme` + 控件底色，
   并给**每个 `<option>` 显式设背景/文字色**（深色 `#22262e/#e7e9ee`，浅色 `#ffffff/#16181d`）；
3. 面板背景若解析为透明（令牌未定义）⇒ 用显式兜底色（深 `rgba(30,32,38,.98)` / 浅 `rgba(250,250,252,.98)`）；
4. **主题跟随**：布局调用时立即刷，空闲 tick 每秒自检一次（主题切换 1 秒内跟上；带缓存键避免频繁重写）。

**实测**：

| 场景 | 结果 |
|---|---|
| 深色主题（当前） | `panelScheme:'dark'`、`panelBg:rgba(30,32,38,0.98)`、`select colorScheme:'dark'`、`option {bg:rgb(34,38,46), color:rgb(231,233,238)}`、边框 `rgba(255,255,255,0.12)` |
| 自造浅色（只改面板内联背景，不动 DSH 主题） | 1.6s 后自动切换：`panelScheme/selScheme:'light'`、`option {bg:#ffffff, color:rgb(22,24,29)}`、`select bg rgba(0,0,0,.05)` |
| 还原深色 | 1.6s 内切回深色样式 ✓（缓存键驱动，无闪烁） |

### 3.9.6 R-OWN v6：侧栏工具条「设备尺寸 / 截图到剪贴板」+ 自持窗口截图进剪贴板（2026-10-10 用户要求）

**位置**：挂在批注图标同一处（`form[class*="toolbar"]`，P37 认领制，与批注按钮共用接管/重挂逻辑）。

| 能力 | 实现 | 实测 |
|---|---|---|
| 设备尺寸图标（弹出选项） | 点击弹出预设清单（11 个预设 + 重置）；选中后设 guest 视口=预设分辨率，**显示缩放按当前板块尺寸算**：`k = min(1, 板块宽/预设宽, 板块高/预设高)` | 选 2K：`width:2560px`、`transform:scale(0.448)`（1147/2560）、rect 1147×645、**页内 `window.innerWidth = 2560×1440`**；重置后回 1149×1284 ✓ |
| 截图到剪贴板图标 | `captureShot({el: 该面板, clipboard:true})`（精确截用户点的那块） | 按钮提示 `已复制到剪贴板（1149×1284，clipboard-write）`；PowerShell `GetImage()` 读回 **2560×1440** 图片 ✓ |
| 自持窗口「截图」 | 落盘 + 剪贴板；工具 `{op:'screenshot', clipboard:true}` 亦同（缺省 false，不抢用户剪贴板） | `{path, bytes:1019038, clipboard:{ok:true, method:'clipboard-write', size:'2560×1440'}}` ✓ |

**剪贴板写入的实测结论（重要）**：本机 Electron 下
`new ClipboardItem({'image/png': blob})` 若 blob 来自 `fetch(dataURL).blob()` 或 `new Blob([Uint8Array])`
→ **`DataError: Failed to read or decode ClipboardItemData for type image/png`**；
而 ①`canvas.toBlob(...)` 得到的 blob + `navigator.clipboard.write` **可用**；②选中 `<img>` 后
`document.execCommand('copy')` **可用**。故 `copyPngToClipboard()` 按 ①→② 回退，并用
**PowerShell `[Windows.Forms.Clipboard]::GetImage()` 独立核验**（读到 8×8 探针图与 2560×1440 实拍图）。
另注：`navigator.clipboard.writeText` 一直是通的 ⇒ 不是权限墙问题，是 blob 来源问题。

**★新坑（已记 P55）**：DSH 侧栏 webview 的宽度由 flex/百分比决定，**普通 inline `width` 会被压回面板原宽**
（写 `393px`，`getBoundingClientRect().width` 仍 `1149px`）⇒ 设备尺寸必须用
`style.setProperty('width', px, 'important')`（height/min-width/max-width/transform 同理），并 `flex:0 0 auto`。

### 3.9.7 R-OWN v7：截图**直接输入到输入框** + 弹层向下 + 自持窗口同款图标（2026-10-10 用户要求）

| 要求 | 实现 | 实测 |
|---|---|---|
| 尺寸弹层**向下展开**（避开 DSH 右上图标堆叠遮挡） | 计算按钮下方可用高度；足够就 `top = btn.bottom + 6`，不足才向上翻 | `btnBottom 110 → menuTop 116`、`menuBottom 423`、`downward:true` ✓ |
| 自持窗口「截图」换成**同款图标** | 复用模块级 `SHOT_ICON_SVG`（与侧栏工具条同一枚） | 面板按钮序列 `[svg图标, −, ✕]`（`svg:true`）✓ |
| 截图**不再进剪贴板，直接输入框** | `insertImageToComposer()`：PNG→`File`→`ClipboardEvent('paste')`（路径①）；未接受则 `DragEvent('drop')`（路径②）；**只插图片，绝不追加文字** | 机制实证（独立探针）：`paste` 与 `drop` 各自让输入框图片数 +1（3→4→5→6）✓ |

**两个实测教训（都踩过）**：
1. **校验窗口太短会误判**：Lexical 渲染图片附件是异步的，450ms 回读时图片还没出现 → 被判定失败并错误回退成
   「写路径文本」。改为**轮询等待（最长 2.5s）**后才正确识别成功。
2. **`SHOT_ICON_SVG` 作用域**：图标常量既要给内层工具条、又要给外层自持窗口用，**必须声明在模块外层**；
   先前误放进工具条所在函数作用域，导致自持窗口 `open` 抛 `SHOT_ICON_SVG is not defined`（已记 P56）。

**用户明确要求**：输入框里**只放图片、不附带任何文字**（`截图已保存：…` 之类一律不写；失败时只在按钮提示/工具
返回值里报错）。已用 `assert.doesNotMatch(clientSource, /截图已保存/)` 钉住，防回归。

**用户实测 bug：一次点击插入了 2 张（已修，记 P58）**
- 根因①：`composerImageCount()` 把 DSH 输入框**自带的 18×18 svg 图标**当成附件计数（口径错）；
- 根因②（致命）：用「异步计数是否 +1」决定**补发** drop —— paste 已成功却因计数未及时变化被判失败，
  于是又发一次 drop，**两个事件都被编辑器处理 ⇒ 2 张**。
- 修法：判定交付看**事件是否被接管**（`dispatchEvent(paste) === false` = 编辑器 preventDefault 已接管）
  ⇒ 绝不再发 drop；异步计数**只用于报告**，永不用于决策补发；检测器排除 `/^data:image\/svg/i`；
  另加 1.5s 防连点。
- 实测：单次点击 `nonSvgImgs 0 → 1`（**正好一张**）；2s 内连点两次 `1 → 2`（只 +1，防连点有效）；
  按钮提示 `已插入输入框（图片附件）`、`verified:true`（渲染成 `blob:dsh-app://…` 缩略图）。

### 3.9.8 R-OWN v8：同登录态开进自持 / 多窗口 + 地址栏 / 批注共享（2026-10-10 用户要求）

| 要求 | 实现 | 实测 |
|---|---|---|
| 工具条「↘」：当前页以同登录态开进自持浏览器 | 紧贴 DSH「系统浏览器打开」（↗）右侧（`insertAdjacentElement('afterend')`，失败退回末尾）；读 `pane.getURL()` + 面板所属会话（上溯 `data-sidebar-right-session`）→ 用同一 storage identity 打开 | 四按钮就位：`own@2430`（↘，在系统浏览器图标右侧）、`annot@2462`、`size@2494`、`shot@2526` ✓ |
| 多窗口（新增/关闭/切换） | 面板内标签条；每窗口各自 `acquire` 一份租约、各自 webview；`tabs/tab-new/tab-close/tab-select` 工具入口 | `open`→`tab1`；`tab-new`→`tab2`（example.com，标题自动成 "Example Domain"）；`tab-select` 回 tab1 且地址栏随之回填；`tab-close` 后剩 1 ✓ |
| 地址栏可输入 | `<input>` + 「前往」，回车导航当前窗口；`did-navigate`/切窗口后自动回填 | `addrValue` 随活动窗口变化：keysion → example.com → keysion ✓ |
| 批注进自持 + 与会话共用同一批注 | 「批注」按钮 → `togglePaneAnnot(活动窗口)`（该函数对任意 webview 生效）；同步循环按 `gid` **在所有成员间广播** ⇒ 天然共用 | 开启后自持窗口**页内**出现 `window.__dshKitAnnotator`（`ver 1.6.2`，与本插件期望版本一致）；`joined:true, sessionActive:true`；关闭 `joined:false` ✓ |

**多窗口的关键安全取舍**：只让**活动窗口可见**（其余 `visibility:hidden` + `pointer-events:none` + `data-dsh-kit-agent-view-inactive`），
且 `agentViewWebview()` **只返回活动窗口**——刻意避免对隐藏 surface 调 `capturePage`（P47-B 高危：隐藏/零尺寸面板
截图会挂死或崩宿主）。实测 2 个窗口时 `frames:2 / visibleFrames:1` ✓。

### 3.9.11 R-OWN v11：批注=会话级总开关 / 跨窗口归属标注（2026-10-10 用户要求）

| 要求 | 实现 | 实测 |
|---|---|---|
| 批注图标蓝底**一闪一闪**要修 | ①**实例围栏**：热重载遗留的旧客户端实例停止一切 DOM 周期任务（`__dshKitLiveInstance` + `clientBootAt` 单调比较）；②点亮改为**属性 + `!important` CSS**（只切 `data-kit-annot-on`，内联被后写也压不掉） | 一次点击后 `ON/ON`，**8s 采样变化次数 = 0** ✓（修前为 off/ON 反复，实测 2~4 次变化） |
| 两处浏览器批注**同步开/关** | `togglePaneAnnot` 改为**会话级总开关**：开 → 本窗口为首个成员并**立即拉齐所有窗口**（侧栏各面板 + 自持各标签，不等 2s tick）；关 → `endAnnotSession()` 对所有成员 `stop+clearAll` 并复位 | 点一次：`active:true`、两处按钮同时亮、成员含两类窗口；再点一次：`active:false`、两处同时灭 ✓ |
| 跨所有窗口**编号延续** | 编号下限机制不变（`joinFloorIndex(sessionMaxIndex())`：新成员从全局最大号续编）；自持窗口现在与侧栏窗口**同处一个成员表**，且新开窗口立即 `joinPane` ⇒ 同一编号空间 | 契约钉子（P25 成员先入册 / P26 下限不双加）持续通过；`annotator-status` 显示两类成员同表 ✓ |
| Agent 能分清批注属于**哪个窗口** | 新增 `paneOwnerLabel()`：自持 → `自持浏览器 tab2 · Example Domain`；侧栏 → `DSH 浏览器窗口 1（会话 bae5fc）`（`closest('[data-sidebar-right-session]')`，修掉 P61 的层数失配）。落盘时逐条 `{...a, window, windowKind}`，并在协议里输出 `Window:` 行；摘要（胶囊 hover）同步带 `window` | `buildAnnotationsMarkdown` 实测输出 `Window: DSH 浏览器窗口 1（会话 bae5fc）` / `Window: 自持浏览器 tab2 · Example Domain` ✓ |

**两个新坑**：**P60**（僵尸实例抢写 DOM + 内联样式无仲裁权 ⇒ 用属性/类 + `!important` 并加实例围栏）、
**P61**（祖先匹配要用 `closest`，手写层数不够会静默失配）。

### 3.9.12 R-OWN v12：批注面板可见带 / 页面 CSS 隔离 / 图标顺序（2026-10-10 用户要求）

| 要求 | 实现 | 实测 |
|---|---|---|
| DSH 面板在**调整显示尺寸后超出右边界看不到** | 批注面板是 `position:fixed; right:12px`（相对 **guest 视口**），而"可见区"可能只是视口的一部分 ⇒ 由 client 计算**可见带**并告知批注器 | 自持窗口 2K（视口 2560 / 舞台 2520）：面板 `left 2244 → right 2508` **完全在带内** ✓（修前 2284→2548，右缘被切）；DSH 窗口（视口 1039）`763→1027` 等价 `right:12` 无回归 ✓；切回 1080p `1644→1908` ✓ |
| 自持批注面板布局与 DSH 一致 | 面板/提示条加 `all: initial` 前缀（隔离宿主页面 CSS 的继承与通用选择器影响）；版本 1.6.3 | 实测面板根 `box-sizing/display` 均为我们设定的值（`border-box/flex`）；两端同一份注入源 ⇒ 布局一致 ✓ |
| 图标顺序改「尺寸 → 截图 → 批注」 | 调整 `specs` 顺序，首个取 `margin-left:auto` 右对齐（「↘」仍紧贴 DSH 系统浏览器图标右侧） | 实测 left：`size@2462 < shot@2494 < btn@2526`、`own@2430` ✓ |

**可见带的算法（两处实测都覆盖）**：`band = min(容器可见宽, 元素可见宽) / 已用缩放`。
- 侧栏套设备尺寸：容器 1147 / 元素可见 1147 / k=0.448 ⇒ band = 2560 = 完整视口（面板本就可见，等价 right:12）；
- 自持窗口 100% 显示：容器 2520 / 元素可见 2560 / k=1 ⇒ band = 2520（右侧 40px 被裁，面板必须回退 40px）✓
**★坑（P62）**：guest 里的 `position:fixed` 浮层按**视口**定位，但"看得见的区域"可能小于视口
（外层 transform 缩放 / 容器裁剪 / 滚动）——凡是注入 guest 的浮层都必须接受"可见带"参数。

### 3.9.13 R-OWN v13：批注面板固定尺寸 / 右下角 / 蓝色激活图标（2026-10-10 用户要求）

| 要求 | 实现 | 实测 |
|---|---|---|
| 面板**固定尺寸**，不随分辨率变化 | 批注器新增 `uiScale`：面板按 `1/uiScale` **反向缩放**（`transform-origin: bottom right`），视觉尺寸恒定；基准 = 实测 **264×82** | 默认 `scale:none` → 264×82 ✓；侧栏 2K `scale(2.4685)` × 外层 0.405 → **屏幕上仍是 264×82** ✓；自持 2K `none` → 264×82 ✓ |
| 面板移到**右下角** | `top:auto; bottom:12px`（可见带底部补偿：guest 比舞台高时 `bottom` 变大，仍贴"看得见的底部"）；右缘用 `offsetWidth` 算（不受自身 transform 影响，避免自反馈） | 默认/侧栏 `bottom:12px` ✓；自持 2K `bottom:180px`（贴可见带底部）✓ |
| **删除按钮蓝色背景**，改用**蓝色批注图标**表示激活 | 新增 `ANNOT_ICON_ACTIVE_SVG`（蓝色实心气泡 + 白色加号）；`applyAnnotBtnState` 只做"**换图标**"（幂等、无闪烁），CSS 规则改为把背景钉成 `transparent !important` | 激活：`bg:transparent, blue:true` ✓；未激活：`bg:transparent, blue:false` ✓ |

**★v13 的坑（P63）**：`webview.getZoomFactor()` **混入了显示器缩放**（实测本机 ≈1.23），
用它算"反缩放"会把侧栏面板放大 1.23 倍。改为**几何测量 + 我们已知的缩放**：
`uiScale = 元素可见宽 / 元素 CSS 宽 × 我们设过的缩放（dataset.kitZoomFactor）` ✓
（几何比值天然包含外层 `transform: scale`，且不含显示器缩放）。
另外"可见带"**要同时算宽和高**——自持窗口 100% 显示时 guest 比舞台高，只补偿宽度会让面板贴到看不见的底部。

### 3.9.14 R-OWN v14：避让停靠 + 激活图标改为"描边变蓝"（2026-10-10 用户要求）

| 要求 | 实现 | 实测 |
|---|---|---|
| 批注面板与自持浏览器窗口**叠一起** | 批注会话激活时，自持小窗**换到左下角**（`left:12px; right:auto`），批注关闭后自动回右下角；状态变化由 1s 空闲 tick 检测（`agentView.lastAnnotOn`）并重排 | 关闭：`left 2284 / bottom 16`（右下）✓；**激活：`left 12 / bottom 16`（左下）** ✓；再关闭：自动回右下 ✓ |
| 蓝色图标应是"白色改蓝色"，不是填充蓝块 | `ANNOT_ICON_ACTIVE_SVG` 改为**同一枚图标、`fill="none"` + `stroke="#2563eb"`**（描边变蓝） | 激活：`fills:["none","none"]`、`strokes:["#2563eb","#2563eb"]`、`bg:transparent` ✓；未激活：`strokes:["currentColor",…]` ✓ |

**★坑（P65）**：**guest 空间的浮层与 GUI 浮层会互相遮挡**——批注面板位于 DSH 板块的 **guest 右下角**，
自持浏览器窗口是 **GUI 浮层（z-index 最大）**，两者在屏幕上重叠时**无法用 z-index 分胜负**（不同合成层）。
可行解只有**避让**：由 client 在批注激活时改变自持窗口的停靠位置。

### 3.9.15 R-OWN v15：批注面板抬升让位（两者都可见）+ 注入图标与 DSH 同色（2026-10-10 用户要求）

| 要求 | 实现 | 实测 |
|---|---|---|
| 开启批注后面板与小窗**互相遮挡** | 改为**抬升面板**而非挪小窗：自持小窗**恒定停右下角**；批注激活时把"小窗高 + 间距"作为 `bottomExtra` 推给侧栏面板，使面板停在**小窗上方**（用户指定布局：面板在上、小窗在下，两者都可见） | 面板 `cssBottom 12px → 80px`（=44+24）→ 面板底 y 1204、小窗 1340..1384 ⇒ **都可见** ✓；关闭批注自动回到 12px ✓ |
| 注入图标颜色与 DSH 自带「系统浏览器打开」一致（**两种主题**） | `syncToolbarIconColor()`：把 DSH 参照按钮的 **computed color** 抄给我们四个注入图标；由 2s tick + 空闲 tick + 创建时同步，主题切换自动跟上 | 参照 `rgb(207,211,214)`；`size/shot/annot/own` 的 inline 与 computed **全部相同** ✓ |

**★坑（P67）**：`color: inherit !important` 那条"防覆盖"规则**会把我们自己设置的 inline 颜色也压掉**
（实测：inline 已是 `rgb(207,211,214)`，computed 却是 `rgb(249,250,251)`）——!important 不区分写者。
"防覆盖"的规则只应约束**真正需要钉死**的属性（这里是背景透明），不要顺手把还想设置的属性也钉死。
另外：`bottomExtra` 这类**依赖会话状态**的指标，必须在**状态变化时重推一次**（只在设备尺寸变化时推会漏掉"点开批注"这条路径）。

### 3.9.16 R-OWN v16：小窗状态即可完成全部操作 + 小窗内图标常显 + 面板始终贴小窗上方（2026-10-10 用户确认/要求）

**问题**：用户确认"自持窗口保持**小窗**状态时，Agent 能不能照常操作（打开网址/调分辨率/网页自动化/截图）？"
并指出：小窗里**看不到图标**、**调整尺寸后批注面板会跑**。

| 项 | 实现 | 实测 |
|---|---|---|
| 小窗状态下的**能力矩阵** | 导航（`loadURL`）、改分辨率（设元素尺寸 + `setZoomFactor`）、页内自动化（`executeJavaScript` / `sendInputEvent`）**本就不需要元素可见** ⇒ 小窗下照常工作；**只有截图需要"可见"** | 小窗下：`navigate:true`、`resolution:"1440×900"`、`eval/click/snapshot` 均 ok ✓ |
| 小窗下**也能截图** | `captureShot` 在"目标是自持窗口且面板为小窗"时**先临时展开**（320ms 等一帧）→ 截图 → **自动收回小窗**（`restoredCollapsed`）；原因是 `capturePage` 对隐藏/零尺寸面高危（P47-B），且**可见性检查在"选目标"时就已执行**，必须**先展开再选目标** | `ok:true`、`20261010-033152-KEYSION.png` 637KB、`stateAfter:"collapsed"` ✓ |
| 小窗里**图标常显** | 截图/批注两个图标从 `addrRow`（小窗隐藏）**移到常显的标题行**（`head.insertBefore(annotBtn, minBtn)`） | 小窗（260px）内按钮 `[截图icon, 批注icon, ▣, ✕]` 全部 `shown:true` ✓ |
| **调整尺寸后批注面板不跑** | ①`applyAgentViewLayout` 里给**侧栏成员面板**也重推指标；②批注进行中由 1s 空闲 tick **周期性重推**（`bottomExtra` 跟着小窗走） | 开启批注 `cssBottom:80px`；把自持窗口改成 2K 后**仍为 80px**（面板始终贴小窗上方）✓ |

**★坑（P68）**：把"需要常显的控件"放进**会被整体隐藏的容器**里（如把图标放进 `addrRow`），
隐藏容器时它们一起消失；`display` 的恢复逻辑再正确也没用。**先确认控件的父容器处于哪个显隐分支**。

### 3.9.17 R-OWN v17：面板按屏幕锚点定位（改分辨率不漂移）+ 图标取 DSH 图标元素的颜色（2026-10-10 用户要求）

| 要求 | 实现 | 实测 |
|---|---|---|
| 4 个图标颜色与 DSH 原生图标**仍不一致** | 参照物从**按钮**改为**按钮内的 `<svg>` 元素**：DSH 图标把颜色写在自己的 svg/主题令牌上，按钮的 `color` 未必等于字形颜色；同时抄 `opacity` | 参照 `svg`：`rgb(207,211,214)`/opacity 1；四个注入图标 computed **全部相同** ✓ |
| 批注面板**没有固定在小窗上方**、会随分辨率调整改变 | ①**小窗改停靠在「侧栏浏览器板块的右下角」**（guest 内的面板只能在板块范围内 ⇒ 必须把两者放进同一个盒子才可能相邻）；②面板改为**屏幕锚点定位**：宿主算出"右缘/下缘"并换算成 guest 坐标（`anchorRight`/`anchorBottom`）下发 | 小窗 `barTop 590 / bottom 634`（原在窗口底部 ~1340）✓；面板 `cssBottom 8px → 139px`（抬到小窗正上方）✓；**自持窗口切 2K 后小窗与面板位置完全不变**（`left 1362 / bottom 941` 前后一致）✓ |

**★坑（P70）**：**guest 内的浮层永远出不了板块的盒子**——想让它与"GUI 浮层"贴在一起，
要么把 GUI 浮层搬进同一个盒子（本例：小窗停靠到板块右下角），要么把浮层改由宿主绘制；
只调 guest 内的坐标是徒劳的（`vh - anchorBottom` 会被直接夹到最小值）。
**坑（P71）**：抄"参照控件的颜色"要抄**真正承载字形的那一层**（svg/path）——抄按钮层可能拿到容器色。

### 3.9.18 R-OWN v18：小窗与批注面板同处"板块容器右下角"（用户 2026-10-10 纠正）

**用户纠正**：「反了，应该是在 DSH 浏览器**右下角**显示这 2 个，现在都跟随缩放后的窗口跑到上面了。」

| 项 | 问题 | 修法 | 实测 |
|---|---|---|---|
| 小窗停靠参考物错 | v17 用 **webview 元素**的底边；设备尺寸下元素只有 `res.h×k` 高 ⇒ 被钉到"缩放后页面的底边"（跑到上面） | 改用 **webview 的父容器**（板块可视区）底边 | `barBottom 1388` ≈ 容器底 `1400` ✓ |
| 面板到不了容器右下角 | guest 视口高（预设 1080）< 容器高（1284）⇒ guest 内的面板**永远够不到容器底边**（锚点被夹到最小值） | 设备尺寸下**让元素高度填满容器**：`height = max(预设高, 容器高/缩放)`（**宽度仍严格按预设**，布局模拟关键在宽度） | 视口 `1080 → 2611`（=1284/0.492）；元素视觉底边 `1398` ≈ 容器底 `1400` ✓；**面板 `cssBottom 135px` ⇒ 正好在小窗正上方** ✓ |

**取舍**：套设备尺寸时"高度填满板块"意味着页面视口高度不再等于预设高度（宽度仍精确）。
若更希望**严格保留设备高度**，替代方案是让元素**底对齐**容器（页面贴板块底部、上方留白）——
两者都只是视觉取舍，宽度/布局模拟不受影响。

### 3.9.19 R-OWN v19：视口严格等于预设 + 元素底对齐容器（用户 2026-10-10 纠正）

**用户纠正**：「设置的 1920×1080，实际是 1920×**2689**？」——v18 的"高度填满容器"把视口改大了。

| 项 | 修法 | 实测 |
|---|---|---|
| 视口必须**严格等于预设** | 元素 `height` 回退为 `res.h`（不再填充） | 套 1080p → guest `1920×1080` ✓；切 2K → `2560×1440` ✓ |
| 又要让 guest 面板能贴板块右下角 | 改为**元素底对齐容器**：`transform: scale(k) translateY((容器高 − res.h·k)/k)`（translate 在 scale 之后 ⇒ 本地 dy = 视觉空隙 / k，`transform-origin: top left`） | `elBottom 1398 ≈ hostBottom 1400` ✓（`cssH: 1080px` 精确） |
| 面板仍在小窗上方 | 屏幕锚点的 **guest 原点改用元素 rect**（元素被缩放/位移后，容器左上角不再是 guest 原点） | 面板 `cssBottom 135px`（1080 视口）/ `180px`（1440 视口）✓ 始终贴小窗上沿 |

**★坑（P73）**：`transform: scale(k) translateY(d)` 中 **translate 发生在缩放后的坐标系** ⇒
想移动 `Δ` 个屏幕像素，本地要写 `d = Δ / k`。写错 k 倍会得到"看起来差一点点"的错位。

### 3.9.20 R-OWN v20：批注面板改**宿主渲染**（镜像），页面回到顶部（用户 2026-10-10 要求）

**用户要求**：「怎么变到下面了，保持在顶部，这样可以避免面板和小窗遮挡浏览器内容。」

| 项 | 结论/实现 | 实测 |
|---|---|---|
| 为什么不能"页面在顶部 + 面板在黑区" | **guest 内的 `position:fixed` 浮层出不了 guest 视口**（= 元素底边）。页面顶部对齐后，guest 里没有任何办法把面板放到页面下方的空区 ✗（P70/P74） | — |
| 页面**顶部对齐** | `transform: scale(k)`，不再做底对齐位移；视口仍**严格等于预设** | `topAligned: true`（`pageTop 116 = hostTop 116`）；视口 `1920×1080` ✓ |
| **面板改宿主渲染（镜像）** | guest 侧以 `mirror:true` 启动（面板 `display:none`，只保留状态/徽标）；新增 `mirrorSnapshot()` 返回面板 DOM + 计数；宿主把 DOM **镜像**到 `#dsh-kit-annot-mirror`，在**屏幕坐标**里定位（右缘贴板块、下缘贴小窗上沿），按钮改由宿主调批注器 API（清除→`clearAll()`、提交→`finishSubmit()`、取消→`endAnnotSession()`），1s tick 轮询重镜像 | 镜像面板 `264×82`、文字「批注0清除▸提交取消」✓；`gapPanelToBar 12px` ✓；**`panelInsideEmptyArea: true`**（面板落在页面下方的空区）✓；会话结束自动移除 ✓ |

**收益**：面板不再受 guest 视口/缩放/可见带约束（屏幕坐标，天然固定尺寸），
页面可以顶部对齐而面板与小窗都不遮挡网页内容。

### 3.9.21 R-OWN v20b：镜像模式下 guest 面板必须**一律隐藏**（2026-10-10 用户报"变成 2 个了"）

| 现象 | 根因 | 修法 | 实测 |
|---|---|---|---|
| 屏幕上有**两个**批注面板（一个压在页面上、一个在黑区） | 隐藏逻辑只写在 `ensurePanel()` 的**"面板已存在"分支**里；面板**新建**走的是另一个分支 ⇒ 首次创建时没被隐藏 | 把隐藏移进 `renderPanel()`（每次状态更新都经过它）：`if (mirrorMode && panel.style.display !== 'none') panel.style.display = 'none'`；并在非镜像模式恢复 `display ''` | guest 面板 `display:none`、rect `0×0` ✓；宿主镜像 `264×82`、`inEmptyArea:true` ✓；多次采样稳定（不再出现第二个） |

**镜像面板功能实测**：点页面元素 → `count:1`；点宿主「清除」→ `count:0`；
点宿主「取消」→ `sessionActive:false` 且镜像自动移除 ✓（按钮事件由宿主重绑并回调 guest API）。

**★坑（P75）**：同一元素有**多条创建/复用路径**时，只在其中一条上加"隐藏/样式"处理必然漏；
要放在**所有路径都经过的公共出口**（这里是 `renderPanel`）。

### 3.9.22 R-OWN v21：批注时**背景层不选中** + 指针离开网页即清除高亮（2026-10-10 用户反馈）

**用户反馈**：「批注开启时，如果鼠标不在浏览网页范围内，应该不选中元素，现在鼠标移出浏览范围会默认选中最大的背景页。」

| 项 | 修法 | 实测 |
|---|---|---|
| hover/点击落到**根元素或整页背景层**时"选中整页" | 新增 `isRootTarget(el)`：`<html>`/`<body>`，或**铺满视口且子节点 ≤2** 的容器（站点常见 `#app/#root` 包裹）一律视为背景；`updateOverlay` 遇到它就隐藏高亮/提示，`handlePickClick` 遇到它就**不采集** | 悬停 `body`/`html` → overlay `none` ✓；点背景 → 计数 `0 → 0`（不产生批注）✓；悬停/点击真实元素 → overlay `block` / 计数 `1` ✓ |
| 指针移出网页后**高亮残留**（看起来像已选中） | 新增 `handlePointerLeave()`：清掉合帧回调 + `hoverTarget` + 隐藏高亮；注册 `document mouseleave`、`window mouseout(relatedTarget 为空)`、`window blur` | 真实元素高亮 → 派发"离开网页"事件 → overlay 变 `none` ✓；再回真实元素可恢复 `block` ✓ |

**判定口径**：`isRootTarget` 只挡"根元素 + 铺满视口的容器"，**其子节点照常可批注**——
避免把整页应用的外层 wrapper 当成"不可批注"，同时消除"整页高亮 + `html 1920×864` 提示"的误选。

### 3.9.23 v22 审查收敛（2026-10-10，用户要求 review / simplify / 解耦 / 强制优化 / 测试验收）

流程：**实现 → 独立审计（只读 subagent，锚定提交 `2396f09`）→ 收敛 → 全量验收**。审计共报 9 项死代码、
7 项重复耦合、8 项风险、4 项性能冗余、8 条测试缺口建议；下面记录**落地结论**。

**A. 删除（面板改宿主渲染后遗留的死管道）**

| 符号 | 为什么是死的 | 处置 |
|---|---|---|
| `visibleHeight` + `visibleBandHeight()` | 唯一消费者是"隐藏面板"的定位 | 删（保留 `visibleWidth`/`visibleBand()`：**提示条**仍需要） |
| `bottomExtra` / `annotBottomExtra()` | §3.9.15 的"抬升让位"链终点是隐藏面板 | 全链删 |
| `anchorRight/anchorBottom` / `annotAnchors()` | guest 侧屏幕锚点与宿主 `positionAnnotMirror` **重复且语义不一致** | 全链删（落位规则收敛到纯模块，见 C） |
| `setVisibleWidth()` / `setUiScale()` | 全仓无运行时调用者（只有一条 pin 撑着） | 删 API + 删 pin |
| `void annotOn` / `void 0` / `data-dsh-kit-agent-view-always` / `__dshKitLastSubmit` | 写入后无人读 | 删（`mirrorSnapshot({mirror,count})` 也一并瘦身为 `{rev,count,html}`） |

**B. 修掉审计发现的真问题**

| # | 问题（审计原文） | 修法 | 证据 |
|---|---|---|---|
| B1 | 镜像模式下"批注列表"永远展不开：`listExpanded` 唯一写者是被 `display:none` 的页内 chevron，`renderPanel` 在 `!listExpanded` 时提前 return ⇒ `panelList` 恒空，镜像点 ▸ 只能展开空容器 | 行数据**始终渲染**，展开只控 `display`；宿主侧用 `annotMirror.listOpen` 记住展开态并在每次重镜像后贴回 | 折叠时 `listRows:1`；点 ▸ → `listDisplay:block` 且**含真实行**「1 h1 (未填写意见)」✓ |
| B2 | 自持窗口**展开态**时镜像面板被顶出屏幕（`bottom = innerHeight − bar.top + 12`，bar.top≈46 ⇒ 底边 y≈34，约 48px 被裁） | 落位改为"只有 bar 在视口下半才贴其上沿"，并加**上界夹取**（`bottom ≤ winH − panelH − gap`）+ `clipped` 标记 | 展开态实测 `top 1274 / bottom 1388 / onScreen:true` ✓ |
| B3 | 1s tick 无单飞护栏：guest 若不 settle（P22 家族）每秒累积一个悬挂 IPC，无上界 | `annotMirror.busy` 单飞 | `test/annotator-v22-guards.test.mjs` T6 |
| B4 | 镜像缓存可能失联：host 被外部移除/重建时，仅比较 html 会永远跳过填充，`root` 指向已脱离节点 | 校验 `isConnected/parentElement`，失联时调 `mirrorReset()` 强制取全量；并守住"`html===''` 表示未变，**不是**没有面板"（否则会清空镜像） | 代码路径 + 注释钉住 |
| B5 | `finishSubmit` 无重入：双击镜像"提交"会 `mergeAndSave` 两次（两份落盘 + 重复提示） | `annotMirrorSubmitBusy` 重入护栏 | 代码 + T7 |
| B6 | `mirrorMode` 粘滞：`endSession` 不复位 ⇒ 之后不带 `mirror` 的 `start()`（冒烟测试正是如此）继承"面板隐藏" | `endSession` 复位 `mirrorMode` | 代码 |
| B7 | 会话复位两处字面量漂移：`finishSubmit` 漏复位 `count/startedAt/convo` ⇒ 提交后诊断报旧值 | 抽 `resetAnnotState(reason, keepLastSaved)` 单一真值，两条收尾路径都走它 | T7 断言字面量只出现 1 次 |

**C. 解耦与优化**

- 落位几何抽成纯模块 [`src/annot-mirror-anchor.mjs`](../src/annot-mirror-anchor.mjs)（`mirrorPlacement()`），
  client 内嵌 **canonical 副本**对拍 → 消除"guest/宿主两套实现互相矛盾"（审计 §2）。
- 镜像按钮改**稳定属性**绑定（`data-dsh-kit-panel-clear|submit|cancel|chevron`）→ 文案改字不再静默失联；
  T3 双向断言"宿主绑定的属性都在批注器里存在"且"批注器新增的属性都被宿主绑定"。
- `sysBrowserBtnOf` 去重（原先有一份逐字重复的内联孪生，正则漂移即失配）。
- 反向缩放公式收敛为 `inverseScale()`（面板与提示条共用，原先提示条手搓同一公式）。
- **跨进程开销**：指标推送加**值缓存**（`band|scale` 未变不发）；镜像快照加 **rev**（内容未变只回 rev，
  不再每秒搬运整份 `outerHTML`）；tick 本体不再直接发起 `executeJavaScript`（T6 钉死）。

**D. 验收（全量重跑）**

- `node --test`：**180 项 / 179 过 / 1 跳过**（跳过项需 Chrome+CDP）。
- 端到端（真实 GUI）：`guest 视口 1920×1080`（严格等于预设）✓、页面 `topAligned:true` ✓、
  自持小窗在板块右下角 `barBottom 1388 ≈ hostBottom 1400` ✓、镜像面板 `264×82` 且距小窗 `12px`、
  `panelBelowPage:true`（不遮挡网页）✓、悬停背景 `overlay:none` ✓ / 悬停真实元素 `overlay:block` ✓、
  点真实元素 `count 1` ✓、镜像「清除」→ `count 0` ✓、「取消」→ `sessionActive:false` 且镜像移除 ✓、
  小窗状态截图 `ok:true`（637KB）且 `stateAfter:collapsed` ✓、四个工具条图标与 DSH 图标同色
  `rgb(207,211,214)` ✓。
- 批注器版本 **1.7.3**：`EXPECTED_ANNOT_VERSION` 比对后自动重注入（实测 guest 由 1.7.2 自愈到 1.7.3，
  且 `setVisibleWidth/setUiScale` 已不存在）。

**E. 明确保留 / 未做（有意取舍，非遗漏）**

- `data-kit-annot-on` 属性 + `!important` 背景规则：审计指出它"几乎无视觉作用"（背景已由 `mkToolbarBtn` 内联为透明）；
  保留原因是 P60 的实例围栏与属性驱动仍承担"状态单一来源"，删它反而会重新引入多写者。
- guest 面板交互面（`确保Panel` 的清除/提交/取消按钮）在生产路径 `mirror:true` 下不可达，
  但 `annotator-smoke`（需 Chrome）走的是非镜像路径 ⇒ **保留**，并在 §5 记为"镜像路径尚无自动化覆盖"。
- `captureShot` 的"临时展开 320ms"对用户可见（P69 取舍）：保持，因为隐藏面 `capturePage` 高危。

### 3.9.24 R-OWN v23：修「开批注但右下角没有面板」——镜像驱动被"自持窗口门"挡住（2026-10-10 用户实测）

**现象**：点开批注，右下角**什么都没有**（页内面板已被 `mirror:true` 隐藏 ⇒ 两头都空）。

**四路取证**（`probe-mirror-gone.cjs`）：

| 证据 | 值 | 含义 |
|---|---|---|
| `kit-status.annotActive` | true | 会话是活的 |
| `ownedBar` / `webviewKinds` | false / 全 `session` | **自持窗口没开** |
| `#dsh-kit-annot-mirror` | 不存在 | 宿主镜像从未创建 |
| guest 侧 | `panelDisplay:"none"`、`snapHtmlLen:10341` | 页内面板被隐藏、快照**有内容** |

**根因（两层）**：①`agentViewIdleTick`（1s）开头的 `if (!agentViewWebview()) return;` 让**没开自持窗口**时会话直接返回 ⇒ 里面的 `syncAnnotMirror()` 永不执行；②该 tick 本身只由 `startAgentViewIdleTick()` 在**自持窗口 open 路径**里启动（诊断字段 `idleTimerOn:false` 当场指认）。

**修法**：把批注镜像的驱动搬到**必定在跑**的主 2s tick（`tickAt` 心跳为证），并在批注会话开启后 300ms 立即拉一次（点开即见）；同时把 idle tick 里的批注块移到那道门**之前**（自持窗口开着时更快）。镜像失败不再静默：新增 `stateRef.mirrorDiag`（calls/injected/skippedBusy/skippedNoPane/skippedNoHtml/resetForced/lastError/lastAt/idleTimerOn），经 `kit-status.annotMirror` 暴露。

**顺带修掉的第二个 bug**：`positionAnnotMirror` 在锚点面板 rect **退化为 0**（面板此刻不可见）时算出 `right = winW − 0 + gap = 2572` ⇒ 面板被推出屏幕（实测 `rect.left = −276`）。纯函数 `mirrorPlacement()` 现把 `paneRight <= 0` 视为"无锚点"⇒ 回退视口右下角（`annot-mirror-anchor.test.mjs` 增退化用例）。

**实测（修后）**：无自持窗口 → `mirrorNode:true`、`264×82`、`left 2284 / onScreen:true`、文案含真实批注行 ✓；点 ▸ 展开 82→115 ✓；开自持窗口后自动贴到小窗上方（`hostBottom:72px`）✓；`mirrorDiag.calls` 每 2s 递增、`lastError:null` ✓。

**★坑（P80）**：**"只在某条功能路径里启动的周期任务"不能承担另一个功能的驱动** —— `agentViewIdleTick` 只在"打开自持窗口"时启动，把它当作批注镜像的心跳，等于给批注功能绑了个"必须开着自持窗口"的隐形前置条件。判据：**任何周期任务都要先问"它在什么条件下才存在"**，跨功能复用前确认它在目标场景里真的在跑（`idleTimerOn` 这类心跳字段就是为此加的）。

### 3.9.25 R-OWN v24：提交/关闭后**保留批注**，重开可续用与续号（2026-10-10 用户需求）

**用户需求**：「同一个会话，先提交了 1 条批注，然后又打开批注，应该延续前面的批注，能看到前面的批注和修改，新增批注延续序号。」

**旧行为**：提交（`stop()+clearAll()`）与关闭（同）都是"单次消耗、全窗口清空" ⇒ 重开从 0 开始、序号从 1 重排 ✗。

**新行为**（批注器 1.8.0）：

| 机制 | 实现 |
|---|---|
| 提交后保留 | `finishSubmit` 改为 `stop()` + `markSubmitted()`（**不再** `clearAll`）；记录留在 guest 内存，会话重启时 `startAnnotating` 重新钉标 ✓ |
| 关闭后保留 | `endAnnotSession` 同样只 `stop()`；**丢弃只能走面板「清除」**（`clearAll`，全窗口同步移除） |
| 状态可见 | 徽标三态：`pending`（写意见中，浅蓝）/ 待提交（蓝）/ **`submitted`（绿，已提交）**；列表序号底色同一来源 `badgeColor()` |
| 只提交变更 | 记录带 `dirty`（新建/改意见置真，提交后清）；`mergeAndSave` 仅取 `dirty !== false` 的条目 ⇒ **不会重复落盘**；`addExternal` 也接收该标记（跨面板同步/重注入后不丢失） |
| 序号延续 | `nextIndex()` = max(已有号, indexBase) + 1 ⇒ 重启后天然续号 ✓ |

**实测（真实 GUI）**：提交 1 条 → 记录保留 ✓；**关闭后仍保留**（修前为 0 ✗）✓；重开徽标重新钉上且状态 `submitted`（绿）✓；新增一条序号为 **6**（延续而非重排）✓；镜像面板列出全部 6 条 ✓；二次提交落盘 `# Web page annotations: 1`（**只含新增那条**）✓。

**★坑（P82）**：「提交即清空」这类**不可逆**动作，必须先问"用户是否还想继续"——
本需求与 2026-10-05 的"单次消耗"需求直接冲突，说明**清空语义应与"丢弃"绑定，而不是与"提交/关闭"绑定**；
把不可逆动作挂到高频动作（提交、关闭）上，用户一旦想继续就只能重做。

### 3.9.27 R-OWN v26/v27：面板重构（发送即消费）+ 批注草稿箱（2026-10-10 用户指定）

**用户要求（原文要点）**：
①「未提交时，重复打开或关闭批注功能，都保留批注内容，即草稿功能」；
②「会话输入框**发送出去**，即消费批注、清空，下一轮重新开始」；
③「删除提交按钮、删除取消按钮、左上角展开图标删除，改成 ✕ 关闭图标；原提交+取消位置改为**展开/收起**按钮」；
④（上一轮遗留）「登录页批注 → 跳转内页 → 再打开，应能看到前面的批注、编号续排」。

| 项 | 实现 |
|---|---|
| 面板结构（v26/annotator 1.9.0） | 头部：`📍 批注 N  [清除] [✕]`（✕=关闭并**保留草稿**）；底部：整宽「展开列表 ▾ / 收起列表 ▴」；**提交、取消、▸ 图标全部删除** |
| 消费时机 | 不再由面板发起：**用户把消息发送出去**即消费（复用既有发送检测 `planChipConsume`，草稿有独立基线 `draftBase`）⇒ 落盘 → 挂胶囊到刚发出的那条消息 → **清空页面批注与草稿** → 会话结束（下一轮从 1 开始） |
| 草稿箱（v27） | 真值**上移到 client**：`gid → item`（含 `_originUrl` 供同页门控）持久化到 `localStorage`，key = **会话 id**（不是对话标题——实测标题键取不回 ✗）；关闭/跳页/热更新后都在 |
| 跳页恢复 | 会话打开时 `draftReload()` + 每轮 tick `hydrateDraftIntoPanes()` 把草稿回注：**同页条目重新钉标**，**异页条目只进列表**（`pageOk=false` 防串窗）；编号 `sessionMaxIndex()` = max(guest 最大号, **草稿最大号**) ⇒ 续号 |
| 可诊断 | `kit-status.annotMirror` + **`kit-status.annotDraft`**（key/keyUsed/loaded/count/maxIndex/inPanes）——本轮两次误判都靠它当场纠正 |

**实测（真实 GUI）**：关闭 → 跳页 → 重开 ⇒ 三个面板均 `rec:1 idx:[1]`，面板列出「1 h1(未填写意见)」✓；
再新增一条 ⇒ 序号 **2**（续号）✓；面板文案 `批注2 清除 ✕ 1 h1 … 2 h1 … 展开列表 ▾` ✓。
**发送即消费**：代码 + 单测覆盖（`consumeDraft` / `draftClear` / 发送检测基线），**尚未真机点发验证**（需真实发送一条消息）⚠️。

**★坑（P85）**：懒加载与"key 变化才重载"混用 ⇒ 首次永不加载（草稿恒空）；必须有独立 `loaded` 标志。
**★坑（P86）**：真值不能只放在**会随导航销毁的文档**里；存储 key 要用**稳定身份**（会话 id），不要用会变的标题。

### 3.9.28 R-OWN v28：跨会话泄漏修复（2026-10-10 用户实测）

**现象**：会话 A 批注 2 条 → **删除** → 切到会话 B ⇒ **B 仍能看到这 2 条** ✗（回 A 已无 → 再回 B 又消失）。

**根因（两个叠加，均在源码取证）**：

| # | 问题 | 修法 | 实测 |
|---|---|---|---|
| 1 | 隔离守卫 `if (!st \|\| !st.active) return;` ⇒ **清除后批注会话已不活跃**，切会话时直接返回，页面上的残留批注没人清 ✗ | 判据改为**会话 id**（比标题稳定）并**与活跃状态解耦**：id 一变即清上一会话页面批注 + 复位 + 换草稿本 + 收提示条 | 清除后关闭批注 ⇒ 三个面板全 `rec:0 mk:0` ✓ 别的会话不可见 ✓ |
| 2 | 草稿合并把**所有**面板列表并进当前会话草稿 ⇒ 别的会话残留的批注被**吸进本会话** ✗ | 合并前按 `[data-sidebar-right-session="<当前 sid>"]` **限定作用域** | 单测钉子 + 同实测 |

**诊断**：`kit-status.annotDraft` 继续作第一手判据；清除后 `count:0` ✓ ⇒ 重开不会"复活" ✓。

**收养（客户端重载后）**：把面板里**所有**自持 webview 收养为窗口（`name`=租约、`partition`），
丢弃重复面板时释放其**全部**窗口租约（否则多窗口会泄漏租约）。实测重载后 `tab-adopt-1` 仍为 example.com、`shared:true` ✓。

### 3.9.9 R-OWN v9：布局对齐 DSH 浏览器（2026-10-10 用户要求）

| 要求 | 实现 | 实测（2K 展开） |
|---|---|---|
| 删除「前往」 | 移除该按钮（回车即导航） | `hasGoBtn:false` ✓ |
| 新增前进/后退/刷新 | 行2 起始 `‹ › ↻`（`canGoBack/goBack`、`canGoForward/goForward`、`reload`） | `navBtns:["back=‹","forward=›","reload=↻"]`；点刷新/后退后 URL 从 example.com 回到 keysion.cn ✓ |
| 输入栏宽度增大 | 地址栏是行内**唯一弹性项**（`flex:1 1 auto;min-width:120px`） | 面板 2536 → **地址栏 2126px** ✓ |
| 尺寸/缩放/截图/批注移到地址栏那行 | 行2 = `‹ › ↻` + 地址栏 + 分辨率 select + 缩放 select(+自定义 input) + 截图 + 批注 | `addrRowChildren` 顺序完全一致 ✓ |
| 布局参考 DSH 浏览器 | **行1** 标题+标签条+＋ / `−` `✕`（右对齐）；**行2** 导航+地址栏+图标；`barH` 60/32 | `panelRows:3`（2 行 chrome + stage）✓ |
| 批注改图标（与 DSH 一致） | `annotBtn.innerHTML = ANNOT_ICON_SVG`（与侧栏批注按钮同一枚） | `annotIsIcon:true`（svg 296B）✓ |

**★新坑（P59）**：展开/收起时用 `el.style.display = ''` 去"恢复"隐藏的控件，会**清掉 cssText 里设的
`display:flex`** —— 地址/工具行因此退回 `block`，其内部 `flex:1 1 auto` 失效，**地址栏缩成 163px**（用户看到的“没加宽”）。
修法：①创建时**记下原始 display**（`data-kit-own-display`，且必须在设完 cssText 之后再记）；②对结构性容器
（`addrRow`）在布局里**强制 `flex/none`**，不依赖记忆值（收养来的旧面板可能已丢值）；③自定义缩放输入框单独管理显示。

### 3.9.10 R-OWN v10：顶栏细节（用户 2026-10-10 要求）

| 要求 | 实现 | 实测 |
|---|---|---|
| 标签旁的网址不再显示 | 删除"把 URL 写进 urlText"的同步；`urlText` 只作**临时状态提示**（6s 自动清空，`agentStatus()`） | 顶栏只剩 `🤖 Agent 浏览器` + 标签 chip；网址只在地址栏 ✓ |
| ←→↻ 加方框、合适间距、图标居中 | `mkNav` 与截图/批注共用同款**方框**：`26×22 + inline-flex + align/justify center`；行内 `gap:6px` | 三个导航键与截图/批注同为方框且字形/图标居中 ✓ |
| 截图/批注图标居中于方框 | `mkBtn` 改为 `display:inline-flex;align-items:center;justify-content:center;width:26px;height:22px;padding:0;line-height:1` | 图标垂直/水平居中 ✓ |
| **默认尺寸改 1920×1080 档位** | `AGENT_VIEW_PRESETS` 把 `1080p` 提到**首位**并作为默认；`agentViewResolvePreset` 兜底、`ui.preset` 初始化、收养兜底全部改 `'1080p'` | 新开窗口 `resolution: 1920×1080`、预设下拉首项为 Desktop · 1920×1080 ✓ |

## 4. 风险：截图会崩（本轮实测）
- ZCode 源码注释原文：**「走 CDP Page.captureScreenshot（规避 renderer webContents.capturePage 的 V8 FATAL，且拿全页）」**——他们踩过并绕开了。
- 2026-10-09 23:2x：探针调用 `<webview>.capturePage()` 后 DSH 进程崩溃重启（同一探针里还有 `sendInputEvent` 与页内 console hook，不能 100% 归因，但 `capturePage` 是唯一有已知 V8 FATAL 记录的调用）。
- 建议：`screenshot` 命令改成**分级**——首选（若将来拿到 CDP）；当前退化为「仅在可见且小面积时调用 + try/catch + 失败不重试」，并在 pitfalls 记一条；**不要在探针/回归脚本里裸调 capturePage**。

## 5. 建议路线（按投入产出排序）

### 5.0 宿主侧三条路线（横向调研结论，决定「控制台/网络」能不能补齐）

| 路线 | 能力 | 代价 | 现状 |
|---|---|---|---|
| ① **宿主主进程桥**：Electron main 里 `webContents.on('console-message')` / `sendInputEvent` / `capturePage` / `will-download` | 控制台流、可信输入、截图，**不用 CDP** | 需要 DSH 官方开一个宿主插件 API（我们够不到 main） | ❌ 未开放 |
| ② **remote-debugging 端口 + 纯 CDP 客户端** | **完整 DevTools 能力**（Runtime/Log/Network/Input/Page 截图、多 target 一次 attach） | 需要 DSH 以 `--remote-debugging-port` 启动（`--auto-connect` 读 `DevToolsActivePort`）；安全面要收口 | ❌ 未开放——**纯 Node 插件拿到完整能力的唯一路径** |
| ③ **页内 hook**（本插件可独立完成） | console/error/unhandledrejection/fetch-XHR 环缓冲 → `browser_console` 工具 | 丢早期日志与浏览器级消息、每 frame 都要注入、无断点/trace | ✅ 可落地 |

→ 对外建议（可并入 WebHID 那条 Discussion）：请 DSH 开放 ①/② 任一宿主能力；在那之前我们用 ③ 兜底。
  另据调研：Electron `webContents.debugger` 的 detach 会被「用户手动打开 DevTools」触发（官方文档），
  一次 attach 可管多个 target（多 tab/webview）——若将来走 ②，这是必须处理的边界。


**P0-A｜把命令通道升级为一等 agent 工具**（证据：`ctx.tools.register(defineTool({name,description,parameters,output,execute}))`，`inject=['tools']`；参考 `zcode-dispatch/index.js` L410 与 `refs/dsh-tools`）
- `browser_navigate` / `browser_snapshot` / `browser_click` / `browser_type` / `browser_console` / `browser_tabs` / `browser_open` / `browser_screenshot`。
- 好处：模型可见、参数有 schema、有校验与呈现；现有命令通道保留为内部实现。

**P0-B｜页内控制台通道**（DSH 无 CDP 的现实解）
- 注入 console/error/unhandledrejection/fetch-XHR hook（复用 `src/hid-observer.js` 的 console 镜像经验），页面内环形缓冲 + `dump({level,since,limit})`；
- `browser_console` 工具读它；可选在 `shell.overlay` 或 `sidebar.right.*` 槽位做可视化控制台面板。

**P0-C｜真输入事件**
- 用 `<webview>.sendInputEvent({type:'mouseDown'|'mouseUp'|'keyDown'|'char'|...})` 替代/补强 DOM 合成点击与输入（可信事件，框架与反爬都认）；**需先做一次小范围安全实测**（只发无害事件），并确认不会像 capturePage 那样触发崩溃。

**P0-D｜开页 + 枚举（回答本次提问）**
- `ctx.inject(['sidebarRight'])` → `openTab('browser',{params:{url}})` / `openTabs.getSnapshot()`；
- 兜底：DOM `document.querySelectorAll('webview')` 枚举（已有）。

**P1**：等待原语（selector/导航/文本）、键盘/滚动/悬停/select/check/drag、back/forward/getState、网络 hook、ref 失效语义。
**P2**：cookie/storage、文件上传下载、多页面并发与租约隔离（`dshDesktop.browser.acquire/release`）。

## 6. 与外部项目的对标

- 本地已有对标（`browser-annotation-and-screenshot-research.md` §2、§5.5）：ZCode BrowserCommand 全清单（`navigate/getState/back/forward/reload/screenshot/snapshot/click/type/press/scroll/hover/select/check/drag/elementInfo/evaluate`）、chrome-devtools-mcp、playwright-mcp；
- 外部横向调查（chrome-devtools-mcp / playwright-mcp / browser-use / Stagehand / Browser MCP / Nanobrowser / Claude-in-Chrome 等）见 `.local/browser-agent-landscape.md`（子代理产出，持续推进中）。

## 7. 落地进度（2026-10-10 00:2x 收尾）

| 路线项 | 状态 | 产物 |
|---|---|---|
| P0-D 开页/枚举页面/关标签/面板 | ✅ 已实测 | `browser-tabs / browser-open / browser-close / browser-panel`（§3.1） |
| P0-A 工具化（一等 agent 工具） | ✅ 已实测 | `plugin/browser-tools.host.mjs`（22 个 `browser_*` 工具，§3.3 链路） |
| P0-B 控制台/网络通道 | ✅ 已实测 | `src/console-observer.js` + `browser_console`（§3.3） |
| P0-C 可信输入 | ✅ 已实测 | `input` 命令 + 交互族工具 + 遮挡检测（§3.4） |
| P0 风险止血（capturePage） | ✅ 已实测 | 四件套护栏 + 崩溃回环断路器（§4） |
| P1 等待/状态/历史/表单 | ✅ 已实测 | `browser_wait / browser_state / browser_history / browser_select / browser_check`（§3.5） |
| P1 ref 健壮性 | ✅ 已实测 | `browser_element_info`（元素档案 + 遮挡 + 失效 ref 明确提示）；快照默认 compact 省 token |
| P1 网络观测 | ✅ 已实测 | console-observer 的 fetch/XHR 捕获（`browser_console {net:true}`） |
| P2 cookie/storage、文件上传下载、多页面租约并发 | ⏳ 未做 | 需 CDP 或 `dshDesktop.browser.acquire` 租约（见 §5.0 路线②） |
| 宿主侧 DevTools/CDP（完整能力） | ⛔ 需 DSH 官方开放 | §5.0 路线①/②——建议并入 WebHID 那条 Discussion 一起提 |

**注**：`capturePage` 实测在**可见且 ≥80px** 的面板上连续调用两次未崩（3.1s / 54KB），隐藏 surface 一律拒绝；但 ZCode 的 V8 FATAL 记录仍在，故护栏保留、探针禁用裸调。

## 8. 后续可选项（按价值排序）

1. **P2 交互/状态深化**：cookie/storage 读写（需 CDP 或 `webview` session 代理）、文件上传（`DOM.setFileInputFiles` 等价：Electron 无直接 API，可试 `input.files` 注入 + `DataTransfer`）、下载观测（session `will-download`）、多页面并发与租约隔离（`dshDesktop.browser.acquire/release`）。
   - ✅ 已做：storage（页内，HttpOnly 除外）、文件上传（DOM+DataTransfer）、`browser_find` 省 token；
   - ⏳ 租约自持视图：契约已钉死（§3.8），实现属独立特性；
   - ⛔ 下载观测 / 整页截图 / HttpOnly：需 DSH 宿主侧能力。
2. **省 token 再进一步**（横向调研 #9/#10）：`browser_find`（在快照里按文本/正则只回匹配节点+路径）、快照增量（`--delta`）、大输出落盘。
3. **对 DSH 官方的诉求**：开放宿主主进程桥（`console-message` / `sendInputEvent` 之外还需 session 级 API）或允许 `--remote-debugging-port` + 插件作纯 CDP 客户端（§5.0 路线①/②）——那将一次性补齐控制台/网络/整页截图/文件上传。可与 WebHID 的 Discussion 合并提出。
