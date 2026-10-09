# dsh-browser-kit

> DSH 内置浏览器增强工具集：**元素批注 · 截图回传 · WebHID 直连 · 视觉反馈闭环**
> 状态：**共享批注会话 + 命令通道（25 action）+ WebHID 系统层直连桥 + WebHID polyfill（页面零修改直连 HID 设备）可用（2026-10-09，annotator 1.6.2 / hid-shim 1.2.0）** · 本 README 是实施会话的入口文件
> 现行行为以 `src/` 与 `pitfalls.md` 为准；`docs/delivery-*.md` 为各功能**交付时点快照**，可能已被后续需求推翻（如 delivery-01 的「密码框跳过」已移除）

## 1. 项目定位

让 DeepSeek Harness（DSH，本机 Electron 桌面应用）的内置浏览器具备与 agent 协作的交互能力：

1. **元素批注（核心差异点）**：批注态下连续点选多个元素，每个元素就地钉编号标记并输入修改意见（可留空），意见与元素一一绑定；一键提交后 agent 收到的每条批注都是「意见 → 元素信息」的明确配对——弥补 ZCode「元素→会话附件」多元素无法区分描述的短板；
2. **截图回传**：一键截取当前页面，agent 拿截图做视觉识别——自动化测试与视觉验收的基础设施；
3. **设备通讯观测 + 控制台调试（SDK 无关）**：hook 在 `navigator.hid / serial / usb` 平台 API 层，任意项目、任意 SDK 通用（当前 业务 WebHID，后续其它项目其它 SDK 直接复用）；agent 能获取收发报文、页面 console 流，并执行调试操作（CDP evaluate / 注入 mock）验证通讯链路；
4. **WebHID 直连桥 + polyfill（2026-10-09）**：DSH 宿主缺 `select-hid-device`（Chromium 缺省静默 resolve `[]`，见 pitfalls P35 / 官方 Discussion #8994）。本插件用 node-hid 在宿主 RUN_AS_NODE 进程做**系统层直连**（face：`hidList/hidOpen/hidRead/hidWrite/hidClose`），并在 guest 页注入 **WebHID polyfill**（`src/webhid-shim.js`）：`navigator.hid.requestDevice()` 弹 dsh-kit 选择器（复用批注面板视觉），`open/sendReport/oninputreport/close` 全部经命令通道转发桥——**页面零修改直连 HID 设备**（实测某 WebHID 音频配置器站点）。
   - **1.2.0（P43-P45 真机定论）**：①face 双层信封拆包只能用信封形状判定，业务键谓词会让 `hidRead` 结果恒被判「无 data」→ 页面**全部 timeout**（真根因）；②读通道改**单飞 + 立即续读**、client 起 **HID 快泵**（自适应 40ms/400ms），一次读往返 **1.7–4.2s → 77–140ms**；③`inputreport.data` 对齐 Chrome 的 **DataView** 语义、`reportId` 单列；④监听器表与轮询所有权挂 window 级共享（重注入不再断流）。
5. **Agent 浏览器操作 + 页面管理（2026-10-09 起）**：命令通道新增 `browser-tabs`（跨会话枚举全部已开页面：sessionId/tabId/类型 + DOM 实时 url/title/wcId）、`browser-open`（自己打开指定网页，策略与地址栏一致：只 http/https、拒凭据、拒 DSH 自身 origin）、`browser-close`（关标签，省略 tabId = 关当前活动标签）、`browser-panel`（开/关右侧栏浏览器面板）；既有 `navigate / click / type / snapshot / screenshot / reload` 继续可用。
   - **已升级为 agent 一等工具（R-TOOL）**：`browser_tabs / browser_open / browser_close / browser_panel / browser_navigate / browser_reload / browser_snapshot / browser_click / browser_type / browser_eval / browser_screenshot`——host 侧 `ctx.tools.register(defineTool(...))` 注册，execute 经命令通道驱动 client 执行；工具名、参数 schema、超时与错误都由框架呈现（不必再手写 `command.json`）。
