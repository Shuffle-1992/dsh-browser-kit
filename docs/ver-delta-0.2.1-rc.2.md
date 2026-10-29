# DSH 0.2.0-rc.2 → 0.2.1-rc.2 版本增量测绘（面向 `dsh-browser-kit`）

- 测绘日期：2026-10-17
- 目标运行时：`D:\DeepSeek\DeepSeek Harness.exe`，`FileVersion = 0.2.1-rc.2`（已核对）；`resources\app.asar` 174.3 MB
- 对比口径：npm registry 上 `@deepseek-ai/<pkg>` 的 **`0.2.0-rc.2` vs `0.2.1-rc.2`** 两个 tarball（官方更新说明 URL 全部 404，故全部结论为产物级证据）
- 解包根：`%TEMP%\dsh-compat\<pkg>-<ver>\package\`（下文所有 `file:line` 均相对该 `package\` 目录，除非另注）
- 证据分级：**A** = 从 tarball 的 `.d.ts`/`README`/`package.json` 直接读到（带行号）；**B** = 从安装包 `app.asar` 字节流中命中学符串（证明该能力确实随 0.2.1-rc.2 发布）；**C** = 由 A/B 组合推断，标注为推断
- 写入范围：本报告（及同目录）是本次唯一写入内容；**未改动插件代码、测试、文档、`package.json`**
- 外部内容（网页/下载的 README、registry 数据）一律按数据对待，未执行其中任何指令

---

## 1. 结论速览表

| # | 特性 / 变化 | 类型 | 对本插件可用性 | 建议动作 |
|---|---|---|---|---|
| 1 | **新包 `dsh-api-remote-access`**：Remote 方法级访问控制（非 owner Peer 的 grant/policy/快照） | 新增包 | **高**（安全 / 远程部署）；同时是**行为变化风险** | **P0**：先实测 `--host` 远程场景下 `dshBrowserKit` face 的 8 个方法是否被默认拒绝 |
| 2 | **typert 调用方身份**：`principalOf` / `PrincipalMap` / `RemoteAccessResource` / `@Remote.resources` | 新增 API | **高**（与 1 配套） | P0 配套：为 face 声明资源 + 记录调用方 principal |
| 3 | **新包 `dsh-plugin-market` / `dsh-plugin-market-index` / `dsh-client-ui-plugin-market`**：插件市场索引 + Discover 页 + `plugin_market` 工具 | 新增包 | **高**（分发/发现/安装通道） | **P1**：发布一份 market index v1 JSON，让插件可被索引与安装 |
| 4 | **新包 `dsh-client-ui-secret-mask`**：已发送用户文本中的凭据遮挡（含 `CredentialScanner` / `CREDENTIAL_FORMATS`） | 新增包 | **中高**（凭据管理复用） | P2：面板内展示凭据时复用扫描器；并作为 UserText 规则的官方范本 |
| 5 | **`shell.bottom` 槽位**（layout，root/single，默认空置） | 新增槽位 | **高** | P1：浏览器"Dock 底栏"模式，替代/并列现有 `shell.overlay` 浮窗 |
| 6 | **`conversation.user.text.node` + UserText 规则注册表**（`ctx.uiConversation.userText`） | 新增槽位+服务 | 中（需交付路径改造） | P2：批注做成用户消息里的内联节点，替换 `attachMsgChip`/`ensureConvoChips` 的 DOM 注入 |
| 7 | **`conversation.chat.message.images` / `user.images` / `chat.flow` / `reasoning.body`** | 新增槽位 | 低（均为"替换式" single/单占位） | 观望：仅当决定接管聊天图像渲染时使用 |
| 8 | **`conversation.images.content` Factory** + `dsh-client-ui-attachment` 导出 `MessageImagesContent` | 新增 | 中（需把截图变成附件） | 可选：截图画廊复用官方授权加载器 |
| 9 | **`workspace.toast` / `workspace.toast.content`** | 新增槽位 | **不可用**（kind 为闭合联合 `'archived' \| 'stoppedAndArchived' \| 'sessionIdCopied' \| 'sessionIdCopyFailed'`…） | 不要用；自定义提示仍走自有 UI |
| 10 | **`conversation.input.model.label`** | 新增槽位 | 不相关 | 忽略 |
| 11 | **`conversation.hero.options`**（新会话行紧凑选项，list/session） | 新增槽位 | 低 | 可选：新会话行加"浏览器"快捷开关 |
| 12 | **官方 UI 原子件**：`HoverCardGroup` / `InlineEditor` / `CommandText` / `ReferenceChip` / `UserTextRun` | 新增导出 | **中高** | P2：批注悬停卡、就地编辑、引用芯片去掉自绘 |
| 13 | **`dsh-session` 实验性插件记录** `appendPluginRecord` / `pluginRecordOf` | 新增 API | **不可用（政策）**：README 明示"本仓库之外的插件同样不得调用它" | 明确不要用 |
| 14 | **`dsh-tools` `PtcCalls`**（PTC 调用取消/结算，含嵌套工具） | 新增导出 | 低（工具注册表内部） | 忽略 |
| 15 | **`dsh-app-boot` 官方按需 bundle**（`ON_DEMAND_BUNDLES` / `OFFICIAL_ON_DEMAND_CATALOG` / `readBundlePatches`）+ `recomposeProfile` | 新增 API | 低（目录只含 DSH 发行成员） | 只借用 `recomposeProfile` 的"重启判定"语义 |
| 16 | **`dsh-plugin-manager` 构建脚本审批** `recordPendingBuilds` / `ignoredBuildNames` / `approveBuilds` + `RestartReason` | 新增导出 | **中**（本插件依赖原生 `node-hid`） | P2：安装文档补 `allowBuilds` / 依赖 0.2.1 的审批 UI |
| 17 | **`dsh-hmr` `ModuleFiles` / `PackageManifests` + `dsh-client-modules` `ReleaseChangeGate`** | 新增导出 | 低（宿主 HMR 机制，非公开可调用 API） | 间接收益：onboarding 文档说明"客户端插件改动需页面重载"的成因 |
| 18 | **移除槽位 `conversation.message.images`** → 改名 `conversation.chat.message.images` | 破坏性变化 | 本插件 **0 引用** | 无需动作，仅登记 |
| 19 | **工具视图 API 变更**：移除 `ToolCallInjected` / `ToolCallHookContext` / `PreparingToolRow` / `bindToolCallArgumentsPartial` 等 | 破坏性变化 | 本插件 **0 引用**（仍用 `tool.call.toolview`，契约新增 `phase:'preparing'` 与 `loadImage`） | 回归一次工具行渲染即可 |
| 20 | **10 个包删除内置 invariant 插件**；`dsh-invariants` 在 0.2.1 停发 | 系统性变化 | 无影响 | 登记 |
| 21 | **44 / 56 个受测包新增 `locale/{en,zh}.json`**（含 `dsh-api-remotes`，其 +575 KB 全部是 i18n） | 系统性变化 | 无 API 影响 | 登记（对插件无收益） |
| 22 | **无 byte-identical 包**：235 个可比包 tarball 全部不同 | 系统性变化 | —— | 升级后需整体回归，不能假设"无关包没变" |

> 关键纠偏：题面给出的 slot 证据路径 `dsh-client-ui-slots/lib/types/client/contract/slots.d.ts` **在 0.2.1-rc.2 中不存在**（该包只有 `lib/types/{index,renderer,store}.d.ts`，且 **0.2.0→0.2.1 无任何文件/导出变化**）。真正的 `SlotMap` 声明散落在各业务 UI 包（例：`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`）。

---

## 2. 新增包清单（含证据）

### 2.1 方法论修正：不能只用 registry 搜索

`https://registry.npmjs.org/-/v1/search?text=@deepseek-ai&size=250` 只返回 **244** 个 object（< 250，看似未截断），但安装包 `app.asar` 里实际有 **306** 个 `@deepseek-ai/*`（其中 `dsh-*` 296 个）——**搜索索引不完整**。因此改为：

