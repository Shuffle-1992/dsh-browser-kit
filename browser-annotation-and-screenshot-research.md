# DSH 内置浏览器「元素批注 + 截图回传 Agent」方案调研

> 项目：**dsh-browser-kit** · 2026-10-04 · 调研阶段产出（未开工实施）
> 目标：给 DSH 内置浏览器补两个能力——① 用户选中页面元素/板块并批注，批注内容 + 元素信息进入 agent 上下文（便于调布局）；② 一键截图当前页面，agent 拿截图做视觉识别（便于自动化测试）。
> 主体参考：ZCode 开源实现（github.com/zai-org/ZCode，Apache-2.0，TS，7.4k★），本地克隆于 `F:\My Code\ZCode\`。
>
> **本文档是自足交接件**：撰写自一次完成的调研会话（含对 DSH 宿主的二进制级实测），实施会话可零上下文开工。读法：赶时间读 §0；动手前必读 §4（DSH 实测事实）+ §5（落地方案）+ §6（路线与验收）。

---

## 0. 结论摘要

1. **ZCode 两套能力都齐，且思路可以直接抄**：
   - 人工批注 = 注入自包含「元素选择器」脚本到页面 → 采集结构化元素信息 → 以 **Markdown 块**拼进聊天 prompt（纯文本协议，可往返解析成 UI chip）。
   - Agent 截图 = 三通道截图（webContents.capturePage / CDP Page.captureScreenshot / Playwright），图像以 image content block 进模型上下文，超限降级为落盘 artifact + 路径。
   - **本项目差异点（用户明确要求）**：ZCode 是「元素→会话附件」，多个元素时无法区分描述（用户文字只存在于消息正文一处）；本项目改为**批注模式**——点击元素就地钉标并输入意见，意见与元素一一绑定（§5.2）。
2. **关键技术澄清**：批注与截图**不经过浏览器 permission handler**（DSH 那套 deny-all `setPermissionRequestHandler` 只管 getUserMedia/HID/通知等 Web API），只依赖「能对 guest webContents 调 `executeJavaScript` / `capturePage` / `debugger`」——这些是宿主侧 API，不受 Web 权限策略约束。**无需解 DSH 的权限锁（与 WebHID 问题完全无关）。**
3. 落地 DSH 的不确定点只剩**接入路径**：client plugin（renderer 侧）还是 host plugin（main 侧）能拿到 guest webContents 引用。§5 给出三条候选路径与逐项验证步骤。
4. 工程量分级：MVP（截图落盘 + 批注复制）很小；完整对齐 ZCode（后台 tab 截图 surface 协调器等）是重工程，**不建议**一步到位。
5. **HID 通讯观测与控制台调试（自动化测试基础设施，F4/F5）**：CDP/DevTools 没有 HID 报文域，但观测可**通用化**——CDP `Page.addScriptToEvaluateOnNewDocument` 在页面脚本执行前注入 HID wrapper，零 app 改动、对任意页面生效（L1）；语义标注为 app 侧可选增强（L2）；OS 层 USBPcap 兜底（L3）。控制台流与调试操作走标准 CDP（`Runtime.consoleAPICalled` / `Runtime.evaluate`），DSH 内置浏览器侧对应 `console-message` 事件 + `executeJavaScript`（§5.5）。

---

## 1. 目标与场景定义

### 1.1 功能需求

| 编号 | 需求 | 验收口径（DoD 以运行时表现为准） |
|---|---|---|
| F1a 快速引用 | 点选单个元素 → 元素结构化信息直接进入 agent 上下文（ZCode 式，适合「看看这个」） | 同 F1b 的定位标准 |
| F1b 批注模式（主形态） | 批注态下连续点选多个元素，每个元素就地钉编号标记 + 就地输入修改意见（可留空）；意见与元素一一绑定；一键提交打包全部批注 | agent 收到 N 条批注，每条「意见→元素」配对明确，能在源码中逐条定位（如 localhost:5173 的多个组件） |
| F2 截图 | 一键截取浏览器当前可视页面 → agent 获得图像做视觉识别 | agent 通过 `read_image` 类工具读取 PNG 并正确描述页面内容 |
| F3（远期/可选） | agent 主动操作内置浏览器：navigate / click / type / snapshot / screenshot | 参照 ZCode BrowserCommand 协议裁剪 |
| F4 设备通讯观测（SDK 无关） | hook 在平台 API 层（`navigator.hid`，Serial/USB 预留）——**任意项目、任意 SDK** 通用；agent 能获取通讯记录（方向/时间/reportId/原始字节/可选语义），用于自动化测试断言（例：切预设 → 应见对应下行帧 + 设备应答帧） | 对一个非 keysion 的第三方 WebHID 页面同样抓到配对 TX/RX；keysion 页面切预设的帧字节与协议一致 |
| F5 控制台调试 | agent 能读取页面 console 流，并能执行调试操作（查内部状态、evaluate JS、注入 mock） | agent 经控制台通道发现一条报错并定位原因；evaluate 读到应用内部状态 |

### 1.2 用户故事

- 「我指着这个卡片说：这里间距太大」→ agent 收到该卡片 selector+样式+我的说明，直接改组件。
- 「截个图看看现在页面长什么样」→ agent 读截图，发现按钮溢出，主动提修复建议。
- 自动化测试：agent 操作页面后自动获得操作后的视觉反馈（ZCode 的 turn-end 截图模式）。

### 1.3 明确不做（scope out）

- 不做画笔涂鸦式批注（ZCode 也没有；「指向 + 文字」已满足诉求）。
- 不在 MVP 阶段解决「后台/隐藏 tab 截图」（ZCode 为此写了 ~2000 行 surface 协调器，见 §2.2 复杂度警告）。
- 不修改 DSH 的权限策略（无必要，见 §4.3）。
- 不做 OS 级 USB 抓包（Wireshark + USBPcap）——仅作人工深度排查手段，不进自动化链路。

### 1.4 术语表

| 术语 | 含义 |
|---|---|
| DSH | DeepSeek Harness，本机 Electron 桌面应用（`D:\DeepSeek\DeepSeek Harness.exe`），GUI 服务于 127.0.0.1:19387 |
| guest | 内置浏览器里承载外部网页的 `<webview>` 实例 |
| lease | DSH 给每个 guest 发的租约（`about:blank#<leaseId>` + 独立 partition），main 侧 `will-attach-webview` 校验，防未授权挂载 |
| picker | 注入页面的元素选择脚本（ZCode 叫 element picker） |
| CDP | Chrome DevTools Protocol；Electron 里经 `webContents.debugger.sendCommand` 使用 |
| ref/uid | 快照里给元素分配的稳定引用 ID，agent 用它指哪打哪（playwright-mcp / chrome-devtools-mcp 模式） |

