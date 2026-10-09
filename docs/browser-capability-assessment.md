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