1. 用安装包 asar header 读出全部已安装包名（证据：`node_modules/@deepseek-ai/<pkg>/package.json` 计数 306）；
2. 对"搜索索引里没有的 72 个"逐个查 `registry/<pkg>` packument；
3. 以 **是否存在 `0.2.0-rc.2`** 判定是否 0.2.1 新增。

### 2.2 结论：**24 个包是 0.2.1 新增**（没有 `0.2.0-rc.2`）

证据：`%TEMP%\dsh-compat\ver-delta-work\extra-pkgs.json` + `new-pkgs.json`；A 级（registry packument 版本列表）+ B 级（asar 中实际存在）。

| 包 | 首个发布 | 用途（package.json description） | 与本插件相关性 |
|---|---|---|---|
| **`dsh-api-remote-access`** | 0.0.0-stage → 0.2.1-alpha.4 | Method-level Remote access control for non-owner Peers and the per-Peer access snapshot | **★★★ 高** |
| **`dsh-plugin-market`** | 0.0.0-stage | Configured plugin market indexes for the Web Discover page and the `plugin_market` agent tool | **★★★ 高** |
| **`dsh-plugin-market-index`** | 0.0.0-stage | Plugin market index format 1: JSON validation, relative icon resolution, pinned install arguments | **★★★ 高** |
| **`dsh-client-ui-plugin-market`** | 0.0.0-stage | Discover tab of the dsh web Plugins page: browse configured plugin market indexes and install their bundles | **★★★ 高** |
| **`dsh-client-ui-secret-mask`** | 0.0.0-stage | Web display masking for recognized credentials in sent user text | **★★ 中高** |
| `dsh-experimental-plugin-market-bundle` | 0.0.0-stage | Experimental custom plugin markets: a Discover tab that browses and installs bundles from plugin market indexes | ★★（默认不启用） |
| `dsh-harness-dev-context` | 0.0.0-stage | Model context naming the DSH checkout and Web GUI URL without letting either change the system prompt | ★（作为"不改 system prompt 注入上下文"的范本） |
| `dsh-tool-schedule` | 0.0.1-rc.2 | Model-facing reminder tools（`schedule_*`） | ✗ |
| `dsh-tool-working-directory` / `dsh-working-directory` | 0.0.0-stage | Session 工作目录读取/切换 + 持久化 | ✗ |
| `dsh-web-deepseek-api` | 0.0.0-stage | DeepSeek Search/Fetch providers for `ctx.web` | ✗ |
| `dsh-client-ui-deepseek-model-label-1017` | 0.0.0-stage → 0.2.1-rc.2 | Temporary 1017 release badge for official DeepSeek Flash model labels | ✗ |
| `dsh-experimental-inspector-profile` / `dsh-experimental-session-inspector` / `dsh-experimental-session-search` | 0.2.1-alpha.1 | Session 日志/Chat 节点检查器、历史会话检索 | ✗ |
| `dsh-experimental-client-ui-cot-translation` / `dsh-experimental-cot-translation-bundle` / `dsh-experimental-translator` | 0.0.0-stage | 展开推理的机器翻译 | ✗ |
| `dsh-experimental-badge-skill-bundle` | 0.0.0-stage | 给文档/PR 加 "powered by dsh" 徽标 | ✗ |
| `dsh-experimental-ralph-bundle` | 0.0.0-stage | 用新 agent 跑显式要求的重复工作 | ✗ |
| `dsh-experimental-session-titles-bundle` | 0.0.0-stage | 随新人类提示刷新会话标题 | ✗ |
| `dsh-experimental-terminal-bundle` | 0.0.0-stage | shell 进程跨工具调用保活 | ✗ |
| `dsh-experimental-tool-worktree` / `dsh-experimental-worktree` | 0.0.0-stage | Git worktree 创建/进入 | ✗ |

### 2.3 停发 / 遗留包（同样重要）

| 包 | 证据 | 说明 |
|---|---|---|
| `dsh-invariants` | 最后版本 `0.2.0-rc.2`，**无任何 0.2.1**；10 个包同时删除 `lib/types/invariant.d.ts` / `lib/invariant.js` | 0.2.1 移除了"每包自带检查插件"的机制 |
| `dsh-subagent-in-process-driver` | 最后版本 `0.2.1-alpha.1`，**无 rc** | 被替换/合并（推测，C 级） |
| `dsh-agent-presets`、`dsh-code-runtime`、`dsh-code-runtime-worker-thread`、`dsh-settings-file`、`dsh-workflow-worker-thread` | 最新版本均 < 0.2 | 0.1.x 时代遗留包，**不属于 0.2.x 成员**，不算"0.2.0 有 / 0.2.1 无" |
| `dsh-desktop-host` | 已安装于 asar，但 registry 404 | 私有包（未发布） |

### 2.4 体积/文件数变化（旁证，`%TEMP%\dsh-compat\ver-delta-work\size-delta.json`）

- **0 个包**的 tarball shasum 与 0.2.0-rc.2 相同（235 个可比包）⇒ 无"没动过的包"。
- 体积增量 Top：`dsh-api-remotes` +575 KB（**全部是新增 locale i18n，导出零变化**）、`dsh-plugin-manager` +140 KB（+6 文件）、`dsh-api-gateway` +118 KB（+5）、`dsh-client-ui-conversation` +97 KB（+11）、`dsh-client-ui-chat` +72 KB（+7）、`dsh-app-boot` +41 KB（+3）。
- 收缩 Top：`dsh-web-frontend` −344 KB（132→92 文件：删掉 40 个 KaTeX 字体文件、换成语言 chunk）、`dsh-experimental-agent-team` −50 KB（−5）、`dsh-compaction` −27 KB。