---

## 2. ZCode 实现解剖（主体参考）

### 2.0 代码分层与阅读地图

| 层 | 位置（相对 `F:\My Code\ZCode\`） | 职责 |
|---|---|---|
| 桌面 main | `packages/desktop/src/main/browserView/` | guest webview 生命周期、BrowserCommand 执行器、CDP、截图 surface 协调 |
| 桌面 renderer UI | `packages/ui/src/`（React） | UnifiedBrowserView、element picker hook、composer 集成 |
| CLI/agent 侧 | `apps/zcode-cli/packages/core/src/browser-client/` | agent 用的 browser facade（BrowserCommand 协议） |
| Node REPL 桥 | `apps/zcode-cli/packages/node-repl-host/src/browser-bridge.ts` | agent JS 沙箱里 `tab.screenshot()` 等的原生桥 |

### 2.1 批注链路（人工选元素 → agent 上下文）

**流程总览**：

```
[工具栏按钮] → useWebElementPicker.startPicking()
    → executeJs(buildWebElementPickerScript())          ← 传输无关出口
        路径①: <webview>.executeJavaScript(script, true)   (renderer 直调, userGesture=true)
        路径②: main IPC → browserGuestManager → guest.executeJavaScript(script, true)
    → 页面内: overlay 高亮 + popover 实时信息 → 点击采集 / Esc 取消
    → Promise resolve: {status:"selected", element:{...}}
    → dispatchWebElementContextAddToChat (window CustomEvent)
    → composer 监听 → chip 附件展示
    → 发送时 buildPromptWithWebElementContexts(): 拼成 Markdown 块追加进 prompt
    → 历史回显: parsePromptWebElementContexts() 正则反向解析回 chip
```

**注入脚本机制**（`packages/ui/src/lib/webElementPickerScript.ts`，664 行，自包含 IIFE，无外部依赖）：
- `window.__zcodeWebElementPicker` 单例：重复注入先 cancel 旧实例（`existing?.cancel?.()`）；
- **capture 阶段**监听 `mousemove/click/keydown`（`addEventListener(..., true)`，页面自身 JS 拦不住），`document.documentElement.style.cursor = "crosshair"`；
- 蓝色高亮 overlay：`border: 2px solid #2563eb; box-shadow: 0 0 0 9999px rgba(15,23,42,.10)`（四周压暗）；`pointerEvents:none`、`zIndex: 2147483647`、`position:fixed`；
- 悬浮 popover（深色毛玻璃）实时显示 `tag / 尺寸 / 颜色 / 背景 / 字体`（`getComputedStyle` 取值，颜色归一化为 `#RRGGBB`，透明背景则不显示该行）；
- popover 四向自动定位：优先元素外侧 4 方位，视口放不下则选可用空间最大方向并夹在视口内（源码注释明确处理了「元素贴边/近全屏」交互）；
- 点击 → `preventDefault + stopPropagation + stopImmediatePropagation`（capture 阶段，页面不收到点击）；Esc / `window.__zcodeWebElementPicker.cancel()` 退出；
- 导出为可执行字符串的技巧：`(${fn.toString()})(${JSON.stringify(options)})`——函数即模板，选项随参数注入。

**Payload schema**（`webElementContext.ts`）：

| 字段 | 说明 | 限额/防护 |
|---|---|---|
| pageUrl / pageTitle | 页面定位 | — |
| tagName / role / accessibleName | 标签 + 隐式 ARIA role + 可访问名 | role 隐式映射表：button/link/img/checkbox/radio/slider/textbox/combobox/navigation/main/form/heading |
| selector | CSS 路径：id 优先，逐级 tag+前2个class+nth-of-type，≤8 级 | `CSS.escape` 防转义 |
| xpath | 绝对 XPath，≤12 级 | — |
| text | 元素内文（input 取 aria-label/placeholder/name/type，password 显示 `[masked password input]`） | ≤4000 字符 |
| nearbyText | `closest("article,section,main,form,li,tr,dialog")` 的内文 | ≤4000 |
| htmlExcerpt | 克隆节点去 script/style/noscript/template；input.value 剥离、password 保留掩码 | ≤6000 |
| attributes | 白名单：id/class/href/src/alt/title/name/type/placeholder/aria-*（排除 value） | 每值 ≤500 |
| rect / style | `{x,y,width,height}` + `{color,backgroundColor,display,fontFamily,fontSize,fontWeight}` | 颜色归一 `#RRGGBB`/transparent |
| workspacePath / workspaceIdentity / capturedAt | 归属工作区与时间戳 | — |

**进上下文的协议——纯 Markdown**（最妙的设计，无专用存储、历史天然可重放）：

```markdown
# Web page elements:

## Element 1
URL: http://localhost:5173/checkout
Title: 结算页
Tag: button
Role: button
Accessible name: 提交订单
Selector: #checkout > div.cart > button.submit
XPath: /html/body/div[1]/main/section/div[2]/button[1]
Attributes: id="submit" class="btn primary" aria-label="提交订单"
Color: #FFFFFF
Background: #2563EB
Font: 16px Inter, system-ui
Font weight: 600
Display: flex
Rect: x=120, y=840, width=180, height=48

Text:
```
提交订单
```

Nearby context:
```
…购物车汇总…
```

HTML excerpt:
```html
<button class="submit">…</button>
```
```

