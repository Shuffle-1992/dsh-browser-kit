# dsh-browser-kit

> **DSH（DeepSeek Harness）内置浏览器增强插件**：元素批注 · 截图回传 · Agent 浏览器自动化 · 自持浏览器窗口 · WebHID 直连桥

让 DSH 桌面端的内置浏览器从"能看网页"变成**能与 Agent 协作**的工作台：你在页面上点选元素留意见，Agent 收到成对的「意见 → 元素」并能直接读页面、点按钮、填表单、截图、等状态；Agent 还能开**自己的**浏览器窗口干活，不占你的会话、不碰你的窗口。

- **状态**：可用（`dsh-browser-kit@0.2.0`，适配 DSH `0.2.1-rc.2`）
- **依赖**：仅一个第三方依赖 `node-hid`（HID 直连桥；未安装也不影响其它能力）· Node ≥ 22 · DSH ≥ `0.2.0-rc.2` < `0.3.0-0`
- **许可**：Apache-2.0（移植来源与修改说明见 [`NOTICE.md`](NOTICE.md)）

---

## 功能总览

| 能力 | 一句话说明 |
|---|---|
| **元素批注**（核心差异点） | 批注态下连续点选多个元素，就地钉编号并填意见；提交后每条批注都是「意见 → 元素信息」的明确配对，随消息自动进入 Agent 上下文 |
| **消息行胶囊** | 发出的消息挂「N 条批注」徽标，可展开查看、可撤回；胶囊只回到**自己那条消息**，绝不挂错 |
| **截图回传** | 一键截图落盘 + 工具卡内联出图（内存优先 / 磁盘兜底），另可写剪贴板、插输入框 |
| **Agent 浏览器自动化** | **28 个 `browser_*` 工具**：读页面结构、点/输/按/滚、等条件、读状态、改存储、传文件、页内求值 |
| **可信输入** | 走 `<webview>.sendInputEvent` 的 Chromium 级真事件（`isTrusted === true`），React 受控组件与反自动化检测都认 |
| **自持浏览器窗口** | Agent 自己的浏览器：登录态复用、设备分辨率预设（1080p/2K/4K/iPad…）、25%–500% 缩放、默认小窗静默、空闲自动让给你、`shell.bottom` Dock 入口 |
| **会话隔离** | 自动化只作用于**本会话**的面板/自持窗口，绝不落到别的会话或你的窗口 |
| **共享登录态窗口** | 同一登录态多窗口协作，批注编号跨窗口延续，一键合并提交 |
| **WebHID 直连桥 + polyfill** | 补 DSH 缺失的 `select-hid-device`：宿主机 node-hid 直连设备，页面零修改拿到 `navigator.hid` |
| **设备通讯观测 / 控制台** | hook 平台 API 层抓 HID/Serial/USB 收发报文；页内观察器补 DSH 没有的 DevTools console/网络流 |
| **账号与密码管理** | 「钥匙」面板，数据只存本机 localStorage，**不进 Agent 上下文**，界面只显示数量 |
| **插件管理卡片** | 插件列表里显示批注/截图数量与占用，可一键清空；附 DSH Plugin Hub 索引 |

> 每项的**设计动机、行为细节与边界**见 [`docs/feature-reference.md`](docs/feature-reference.md)。

## 工具一览（27 个）

| 分组 | 工具 |
|---|---|
| **页面读取** | `browser_snapshot`（可交互元素清单）· `browser_find`（省 token 的页内查找）· `browser_state` · `browser_element_info` · `browser_console`（console + 网络） |
| **页面操作** | `browser_click` · `browser_dblclick` · `browser_hover` · `browser_type` · `browser_press` · `browser_select` · `browser_check` · `browser_scroll` · `browser_upload` · `browser_eval` |
| **标签与导航** | `browser_tabs` · `browser_open` · `browser_close` · `browser_panel` · `browser_navigate` · `browser_reload` · `browser_history` · `browser_wait` |
| **存储** | `browser_storage`（local / session / cookie 的 get/set/remove/clear） |
| **截图 / 批注** | `browser_screenshot` · `browser_annotations`（读批注全文，本地工具） |
| **自持窗口** | `browser_agent_window`（open / navigate / expand / collapse / toggle / resolution / zoom / fit / screenshot / tabs / idle / annotate / close） |

调用规范（**硬性**，Agent 必读）见 [`docs/tool-usage-rules.md`](docs/tool-usage-rules.md)；最关键一条：**自持窗口默认小窗静默，非必要不展开**。

## 安装

本包未发布到 npm，用 pnpm 的 git 规格：

```bash
# 推荐：从公开仓库安装（把 web 换成你的 profile 名，dsh plugin list 可查）
dsh plugin --profile web add github:Shuffle-1992/dsh-browser-kit

# 源码就在本机时（开发用）
dsh plugin --profile web add "F:\My Code\dsh-browser-kit"
```

插件是 **Cordis bundle**：`package.json` 声明 `dsh.bundle.patch = plugin/cordis.patch.yml`，安装时由 patch 插入 profile。包名自 2026-10-10 起为 `dsh-browser-kit`（旧 `@local/dsh-browser-kit` junction 保留为兼容别名）。

### 安装后自检