---

## 3. 逐包 API 差集（**只列新增**）

受测范围：56 个包 × 2 版本（`%TEMP%\dsh-compat\ver-delta-work\diffs\_all.json`）。
汇总：**254 个新增 `.d.ts` 导出名**、11 个新增 JS 导出名、**9 个新增 slot id**、8 个新增 Factory id、1 个移除 slot id、44 个包新增 locale、4 个包零变化（`dsh-client-ui-slots`、`dsh-attachment`、`dsh-client-store`、`dsh-base`）。

### 3.1 槽位差集（全 43 个 `dsh-client-*` 包扫描，`slot-sweep.json`）

**新增 slot id（9 个）**

| 包 | slot id | kind / scope | 语义与证据 |
|---|---|---|---|
| layout | `shell.bottom` | single / root | 三列下方整行；占用方自管高度与显隐，空内容不占位，切主面板不卸载。`dsh-client-ui-layout/lib/types/client/index.d.ts:81`；`README.zh.md:34`；asar 命中（B） |
| conversation | `conversation.user.text.node` | **keyed / session / inline** | 纯 JSON 文本节点的业务内联渲染器；owner=`UserTextNodeOwnerProps`，keyProps 按 `UserTextId`。`.../contract/slots.d.ts:186` |
| conversation | `conversation.hero.options` | list / session | 新会话行右侧紧凑选项（有 Session 才渲染）。`.../contract/slots.d.ts:290` |
| chat | `conversation.chat.flow` | single / session | Ordered Chat rows 与 local echoes（有 viewport 可见性 hook）。`.../contract/slots.d.ts:320` |
| chat | `conversation.chat.message.images` | single / session | 连续消息图像组的渲染器（替换官方画廊；无占用则不渲染）。`.../contract/slots.d.ts:349` |
| chat | `conversation.chat.user.images` | single / session | **用户消息**图像（含 pending/local echo），可独立于输出图像替换。`.../contract/slots.d.ts:355` |
| chat | `conversation.chat.reasoning.body` | single / session | 展开的推理正文（官方条目 priority 100）。`.../contract/slots.d.ts:375` |
| model-selection | `conversation.input.model.label` | single / session / inline | composer 模型名内联标签（trigger/menu/option 三个位置）。`.../client/slots.d.ts:34`，注册范例在同文件 `:20-33` |
| workspace | `workspace.toast` | keyed / root | 工作区通知，按既有业务判别式 `ToastKind` 分派。`.../contract/toast.d.ts:50` |

**新增 Factory（8 个）**：`conversation.user.text`(`conversation slots.d.ts:165`)、`conversation.user.text.node`(:170)、`conversation.images.content`(:178)、`conversation.hero.options`(:395)、`conversation.chat.user.content`(chat `:300`)、`conversation.chat.user.images`(:305)、`conversation.chat.reasoning.content`(:312)、`workspace.toast.content`(toast `:61`)。

**移除 slot（1 个）**：`conversation.message.images`（chat，0.2.0 `slots.d.ts:252`）→ 由 `conversation.chat.message.images` / `conversation.chat.user.images` 取代。

> 既有（非新增，供对照）：`tool.call.toolview`（keyed，按 wire 工具名分派，**本插件正在用**）、`tool.call.images`（single，工具结果图像画廊）、`shell.overlay`（list/root 浮动层，**本插件正在用**）、`shell.leading`、`main`（keyed/root）、`sidebar.right.tab.menu.item`（**本插件正在用**）、`conversation.chat.turnTail` / `conversation.chat.assistant-actions`（list，轮尾/助手动作）、`conversation.input.left|right|dock|overlay`、`conversation.composer.dock`。证据：`dump-slots.mjs` 输出。

### 3.2 新增导出（按主题，均含 `file:line`）

**A. 客户端扩展位 / 用户文本体系（dsh-client-ui-conversation，+12 文件）**

- `UserTextId`(`contract/user-text.d.ts:4`)、`UserTextDocumentInput`:11、`UserTextNode`:16、`UserTextTransformContext`:25、`UserTextRule`:34、`UserTextEvaluator`:58
- `UserTextDataMap`(`client/index.d.ts:4`)、`UserTextFacts`:13、`UserTextRegistry`(`conversation/user-text-registry.d.ts:5`)、`UserTextDocument`:3
- `UserTextInput`(`contract/slots.d.ts:135`，含 `interactive`/`ellipsis`)、`UserTextInjected`:142、`UserTextNodeOwnerProps`:152、`UserTextNodeProps`:157
- `MessageImageLabels`(:116)、`MessageImagesContentInput`(:131)
- `ConversationMatchHandler`(`contract/conversation.d.ts:178`)、`ConversationNodeDefinitionInput`:233、`ConversationEventRoute`(`conversation/event-registry.d.ts:4`)
- 编辑器/草稿：`CommandChip`(`input/editor/CommandChip.d.ts:12`)、`SerializedCommandChipNode`(`command-chip-node.d.ts:14`)、`CommandChipNode`:18、`$createCommandChipNode`:70、`$isCommandChipNode`:76、`registerCommandChipSeat`:86、`registerCommandChipSelection`(`command-chip-selection.d.ts:19`)、`DraftReference`(`contract/draft-editor.d.ts:20`)、`DraftCommand`:26、`DraftSnapshot`:35、`DraftInput`:41、`DraftInitializationOptions`(`contract/input.d.ts:217`)、`DraftInitializationResult`:222、`resolveDraftInput`(`client/draft.d.ts:7`)、`parseStoredDraft`:13、`snapshotDraft`:21、`readConversationDraft`(`client/stores.d.ts:23`)
- `ToolArgs`(`contract/records.d.ts:282`)
- README 新增章节：`README.zh.md:54` 「已发送用户文本」、`:65`（图像插槽语义）、`:97`（composer 是 shell 所有的 Lexical 编辑器，引用 chip 是原子装饰器节点）

**B. 新包 `dsh-api-remote-access`（远程访问控制）**

