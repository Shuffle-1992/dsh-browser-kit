# dsh-browser-kit — DSH 0.2.1-rc.1 兼容与优化评估

> 生成：2026-10-17 ｜ 作者：标准模式 DSH 会话
> **基线**：DSH `0.2.0-rc.2`（当前运行，**尚未更新**）→ **目标**：`0.2.1-rc.1`
> 排查方式：静态代码扫描（排除 `node_modules` / `test` / `.data`）+ 官方包对比（npm `0.2.1-rc.1` vs 当前 `app.asar` 内 `0.2.0-rc.2`）+ 本机实测

---

## 一、结论速览

| 项 | 结论 |
|---|---|
| 破坏性冲突 | **0 项** |
| 必须处理 | **1 项** —— 缺 `engines.dsh` 声明（0.2.1 明确要求插件作者检查） |
| 建议优化 | **3 项** —— 新增「文本与图片展示」扩展位 / 图片处理依赖安全修复 / 工具动态增删 |
| 更新后风险 | **低**。只需确认 27 个 `browser_*` 工具、两张插件卡片、内嵌浏览器面板仍正常 |

---

## 二、插件现状（含证据）

### 包与注册

| 项 | 值 | 证据 |
|---|---|---|
| 包名 / 版本 | `dsh-browser-kit` / `0.2.0`（`private: true`） | `plugin/package.json` |
| 解析路径 | `node_modules/dsh-browser-kit` → `F:\My Code\dsh-browser-kit\plugin`（junction） | 实测 |
| 别名 | 另有 `node_modules/@local/dsh-browser-kit` 同指向 | 实测 |
| 入口 | `.` → `./entry.mjs` | `plugin/package.json` exports |
| 客户端 | `./client` → `./client.js`（`platform: web`, `immediately: true`） | 同上 |
| 远端面 | `./typert` → `./wire.host.mjs` | 同上 |
| bundle patch | `./cordis.patch.yml`（insert `id/name = dsh-browser-kit`） | `plugin/cordis.patch.yml` |
| 依赖 | `node-hid ^3.4.0` | `plugin/package.json` |

### 关键接口清单

| 接口 | 位置 | 说明 |
|---|---|---|
| **27 个 agent 工具** `browser_tabs` / `open` / `close` / `panel` / `navigate` / `reload` / `snapshot` / `state` / `history` / `wait` / `select` / `element_info` / `storage` / `upload` / `annotations` / `find` / `agent_window` / `check` / `click` / `dblclick` / `hover` / `type` / `press` / `scroll` / `eval` / `console` / `screenshot` | `plugin/browser-tools.host.mjs:308–606` | `ctx.tools.register(defineTool({...}))` |
| `defineTool` 解析 | `plugin/browser-tools.host.mjs:104–141` | **裸 `import('@deepseek-ai/dsh-tools')` + 绝对路径回退**双策略；全失败降级 `null` 只 warn |
| `output` 必填 | `browser-tools.host.mjs:15` 注释 | `defineTool` **无条件**读 `options.output.render` / `.schema` |
| 插件卡片 | `plugin/client.js:5687`、`5692` | 槽位 `plugins.bundle.config`（key=`dsh-browser-kit`）+ `plugins.row.config`（key=`dsh-browser-kit#<rowId>`） |
| 宿主服务 | `plugin/client.js:2673`、`2683` | `sidebarRight`、`layout`（均为**惰性** `ctx.inject`，不写进顶层 inject） |
| 远端面注册 | `plugin/wire.host.mjs:18` | `ctx.provide(FACE_NAME, face)` + typert 绑定兜底 |

---

## 三、兼容性排查（逐条对照 0.2.1 开发者变更）