6. **Agent 操作可视化（R-GLOW）**：Agent 执行浏览器自动化时，浏览器窗口**四边亮起呼吸光效** + 左上角胶囊「🤖 Agent 操作中 · <动作>」，让用户随时看得见「Agent 正在操作」；末次操作后自动淡出，`agent-glow {op:on|enable|off|pulse|status}` 可常亮/关闭/手动脉冲（localStorage 持久，默认开）。
7. **页内控制台/网络通道（R-CONSOLE，2026-10-09）**：DSH 没有 DevTools/CDP（实测 `openDevTools()` 无效、宿主全库零 DevTools 引用、host 插件是纯 Node 进程够不到 Electron），故用**页内观察器**补齐：`src/console-observer.js`（纯 ES5 IIFE、零依赖、可重复注入）hook `console.* / window.onerror / unhandledrejection / fetch / XMLHttpRequest`，环形缓冲 500 条；agent 工具 `browser_console` 可 `dump({level,limit,filter,net,since})`、`mark` 打锚点、`clear`、`stats`、`uninstall`。**源码随命令下发 → 页面刷新/新开标签自动重装（自愈）**。
8. **可信输入（R-INPUT，2026-10-10 实测解锁）**：`<webview>.sendInputEvent` 能发 **Chromium 级真事件**（页面侧 `isTrusted === true`，React 受控组件/反自动化检测都认），且不像 `capturePage` 那样崩。工具族：`browser_click / browser_dblclick / browser_hover / browser_type / browser_press / browser_scroll`；**点击前做遮挡检测**（中心被盖住则提前失败并回报遮挡者，`force:true` 可强点）；`type` 支持 `clear` 与 `submit`，中文可用（value 为准）。
9. **等待/状态/表单补全（R-STATE/R-WAIT/R-FORM，2026-10-10）**：`browser_wait`（页面内轮询等 selector/text/url/load/fn，超时以 `matched:false` 返回，不报错）、`browser_state`（url/title/loading/前进后退可用性/视口/滚动/焦点/控制台计数）、`browser_history`（back/forward）、`browser_select`（按 value 或文本选项）、`browser_check`（checkbox/radio 勾选）、`browser_element_info`（元素档案：属性/值/勾选/几何/**遮挡情况**；ref 失效明确提示重取快照）；`browser_snapshot` 默认 **compact** 省 token。合计 **22 个 `browser_*` 工具**。
10. **会话隔离（R-SCOPE，2026-10-10 用户需求）**：**自动化只作用于本会话的浏览器窗口**——工具层把「调用方会话 id」随命令下发，client 只在 `[data-sidebar-right-session="<调用会话>"]` 子树里找 webview；本会话没有已挂载面板、或面板操作的目标不是前台会话时**一律明确拒绝**（绝不去动别的会话）。另有**「用户正在输入」守卫**（焦点在输入框且不在本会话面板内 ⇒ 拒绝，`force:true` 才继续）与**焦点归还**（操作完把焦点还给原元素），避免打断用户打字。
11. **P2 深化（2026-10-10）**：`browser_storage`（localStorage/sessionStorage/cookie 的 get/set/remove/clear；HttpOnly cookie 需 CDP 故不可见）、`browser_upload`（DOM+DataTransfer 注入 `File` 到 `<input type=file>`，等价 CDP 的 `DOM.setFileInputFiles`，上限 4MB）、`browser_find`（**省 token**：按关键词在 elements/text/links 三种模式下只回匹配项，命中元素带 ref 可直接点击）。合计 **25 个 `browser_*` 工具**。仍需 DSH 宿主能力的项（下载观测 `will-download`、整页截图 `Page.captureScreenshot`、独立浏览器视图租约）已在评估文档 §8 列明。
12. **Agent 自持浏览器窗口（R-OWN，2026-10-10 实测打通）**：用 `dshDesktop.browser.acquire(storageIdentity)` 拿**自己的租约**、自建 `<webview>`（`name=<lease>` + `partition`）挂在右下角小窗里——**不占任何会话、不碰用户侧栏**，后台会话也能持续自动化。
    - **登录态复用（默认）**：storage identity 按官方公式 `cwd:<workspace.path>` 自动探测（工具层从 `exec.agent.session.header.cwd` 取路径，用 `acquire(候选).partition` 与侧栏 webview 的 partition **逐字比对**验证），命中即**与侧栏窗口同分区 ⇒ 共享 cookie（含 HttpOnly）/localStorage，免登录直接测**；传 `storageIdentity:'dsh-browser-kit:agent-view'` 可改用独立干净分区。
    - **多分辨率**：预设同 Chrome DevTools 设备模式（**默认 Desktop · 1920×1080**；另有 2K 2560×1440、4K 3840×2160、1440×900、1280×720、iPad Pro 1024×1366、iPad mini 768×1024、iPhone 15 Pro 393×852、iPhone 15 Pro Max 430×932、Pixel 7 412×915、Galaxy S20 360×800）与自定义 `WxH`，可带 `dpr`。
    - **100% 显示、不缩放（默认）**：guest 视口=目标分辨率且**按 1:1 显示**（装不下由窗口内滚动查看）；
      需要缩到窗口内看得全时用 `op:'fit', fit:true`。
    - **空闲即让给用户（协作）**：Agent 操作中窗口边框为青色，**空闲 4 秒后回到中性边框**（不暗示占用）；
      默认**空闲 10 分钟无 Agent 操作即自动释放窗口**（`op:'idle'` + `idleReleaseMs` 可调，0=不释放），
      期间用户可随时手动操作该窗口（点击/滚动/输入都可用，Agent 操作完也会把焦点还回去）——**人机协作同一窗口**。
    - **小窗形态 + 顶栏控件**：默认右下角 **260×44** 小窗（不遮挡 DSH），**点头部标题**或 `−` 按钮展开/收起；
      展开态顶栏（左→右）：`标题 · URL · 分辨率▾ · 缩放▾+自定义 · 截图 · − · ✕`（收起态只留 `标题 · URL · ▣ · ✕`）。
      展开时窗口**贴 DSH 标题栏之下（top:46px）并置顶 z-index**，不会被右上角三个窗口按钮遮挡。
    - **主题适配（DSH 明/暗两套）**：面板配色走主题变量；**原生下拉弹层**按检测到的明暗设 `color-scheme` 并给每个 `<option>` 显式上色（否则深色主题下是「白底白字」）；主题令牌在浮层里解析成透明时用显式兜底色。主题切换后 1 秒内自动跟上。
    - **页面缩放（等同 Chrome）**：`op:'zoom', zoom // 或 zoomPct`，范围 25%–500%（预设 25/50/67/75/80/90/100/110/125/150/175/200/250/300/400/500% + 自定义输入）；与预设 `dpr` 取乘积后走 `setZoomFactor`，可信输入的坐标换算自动自洽。
    - **截图供视觉分析**：`browser_agent_window {op:'screenshot'}`（或 `browser_screenshot {target:'agent'}`）把当前窗口画面落盘（实测 2K 下 2560×1440 / 1.37MB），再用 `read_image` 做视觉鉴定或布局复刻。
    - 页面级工具统一带 `target: agent|session`，**缺省自持窗口优先**（用户要求：默认不碰他的窗口），没有自持窗口才退回本会话面板。

13. **侧栏浏览器工具条新增两个图标（2026-10-10 用户要求）**：挂在**批注图标同一处**（`form[class*="toolbar"]`，P37 认领制，与批注按钮同一套接管逻辑）；**显示顺序（用户指定）= 设备尺寸 → 截图 → 批注**（首个取 `margin-left:auto` 右对齐），「↘ 同登录态开进自持」紧贴 DSH 的「系统浏览器打开」右侧——
    - **设备尺寸**：点击弹出分辨率清单（2K/4K/1080p/1440×900/1280×720/iPad/iPhone/Pixel/Galaxy + 重置）。选中后把该面板的 guest 视口设成预设分辨率，**显示缩放按「当前浏览器板块的尺寸」计算**（`k = min(1, 板块宽/预设宽, 板块高/预设高)`）。
      实测：选 2K → `width:2560px` + `transform:scale(0.448)`（1147/2560）、**页内 `window.innerWidth = 2560×1440`**；重置即恢复自适应面板。
      ★踩坑：DSH 侧栏 webview 的宽度由 flex/百分比决定，**普通 inline width 会被压回原宽**（写 393px 实际仍 1149px）⇒ 必须 `style.setProperty(..., 'important')`。
    - **截图到输入框（不再走剪贴板）**：点击把**当前浏览器截图直接插入会话输入框**（图片附件，可直接发送给 Agent）。
      实现：PNG → `File` → `ClipboardEvent('paste')`（**路径①**）；未被编辑器接受则用 `DragEvent('drop')`（**路径②**，两条均实测可用）；
      校验用**轮询等待**（Lexical 异步渲染，450ms 回读会误判失败——实测教训）。
      **只插图片、绝不追加任何文字**（用户明确要求）。
    - 尺寸弹层**向下展开**（向上会与 DSH 右上角图标堆叠重叠遮挡）；下方空间不足才翻到上方。
14. **自持窗口「截图」= 同款图标**：点击后**直接插入会话输入框**（图片附件）+ 落盘（供 Agent `read_image` 分析）；`browser_agent_window {op:'screenshot', insertToComposer:true}` 亦同（`clipboard:true` 仍可显式要求写剪贴板，但缺省不做）。

15. **工具条「↘」图标：把当前页以同登录态开进自持浏览器（2026-10-10 用户要求）**：紧贴 DSH「系统浏览器打开」图标（↗）右侧（`insertAdjacentElement('afterend')`，找不到才退回末尾）。点击读取该面板当前 URL 与该面板所属会话（沿 DOM 上溯 `data-sidebar-right-session`），用同一 storage identity 在自持窗口打开 ⇒ **登录态一致**。
16. **自持浏览器多窗口 + 地址栏 + 批注（2026-10-10 用户要求）**：
    - **多窗口**：面板内**标签条**——每个窗口一个 chip（标题 + ×，末尾「＋」新建）。每个窗口**各自 acquire 一份租约**（各自独立的浏览上下文），但共用同一 storage identity ⇒ 登录态一致。
    - **布局对齐 DSH 浏览器（2026-10-10 用户要求）**：**行1** = `🤖` 标题 + 标签条（chip：标题+×）+ `＋` + 右侧 `−`/`✕`；**行2** = `‹ 后退` `› 前进` `↻ 刷新` + **加宽地址栏**（唯一弹性项，2K 下实测 2126px）+ 尺寸/缩放/截图/**批注图标**（`ANNOT_ICON_SVG`，与 DSH 批注图标同款）。已删除「前往」（回车即导航）。
    - **地址栏**：可输入网址、回车（或点右侧图标）在当前窗口导航；切窗口/导航后自动回填。
    - **只让活动窗口可见**（其余 `visibility:hidden` + `pointer-events:none` + `data-dsh-kit-agent-view-inactive`），且 `agentViewWebview()` **只返回活动窗口**——刻意避免对隐藏 surface 调 `capturePage`（P47-B 高危）。
    - **批注面板 = 宿主渲染（R-OWN v20 → v22 审查收敛）**：面板**不再由 guest 页面渲染**。guest 侧以 `mirror: true` 启动（页内面板 `display:none`，只保留状态/徽标），宿主把面板 DOM **镜像**到 `#dsh-kit-annot-mirror`，在**屏幕坐标**里定位——**规则唯一真值**是 [`src/annot-mirror-anchor.mjs`](src/annot-mirror-anchor.mjs) 的 `mirrorPlacement()`（右缘贴板块、下缘贴自持小窗上沿、**上界夹取**，展开态不会被顶出屏幕）。原因：guest 内的 `position:fixed` 浮层**出不了 guest 视口**（= 页面底边），页面顶部对齐后必然压在网页内容上。
      - 按钮按**稳定属性**绑定（`data-dsh-kit-panel-clear|submit|cancel|chevron`），文案改字不会静默失联；列表数据在 guest 侧**始终渲染**，展开/收起只控显示。
      - 跨进程开销：指标推送带**值缓存**（不变不发）、镜像快照带 **rev**（内容未变只回 rev，不搬整份 outerHTML）、镜像同步有**单飞护栏**。
    - **宿主页面 CSS 隔离**：批注面板/提示条加 `all: initial` 前缀，避免不同站点 CSS 影响面板排版（自持窗口与会话窗口表现一致）；批注器版本 **1.7.3**，由 client 的 `EXPECTED_ANNOT_VERSION` 与版本号比对后**自动重注入**。
    - **批注可用且共享**：面板内「批注」按钮 = **总开关**，把**所有**浏览器窗口（侧栏各面板 + 自持各标签）一起加入/退出**共享批注成员表**——同步循环按 `gid` 在所有成员间广播，所以自持浏览器与 DSH 会话浏览器**共用同一批注**，编号跨窗口延续，落盘每条带 `Window:` 归属行（如 `DSH 浏览器窗口 1（会话 xxxxxx）` / `自持浏览器 tab2 · Example Domain`）。
    - 工具：`browser_agent_window {op:'tabs'|'tab-new'|'tab-close'|'tab-select'|'annotate'}`（`tabId`、`on` 参数；`status` 里带 `tabs[]/activeTabId/tabCount`）。

17. **v22 审查收敛（2026-10-10，用户要求 review/simplify/解耦/验收）**：一轮"实现 → 独立审计 → 收敛"的闭环。
    - **删除**（面板改宿主渲染后遗留的死管道）：`visibleHeight`/`bottomExtra`/屏幕锚点三套定位机制、
      `setVisibleWidth()`/`setUiScale()` 死接口、`visibleBandHeight()`、镜像模式下无人消费的字段与
      被丢弃的写入（`void annotOn`/`void 0`/`__dshKitLastSubmit`/`data-dsh-kit-agent-view-always`）。
      保留的只有**提示条**真正需要的两项：`visibleWidth` + `uiScale`（且公式收敛为 `inverseScale()` 单一来源）。
    - **修掉审计发现的真 bug**：①镜像面板里"批注列表"永远展开为空（`listExpanded` 唯一写者是被隐藏的页内 chevron）
      ②自持窗口**展开态**时镜像面板被顶出屏幕 ③1s tick 无单飞护栏（P22 失效类下 IPC 无界增长）
      ④镜像缓存/陈旧 root 失联 ⑤`finishSubmit` 无重入护栏（双击提交落盘两次）⑥`mirrorMode` 粘滞
      ⑦会话复位两处字面量漂移（提交后 `count/startedAt` 报旧值）。
    - **解耦**：落位几何抽成纯模块 [`src/annot-mirror-anchor.mjs`](src/annot-mirror-anchor.mjs) + client 内嵌
      canonical 副本对拍；按钮改**稳定属性**绑定；`sysBrowserBtnOf` 去重；会话复位收敛为 `resetAnnotState()` 单一真值。
    - **测试**：新增 `test/annot-mirror-anchor.test.mjs`（4 例：canonical 对拍 / 展开态不被顶出屏幕 / 上界夹取 / 右缘公式）
      与 `test/annotator-v22-guards.test.mjs`（5 条护栏：版本自洽 / 死接口不得复活 / 镜像按钮属性↔API 映射 /
      tick IPC 预算与单飞 / 复位单一来源）。全量 **180 项：179 过 / 1 跳过**（跳过项需 Chrome/CDP）。

**明确不做**：画笔涂鸦式批注；MVP 阶段不做后台/隐藏 tab 截图；不修改 DSH 权限策略（无必要，见调研文档 §4.3）。

## 2. 背景一页纸

- DSH 内置浏览器 = GUI 文档里按 lease 挂载的 `<webview>` guest（sandbox/contextIsolation 强制开启，main 侧 `will-attach-webview` 白名单校验）。目前它只有「看」的能力：用户无法指元素、agent 拿不到视觉。
- 对 DSH 的二进制级实测（调研文档 §4）确认：批注/截图所需能力（`executeJavaScript` / `capturePage` / `debugger`）是**宿主侧 API，不受浏览器 deny-all 权限策略影响**——与 WebHID 探测中发现的权限锁完全无关，本项目的实现不依赖也不触碰 DSH 权限配置。
- 方案主体照抄 ZCode（Z.ai 官方开源 coding agent，Apache-2.0）：它的 element picker + Markdown 上下文协议 + CDP 截图管线已在生产验证，源码已克隆本地可精读。
- **与 ZCode 的关键差异**：ZCode 把元素作为会话附件堆积，多元素时无法区分描述；本项目主形态是「点击元素 → 就地钉标 → 就地批注」，意见与元素一一绑定（交互原型：BugHerd / Marker.io 类设计协作工具；开源参照 pageflag、onlook）。

## 3. 新会话开工指引

**读单（按序）**：
1. 本 README（全景 + 纪律）；
2. [browser-annotation-and-screenshot-research.md](browser-annotation-and-screenshot-research.md)——**§0 摘要 → §4 DSH 实测事实 → §5 落地方案 → §6 路线与验收**；§2（ZCode 解剖）与 §8（文件索引）在写代码时对照查阅。

**环境事实**：
| 项 | 值 |
|---|---|
| 本项目目录 | `F:\My Code\dsh-browser-kit\` |
| ZCode 源码克隆 | `F:\My Code\ZCode\`（github.com/zai-org/ZCode，main 分支，浅克隆） |
| 插件范例仓 | `F:\My Code\zcode-dispatch\`（完整 host+client 范例 `zcode-dispatch\`；官方模板副本 `refs\templates\decoration\`） |
| DSH 应用 | `D:\DeepSeek\DeepSeek Harness.exe`（Electron 44 / Chromium 152；asar 于 `D:\DeepSeek\resources\app.asar`，**本项目不改 asar**） |
| GUI | http://127.0.0.1:19387 ；client plugin HMR 接收器已激活，但插件产物重建需 `pnpm run dev:web` watcher 或手动重建 Web 产物后刷新页面 |

**第一步（MVP-0，✅ 已完成 2026-10-04，证据与结论见 [docs/delivery-02-mvp0.md](docs/delivery-02-mvp0.md)）**：
1. ~~调 `cordis_inspect_list`~~ ✅（注意：本 harness 版本 `cordis_inspect_query` 的 `input` 参数有 bug，传对象即拒；host `Service.listService` 是静态声明目录，验证不了运行期 face 注册）；
2. ~~读插件范例源码~~ ✅ 范例在 `F:\My Code\zcode-dispatch\`（早前记录的 `dsh-plugins\` 已不存在）；
3. ~~写最小 client plugin 探测~~ ✅ 探测插件 `@local/dsh-browser-kit`（`plugin\`）已装进 desktop profile：GUI 主世界直得原生 WebViewElement，`executeJavaScript('1+1')=2`、`capturePage()` 真实 PNG、`getWebContentsId()` 全通；
4. ~~定主路径~~ ✅ **A（client plugin）为主、host 插件做落盘+工具面的混合架构**：host 插件实测运行于 `ELECTRON_RUN_AS_NODE=1` 的 dsh-desktop-host runner 子进程，**不可触达 webContents/BrowserWindow**（Path B 否决）；Path C（外挂 Chrome）不需要。

**纪律**：踩坑即记 `pitfalls.md`（本项目根，自建）；DSH 升级后回归 MVP-0 清单；移植 ZCode 代码保留 Apache-2.0 版权与 NOTICE；改动落在本项目目录内，勿散落。

## 4. 目录结构

```
dsh-browser-kit/
├── README.md                                        # 项目入口
├── NOTICE.md                                        # Apache-2.0 归属声明（ZCode 移植来源与修改说明）
├── package.json                                     # 零 npm 依赖 · Node ≥22 · scripts.test = node --test
├── .gitignore                                       # shots/ annotations/ node_modules/
├── browser-annotation-and-screenshot-research.md    # 方案调研（自足交接件，含 DSH 实测证据）
├── tasks/
│   └── zcode-task-01-portable-layer.md              # ZCode 任务01：可移植资产层（任务书）
│   ├── docs/
│   │   ├── delivery-01..12.md                          # 任务/交付记录（01 可移植层 → 12 胶囊+撤回 face）
│   │   └── mvp0-probe-state.md / mvp3-loop-state.md    # 探测期/闭环期交接件（历史留档）
├── plugin/                                            # DSH 插件 @local/dsh-browser-kit
│   ├── package.json / cordis.patch.yml                # bundle 声明（exports["."] → entry.mjs；junction+install_bundle 安装）
│   ├── entry.mjs                                      # host 入口永久薄壳（?ts=mtime-seq 击穿 ESM 缓存，pitfalls P13）
│   ├── host.impl.mjs                                  # host 业务（探测/face/落盘/_internals 测试导出；改后 toggle 即生效）
│   ├── wire.host.mjs                                  # TYPERT 描述符 + createRemoteFace（10 方法，client↔wire 对账有测试）
│   ├── client.js                                      # client 半边（探测/共享批注会话/胶囊/命令通道/工具条/面板）
│   └── .data/                                         # 运行期数据（command.json / command-results.jsonl / probe-report.json）
├── src/
│   ├── hid-observer.js                                # L1 通用设备观测（HID/Serial/USB，自包含 IIFE，零 DSH 依赖）
│   ├── element-annotator.js                           # 网页批注层 v1.5.0（picker 基座 + 共享会话/同页门控/清除，自包含 IIFE）
│   ├── annotations-protocol.js                        # 批注协议 v2 build/parse（纯函数 ESM）
│   ├── virtual-hid-device.js                          # mock 设备（ESM + 可注入 IIFE 双形态）
│   └── cdp/
│       └── drive.mjs                                  # CDP 驱动（launch/connect/inject/evalJs/console/screenshot）
├── test/
│   ├── helpers/                                       # vm 沙箱 + Chrome 冒烟公共工具
│   ├── fixtures/                                      # hid-mock-page / hid-docstart-page / page
│   ├── annotations-protocol.test.js                   # 协议 round-trip 全分支
│   ├── virtual-hid-device.test.js                     # mock 设备双形态
│   ├── hid-observer.test.js                           # observer 沙箱单测（HID/Serial/USB + detach/重注入）
│   ├── annotator-protocol-parity.test.js              # 批注层内嵌 builder ↔ ESM 协议逐字对拍
│   ├── cdp-smoke.test.js                              # CDP 五项冒烟（真实 Chrome）
│   ├── hid-fixture-smoke.test.js                      # 无硬件配对帧冒烟（evaluate 兜底注入）
│   └── annotator-smoke.test.js                        # 批注流全链路冒烟（含共享编号/门控/清除/删除日志）
├── pitfalls.md                                        # 踩坑记录 P1–P33（实施期自建）
├── README.md                                          # 本文件
├── NOTICE.md                                          # Apache-2.0 归属声明（ZCode 移植来源与修改说明）
├── package.json                                       # 零 npm 依赖 · Node ≥22 · scripts.test = node --test
└── shots/ annotations/                                # （运行期产物，已 gitignore）
```

## 5. 参考资料

| 资料 | 位置 |
|---|---|
| ZCode 源码（Apache-2.0） | `F:\My Code\ZCode\` · github.com/zai-org/ZCode |
| chrome-devtools-mcp | github.com/ChromeDevTools/chrome-devtools-mcp |
| playwright-mcp | github.com/microsoft/playwright-mcp |
| browser-use | github.com/browser-use/browser-use |
| pageflag（开源 BugHerd 替代，批注模式交互参照） | github.com/Laaaaksh/pageflag |
| onlook（AI 可视化编辑：点选元素→AI 检查/编辑，26.8k★） | github.com/onlook-dev/onlook |
| DSH 宿主实测证据 | 调研文档 §4（版本/fuse/权限/lease 机制，2026-10-04 探测） |

## 6. 当前状态与下一步

- ✅ 调研完成：ZCode 方案解剖 + 业界对比 + DSH 宿主实测 + 落地草案 + MVP 路线（见调研文档）。
- ✅ 任务01（ZCode）：可移植资产层——45/45 测试全绿（docs/delivery-01.md）。
- ✅ 任务02（主会话）：**MVP-0 接入验证**——主路径 A（client plugin）+ host 落盘/工具面的混合架构，Path B 否决（host 插件在 RUN_AS_NODE 子进程，pitfalls P14），Path C 不需要（docs/delivery-02-mvp0.md）。
- ✅ 任务03（主会话）：**MVP-1 截图管线**——client `capturePage()` → face `saveShot` → `shots/*.png` + index.jsonl，agent `read_image` 正确识别页面（公网 Vue 站点实测）；face 加方法免重启（pitfalls P16）（docs/delivery-03-mvp1.md）。
- ✅ 任务04（主会话）：**MVP-2 批注模式接入**——`element-annotator.js` 零改动注入 guest，机器全链路验收（合成事件 3 条批注 → `saveAnnotations` 落盘 → 协议解析 round-trip 无损）；命令通道（MVP-4 种子：`guest-eval` 等）顺带交付（docs/delivery-04-mvp2.md）。
- ✅ 任务05（主会话）：**MVP-3 闭环体验**——「批注→agent 修改→截图确认」单轮闭环全自主跑通（demo 页实物验证）；面板 ZCode 式批注图标开关 + 左下角定位；关键约束发现：guest 导航受 allowedNavigation 白名单（agent 侧用 document.write 替代）（docs/delivery-05-mvp3.md）。
- ✅ 任务06（ZCode 派发 + 主会话落地）：**host impl 单元测试**——39 项全绿（全量 83/83）；P21：headless 派发会话无许可客户端，读写类派发须 mode=yolo 或交互会话执行（docs/delivery-06-plugin-tests.md）。
- ✅ 任务07（主会话）：**MVP-4 agent 自动化命令集**——snapshot（真实页面 21 元素实测）/ click / type / reload / navigate / page-inject / page-open / guest-eval(frame)；P22 document.write 悬挂、P23 var 遮蔽、P24 iframe CSP 两道墙（docs/delivery-07-mvp4.md）。
- ✅ 任务08（主会话）：**共享批注会话 + 正式形态入口**——同会话多窗口共用批注（编号跨窗口延续、saveMerged 合并单文件）、工具条批注图标（每标签一个，尽力而为注入）+ 标签菜单项 + 面板最小化；自诊断体系（kit-status/PanelBoundary/findings.gui）（docs/delivery-08-shared-session.md）。
- ✅ 任务09-12（主会话，2026-10-05 连续迭代，docs/delivery-09..12）：**共享会话真打通 + 输入框胶囊 + 主题适配**——
  - P25/P26/P27 三根因修复（成员先入册再 start / 编号下限不双加 / webContentsId 身份统一）+ 会话自动加入（窗口1开启 → 全部窗口数秒内亮起，leftIds 防拉回）+ 导航自愈；
  - **P29 face 装配对账**（client descriptors ↔ wire 方法表漂移 = 调用静默失败，W3 静态契约守护）；P30 Lexical 输入框延迟回读（同步回读必误报）；P31 会话指纹（document.title）防胶囊跨会话泄漏；P32 tbLeft 未声明（MutationObserver 快速重挂整体失效）；
  - **ZCode 式胶囊**：提交后输入框卡片内独占一行「N 条批注 ×」，× = 撤回（deleteAnnotations face，annotations/ 围栏）；同页门控（pageOk）防徽标串窗；样式全走主题令牌（明暗双主题自适应）；
  - **face 扩到 10 方法**（+deleteAnnotations/getStats/clearArtifacts），插件管理页卡片显示批注/截图数量与字节占用 + 一键清空；
  - 调试面板默认隐藏（panel-toggle 唤出，功能保留）；清理项：死 case 分支、tbLeft、双份助手、writeArtifact 三合一、dirname 内置化。
- ⏭️ 下一步：**人工验收包**——① 业务 Vue 项目（localhost:5173）连续 3 轮「批注→修改→截图」；② 双窗口共享批注人工确认（窗口2 编号从窗口1 最大号+1 延续）；③ 真实表单走 snapshot→type→click→screenshot 组合；④ 明暗主题下胶囊/徽标视觉复核；⑤ 向 DSH 官方提浏览器工具条插槽需求。
- 📋 队列中：MVP-5 = F4/F5（设备报文观测 + 控制台调试，调研文档 §5.5）——真实 Chrome 主路径已有 `cdp/drive.mjs` + `hid-observer.js` 全套资产；DSH 内置浏览器侧的注入走 client 插件（同 MVP-1 通道）。
- 关键修正（推翻调研文档 §4.4 预判）：host plugin 无 main 进程能力；`browserUse`/`computerUse` 等自动化属 DSH 主进程自有服务，第三方插件无门（F3 远期需求届时再评估）。