- Host 服务 `RemoteAccessService`(`lib/types/index.d.ts:29`，ctx key `remoteAccess`)：`registerPolicy(kind, policy)`、`invalidate(principal?)`、`decide(request)`、`allows(resource)`、`snapshotFor(principal)`、`follow(signal)`
- 类型：`RemoteAccessEndpoint`:9、`RemoteAccessAction`:11、`RemoteAccessRole`:13、`RemoteAccessDecision`:22、`RemoteAccessCondition`:38、`RemoteAccessBinding`:44、`RemoteAccessRequest`:53、`RemoteAccessPolicy`:71、`RemoteAccessDeniedDetails`:88、`RemoteAccessGrant`:104、`RemoteAccessFrame`:116、`RemoteAccessBaseline`(`index.d.ts:15`)
- Client：`REMOTE_ACCESS_SNAPSHOT_KEY`(`snapshot.d.ts:7`)、`mountAccess`(`client/mount.d.ts:49`)、`ClientRemoteAccess`:15、`RemoteEndpoint`:13、`ClientAccessState`(`client/state.d.ts:24`)、`parseInjectedBaseline`:18、`Baseline`:9
- 语义证据：`README.zh.md:10`（概述）、`:25`（Host 服务成员表）、`:58`（Client 面：`ctx.remoteAccess.source(kind,id,action)`、`useRemoteAccess(action)`；ui-session 的 `useSessionAccess(sessionId,action)`/`useAccess(action)`；ui-workspace 的 `useWorkspaceAccess(workspaceId,action)`）
- 关键规则（README `:38` role/binding/policy 判定段 + `:40` 资源解析段）：**owner 从不检查**；"不指明任何资源的调用只访问 `global` 资源，因此只有 `global` 级 role 能放行"（`:40`）；`bindings()` 在每次 `decide()`/`allows()`/快照计算中各调一次、不跨判定缓存（`:38`）

**C. typert 协议（dsh-typert-protocol，+6 文件）**

- `principalOf(invocation)`（`lib/types/principal.d.ts:12`，读非 owner 调用方）
- `PrincipalMap`（`types.d.ts:363`，内置 `owner: { kind: 'owner' }`）、`Principal`:370、`PeerScope`:376
- `RemoteAccessResourceKind`（`remote-access.d.ts:10`）、`RemoteAccessResource`:16
- `RemoteScopeOptions`（`index.d.ts:61`）、`createTypertRemoteInfo`（`remote-info.d.ts:10`）、`isTypertRemoteMethod`:74、`TypertResourceMap`（`types.d.ts:47`）、`TypertResource`:36
- README 新增章节「识别调用方并放行非 owner 调用方」：`@Remote({ name, resources: { session: request => request.address.sessionId } })`
- **新包 `dsh-api-remote-access` 与该能力是一套**：Gateway 解析资源 → 询问 `remoteAccess` → 允许/拒绝（`remote-access/denied`，reason ∈ `resource-invalid` / `no-allow` / `policy-failed`）

**D. 插件市场（3 个新包）**

- `dsh-plugin-market`：`Config`(`lib/types/index.d.ts:14`：`indexes[]` / `fetchTimeoutMs` / `maxBytes` / `cacheTtlMs`，配置表见 `README.zh.md:31`)、`MarketSearch`(`search.d.ts:6`)、`normalizeIndexUrl`(`index-url.d.ts:8`)、`MarketIndexSummary`(`types.d.ts:36`)、`MarketListingEntry`:73、`MarketQuery`:101、`MarketSearchResult`:126；Remote 方法 `listIndexes` / `setIndexes` / `search` / `entry`；agent 工具 `plugin_market`
- `dsh-plugin-market-index`：`parseMarketIndex`(`lib/types/index.d.ts:28`)、`marketInstallTarget`:36、`MarketIndex`(`types.d.ts:82`)、`MarketInstallTarget`:91、`MarketEngines`:51、`MAX_INLINE_ICON_BYTES`:19
- `dsh-client-ui-plugin-market`：`DiscoverSection`(`client/DiscoverSection.d.ts:8`)、`DiscoverFace`(`client/market-store.d.ts:49`)、`DiscoverController`:77、`DiscoverState`:36
- README 证据：`dsh-plugin-market/README.zh.md:25`（配置表：`indexes` 为 volatile 字段，可用 `http(s)` 规范 URL）、`:84`（`plugin_market` 工具返回传给 `plugin_manager.install_bundle` 的 `target`/`registry`；兼容性用 `evaluatePluginCompatibility` 按 `engines.dsh` 计算）；`dsh-client-ui-plugin-market` README:25（Discover 页）

**E. 凭据遮挡（新包 `dsh-client-ui-secret-mask`）**

- `CredentialScanner`(`lib/types/client/credential-scanner.d.ts:17`)、`CREDENTIAL_FORMATS`(`credential-formats.d.ts:56`)、各格式正则常量 `KEY`:8 … `JWT`:42、`CredentialFormat`:44
- `MASK` / `CredentialMasks`(`credential-masks.d.ts:2/4`)、`createSecretRule`(`secret-rule.d.ts:24`)、`SecretText`(`SecretText.d.ts:11`)、`formatTables`(`format-tables.d.ts:28`)、`NS`/`zh`/`en`(`locales.d.ts:3/5/18`)
- README:26「使用本包」（Web 应用 bundle 默认挂载；每个 UserText Factory 调用方都会被遮挡：消息气泡、插话消息、发送中回显、排队消息、`/goal` 输入气泡）、:33「遮挡范围」（`sk-`/`AIza`、`ghp_`/`github_pat_`/`glpat-`/`npm_`/`hf_`、`AKIA`/`ASIA`/`LTAI`/`AKID`、`xoxb-`/`sk_live_`/`rk_test_`/`whsec_`、JWT、私钥块、URL 内密码；保留前 8 字符）

**F. UI 原子件（dsh-client-ui-primitives，+5 文件）**

- `InlineEditor`(`lib/types/index.d.ts:24`，多行内联编辑器：Enter 保存 / Shift+Enter 换行 / IME 组合期间 Enter 不动作 / Esc 取消；语义见 `lib/types/InlineEditor.d.ts` 头注释)
- `HoverCardGroup`(`HoverCardGroup.d.ts:18`) + `HoverCardGroupContext`:11（列表与 portal 共享首次显示驻留）
- `CommandText`(`CommandText.d.ts:15`) + `CommandTextProps`:2
- `ReferenceChip`(`index.d.ts:55`) + `ReferenceChipProps`(`user-text.d.ts:15`)、`UserTextRun`(`index.d.ts:55`) + `UserTextRunProps`(`user-text.d.ts:5`)
- `PermissionIconAutoReviewMedium` / `…Regular`(`index.d.ts:48`)
- `dsh-client-ui-attachment`：`MessageImagesContent`(`lib/types/client/MessageImages.d.ts:9`)

**G. 宿主服务 / 工具 / 分发**