| # | 0.2.1 变更 | 是否命中 | 证据 / 结论 |
|---|---|---|---|
| 1 | 移除运行时 invariant 插件及 `./invariant` 导出 | ❌ | 全插件扫描 `invariant` **0 命中**（另：0.2.0-rc.2 的 `dsh-session` 有 `lib/invariant.js`，0.2.1-rc.1 已删除，印证该变更真实存在） |
| 2 | 子路径插件不再读独立 `package.json` | ❌ | 本插件按**包名**注册（`dsh-browser-kit`），非子路径注册；且已显式导出 `./package.json` 与 `./locale/*.json` |
| 3 | 兼容性优先按 `engines.dsh` 判断 | ⚠️ **命中** | 本插件 `package.json` **完全没有 `engines` 字段** → 见 §四 P0 |
| 4 | 输入区统计拆为 `activity` / `usage`（覆盖旧 `stats` 整行的插件需改 ID） | ❌ | 本插件注册的是 `plugins.bundle.config` 与 `plugins.row.config`，**不碰 composer 的 stats 行**。代码里的 `getStats`（`client.js:5582+`）是**它自己的远端 face 方法**（批注/截图数量与字节），与宿主 stats 行无关 |
| 5 | 移除工具展示 `both` 混合模式 | ❌ | 扫描 `toolPresentation` / `presentationMode` / `'both'` **0 命中** |
| 6 | Agent Team 消息直投目标 Inbox（移除 outbox / 重试 / 去重） | ❌ | 扫描 `outbox` / `agentTeam` / `agent-team` **0 命中** |
| 7 | 统一子代理执行与完成通知，工具立即返回 child ID | ❌ | 扫描 `ctx.subagent` / `subagentProvider` **0 命中**；本插件不注册子代理 |
| 8 | Python PTC 接入 Session 沙箱；自定义组合需 sandbox / sandboxPolicy | ❌ | 扫描 `ptcRuntime` / `sandboxPolicy` **0 命中** |
| 9 | 移除 agent-instructions 逐行 `dshHome` 配置 | ❌ | 扫描 `dshHome` **0 命中** |
| 10 | pi-ai 更新至 1.0.2 | ❌ | 本插件**无 `peerDependencies`**，不触碰 LLM 层 |
| 11 | Azure provider 改名 `azure-openai-responses` → `azure` | ❌ | 扫描 `azure` **0 命中** |
| 12 | API Key 读取优先级变更（Web/桌面优先已保存凭据） | ❌ | 本插件不读凭据 |

**另一条与兼容无关但已被实证**：本插件与 `dsh-dispatch` 同款「从 `app.asar` 绝对路径加载 `@deepseek-ai/dsh-tools`」。0.2.1 **未列出 `dsh-tools` 的 API 变更**，但「工具立即返回 child ID」属于工具契约范畴，建议更新后跑一次 §六 的自检。

---

## 四、需要处理的项

### P0 —— 补 `engines.dsh` 声明

**问题**：`plugin/package.json` 没有 `engines` 字段，因此 0.2.1 的兼容性判定只能走"未声明时沿用原有规则"。

**官方原文**（0.2.1-rc.1 Release Notes · 其他变更）：

> 第三方插件的版本兼容性优先按 `engines.dsh` 判断；未声明时沿用原有规则。**插件作者需检查声明是否覆盖支持的 DSH 版本。**

**生态惯例**（本机已装插件实测）：

| 插件 | 声明 |
|---|---|
| `dsh-cost-meter` | `"engines": { "dsh": ">=0.1.0-rc.5" }` |
| `dsh-opencode-go` | `"engines": { "dsh": ">=0.1.5-rc.1" }` |

**建议改法**：在 `plugin/package.json` 增加

```json
"engines": {
  "dsh": ">=0.2.0-rc.2 <0.3.0-0"
}
```

（`0.2.0-rc.2` 是你当前已验证可用的版本，`0.2.1-rc.1` 落在区间内。）

**影响评估**：不补**不会立刻坏**（走原规则），但补上后兼容判定显式化，避免未来规则收紧时被**静默拒载**（历史上发生过：peer 范围过旧导致 `loadProfileDirectory` 直接移除 bundle）。

---

## 五、0.2.1 新功能带来的优化机会

### 1. 新增「文本与图片展示」扩展位（收益最大）

**0.2.1 新增**：

> 为用户消息、文本与图片展示、新会话页及模型选择器添加扩展位，支持插件定制对应内容。

**本插件现状**：批注与截图只能**落盘**（`annotations/`、`shots/`），再由 agent 通过 `browser_annotations` / `browser_screenshot` 读回。用户在对话里看不到批注内容本身。

**可做的改造**：用「文本与图片展示」扩展位把批注 markdown / 截图**直接渲染进对话流**。

**收益**：消除当前最大的体验短板 —— 从"落盘再读"变成"当场可见"。