- 字段级截断：Markdown 里单字段 ≤8000 字符，超出追加 `[truncated]`；
- composer 里批注以 chip 附件展示（`WebElementContextAttachmentChip`），发送前才拼 prompt；解析/拼装互为逆操作（正则按 `## Element` 分割、按标签行 + 围栏块取值）；
- **批注是什么**：没有画笔涂鸦；用户自由输入的文字就是聊天正文本身，选中元素的信息自动附加——「指向 + 文字说明」合成一条消息。

**ZCode 模式的局限（本项目的出发点）**：元素以 chip 附件形式堆积在一条消息里，用户文字只有正文一处——多个元素时无法区分「哪个意见对应哪个元素」，只能靠口头描述位置。本项目改为**批注模式**：意见在页面上就地输入、与元素绑定（§5.2）。

### 2.2 截图链路（agent 视觉识别）

**三条采集通道**（`browserCommandExecutor.ts` 按 command.method 分发）：

| 通道 | 实现 | 适用 | 备注 |
|---|---|---|---|
| viewport 快照 | 宿主 compositor 直读 guest surface（`captureViewportScreenshot`） | 默认无 clip、非 fullPage | 「Desktop 生产实现从 main 进程直接读取 guest surface，避开 Windows 下 CDP 对小 surface 的平铺」 |
| **CDP `Page.captureScreenshot`** | `webContents.debugger.sendCommand` + `Page.getLayoutMetrics` 做 CSS 像素归一化 | fullPage / clip / 后台 tab | 源码注释：「走 CDP Page.captureScreenshot（规避 renderer webContents.capturePage 的 V8 FATAL，且拿全页）」 |
| Playwright | `page.screenshot()` / `elementForRef(ref).screenshot()` | Playwright 执行器路径、元素级截图 | `adapters/src/browser/page-command.ts` |

**图像进模型上下文**：
- agent 显式 `tab.screenshot()` → `nodeRepl.emitImage(...)` → **image content block** 直接进上下文（`node-repl-session.ts`）；emitImage 接受 bytes/base64/dataUrl；
- 超大图自动降级（`core/src/mcp/image-normalization.ts`）：剥离图像块 → 落盘 artifact → 替换为文本 `Browser screenshot saved to: <绝对路径>`；受信宿主截图与第三方 MCP 图片的压缩策略分开处理；
- **turn 末自动截图**（`core/src/runtime/methods/browser-turn-screenshot.ts`）：每轮浏览器操作结束抓当前活跃 tab 截图追加进上下文——agent 自动获得「操作后视觉反馈」；无活跃 tab / 抓取失败仅记 telemetry 不报错；
- prompt 使用纪律（写在工具说明里，省 token）：「默认别开页面就截图；snapshot 与 screenshot 默认不要同轮都要；截图必须在同一 JS 调用里 `nodeRepl.emitImage(await tab.screenshot())` 返回，不能留作尾表达式」。

**复杂度警告（MVP 跳过项）**：`browserScreenshotSurfaceCoordinator + browserScreenshotActivityController + browserTransparentWindowBootstrap`（约 2000+ 行）专门解决 Electron 深坑：
- 后台/隐藏 tab 没有 compositor surface → `capturePage` 失败/挂死，或隐藏窗口下 1×1 capturePage 立即 resolve；
- 解法包括：1×1 capturePage 轮询做活跃度检测、透明引导窗口、surface prepare/release 租约 + viewport 一致性校验、transient 错误重试预算、废弃 CDP capture 硬上限（`abandonedScreenshotCaptures`）；
- **DSH MVP 只截可见面板即可，整套跳过**；将来支持后台 tab 再回来抄。

### 2.3 Agent 自动化命令协议（附赠，自动化测试正好用）

- `BrowserCommand` 方法集（main 执行器全量支持，`browserCommandExecutor.ts`）：
  `navigate / getState / back / forward / reload / screenshot / snapshot / click / type / press / scroll / hover / select / check / drag / elementInfo / evaluate`
- `snapshot` 两条实现：
  - 自研 DOM 遍历脚本（`browserCommandScripts.ts`）：语义选择器清单（`body, main, nav, header, …, a[href], button, input, textarea, select, [role], [aria-label], [contenteditable]`）+ `accName/semanticName` + 属性白名单（含 `data-testid/data-test/data-qa`），输出带 ref 的结构化树；
  - Playwright 路径复用 **Playwright aria-ref**（`aria-ref=<ref>` 选择器解析，`browserPlaywrightDomSnapshot.ts`；OOPIF/跨进程 frame 用 CDP sessionId 处理）；
- `ControlledView` 抽象（`browserCommandTypes.ts`）：executor 只依赖 `webContents(loadURL/getURL/…/executeJavaScript) + cdp.send + 可选截图能力`，便于 stub 单测；生产装配时 `executeJavaScript` wire 到 `guest.executeJavaScript(script, true)`（userGesture=true，**与 element-picker 同一约定**）；
- 防护细节：URL 白名单 `isAllowedBrowserUrl`；导航 ERR_ABORTED-but-committed 复核（SPA/重定向不误报，防模型瞎猜重试）；screenshot 单 tab 在飞去重 + 超预算拒绝；agent 操作时页面顶部操作指示器 + 录制光标可视化（`__zcodeBrowserRecordingCursor`）。

### 2.4 可直接移植资产清单（按 MVP 标注）