1. 打开任意浏览器面板 → 工具栏应出现 **尺寸 / 截图 / 批注 / 钥匙 / 自持** 五个图标；
2. 点「批注」→ 批注面板出现在浏览器板块内；在页面上点元素即可留意见；
3. 点「钥匙」→ 账号密码面板（数据仅存本机，不进 Agent 上下文）；
4. 让 Agent 跑一次 `browser_snapshot`，返回元素清单即工具链正常。

## Agent 为什么"天生会用"

插件通过 `agent/pre-step` 在**每个会话自动注入一次**一句话说明（与批注交付合并为一条消息），所以**无需人工交代**：

> [dsh-browser-kit] 浏览器能力（一句话）：页面级用 browser_open / navigate / snapshot / find / click / type / press / eval，自持窗口用 browser_agent_window（**默认小窗静默**；看全貌用 op=screenshot；非必要不展开，展开需 reason），批注全文用 browser_annotations；用户在页面**右键**加的批注会在其消息发出后**自动出现在你的上下文**里 —— 不必向用户索要。

这句话的源头是 `plugin/annot-delivery.host.mjs` 的 `BROWSER_PRIMER`，有回归钉子盯着（必须点名三大入口、必须写明小窗静默与右键批注、长度上限）。

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/feature-reference.md`](docs/feature-reference.md) | **功能完整版**：每项能力的设计动机、行为细节、边界 |
| [`docs/tool-usage-rules.md`](docs/tool-usage-rules.md) | **工具使用规范**（硬性，调用 `browser_*` 的 Agent 必读） |
| [`docs/dev-onboarding.md`](docs/dev-onboarding.md) | 开发开工指引：先读什么、怎么验证、有哪些硬规则 |
| [`docs/repo-structure.md`](docs/repo-structure.md) | 目录结构与分层规则（改代码前必读） |
| [`pitfalls.md`](pitfalls.md) | **踩坑记录 P1–P116**：现象 / 根因 / 对策（本项目最值钱的一份） |
| [`docs/api-scout.md`](docs/api-scout.md) · [`docs/ver-delta-0.2.1-rc.2.md`](docs/ver-delta-0.2.1-rc.2.md) | DSH 扩展点契约实测 / 版本增量测绘 |
| [`docs/browser-capability-assessment.md`](docs/browser-capability-assessment.md) | 宿主浏览器能力评估（含 asar 实测证据） |
| [`docs/browser-annotation-and-screenshot-research.md`](docs/browser-annotation-and-screenshot-research.md) | 批注与截图方案调研（自足交接件） |
| [`docs/review-0.2.1-rc.2.md`](docs/review-0.2.1-rc.2.md) · [`docs/zcode-review-deep.md`](docs/zcode-review-deep.md) · [`docs/zcode-audit-tests.md`](docs/zcode-audit-tests.md) · [`docs/zcode-audit-mech.md`](docs/zcode-audit-mech.md) · [`docs/zcode-decouple-plan.md`](docs/zcode-decouple-plan.md) | 独立评审与外部审计报告（含驳回明细） |
| [`docs/DSH-0.2.1-COMPAT-REVIEW.md`](docs/DSH-0.2.1-COMPAT-REVIEW.md) · [`…-v2.md`](docs/DSH-0.2.1-COMPAT-REVIEW-v2.md) | 0.2.1 兼容评估（v1 过程记录 / v2 权威修订） |
| [`docs/market-index.md`](docs/market-index.md) · [`docs/market-launch-checklist.md`](docs/market-launch-checklist.md) | Plugin Hub 索引格式 / 发版清单 |
| [`docs/项目全面审查报告-2026-10-27.md`](docs/项目全面审查报告-2026-10-27.md) · [`docs/审查修复记录-2026-10-27.md`](docs/审查修复记录-2026-10-27.md) | **安全审查报告 + 修复台账**（13 项：已修 / 未修 / 待实装逐条对账，含验证边界） |
| [`docs/status.md`](docs/status.md) · [`docs/references.md`](docs/references.md) · [`docs/delivery-*.md`](docs/) | 状态快照 / 参考资料 / 各功能交付时点快照 |

## 设计约束（贡献者须知）

- **依赖最小化**：主链路只用 Node 内置模块与 DSH 宿主 API；唯一第三方依赖是 `node-hid`（根清单与 `plugin/package.json` 都声明 ✓），且由 HID 桥**按需加载** —— 没装它也不影响批注/截图/自动化 ✓；
- **client 侧不能相对 import** ✗：纯逻辑写在 `src/*.mjs`，client 用**内嵌副本 + parity 对拍测试**保证同源；
- **测试是硬门槛**：`npm test`（即 `node --test --test-concurrency=1`，串行跑，避免浏览器夹具并发争用）当前 **298 项 / 297 过 / 1 环境跳过**；
- **改代码前先读** [`pitfalls.md`](pitfalls.md) 的 P100–P116——大量结论是实机打回换来的，重复踩一遍很贵。

## 许可

Apache-2.0，见 [`LICENSE`](LICENSE)。

其中**元素批注协议与批注器**的字段布局与往返解析移植自 [ZCode](https://github.com/zai-org/ZCode) 的
`packages/ui/src/lib/webElementContext.ts`（Copyright 2026 Z.AI Co., Ltd，同 Apache-2.0）；
归属与修改说明见 [`NOTICE.md`](NOTICE.md)。