**证据**：`client.js:5687`（现有卡片注册范式可复用）；工具清单 `browser-tools.host.mjs:442`（`browser_annotations`）、`:606`（`browser_screenshot`）。

---

### 2. 图片处理与客户端渲染依赖的安全修复

**0.2.1 原文**：

> 更新运行时工具、MCP 协议、图片处理和客户端渲染依赖，纳入兼容版本的安全修复。

**为什么对本插件直接相关**：它处理多窗口截图、`base64` 图片注入（`browser_upload` 的 base64 上限 4MB）、以及 `read_image` 回传链路。

**收益**：安全修复直接落到它的主链路上，**零改造成本**。

---

### 3. 工具动态新增和移除（27 个 schema 的常驻开销）

**0.2.1 原文**：

> pi-ai 路由支持按模型能力处理会话中的系统提示词更新，以及**工具的动态新增和移除**。

**本插件现状**：27 个 `browser_*` 工具的 schema 全部常驻。系统提示里能看到 `[dsh-browser-kit]` 一行摘要 + 27 个工具的完整 schema。

**可做的改造**：按任务阶段**动态挂载/卸载**工具子集（例如只在需要时挂 `browser_upload`、`browser_storage`、`browser_download` 类低频工具）。

**收益**：减少常驻 token；对上下文紧张的长会话尤其明显。

**⚠️ 前提**：该能力是 **pi-ai 路由**层面的（宿主按模型能力处理），需先确认插件侧是否有对应注册入口。**这条属于待验证机会，不是已确认可行的改造。**

---

### 4. 次要：密钥/令牌默认脱敏（作用域待确认）

本插件的 `console-observer`（`client.js:4395+`）会 dump 页面控制台与网络事件，页面内容可能含令牌。0.2.1 新增「识别已发送消息中的密钥和令牌，并默认脱敏」。

**需确认**：该脱敏是否覆盖**工具输出**（若只覆盖用户消息则与本插件无关）。**未确认，不作为行动项。**

---

## 六、更新后验证清单（可复跑）

```powershell
# 0) 更新前后都跑，作为对照基线
Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json" | Select-String 'dsh-browser-kit'

# 1) 插件卡片仍注册（宿主日志应有"插件管理卡片已注册"）
#    证据字符串见 client.js:5699

# 2) 27 个工具仍在（新会话里系统提示应含 [dsh-browser-kit] 摘要行）
#    逐条验证工具名：browser_tabs ... browser_screenshot

# 3) 冒烟：打开一个网页并截图
#    browser_open → browser_snapshot → browser_screenshot

# 4) 批注链路：右键加批注 → 批注自动进入 agent 上下文 → browser_annotations 读全文

# 5) defineTool 解析来源（宿主日志应打印来源，见 browser-tools.host.mjs 的 DEFINE_TOOL_PROBE）
```

**通过判据**：以上每步有可复跑证据；任一失败时先看 `defineTool` 解析策略是否仍命中 `resourcesPath/app.asar|import`。

---

## 附：证据来源与不确定性

| 结论 | 证据强度 |
|---|---|
| 27 个工具、槽位、服务、defineTool 双策略 | **强**（源码行号） |
| 12 项变更全部不命中 | **强**（全库扫描 0 命中 + 逐项读码判定） |
| `engines.dsh` 缺失 | **强**（`plugin/package.json` 无 `engines` 字段） |
| 「文本与图片展示」扩展位可渲染批注 | **中**（扩展位存在已确认，但**未验证**其 props/契约能否承载批注与图片） |
| 工具动态增删可用于裁剪 27 个 schema | **弱**（能力在 pi-ai 路由层，**插件侧入口未确认**） |
| 脱敏是否覆盖工具输出 | **未知**（**未确认，不行动**） |

### 需要澄清的命名歧义

0.2.1 发布说明里"**极简模式**支持读取图片和自动压缩长对话"中的"极简模式"，与 npm 上的 `@deepseek-ai/dsh-sdk-minimal`（**独立 SDK profile**，`dsh --profile sdk-minimal`）很可能是同一件事，但应用内也存在一个叫「极简」的工作视图模式。**二者关系未确认**，本评估不依赖该结论。

### 未做改动声明

本文档**只做排查**，未修改任何插件代码或配置。