| 资产 | 源文件 | 移植到 MVP |
|---|---|---|
| picker 注入脚本 | `packages/ui/src/lib/webElementPickerScript.ts` | MVP-2 基座（改前缀 `data-zcode-*`→`data-dsh-*`、`__zcodeWebElementPicker`→`__dshWebElementPicker`；批注层在其上扩展） |
| payload schema + Markdown 协议 | `packages/ui/src/lib/webElementContext.ts` | MVP-2 |
| 选择器 hook | `packages/ui/src/hooks/useWebElementPicker.ts` | MVP-2/3（视宿主框架改写） |
| screenshot 参数构建 + CSS 归一化 | `browserCommandPageHandlers.ts`（`buildViewportScreenshotParams` / `handleScreenshot`） | MVP-1 可只用 capturePage；MVP-4 再抄 CDP |
| turn 末自动截图 | `runtime/methods/browser-turn-screenshot.ts` | MVP-3+ |
| BrowserCommand 协议 + snapshot 脚本 | `browserCommandExecutor/Scripts` | MVP-4（可选） |

---

## 3. 业界方案参照（要点速览）

| 方案 | 核心机制 | 与 DSH 场景差异 |
|---|---|---|
| **chrome-devtools-mcp**（Google 官方） | 独立起 Chrome 实例（或连运行中的浏览器），CDP 采集页面快照并给元素分配 uid；`take_screenshot` 支持 fullPage/元素级/格式选择；交互（click/fill 等）按 uid 定位 | 外挂浏览器、跨进程；DSH 是内嵌 guest，可走更短的 webview 内注入路径，不必开 CDP 端口 |
| **playwright-mcp**（Microsoft 官方） | accessibility snapshot 生成带 ref 的页面摘要，交互按 ref 定位；支持经 CDP endpoint 附加到已开浏览器 | 同上；「ref 稳定引用」思想已被 ZCode 吸收 |
| **browser-use**（Python） | DOM 序列化为带 index 的文本给 LLM，模型按 index 操作 | 纯 prompt 工程，无 UI 批注概念 |
| **设计协作工具**（BugHerd / Marker.io / Usersnap 等，交互原型） | 在真实网页上点选元素钉「图钉」→ 就地输入评论，评论与元素位置绑定，形成可提交的反馈清单 | 商业产品不对接 agent；「点选→钉标→就地评论」交互正是本项目批注模式的原型；开源同模式参照 [pageflag](https://github.com/Laaaaksh/pageflag)（MIT） |

> 注：以上为公开资料要点速览（本会话 web 检索受限，未逐一联网核验细节）；三家机制均为稳定公开事实，实施期如需精确 API 名以官方 README 为准。

**共同模式**：结构化快照（a11y tree / DOM 摘要）+ 稳定元素引用（uid/ref/index）+ 截图对齐，让模型「看得见也指得准」。ZCode 的差异化是**人工批注通道**：用户直接指元素，把「模型猜用户指哪」变成「零歧义结构化输入」——正契合「用户指着板块说这改一下」的诉求。

参考仓库：
- https://github.com/ChromeDevTools/chrome-devtools-mcp
- https://github.com/microsoft/playwright-mcp
- https://github.com/browser-use/browser-use
- https://github.com/Laaaaksh/pageflag（MIT：「Point, click, comment」，开源 BugHerd 替代——批注模式交互参照）
- https://github.com/onlook-dev/onlook（26.8k★，Apache-2.0：预览页点选元素 → AI 检查/编辑——AI 可视化编辑同类交互）

---

## 4. DSH 宿主事实（本会话实测证据，2026-10-04）

> 以下全部为对 `D:\DeepSeek\resources\app.asar`（121,348,951 字节）与 `D:\DeepSeek\DeepSeek Harness.exe` 的直接探测结果，供实施会话免重查。

### 4.1 运行时形态

| 项 | 值 |
|---|---|
| 应用 | DeepSeek Harness 0.2.0-rc.2（Electron 桌面应用） |
| 内核 | **Electron 44.0.0 / Chromium 152.0.7977.54**（exe 内版本字符串） |
| 代码签名 | GlobalSign GCC R45 EV，CN="Hangzhou DeepSeek Artificial Intelligence Co., Ltd."，Status: Valid（2026-08-31 ~ 2027-09-01） |
| Electron fuses | RunAsNode=1, EnableCookieEncryption=0, NodeOptions=1, NodeCliInspect=1, **EnableEmbeddedAsarIntegrityValidation=0**, OnlyLoadAppFromAsar=0, GrantFileProtocolExtraPrivileges=0（另有 2 个新版 fuse 位=1，未逐一命名） |
| asar 内 feature 开关 | 无任何 `appendSwitch` / `disable-features` / `disable-blink-features` → 内核特性全开，`navigator.hid` 等 API 完整存在 |

### 4.2 内置浏览器 guest 架构（desktop browser）

- guest 由 **GUI 文档（dsh-app://）** 创建 `<webview>` 标签挂载：`name=leaseId`、`partition=<lease partition>`、`allowpopups`、`src="about:blank#<leaseId>"`；
- main 侧 `will-attach-webview` 强校验：lease 归属/未重复挂载/partition 匹配，否则 `event.preventDefault()`；校验通过后强制覆写 prefs：`partition=lease.partition, nodeIntegration:false, nodeIntegrationInWorker:false, nodeIntegrationInSubFrames:false, contextIsolation:true, sandbox:true, webSecurity:true, allowRunningInsecureContent:false, webviewTag:false, plugins:false, navigateOnDragDrop:false, disableDialogs:true, …`；
- guest 事件护栏：`setWindowOpenHandler`→deny 并经 `DESKTOP_IPC.browserOpenRequested` 通知 owner（新开页走 owner 决策）；`will-frame-navigate`/`will-redirect` 过 `allowedNavigation` 白名单；`login` 拒绝；owner 主框架导航/render 崩溃/销毁 → `releaseAll` 回收全部 lease；
- 另有 platform view 通道（`dsh-platform-*` partition，仅加载账号 origin 的 /usage、/top_up 页）与 policy 登录窗口通道，同样 deny-all 权限——与本项目无关但说明 deny-all 是产品级统一姿态。

### 4.3 权限策略实测（关键澄清）

desktop browser 的 `configureSession`（asar 偏移 @120758497 附近，逐字引用）：

```js
browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
browserSession.setPermissionCheckHandler(() => false);
browserSession.setDevicePermissionHandler(() => false);
browserSession.setDisplayMediaRequestHandler((_request, callback) => { callback({}); });
browserSession.on("will-download", (event) => { event.preventDefault(); });
browserSession.webRequest.onBeforeRequest(/* 按 allowedNavigation 取消 */);
```

- 全 asar 共 4 处 `setPermissionRequestHandler`：platform view、app 框架（**仅特判 media，其余权限默认放行**）、policy 登录窗、desktop browser；`setDevicePermissionHandler` 2 处均拒绝；**无任何 `select-hid-device`/`select-usb-device` 处理器**；
- **对本项目的含义**：`executeJavaScript` / `capturePage` / `webContents.debugger` 是**宿主侧 API**，不经过上述任何 Web 权限处理 → 批注与截图**零权限障碍**。此前 WebHID 探测结论（deny-all 锁死 WebHID）不影响本项目，也不要试图为此改 DSH 权限。

### 4.4 对接入路径的启示

- webview 标签**存在于 GUI 文档 DOM 中**（lease 创建即 `element.setAttribute(...)` 后挂载）→ client plugin 理论上可在同一文档里查询到它并直调 `executeJavaScript`（ZCode UnifiedBrowserView 正是此模式，Electron 原生支持）；
- main 侧有成熟的 guest webContents 管理与 IPC 通道（`DESKTOP_IPC.*`）→ host plugin 路径同样有落点；
- 不确定点只剩「**plugin 的代码隔离边界**」：client plugin 是否运行在能摸到 DOM/webview 的上下文、host plugin 能否触达 Electron 对象 → 见 §5.1 验证步骤。

---

## 5. DSH 落地方案设计（候选）

### 5.1 三条接入路径对比与验证步骤

| 路径 | 做法 | 优点 | 风险/待验证 |
|---|---|---|---|
| **A. client plugin（renderer）** | client plugin 在 GUI 文档里查询 lease 的 `<webview>` 元素 → `webview.executeJavaScript(pickerScript, true)` / `webview.capturePage()` | 与 ZCode 同款；不需要 main 侧改动；HMR 开发流顺 | plugin 是否运行在可访问 DOM 的隔离世界；`<webview>` 方法是否被宿主封禁 |
| **B. host plugin（main/Node 侧）** | host plugin 经 DSH 插件 API 拿 guest `webContentsId` → `webContents.fromId(id)` 做 `executeJavaScript` / `debugger` / `capturePage` | 能力最全（CDP 全页截图、后台 tab 的可能性） | DSH host plugin 能否 `require('electron')`/触达 BrowserWindow；插件 API 面 |
| **C. 外挂 Chrome（保底，零 DSH 依赖）** | 按键项目 `scripts/collab/双栈视觉对比` 先例：用真实 Chrome（`--remote-debugging-port`）+ 脚本/CDP 驱动，截图落盘给 agent；批注用 Chrome DevTools 的元素检查 + 复制 selector 的替代流 | 第一天就能用、完全不碰 DSH | 失去「内置浏览器里直接点选」的体验；两套窗口切换 |

**验证步骤（实施会话第一步，按序）**：
1. `cordis_inspect_list`（本 harness 工具）→ 列出现有 Inspect Provider，看插件暴露形态（provider/method/input schema），判断 host plugin 能力边界；
2. 读 `F:\My Code\dsh-plugins\zcode-dispatch\`（现成 host plugin 范例）+ `bridge\`，确认 host plugin 如何与宿主进程交互、能否触达 Electron；
3. 写最小 client plugin：在 GUI 文档 `document.querySelectorAll('webview')` 是否可得 → 取一个 lease guest 试 `executeJavaScript('1+1')` 与 `capturePage()`；
4. 按 A/B 结果定主路径（可 A+B 混合：A 做批注/可见截图，B 做 CDP 全页截图）。

### 5.2 批注模式设计（本项目核心差异点）

> 需求出发点：ZCode 是「元素→会话附件」——多个元素堆在一条消息里，用户无法区分描述「哪个意见对应哪个元素」。本项目主形态改为**批注模式**：在页面上点选元素就地钉标、就地输入意见，意见与元素一一绑定。交互原型参照 BugHerd / Marker.io 类设计协作工具；开源参照 [pageflag](https://github.com/Laaaaksh/pageflag)（MIT）与 [onlook](https://github.com/onlook-dev/onlook)（Apache-2.0）。

**两种用法收敛为一种交互**：意见可留空——留空的批注提交时不带 `Note` 行，等价于 ZCode 的快速引用；填了意见即为差异化批注。**不单独做两个模式。**

**交互规格（注入脚本扩展，仍保持自包含 IIFE）**：

```
状态机：idle → picking（hover 高亮，同 ZCode picker）
        → 点击元素：采集 payload（ZCode collectElement 全套字段）
                    → 元素左上角钉编号徽标 ①②③（absolute + 文档坐标，滚动/缩放跟随）
                    → 就地弹意见输入框（textarea + 确认/删除）
        → Enter/确认：意见与元素绑定入列表，徽标变实心，继续 picking
        → 面板「提交」：打包 # Web page annotations: 协议块 → 交付通道（见本节末）
Esc / 完成：清理全部图层；徽标交互：hover→高亮原元素，点击→重编辑/删除该条
```

- 徽标与意见输入框在**页面内**渲染（脚本自持；ZCode 的 in-page popover 已验证此路径可行）；批注列表面板优先由宿主 UI 承载（Path A 可行时），退化为页面内右上角小面板；
- 意见输入框内 keydown `stopPropagation`（防页面快捷键劫持）；批注态内一切点击 capture 拦截（不触发页面自身行为）；
- 密码框、iframe 内元素 MVP 跳过；SPA 重渲染导致 selector 失联 → 徽标置灰标「失效」，提交时该条标注 `[element no longer matched]`；
- 命名空间：`data-dsh-element-picker` / `data-dsh-annotation-marker` / `window.__dshWebElementPicker`；字段限额沿用 ZCode（4000/6000/500/8000）。

**协议 v2（`# Web page annotations:`）**——元素 schema 复用 ZCode（§2.1 表），每条批注在元素信息前增加 `Note:` 行：

```markdown
# Web page annotations: 2

## Annotation 1
Note: 这个按钮太小，加大 padding 和字号
URL: http://localhost:5173/checkout
Title: 结算页
Tag: button
Role: button
Selector: #checkout > div.cart > button.submit
XPath: /html/body/div[1]/main/section/div[2]/button[1]
Attributes: id="submit" class="btn primary"
Color: #FFFFFF
Background: #2563EB
Font: 16px Inter, system-ui
Rect: x=120, y=840, width=180, height=48

Text:
```
提交订单
```

## Annotation 2
Note: 三张定价卡片间距统一改成 24px
Tag: div
Selector: main > section.pricing > div.card:nth-of-type(2)
Rect: x=64, y=210, width=380, height=420
```

- 回显解析同 ZCode 思路：按 `## Annotation` 分割、`Note:` 行即意见，逐条还原成列表 chip；
- 两级说明各司其职：**逐条意见在 `Note:` 行，公共说明写消息正文**（如「整体风格保持不变，按批注改」）；
- Markdown 块头沿用英文 `# Web page annotations:`（模型对英文结构化块的先验最稳）。

**进 agent 上下文的通道（按代价递进，可并存）**：
1. **剪贴板**（保底）：提交 → 协议块进剪贴板，用户粘贴进对话；零宿主依赖；
2. **落盘引用**：写 `<项目>/annotations/<时间戳>.md`，对话里引用路径，agent 用 read 工具读；
3. **composer 集成**（ZCode 式）：chip + 发送时拼 prompt——取决于 DSH composer 可写入口（随 §5.1 步骤 3 一并验证）。

### 5.3 截图管线草案

```
[截图按钮/命令] → webview.capturePage() → PNG
    → 落盘: <项目>/shots/<时间戳>-<tab标题>.png
    → 提示模板: 「截图已保存: <绝对路径>（页面 URL/标题/时间）」
    → agent: read_image(<绝对路径>) 做视觉识别
CDP 增强（Path B 可用时）: webContents.debugger.attach('1.3')
    → Page.captureScreenshot {format:'png', captureBeyondViewport:true} → fullPage
```

- 可见面板用 `capturePage` 即可；**注意 ZCode 踩过的坑**：隐藏/后台 guest 的 capturePage 会失败或假成功（1×1），MVP 明确只支持可见面板并在 UI 上置灰；
- 大图处理：先直接落盘（agent 读文件不占上下文），若未来走消息内嵌图像再抄 ZCode 的 oversized→artifact 降级。

### 5.4 UI 挂载点（待验证）

- client plugin 若能渲染 GUI 悬浮组件（参照 zcode-dispatch 的「页面右下角悬浮窗」先例）→ 挂一个小工具条：[选择元素] [截图] [批注列表]；
- 若不能 → 退化为命令/快捷键 + 剪贴板流（仍可用，体验降级）。

### 5.5 HID 通讯观测与控制台调试（F4/F5，agent 自动化测试基础设施）

**适用流**：硬件测试主路径是**真实 Chrome + dev server（localhost:5173）**（DSH 内置浏览器的 WebHID 被 deny-all 封锁且无选择器，见前序探测；DSH 侧只做非 HID 页面调试）。安全注意：调试端口只绑 localhost，严禁暴露。

**关键事实**：CDP/DevTools **没有 HID 报文域**——chrome-devtools-mcp / Puppeteer / Playwright 的内置能力都看不到 HID payload；`chrome://device-log` 只有系统级连接事件。**但这不等于无法通用观测**：观测代码不必经过 app 源码，可在「页面脚本执行前」注入（下述 L1）；app 埋点只是语义层的可选增强（L2）；OS 层抓包是最终仲裁（L3）。（实施期用 chrome-devtools-mcp 落地时再次核实。）

**通用观测分层（F4 可做到浏览器无关、app 无关）**：

| 层 | 手段 | 改 app？ | 得到什么 | 定位 |
|---|---|---|---|---|
| **L1 通用报文观测** | CDP `Page.addScriptToEvaluateOnNewDocument` 在页面脚本执行前把 wrapper 注入 main world——对被调试 Chrome 的**所有页面**生效 | **否** | TX/RX 原始帧（reportId + hex + len + 时序） | 主推 |
| **L2 语义标注** | keysion sdkjs **封装层**（本体禁改）给帧打 op 名 | 是（可选） | `READ_PRESET#12` 等语义 | 增强，省 token 少猜错 |
| **L3 OS 层兜底** | Windows `USBPcap` + tshark 脚本化抓 USB 总线，按设备地址 + interrupt transfer 过滤 | 否（装驱动+管理员） | 浏览器无关的 ground truth，连非浏览器 HID 流量也能看 | 疑难仲裁，不进常规链路（蓝牙 HID 不适用） |

- **L1 wrapper 技术要点**：代理 `navigator.hid` getter；wrap `HIDDevice.prototype.sendReport`（TX）；对 `addEventListener('inputreport')` 做镜像监听——DOM 事件多播，镜像监听器不消费、不干扰页面自己的监听；`oninputreport` 属性 setter 兜底；connect/disconnect 同法。`document_start` 时机保证页面拿到 HID 对象前 wrapper 已就位；
- **L1 变体 a**：Chrome 扩展（MAIN world + `run_at: document_start`）——适合不受我们 CDP 控制的 Chrome 实例；
- **L1 变体 b（DSH 内置浏览器）**：Path B 拿到 guest 后尽早 `executeJavaScript` 注入（dom-ready 时机，有极小竞态窗；更稳的是给 guest session 注册 preload，Electron 44 的 `session.registerPreloadScript` 待验证）；
- 三个层的采集格式与暴露通道完全共用（`console.debug("[HID]",…)` + `window.__hidLog`，见下）。

**SDK 无关性（设计原则，硬要求）**：
- L1 hook 在**平台 API 边界**（`navigator.hid`），不感知任何 SDK——keysion sdkjs、未来厂商 SDK、第三方 demo 页一律被观测；批注/截图能力同理，本来就是页面无关的；
- wrapper 覆盖面从 WebHID 扩到**全部 Web 设备 API**：`navigator.hid` + `navigator.serial`（Web Serial）+ `navigator.usb`（WebUSB）——wrap 模式完全同构（prototype 方法 + 事件镜像监听），一次实现三类通用，后续项目换传输协议零改造；
- 多设备/多 SDK 共存：每条记录带设备标识 `{vendorId, productId, serialNumber}`，`__hidLog.filter({device})` 按设备切片——同页多设备（如 DAC + 调试板）互不混淆；
- L2 做成**解码器注册表**而非硬编码：`__hidLog.registerDecoder(name, fn)`（可按 vendorId/productId 自动匹配）——哪个 SDK 想要语义就注册哪个解码器，通用层保持「哑」；未来新项目至多写一个解码器文件，观测底座零改动。

**L2：HID 遥测层细节（app 侧，包在 sdkjs 封装外，不动 sdkjs 本体——该目录禁改）**
- 采集点：
  - 发送：`sendReport(reportId, data)` → `{t, dir:"TX", reportId, hex, ascii, len, op?}`
  - 接收：`inputreport` 事件 → `{t, dir:"RX", reportId, hex, ascii, len}`
  - 生命周期：`connect / disconnect / getDevices`、open/close 失败原因
  - 语义层：SDK 帧解析若有语义（读预设/写参数），把操作含义一并记录（如 `READ_PRESET#12`）
- 暴露通道（三路）：
  1. `console.debug("[HID]", entry)` —— CDP 控制台流直接带出；
  2. `window.__hidLog`：内存 ring buffer（默认 500 条）+ `dump() / export() / clear() / filter({dir, since, op})`；
  3. 可选后期：DevTools 风格 HID 面板（复用本项目批注层的 in-page UI 经验）。
- 记录样例：
  ```
  [TX] 2026-10-04T19:20:00.123Z reportId=0x00 len=6  a1 0c 00 00 00 00  ; READ_PRESET #12
  [RX] 2026-10-04T19:20:00.180Z reportId=0x00 len=64 0c 4b 45 59 …      ; preset data
  ```
- 每条记录携带 `device:{vendorId, productId, serialNumber}`——同页多设备/多 SDK 可区分，`filter({device})` 按设备切片；
- 生产卫生：默认关闭或 `?hidDebug=1` / 测试构建开启（防性能损耗与日志噪音）。
- 连接小抄：WebHID `requestDevice()` 需要用户手势；但**首次授权后** `navigator.hid.getDevices()` 可免手势拿回设备 → 自动化连接走 getDevices + open，无需人工点击。

**F5 设计：控制台流与调试操作（agent 侧）**
- Chrome 流（主路径）：Chrome 以 `--remote-debugging-port=9222`（只绑 127.0.0.1）启动 → agent 经 CDP：
  - `Runtime.enable` → `consoleAPICalled` 事件 = 全量 console 流（log/warn/error + 参数序列化）；
  - `Runtime.evaluate` = 调试操作：查 `__hidLog.dump()`、调 app 内部 API、注入 mock、触发动作；
  - `Log.entryAdded`（浏览器日志）/ `Network`（HTTP）/ `Page.captureScreenshot`（视觉，与本项目截图能力同源）。
  - 现成封装：chrome-devtools-mcp（agent 直接用 MCP 工具），或轻量自写 CDP 脚本（keysion 项目 `scripts/collab/双栈视觉对比` 已有 CDP 使用先例）。
- DSH 内置浏览器流（非 HID 页面调试）：main 侧 `webContents.on("console-message")` 可直听 guest 控制台 + `executeJavaScript` 调试（Path B 可用时）；恰好不需要动权限。
- 无硬件回归：实现 `VirtualHidDevice`（同接口 mock），脚本化喂 input report → UI 渲染可离线断言（建议 keysion 侧排期，agent 全链路自动化可脱离硬件跑 CI）。

**F4/F5 验收样例（并入 §6）**：
1. agent 经 CDP evaluate `__hidLog.dump()`，读到一次 UI「切预设 12」产生的配对 `TX READ_PRESET#12` / `RX` 应答帧，字节与协议文档一致；
2. UI 操作后 2s 内 `__hidLog` 出现配对帧（时序断言）；
3. agent 注入 mock 应答 → UI 正确渲染（无硬件回归路径）；
4. 故意断开设备 → console 流出现错误，agent 能引用该错误定位代码；
5. **SDK 无关性验证**：换任意第三方 WebHID demo 页（非 keysion），L1 注入后同样抓到 TX/RX 配对帧——证明观测层与被测 SDK 解耦。

**跨项目落点说明**：F4 的 **L1 通用 wrapper 与 F5 的 CDP 驱动脚本全部落本项目**（`dsh-browser-kit/`），零 keysion 改动即可工作；仅 L2 语义标注（可选增强）落 **keysion dac vue**（web 侧 sdkjs 封装层）——实施会话开工时确认是否排期。
**交付形态定为可复用资产**：`hid-observer.js`（通用注入 wrapper，HID + Serial + USB 三 API 同构覆盖）+ CDP 驱动脚本，后续任何设备项目直接复用；新项目唯一可能要写的只是一个 L2 解码器（可选项）。

---

## 6. 实施路线与验收标准

| 阶段 | 内容 | 验收标准（运行时表现） |
|---|---|---|
| **MVP-0 接入验证** | §5.1 四步验证，产出选型结论（A/B/混合/C） | 能对 lease guest 注入脚本取回返回值；能 capturePage 出非空 PNG |
| **MVP-1 截图** | 截图入口 + PNG 落盘 + 提示模板 | agent `read_image` 成功并正确描述 localhost:5173 页面 |
| **MVP-2 批注模式** | picker 脚本扩展为批注层：编号钉标 + 就地意见输入（可留空）+ 批注列表 + `# Web page annotations:` 协议（§5.2） | 对 5173 的 3 处元素各留意见、一次提交；agent 逐条定位并完成对应修改，无歧义 |
| **MVP-3 体验** | 落盘注释索引 + （可行则）composer chip；turn 末自动截图 | 连续 3 轮「批注→修改→截图确认」闭环无需人工搬运信息 |
| **MVP-4 自动化**（可选） | 裁剪版 BrowserCommand（navigate/click/type/snapshot/screenshot/evaluate）+ ref 解析 | agent 独立完成一次表单填写并截图验证 |
| **MVP-5 HID 观测 + 控制台调试**（F4/F5） | **L1 通用注入 wrapper**（CDP `addScriptToEvaluateOnNewDocument`，零 app 改动）+ 可选 L2 语义标注（keysion）+ CDP 控制台/evaluate 通道（§5.5） | §5.5 验收样例 1-4 全过（配对帧断言、mock 无硬件回归、断连错误定位） |
| 暂缓 | 后台 tab surface 协调、CSS 像素归一化、fullPage CDP、元素级截图 | — |

**工作纪律建议**（沿用本项目习惯）：每步踩坑记 `pitfalls.md`；DSH 升级后回归 MVP-0 清单；移植 ZCode 代码保留 Apache-2.0 版权与 NOTICE 声明。

---

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| DSH 应用升级改变 webview lease 内部结构 | 路径 A/B 失效 | 实现加能力探测 + 降级链（A→C 剪贴板保底）；升级后重跑 MVP-0 |
| client plugin 隔离世界摸不到 DOM/webview | 路径 A 不可行 | 转 Path B（host plugin）或 C（外挂 Chrome） |
| `capturePage` 对隐藏面板假成功（1×1） | 截图不可用但不报错 | 校验 PNG 尺寸 ≥ 视口；不支持时 UI 置灰并提示 |
| asar 直接补丁方案 | 升级覆盖、维护成本 | **本项目不需要 asar 补丁**（权限不受限）；仅记录曾评估过（fuse 关、签名不校验 asar） |
| ZCode 代码移植许可 | 法务 | Apache-2.0：保留版权声明与 NOTICE；修改处注释标明来源 |

---

## 8. 附：ZCode 关键文件索引（本地 `F:\My Code\ZCode\`）

| 文件 | 内容 |
|---|---|
| `packages/ui/src/lib/webElementPickerScript.ts` | 注入式元素选择脚本（核心，664 行，可直接移植） |
| `packages/ui/src/lib/webElementContext.ts` | payload schema + Markdown 协议 + 往返解析（348 行） |
| `packages/ui/src/hooks/useWebElementPicker.ts` | 选择器 hook（传输无关 executeJs，181 行） |
| `packages/ui/src/v4/composer/*`、`packages/ui/src/v4/ConversationComposer.tsx` | composer chip 集成 |
| `packages/ui/src/browser-use/UnifiedBrowserView.tsx` | 受控浏览器视图（webview/IPC 双传输分叉） |
| `packages/desktop/src/main/browserView/browserCommandExecutor.ts` | BrowserCommand 分发（方法全集见 §2.3） |
| `packages/desktop/src/main/browserView/browserCommandTypes.ts` | ControlledView 最小抽象（52 行，先读这个） |
| `packages/desktop/src/main/browserView/browserCommandPageHandlers.ts` | navigate/getState/screenshot/snapshot/evaluate 处理（CDP 截图在此） |
| `packages/desktop/src/main/browserView/browserCommandScripts.ts` | DOM snapshot 注入脚本（选择器清单/accName/属性白名单） |
| `packages/desktop/src/main/browserView/browserPlaywrightDomSnapshot.ts` | Playwright aria-ref 集成 |
| `packages/desktop/src/main/browserView/browserGuestManager.ts` | guest 生命周期 + 截图 surface 调度（重工程所在） |
| `packages/desktop/src/host/browserControlMainBridge.ts` | main 桥（capability/tabs/cua/screenshot/dialog 分类） |
| `apps/zcode-cli/packages/core/src/browser-client/facade.ts` | agent 侧 browser facade |
| `apps/zcode-cli/packages/core/src/runtime/methods/browser-turn-screenshot.ts` | turn 末自动截图 |
| `apps/zcode-cli/packages/core/src/mcp/image-normalization.ts` | 超大图 → artifact 降级 |
| `apps/zcode-cli/packages/core/src/repl/node-repl-session.ts` | emitImage → image content block |

## 9. 附：本会话探查记录（可复现要点）

- 版本/签名：`(Get-Item 'D:\DeepSeek\DeepSeek Harness.exe').VersionInfo`、`Get-AuthenticodeSignature`；
- fuses：在 exe 中找哨兵 `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`，其后 `ver(1B)+len(1B)+wire`（本机 wire=9B，ASCII '0'/'1'）；
- asar 字符串扫描：Node 读 `app.asar` 为 Buffer，`indexOf` 逐 pattern 定位 + 上下文 dump（`select-hid-device` ABSENT；4 处 `setPermissionRequestHandler` 偏移 120609399 / 120620484 / 120742253 / 120758497）；
- ZCode 调研：`git clone --depth 1 https://github.com/zai-org/ZCode.git F:\My Code\ZCode` + 仓库内 grep/read（本会话已完成的精读文件见 §8 表）；
- 限制备忘：本会话 `web_search` 无 API key 不可用、`raw.githubusercontent.com` 被网络策略拦截；github.com 与 api.github.com 可达。