- `dsh-session`：`appendPluginRecord`(`lib/types/index.d.ts:117`)、`pluginRecordOf`:126、`PluginRecordType`(`types.d.ts:520`)、`PluginRecordMap`:527、`PluginRecord`:535；README.zh.md:68「写入实验性插件记录」——**"本仓库之外的插件同样不得调用它"**（:70）
- `dsh-tools`：`PtcCalls`(`lib/types/ptc-calls.d.ts:6`)，`run()`:22（跨沙箱策略变更的取消/结算 + 嵌套工具清理）；新增 `locale/{en,zh}.json`
- `dsh-app-boot`：`readBundlePatches`(`lib/types/index.d.ts:13`)、`ON_DEMAND_BUNDLES`:19、`OFFICIAL_ON_DEMAND_CATALOG`:19、`ProfileRuntimeResolution`:38、`ResolutionRestartRequired`:40、`ProfileRecompositionOptions`:72、`ProfileRecomposition`:82、`recomposeProfile`:106、`OfficialBundleCatalogEntry`(`official-bundles.d.ts:5`)、`realModuleFile`(`profile-resolution/legacy-links.d.ts:14`)；README.zh.md:89（`ON_DEMAND_BUNDLES` 列出"仅按需安装的官方公开包"，目录禁存安装目标）
- `dsh-plugin-manager`：`recordPendingBuilds`(`lib/types/build-approval.d.ts:11`)、`ignoredBuildNames`:17、`approveBuilds`（同文件，紧随其后）、`officialBundleInstallTarget`(`official-install-target.d.ts:11`)、`dependencySpec`(`install-spec.d.ts:62`)、`flatten`(`patch.d.ts:7`)、`RestartReason`(`types.d.ts:31` = `'no-hmr' | 'package-moved' | 'host-module' | 'unmanaged-plugin' | 'module-comparison'`)
- `dsh-hmr`：`ModuleFiles`(`lib/types/module-files.d.ts:9`)、`PackageManifests`(`package-manifest.d.ts:2`)、`ProfileReconciliation`(`index.d.ts:206`)、`PendingModule`:218
- `dsh-client-modules`：`ClientReleaseChange`(`client/index.d.ts:18`)、`WebBootRelease`:21、`readRelease`(`client/manifest.d.ts:186`)、`notifySubscribers`(`client/notify.d.ts:7`)、`ReleaseChangeGate`(`client/release-change.d.ts:18`)
- `dsh-client-connection`：`openConnectionWebSocket`(`client/socket.d.ts:49`)、`ConnectionWebSocketEventMap`:3、`CONNECT_PATH`(`connect-protocol.d.ts:5`)、`ConnectionAdmission`(`index.d.ts:6`)、`Principal`:7、`Peer`:9、`PeerOptions`:10、`isRemoteAuthority`(`api-request-trust.d.ts:35`)、`ConnectionInteractions`(`client/index.d.ts:8`)；新增 `lib/client.browser.js` + `lib/client.node.js`（替换 `lib/client.js`）
- `dsh-web-app`：`WebApp`(`lib/types/index.d.ts:17`)、`parsePublicUrl`(`public-url.d.ts:15`)；README.zh.md:63「监听、信任与公开部署」、:79「公告应用 URL」（`--public-url` / `--trusted-host` / `--tls-cert` / `--tls-key`）
- `dsh-llm`：`LlmCallControls`(`call-config.d.ts:11`)、`ConfigureCall`:36、`LlmNativeAuth`(`types.d.ts:259`)
- `dsh-hook-protocol`：`selectHookGroups`(`index.d.ts:9`)
- `dsh-jobs`：`JobRegisteredData` / `JobSettledData` / `JobToolCall`(`index.d.ts:15`)
- `dsh-client-ui-model-selection`：`ModelLabelOwner`(`client/index.d.ts:6`)
- `dsh-client-ui-workspace`：`ToastKind` / `ToastNotice` / `ToastDisplay` / `ToastOccurrence` / `ToastDisplayInjected` / `ToastEntryProps` / `ArchiveToastInjected` / `ArchiveToastEntryProps` / `WorkspaceToastProps` / `WorkspaceToastOwnerProps`(`contract/toast.d.ts:5-43`)、`registerToasts`(`toast/register.d.ts:9`)、`ToastEntry`(`toast/Toast.d.ts:8`)、`ArchiveToastEntry`:14、`WorkspaceToast`:20、`SessionIdInjected`(`contract/slots.d.ts:404`)、`RowToastActions`:436、`SessionIdMenuItem`(`session-actions/SessionId.d.ts:7`)、`StartSessionOptions`(`client/index.d.ts:6`)
- `dsh-client-ui-reference`：`FileReference`(`client/FileReference.d.ts:19`)、`FolderReference`:25、`FileReferenceInjected`:5、`fileReferenceRule`(`client/user-text-rules.d.ts:14`)、`folderReferenceRule`:16
- `dsh-client-ui-goal`：`GoalCommandReference`(`client/GoalCommandReference.d.ts:8`)、`goalCommandReferenceRule`(`client/user-text-rules.d.ts:20`)
- `dsh-client-ui-theme`：字体体系（`FONT_ROLES` `theme-settings.d.ts:22`、`FONT_SIZE_SPECS`:43、`DEFAULT_FONT_SIZES`:69、`FONT_FAMILY_FIELDS`:71、`fontFamilyVariable`:82、`fontSizeSchema`:107、`normalizeFontFamily`:131、`createFontRowStore` `settings-store.d.ts:41`、`FontFamilyRow`/`FontSettingsGroup` 组件）
- `dsh-client-ui-tool`：`ExitCodeBadge`(`components/ExitCodeBadge.d.ts:6`)、`recordedAbsolutePath`(`models/recorded-path.d.ts:7`)、`terminalExitLabel`(`models/terminal-card-model.d.ts:66`)、`isBackgroundShellCall`:72
- `dsh-llm-deepseek-account`：账号模型目录（`AccountModelCatalog` `catalog.d.ts:26`、`ModelListing` `listing.d.ts:44`、`resolveAccountCatalog` `resolve-catalog.d.ts:44` 等 23 个新导出）
- `dsh-typert-protocol` README 新增章节：识别调用方并放行非 owner 调用方（同 C）

### 3.3 系统性变化（非单包）

1. **i18n 铺开**：44 / 56 个受测包新增 `locale/en.json` + `locale/zh.json`（含 `dsh-api-remotes`、`dsh-client-ui-settings-plugins`——后者的 locale 目录在 0.2.0 完全不存在）。**这些包的业务导出均无变化**，属纯本地化。
2. **invariant 机制移除**：10 个包删除 `lib/invariant.js` 与 `lib/types/invariant.d.ts`（`dsh-tools`、`dsh-session`、`dsh-agent`、`dsh-llm`、`dsh-client-ui-renderer`、`dsh-credentials`、`dsh-client-modules`、`dsh-hook-protocol`、`dsh-jobs`、`dsh-experimental-agent-team`）；`dsh-invariants` 停发。
3. **web-frontend 资源重构**：132 → 92 文件；删 40 个 KaTeX 字体文件（woff/ttf），新增 21 个 `dist/assets/langs/*.js`（asciidoc/bat/cpp/graphql/http/julia/latex/php/powershell/r/rst/ruby/scala/svelte/swift/system-verilog/vb/verilog/vue），vendor 与 index 资产名全变。**升级后必须强刷/确认静态资源缓存**。
4. **Web 包整体获得 locale**：`dsh-web-app` 新增 `locale/{en,zh}.json` + `locale/startup/{en,zh}.json` + 新 `lib/public-url-*.js`。
5. `dsh-client-connection` 客户端入口拆分 `lib/client.browser.js` / `lib/client.node.js`（原 `lib/client.js` 删除）。

### 3.4 破坏性变更 / 移除（**"改变了什么"**）

| 包 | 移除项 | 与本插件关系 |
|---|---|---|
| dsh-client-ui-chat | slot `conversation.message.images`（→ `conversation.chat.message.images`）；导出 `StatsPillsProps`/`StatsPills`/`TURN_PROCESS_INDEPENDENT_KINDS`/`isVisibleAssistantChunk`/`PartialAccumulator`；文件 `conversation-nodes/partial.d.ts` | 0 引用 ✓ |
| dsh-client-ui-tool | 导出 `UseToolCallArgumentsPartial`/`ToolCallHookContext`/`ToolCallInjected`/`PreparingToolRow`/`validEscalationFields`/`bindToolCallArgumentsPartial`；文件 `PreparingToolRow.d.ts`、`tool-call-arguments-partial.d.ts` | 0 引用 ✓，但仍用 `tool.call.toolview`（契约新增 `phase:'preparing'`、`loadImage`，建议回归） |
| dsh-client-ui-conversation | `RenderMessageImages`、`registerClaimDecoration`、`refreshClaimDecoration`；文件 `claim-decor.d.ts` | 0 引用 ✓ |
| dsh-client-ui-primitives | `projectUserText`、`UserTextReferences` | 0 引用 ✓ |
| dsh-app-boot | `HARNESS_SOURCE_SECTION`、`addHarnessSourceSection` | 0 引用 ✓（若曾计划用 system prompt 注入，改用新 `dsh-harness-dev-context` 思路） |
| dsh-web-app | `WebRuntimeValues`、`resolveLanTrust` | 0 引用 ✓ |
| dsh-client-connection | 导出 `OperatorPeer`；文件 `operator-peer.d.ts`、`lib/client.js` | 未引用 ✓ |
| dsh-experimental-agent-team | `TeamMailbox` + `mailbox.d.ts/js`（README「直接消息与历史兼容」） | 无关 |
| dsh-client-ui-renderer / dsh-credentials / dsh-hook-protocol 等 | 各移除 `name/inject/apply`（即内置 invariant 插件面） | 无关 |
| dsh-client-ui-theme | `FontSizeRowState` / `createFontSizeRowStore` → `FontRowState` / `createFontRowStore` | 无关 |

---

## 4. 对本插件的 Top 5 可落地优化（按收益排序）

> 现状基线（只读核对）：插件已用槽位 `shell.overlay`、`sidebar.right.tab.menu.item`、`tool.call.toolview`、`plugins.bundle.config`、`plugins.row.config`（`plugin/client.js`：`SLOT` / `MENU_SLOT` / `safeInject` 调用点）；客户端只 `require('react')`；宿主侧有一个手写的 8 方法 typert face（`plugin/wire.host.mjs`：`saveShot` / `report` / `saveAnnotations` / `saveMerged` / `deleteAnnotations` / `getStats` / `clearArtifacts` / `getInject…`，名字符串 `dshBrowserKit`）；批注投递走"合成 user message 追加到 `decision.messages`"（`plugin/annot-delivery.host.mjs:14-16`），消息胶囊/输入框胶囊走 DOM 注入（`client.js:8-9`、`ensureAnnotChip` / `attachMsgChip` / `ensureConvoChips`）。

### Top 1 — `shell.bottom`：给浏览器窗口一个官方 "Dock 底栏"

- **证据**：`dsh-client-ui-layout/lib/types/client/index.d.ts:81-84`（A）+ `README.zh.md:34`（A："root 作用域的单一 `shell.bottom` slot 横跨三列下方的整行。占用方控制自身高度与显隐；三列按该高度缩短，空内容不预留空间。切换主面板时保留底部组件……**默认组合不占用此 slot**"）+ asar 命中 `shell.bottom`（B）
- **落地设想**：注册 `ctx.slots.inject('shell.bottom', () => ctx.slots.register({ name: 'shell.bottom' }, DockView))`，把现有 agent 窗口的同一份视图（webview/工具栏/状态条）以"Dock 模式"渲染；保留 `shell.overlay` 作为浮窗模式，由配置项切换。收益：三列自动让出高度（不再靠 `fit`/`resolution` 硬算）、切主面板不卸载（长驻浏览器会话）、点击不遮挡（`shell.overlay` 是 click-through，Dock 不需要 `pointer-events` 打补丁）。
- **风险**：低。单一占用位，若其他插件也占用需协商（slot kind `single`，抢占语义）；Dock 高度吃垂直空间，需给"折叠到标题条"的默认态。

### Top 2 — 新包 `dsh-api-remote-access` + typert principal：给 8 方法 face 上访问控制

- **证据**：新包 `dsh-api-remote-access`（`package.json` description = "Method-level Remote access control for non-owner Peers and the per-Peer access snapshot"；`README.zh.md:25` Host 成员表 `registerPolicy`/`decide`/`allows`/`snapshotFor`/`follow`；`README.zh.md:38` role/binding/policy 判定、`:40` 资源解析与 `global` 兜底）+ `dsh-typert-protocol/lib/types/principal.d.ts:12` `principalOf` + `types.d.ts:363-370` `PrincipalMap`/`Principal` + `remote-access.d.ts:10/16` + `RemoteScopeOptions`(`index.d.ts:61`) + asar 中存在 `dsh-api-remote-access`（B）
- **落地设想**：① 在 face 上按 `@Remote({ resources: {...} })` 或 `@RemoteScope` 声明资源，让"谁能调 `saveShot`/`clearArtifacts`"变成显式规则；② 在持久输出（截图、批注落盘）上记录 `principalOf(this.ctx.invocation)`，审计"是谁触发的"；③ 面板入口用 `useRemoteAccess(action)` / `useSessionAccess(sessionId, action)` 隐藏 Host 会拒绝的按钮（Client 快照 + `mountAccess`）。收益：浏览器控制是**高危能力**（截图、HID 输入、清空产物），远程/`--host` 部署下需要明确的授权面。
- **风险**：中高 + **必须实测**。本插件当前是**手写描述符**（`wire.host.mjs:128/151` 自造 `invocation: Object.freeze({kind:'direct'})`），并没有生成式 `@Remote` 的 `this.ctx.invocation`；0.2.1 新增"不指明资源的调用只访问 `global`，只有 `global` 级 role 能放行"，因此非 owner peer 调用 face 可能被 `remote-access/denied`（reason `no-allow`）拒绝。**先本地（owner）回归，再在 `--host` 场景验证**，不要先按"肯定被拒"改代码。

### Top 3 — 插件市场三包：把 dsh-browser-kit 变成"可发现、可安装"

- **证据**：新包 `dsh-plugin-market`（`Config` `lib/types/index.d.ts:14`：`indexes[]` / `fetchTimeoutMs` / `maxBytes` / `cacheTtlMs`；README.zh.md:25 配置表，`:84` 工具语义）、`dsh-plugin-market-index`（`parseMarketIndex` `lib/types/index.d.ts:28`、`marketInstallTarget`:36、`MarketIndex` `types.d.ts:82`、`MarketEngines`:51）、`dsh-client-ui-plugin-market`（`DiscoverSection` `client/DiscoverSection.d.ts:8`、`DiscoverFace` `client/market-store.d.ts:49`）；asar 中存在三者（B）
- **落地设想**：仓库里加一份 **market index format 1 JSON**（name/title/description/categories/labels/versions/source/engines.dsh/install target），指向 `dsh-browser-kit` 的 npm 包或 git commit（`marketInstallTarget` 支持 `name@version`+registry 与 `git+<url>#<commit>`）；用户从 Web "Discover" 页或 `plugin_market` 工具检索→`plugin_manager.install_bundle` 安装。**兼容性评估复用 `evaluatePluginCompatibility`，与本插件 `package.json` 的 `engines.dsh: ">=0.2.0-rc.2 <0.3.0-0"` 直接对接**（该判定链已由 Lead 核实为 `dsh-app-boot/plugin-compatibility.js`）。
- **风险**：中。① 随附 profile **默认不启用**实验性市场组合包（`dsh-experimental-plugin-market-bundle`，README 明示），需用户显式启用；② 索引是 HTTP(S) 拉取，Host 用进程 `fetch` 且拒绝重定向，索引托管必须稳定；③ 市场索引条目会暴露插件元信息，注意不要把内部路径/凭据写进 title/description。

### Top 4 — 用户文本内联节点体系：批注从"DOM 注入胶囊"变成"官方节点"

- **证据**：slot `conversation.user.text.node`（keyed/session/**inline**，`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:186`）+ Factory `conversation.user.text`(`:165`) + 注册表与规则类型（`contract/user-text.d.ts:11/16/25/34/58`、`UserTextDataMap` `client/index.d.ts:4`、`UserTextRegistry` `conversation/user-text-registry.d.ts:5`）+ 官方说明（`README.zh.md:54/56/58`：业务扩展 `UserTextDataMap`/`UserTextFacts`，通过 `ctx.uiConversation.userText` 注册 `match(text, from, context)`，向 `conversation.user.text.node` 贡献 renderer，缺 renderer 时显示原文片段）+ **官方范例** `dsh-client-ui-secret-mask`（`createSecretRule` `secret-rule.d.ts:24`，README:26 说明"每个 UserText Factory 调用方都会被遮挡：消息气泡、插话、发送中回显、排队消息、`/goal` 输入气泡"）
- **落地设想**：给批注定义一种 `UserTextId`（例如页面引用/批注 id），注册匹配器把用户文本（或其消息中的批注标记）解析为节点，用 `conversation.user.text.node` 渲染成可点芯片（点开即定位到该批注/页面），`interactive` 与 CSS `ellipsis` 由 Props 控制。收益：整条链路不再是 `document.querySelector` + 2 s tick 维护（`client.js:14` `tickChipLifecycle`）——渲染由引擎驱动，且**发送后仍随消息保留**（Facts/节点身份由引擎维护）。
- **风险**：中高，且**当前交付路径不匹配**：批注现在走"合成 user message 塞进 `decision.messages`"（`annot-delivery.host.mjs:14-16`，明确"不改用户消息"），该消息不进会话日志、不进 UI，因此 UserText 节点无落点。需要产品决策：是否把批注改为**用户消息的一部分**（可见、可解析，但会进入模型上下文）——这同时是 token 账本变化。**建议先做只读 PoC**，不要直接改投递架构。

### Top 5 — 官方 UI 原子件 + 图像 Factory：去掉自绘浮层的一部分

- **证据**：`dsh-client-ui-primitives` 新增 `HoverCardGroup`(`lib/types/HoverCardGroup.d.ts:18` + Context:11)、`InlineEditor`(`index.d.ts:24`；`InlineEditor.d.ts` 头注释：Enter 保存 / Shift+Enter 换行 / IME 组合期间 Enter 不动作 / Esc 取消 / 最多 6 行后滚动)、`CommandText`(`CommandText.d.ts:15`)、`ReferenceChip`(`index.d.ts:55`)、`UserTextRun`(`index.d.ts:55`)、`PermissionIconAutoReview*`(`index.d.ts:48`)；`dsh-client-ui-attachment` 导出 `MessageImagesContent`(`client/MessageImages.d.ts:9`)；Factory `conversation.images.content`(`conversation slots.d.ts:178`，root 作用域、`props: MessageImagesContentInput`、`locale: 'conversation'`，`MessageImageLabels` 见 `:116`、`MessageImagesContentInput` 见 `:131`)
- **落地设想**：① 批注列表的悬停预览用 `HoverCardGroup`（列表 + portal 共享首次驻留，避免逐条计时器）；② 批注备注/重命名用 `InlineEditor`（省掉自绘 contenteditable 与 IME 处理）；③ 页面/元素引用用 `ReferenceChip`；④ 若把截图纳入"附件"模型（`MessageImageSource` + 会话授权的 `MessageImageLoader`），面板内画廊直接用 `MessageImagesContent` 或 `conversation.images.content` Factory，无需自己实现鉴权 URL 与缩略图。
- **风险**：中低。① 客户端 bundle 目前只有 `require('react')`，要引入 `@deepseek-ai/dsh-client-ui-*` 需确认宿主 client 模块解析白名单（**未验证**）；② 截图当前是"落盘 + 返回路径"（`browser_screenshot` 工具描述），不是附件，图像 Factory 只有在附件化后才有价值；③ 引入官方组件会跟随上游视觉变更，需要视觉回归。

---

## 5. 未确认项（查过但没有产物级答案）

1. **非 owner 调用 face 的默认行为**：0.2.1 起"不指明资源的调用只访问 `global`，只有 `global` 级 role 能放行"（`dsh-api-remote-access/README.zh.md:40`），但本插件是**手写描述符**（`wire.host.mjs:128/151`），未声明 `resources`。远程 peer 调 `dshBrowserKit` 到底是被拒还是放行——**未实测**（需 owner 本地 + `--host`/`--trusted-host` 两种场景）。查过：`dsh-api-remote-access` README 全篇、`dsh-typert-protocol` types/README、`plugin/wire.host.mjs`。
2. **插件市场是否默认启用 / 是否接受第三方索引**：`dsh-plugin-market/README.zh.md:25` 明示"可选的实验性组合包把该服务挂载为 `plugin-market` 行；随附 profile 默认不启用该组合包"，且"默认不配置任何索引源"；`indexes` 可填任意 http(s) URL（⇒ 看来自定义/第三方索引是被支持的），但**是否有官方白名单/签名/审核**未确认；`~/.dsh/profiles/desktop/cordis.patch.yml` 与 `cordis.yml` 中也搜不到 `plugin-market` / `remote-access` 行（B 级：已搜）。
3. **`OFFICIAL_ON_DEMAND_CATALOG` 是否对第三方开放**：`dsh-app-boot/README.zh.md:89` 只说"`ON_DEMAND_BUNDLES` 列出**仅按需安装的官方公开包**"，`officialBundleInstallTarget` 也限定"官方目录包名"（`dsh-plugin-manager/lib/types/official-install-target.d.ts:11`）。第三方插件能否进入官方目录——**未见证据**，推测不能（C）。
4. **`shell.bottom` 与其他占用者的抢占/顺序语义**：`single` slot 的行为（后注册者是否顶替、是否有 priority）在本包 `.d.ts` 中无声明；也未实测与现有 `shell.overlay` 共存时的视觉层叠。查过：layout `index.d.ts` 全文、`README.zh.md`、slots 包 `index.d.ts`（无 API 变化）。
5. **`UserText` 节点方案在我们场景的可行性**：需要批注 token 出现在"用户文本"里，而当前投递是合成 user message（不进日志/不进 UI）。把批注并回用户消息对**模型上下文与 token 账本**的影响未测；`UserTextFacts` 如何由业务侧提供也未验证。
6. **`dsh-client-ui-secret-mask` 的 `CredentialScanner` 能否在第三方 client 插件里直接 import**：导出签名存在（`credential-scanner.d.ts:17`），但依赖链/打包方式（是否是 `/client` 子入口的可导入面）**未验证**；也未验证官方遮挡是否覆盖"插件面板内自绘的凭据展示"（README 只保证"每个 UserText Factory 调用方"）。
7. **`dsh-session` 插件记录的边界**：`README.zh.md:70` 明确"本仓库之外的插件**同样不得调用**它"（仓库检查无法约束外部），且 `plugin-record-callers` 门禁只在本仓库生效。运行时不阻止 = 可用但**违反设计意图**；另外 `PluginRecordType` 语法要求 `plugin:<owner>/<record>` 且语义上 `owner` 是 `@deepseek-ai/dsh-experimental-<owner>` 的后缀（`:72`），对 `dsh-browser-kit` 不成立。
8. **`dsh-client-ui-deepseek-model-label-1017`**（`0.0.0-stage` → `0.2.1-rc.2`）与 `dsh-web-deepseek-api` 的早期版本号形态（`0.0.0-stage`）说明 0.2.1 有"先 stage 后 rc"的发布路径；这两个包的 stage→rc 之间是否还有内容变化**未逐版对比**（只比了 `0.2.1-rc.2` 与 `0.0.0-stage` 的有无）。
9. **`dsh-compaction-image-offload` 行为是否变化**：该包 0.2.0→0.2.1 只新增 locale，README 无标题变化；但其"把超预算图片替换为注明附件与只读路径的文本再重试"的机制与**截图回传的 token 策略**直接相关（截图若走图像内容，会被 offload 成路径文本）。未确认策略参数/触发阈值是否有变——查过：该包文件列表、导出集合、README 标题集合（均无变化）。
10. **未做全量 240 包内容级 diff**：本次逐包 API 差集覆盖 56 个包（56 × 2 = 112 个 tarball：本轮现下载 101 个 + 复用既有缓存 10 个 + 手工补下 1 个）+"全部 43 个 `dsh-client-*` 的 slot 扫描"+"全 scope 体积/文件数 delta"。剩余约 180 个包**只做了体积/文件数级别的筛查**，未逐包读导出集合；其中体积 delta ≥ +20 KB 的包已全部纳入（见 2.4），但**不能声称"其余包零变化"**。

---

## 附录 A：方法与复现

```powershell
# 0) 版本核对（已得 0.2.1-rc.2）
(Get-Item "D:\DeepSeek\DeepSeek Harness.exe").VersionInfo.FileVersion

# 1) 工作目录（全部中间产物在这里，不在项目内）
cd "$env:TEMP\dsh-compat\ver-delta-work"

# 2) 包集合：registry 搜索索引（不完整，仅作起点）
node fetch-scope.mjs          # -> scope-versions.json

# 3) 已安装包真值：解析 app.asar header（8 字节 + header pickle）
node asar-list2.mjs           # -> installed-pkgs.json  (306 个 @deepseek-ai)

# 4) 差集：搜索索引里没有的 72 个包逐个查 packument → 24 个 0.2.1 新增
node extra.mjs                # -> extra-pkgs.json
node newdesc.mjs              # -> new-pkgs.json（描述）

# 5) 全 scope 体积/文件数 delta（235 个可比包）
node fetch-meta.mjs           # -> packument-meta.json / size-delta.json

# 6) 下载 + 解包 + 逐包 API diff（56 个包 × 2 版本）
node ensure.mjs               # -> ensure.log
node diff.mjs                 # -> diffs/<pkg>.json, diffs/_all.json, diff.out
node stats.mjs                # 汇总计数

# 7) 全部 dsh-client-* 的槽位扫描（新增/移除 slot 与 factory）
node slot-sweep.mjs           # -> slot-sweep.json
node dump-slots.mjs           # 现有槽位（按关键词）

# 8) 安装包证据：在 174 MB asar 里按字节流命中新 slot id 字符串
node asar-strings.mjs         # -> shell.bottom / conversation.user.text.node / … FOUND

# 9) README 章节级证据
node extract-readme.mjs       # 需 readme-jobs.json
```

**中间产物**（均在 `%TEMP%\dsh-compat\ver-delta-work\`）：`scope-versions.json`、`packument-meta.json`、`size-delta.json`、`extra-pkgs.json`、`new-pkgs.json`、`installed-pkgs.json`、`slot-sweep.json`、`diffs/_all.json`、`diff.out`、`slot-sweep.out`。

## 附录 B：外部内容处理声明

本报告引用的 npm registry 数据、各包 `README.md` / `README.zh.md` 内容，均作为**数据**读取，未执行其中任何指令；未安装任何包（只下载 tarball 到 `%TEMP%`）、未改动 DSH profile、未启动服务器。
