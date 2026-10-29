# dsh-browser-kit — DSH 0.2.1-rc.1 兼容与优化评估（v2 · 独立复核）

> 原稿 v1：`DSH-0.2.1-COMPAT-REVIEW.md`（2026-10-17，标准模式 DSH 会话）
> **v2 独立复核：2026-10-17（同日，复核方式与 v1 完全不同）**
>
> **为什么单独成文**：复核过程中该文件**连续两次被并发写入**（另一会话正在编辑它 ✗）⇒ 为不覆盖对方成果，本 v2 独立成文、**内容自洽**（含 v1 全部结论 + 本轮修正），由你决定是否合并回 v1 ✓。
>
> **基线**：DSH `0.2.0-rc.2`（当前运行，**尚未更新**）→ **目标**：`0.2.1-rc.1`
>
> **v2 复核方式（与 v1 的关键差别）**：v1 = 静态扫描本插件 + 读更新说明；
> **v2 = 下载官方产物做产物级对比**：
> ① `DeepSeek Harness.exe` 文件版本（确认运行版本）
> ② 官方更新源 `download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml`（确认目标版本与安装包指纹）
> ③ npm registry 逐包下载 `0.2.0-rc.2` vs `0.2.1-rc.1` 的**真实 tarball 并 diff**（`dsh-tools` / `dsh-app-boot` / `dsh-client-ui-conversation` / `dsh-client-ui-slots` / `dsh-client-ui-settings-plugins` / `dsh-web-frontend` / `dsh`）
> ④ 用本机 `semver@2.0.0` **实测**版本区间语义
>
> **一句话结论**：v1 的方向与"12 项全不命中"的判定**成立** ✓；但 P0 的**依据被低估**、P0 的**覆盖面漏了一半** ✗，另有 **3 项 v1 未提的真实缺陷**，且 §5.1 可从"中置信"升为"高置信可落地" ⬆️、§5.3 的**归因需要纠正** ✗。

---

## 一、复核结论（与 v1 的逐条差异）

| # | v1 结论 | v2 复核结果 | 差异 |
|---|---|---|---|
| 1 | 基线 `0.2.0-rc.2` → 目标 `0.2.1-rc.1` | ✅ **确认**：exe 文件版本 `0.2.0-rc.2`；官方 feed `version: 0.2.1-rc.1`，`releaseDate: 2026-10-17T04:50:22.117Z` | 无（**补全安装包指纹**，§三.0） |
| 2 | 12 项开发者变更全部不命中 | ✅ **独立复现**：本插件对 `invariant` / `'both'` / `toolPresentation` / `outbox·agentTeam` / `ctx.subagent` / `ptcRuntime·sandboxPolicy` / `dshHome` / `azure` 命中数均为 **0** | 无 |
| 3 | P0：缺 `engines.dsh` | ✅ **成立，且找到强制执行点**：`@deepseek-ai/dsh-app-boot@0.2.1-rc.1` 的 `lib/types/plugin-compatibility.js`（打进 `index.js`，L252 起）；**0.2.0-rc.2 同文件 `engines` 命中 0** ⇒ 这是 **0.2.1 新增行为** | v1 只有"更新说明这么说"，v2 有**代码级证据** |
| 4 | P0 建议值 `>=0.2.0-rc.2 <0.3.0-0` | ⚠️ **可用，但必须补一个前提**：该区间**只在 `includePrerelease: true` 下**才覆盖 `0.2.1-rc.1`（默认语义实测 ✗ 不满足）；官方实现**正是** `semver.satisfies(v, range, { includePrerelease: true })` | **补充前提 + 实测表**（§二.2） |
| 5 | P0 只需改 `plugin/package.json` | ❌ **漏了一半**：profile 用 `link:` 指 `plugin/`，但 **marketplace 安装的是仓库根包**（根 `package.json` 带 `dsh.bundle.patch` + `files`）⇒ **两个文件都要声明** | **覆盖面修正** |
| 6 | §5.1「文本与图片展示扩展位」：**中**（契约未验证） | ⬆️ **升级为高置信可落地**：0.2.1 的 `dsh-client-ui-conversation` **新增 4 个槽位 id、0 个移除**，且 `dsh-client-ui-slots` 里**有类型化契约** | **置信度升级 + 拿到真实 id**（§五.1） |
| 7 | §5.3「工具动态增删」：**弱**（疑在 pi-ai 路由层） | ❌ **归因不准**：`register()` 返回"精确卸载句柄"**0.2.0 就已有**（`dsh-tools` 0.2.0 `index.js:2876` / 0.2.1 `:2972`）⇒ **不是 0.2.1 新能力，现在就能做** | **归因纠正**（§五.3） |
| 8 | §5.4「密钥脱敏」未确认、不行动 | ✅ **确认与插件无关**：`dsh-tools` 0.2.1 `lib/index.js` 内 `redact` **0 命中** | 保持不行动（依据写实） |
| 9 | —（v1 未提） | 🆕 **根 `package.json` 的 `description` 在磁盘上是乱码**（`DSH 鍐呯疆娴忚鍣?..`） | **新增 P0-2** |
| 10 | —（v1 未提） | 🆕 **license 不一致**：根包 `Apache-2.0` / `plugin/package.json` 是 `MIT` | **新增 P1-1** |
| 11 | —（v1 未提） | 🆕 **`engines.dsh` 写错会 throw**（非字符串/非法区间 ⇒ 建载期直接报错），**比不写更糟**；另有**豁免机制**（`插件名@版本` → 精确运行时版本） | **新增风险提示** |
| 12 | —（v1 未提） | 🆕 **`output.presentationMeta` 是 0.2.1 新选项**（`dsh-tools` 0.2.1 `index.js:843`） | **新增机会（语义待确认）** |

---

## 二、P0 修订：`engines.dsh`（精确语义 + 双文件覆盖）

### 1. 官方实现的逐行语义（`dsh-app-boot@0.2.1-rc.1`）

```js
// lib/types/plugin-compatibility.js（打进 index.js，L252 起）
/** Evaluate plugin dsh requirements (`engines.dsh`, else dsh peers) without importing plugin code. */
function satisfies(runtimeVersion, range) {
  return range.trim() !== "" && semver.satisfies(runtimeVersion, range, { includePrerelease: true });
}
function unmetRequirements(fields, runtimeVersion) {
  const engines = Object.hasOwn(fields, "engines") ? objectOf$1(fields.engines, "Plugin manifest engines") : {};
  if (Object.hasOwn(engines, "dsh")) {
    const range = engines.dsh;
    if (typeof range !== "string") throw new Error("Plugin manifest engines.dsh must be a string");
    return satisfies(runtimeVersion, range) ? {} : { "engines.dsh": range };
  }
  if (!Object.hasOwn(fields, "peerDependencies")) return {};
  // 否则：每一个 @deepseek-ai/dsh 或 @deepseek-ai/dsh-* 的 peer 都必须匹配
}
```

**由此得到 5 条硬事实**：

| # | 事实 | 对我们的含义 |
|---|---|---|
| 1 | **有 `engines.dsh` ⇒ 它"独裁"，`peerDependencies` 完全被忽略** | 我们**没有** peerDependencies ⇒ 只需管好这一个字段 ✓ |
| 2 | **没有 `engines.dsh` ⇒ 检查所有 `@deepseek-ai/dsh`/`dsh-*` peer** | 我们无此类 peer ⇒ **当下不会因此被拒** ✓（v1「走原规则」正确） |
| 3 | **预发布参与区间**（`includePrerelease: true`） | `>=0.2.0-rc.2 <0.3.0-0` **能**覆盖 `0.2.1-rc.1` ✓ |
| 4 | **非法/空区间视为不满足**；非字符串 `engines.dsh` **直接 throw** | 写法必须一次到位，**拼错 = 建载期报错**（比不写更糟 ✗） |
| 5 | 有**豁免机制**：以 `插件名@版本` 映射到精确运行时版本 | 万一被错拒，有官方口子可走（正对应 v1 提到的"历史静默拒载" ✓） |

**0.2.0 vs 0.2.1 对照（证明这是新行为）**：`dsh-app-boot@0.2.0-rc.2` 全包 `engines` 命中 **0** ✗；`0.2.1-rc.1` 命中 **9** ✓。

### 2. 区间语义实测（本机 `semver@2.0.0`）

| 区间 | 默认语义下 `0.2.1-rc.1` | **includePrerelease 下（=官方语义）** |
|---|---|---|
| `>=0.2.0-rc.2 <0.3.0-0` | ✗ 不满足 | ✅ 满足（`0.2.1-alpha.5` ✓ / `0.3.0-rc.1` ✗） |
| `>=0.2.0-rc.2` | ✗ | ✅（**但没有上界** ⇒ 未来 0.3 也放行，不推荐） |
| `^0.2.0-rc.2` | ✗ | ✅（等效 `<0.3.0-0`，可读性更好） |

> **生态反证**：本机 `dsh-opencode-go` 声明 `>=0.1.5-rc.1`，在 `0.2.0-rc.2`（**预发布元组不同**）上**正常运行** ✓ ⇒ 反证 DSH 判定确实开了 `includePrerelease` ✓。
>
> ⚠️ **陷阱**：只按"默认 semver 直觉"写区间，会得到**看似合理但实际不匹配**的结果 ✗。**任何**未来判定实现改动（例如去掉 `includePrerelease`）都会让这类区间**静默失配** ⇒ 文档与代码里都要写明这一前提。

### 3. 建议改法（**两个文件**，值保持一致）

```jsonc
// ① F:\My Code\dsh-browser-kit\plugin\package.json   （profile 的 link: 指向它）
// ② F:\My Code\dsh-browser-kit\package.json          （marketplace 安装产物）
"engines": {
  "dsh": ">=0.2.0-rc.2 <0.3.0-0"
}
```

- 根包已有 `"engines": { "node": ">=22" }` ⇒ **合并**，不要覆盖 ✓
- **不要**用 `workspace:*` / `workspace:^`：对 `engines.dsh` 一律视为**未满足** ✗（官方注释明确）
- 下界取 `0.2.0-rc.2`（**本机已验证可用**的版本 ✓）；上界 `<0.3.0-0` 排除下一次 minor 的预发布 ✓

---

## 三、0.2.1 真实变更（产物级证据，非仅更新说明）

### 0. 版本与安装包指纹（v1 没有；建议每次更新前核对）

| 项 | 值 |
|---|---|
| 官方 feed | `https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml` |
| feed 版本 | `0.2.1-rc.1` |
| releaseDate | `2026-10-17T04:50:22.117Z` |
| 安装包 | `.../bin/win-x64/deepseek-harness-0.2.1-rc.1-win-x64.exe`，`size: 289382752` |
| sha512 | `Yt1SsYXgAQAcgvyE/aKBQ2JjGD9shaaB9HYLDdrySWi3e6A8XpUeSQaATRER1C5h8jZbHZRRAGWv/eDOXQg1yQ==` |
| 当前运行 | `D:\DeepSeek\DeepSeek Harness.exe` → 文件版本 `0.2.0-rc.2` |
| npm 侧 | `@deepseek-ai/dsh-tools` 的 `next` tag = `0.2.1-rc.1`（`latest` 仍是 `0.0.1-rc.1` ⇒ **别按 latest 判断** ✗） |

### 1. 逐项变更 × 是否命中我们

| # | 0.2.1 变更 | 产物证据（v2） | 我们 | 结论 |
|---|---|---|---|---|
| 1 | 移除 runtime `invariant` 插件与 `./invariant` 导出 | `dsh-tools` 0.2.1 **无** `lib/invariant.js`、无 `lib/types/invariant.*`（0.2.0 有 ✓） | 全库 `invariant` **0 命中** | ❌ 不命中 |
| 2 | 子路径插件不再读独立 `package.json` | — | 按**包名**注册（`dsh-browser-kit`），已导出 `./package.json`、`./locale/*.json` | ❌ 不命中 |
| 3 | 兼容性优先按 `engines.dsh` | ✅ **代码级**（§二.1） | **缺声明** | ⚠️ **命中 → P0-1** |
| 4 | 输入区统计拆 `activity` / `usage` | — | 我们 9 处 `stats` **全为自有**（`getStats` face 方法 + console-observer 的 `op=stats`） | ❌ 不命中 |
| 5 | 移除工具展示 `both` 混合模式 | — | `'both'` / `toolPresentation` **0 命中** | ❌ 不命中 |
| 6 | Agent Team 消息直投 Inbox | — | `outbox` / `agentTeam` **0 命中** | ❌ 不命中 |
| 7 | 统一子代理执行与完成通知 | — | `ctx.subagent` / `subagentProvider` **0 命中** | ❌ 不命中 |
| 8 | Python PTC 接入 Session 沙箱 | 🆕 0.2.1 新增 `dsh-tools/lib/types/ptc-calls.{js,d.ts}` | `ptcRuntime` / `sandboxPolicy` **0 命中** | ❌ 不命中 |
| 9 | 移除 agent-instructions 逐行 `dshHome` | — | `dshHome` **0 命中** | ❌ 不命中 |
| 10 | pi-ai → 1.0.2 | — | 无 `peerDependencies`，不碰 LLM 层 | ❌ 不命中 |
| 11 | Azure provider 改名 `azure` | — | `azure` **0 命中** | ❌ 不命中 |
| 12 | API Key 读取优先级变更 | — | 不读凭据（凭据只在 GUI 本地 `localStorage`，**不进 agent 上下文** ✓） | ❌ 不命中 |

### 2. 工具契约（**我们真正依赖**的部分）

| 检查 | 结果 |
|---|---|
| `defineTool` 仍导出？ | ✅ 两版都在（`dsh-tools/lib/types/index.d.ts` 仍导出 `defineTool` / `DefineToolOptions`） |
| `options.output.render` / `.schema` 仍被读？ | ✅ **仍无条件读取**（0.2.1 `lib/index.js:842` `options.output.render`、`:849` `valueSchemaSpecToJsonSchema(options.output.schema)`）⇒ **27 个工具必须继续提供 `output`**（契约未变 ✓） |
| 新增了什么？ | 🆕 `options.output.presentationMeta`（`index.js:843`） |
| `dsh-tools` 体积变化 | `index.js` 157,954 B → 162,201 B（+4.2 KB） |
| 工具卸载能力 | ✅ `register()` 返回卸载句柄，**两版都有**（0.2.0 `:2876` / 0.2.1 `:2972`） |

### 3. 客户端槽位（0.2.1 前端包 diff）

`dsh-client-ui-conversation`：候选 id `396 → 406`，**新增 10、移除 0** ✓

| 新增 id | 归属 | 意义 |
|---|---|---|
| `conversation.user.text` | **槽位工厂** | 用户消息**文本**展示扩展位 |
| `conversation.user.text.node` | **子槽（keyed / inline）** | 单条"业务文本节点"的渲染器 |
| `conversation.images.content` | **槽位工厂** | 图片内容展示扩展位（官方画廊） |
| `conversation.hero.options` | 槽位候选 | 新会话页选项 |
| `row.imageSize` / `row.imageSizeDownscaled` / `terminal.commandLine` / `text.collapse-whitespace` / `text.trim-whitespace` | 非槽位候选（内部键） | — |

- `dsh-client-ui-settings-plugins`：`plugins.tab` 两版都命中 10 ⇒ **稳定** ✓；该包 `SlotFactoryMap` 仅声明 `settings.plugins`
- `dsh-web-frontend`：内部槽位表**打不开**（id 是**动态拼接** ✗，`plugins.bundle.config` / `plugins.row.config` 字面量 0 命中）⇒ **我们依赖的 4 个 id 无法从产物确认**，必须更新后实测（§六.2）

---

## 四、需要处理的项（按优先级 · 等你决定何时执行）

### P0-1 两个 `package.json` 补 `engines.dsh`
- 位置：`plugin/package.json`（**必改**，profile `link:` 指向它）+ 根 `package.json`（**必改**，marketplace 安装产物）
- 值：`"dsh": ">=0.2.0-rc.2 <0.3.0-0"`（§二.3）
- **注意**：写错会 throw ✗ ⇒ 改完先验 JSON 合法；根包是 `engines` **合并**

### P0-2 根 `package.json` 的 `description` 乱码 ✗（v1 漏项）
- 现象：磁盘上是 `DSH 鍐呯疆娴忚鍣ㄥ寮烘彃浠讹紙...`（UTF-8 被按 GBK 解读后再落盘 ✗），结尾还有 `?`
- **不是控制台假象**：同一 read 工具下 `plugin/package.json` 的中文**完全正常** ✓ ⇒ 只有根文件坏了
- 影响：这是 **marketplace 列表文案**（对外门面）✗
- 建议：重写为正确中文（可复用 `plugin/package.json` 的 `meta.description` 口径）

### P1-1 license 不一致
- 根包 `Apache-2.0` + 仓库有 `LICENSE` ✓ / `plugin/package.json` 仍是 `MIT` ✗
- 建议：`plugin/package.json` 改为 `Apache-2.0`（与仓库许可一致）

### P1-2 更新后**必须实测**的 4 个自持槽位（产物无法确认 ✗）
`shell.overlay`（诊断面板）、`plugins.bundle.config`、`plugins.row.config`（两张插件卡片）、`sidebar.right.tab.menu.item`（菜单项）

---

## 五、0.2.1 新功能 → 插件优化机会（按收益排序）

### 1. ⭐ 批注 / 截图**直接渲染进对话流**（收益最大，置信度：高）
**0.2.1 给的真实契约**（`dsh-client-ui-slots` 的 `SlotFactoryMap`）：

```ts
// dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts
'conversation.user.text': {
  scope: 'session';
  props: UserTextInput;
  inject: UserTextInjected;          // 含 createUserTextEvaluator / reportTransformFailure
  children: { 'conversation.user.text.node': { kind: 'keyed'; scope: 'session'; inline: true } };
};
'conversation.images.content': {
  scope: 'root';
  props: MessageImagesContentInput;  // 官方可复用画廊（显式授权加载 + 可选 caller copy）
  locale: 'conversation';
};
```

**我们现状**：批注与截图只能**落盘**（`annotations/`、`shots/`），再由 agent 用 `browser_annotations` / `browser_screenshot` 读回 ⇒ 用户在对话里**看不到内容本身**。
**可做**：把批注 markdown / 截图**渲染进对话流** —— 消除当前最大的体验短板 ✓
**落地顺序建议**：先 `conversation.images.content`（结构简单、root 作用域、官方画廊 ✓）⇒ 再 `conversation.user.text`（session 作用域 + keyed 子槽，需按 `UserTextInput` 造节点 ✓）

### 2. 🆕 `output.presentationMeta`（0.2.1 新选项，v1 未提）
- 证据：`dsh-tools@0.2.1` `index.js:843`
- 机会：给工具结果附**展示元数据**（例如"这是截图 / 这是批注列表 + 计数"）⇒ 让渲染端少靠文本约定
- **状态：待确认**语义与允许值（需读 `DefineToolOptions.presentationMeta` 完整类型）⇒ 确认后再做

### 3. 动态挂/卸 27 个 `browser_*` 工具（**修正：0.2.0 已可用，不必等更新** ✓）
- 证据：`register()` 返回"the exact disposer that unregisters the tool"（0.2.0 `:2876` / 0.2.1 `:2972`）
- 机会：按任务阶段只挂当前需要的子集（如低频的 `browser_upload` / `browser_storage` 类），减少常驻 schema token ✓
- 风险：工具突然消失会让 agent 困惑 ✗ ⇒ 只在**明确阶段**切换，并让 `browser_annotations` / `browser_agent_window` 等核心工具**常驻** ✓

### 4. 图片处理 / 客户端渲染依赖的安全修复（零改造，被动收益 ✓）
我们处理多窗口截图、`base64` 注入（`browser_upload` 上限 4MB）、`read_image` 回传 ⇒ 更新即受益 ✓

### 5. 与插件无关（明确排除 ✗）
- 「密钥/令牌默认脱敏」：`dsh-tools` 0.2.1 **无 `redact`** ⇒ 不在我们链路 ✓
- 「极简模式」命名歧义：本评估**不依赖**该结论 ✓

---

## 六、更新后验证清单（v2 增强版 · 可复跑）

```powershell
# 0) 版本对照（更新前 = 0.2.0-rc.2；更新后应变为 0.2.1-rc.1）
(Get-Item 'D:\DeepSeek\DeepSeek Harness.exe').VersionInfo.FileVersion

# 0b) 目标版本与指纹（官方 feed；sha512 应与实际下载一致）
(Invoke-WebRequest 'https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml' -UseBasicParsing).Content

# 1) engines.dsh 生效验证（若已声明，DSH 应照常加载；若报兼容错误，先查区间语义 §二.2）
Get-Content "$env:DSH_PROFILE_DIR\package.json" | Select-String 'dsh-browser-kit'

# 2) 四个自持槽位（产物无法确认，必须实测）
#    - 诊断面板（shell.overlay）仍出现
#    - 两张插件卡片（plugins.bundle.config / plugins.row.config）仍出现
#    - 侧栏菜单项（sidebar.right.tab.menu.item）仍出现

# 3) 27 个 browser_* 工具仍在；新会话系统提示应含 [dsh-browser-kit] 一行摘要
# 4) defineTool 解析来源仍命中（宿主日志 / plugin/.data 内的 DEFINE_TOOL_PROBE）
# 5) 冒烟：browser_open → browser_snapshot → browser_screenshot
# 6) 批注链路：右键加批注 → 自动进入 agent 上下文 → browser_annotations 读全文
```

**通过判据**：每步有可复跑证据。**任一失败先查两件事**：① `engines.dsh` 区间（§二.2 的语义陷阱 ✓）；② `defineTool` 是否仍从 `resourcesPath/app.asar` 解析到 ✓。

---

## 附：证据来源与置信度（v2）

| 结论 | 证据 | 置信度 |
|---|---|---|
| 运行 `0.2.0-rc.2` / 目标 `0.2.1-rc.1`（+指纹） | exe 文件版本 + 官方 feed | **强** |
| 12 项变更全不命中 | 全库扫描 0 命中 + 产物 diff | **强** |
| `engines.dsh` 为新行为且**有强制点** | `dsh-app-boot` 0.2.0（0 命中）vs 0.2.1（L252+） | **强** |
| 区间须按 `includePrerelease` 理解 + 实测表 | 官方 `satisfies()` 源码 + 本机 semver 实测 + 生态反证 | **强** |
| 两个 `package.json` 都需声明 | profile `link:...plugin` + 根包 `files`/`dsh.bundle.patch` | **强** |
| 根 `package.json` description 损坏 | read 工具直读（同工具下 plugin 文件正常） | **强** |
| 展示扩展位可承载批注/截图 | 真实槽位 id + 类型化 `SlotFactoryMap` | **中高**（契约在 ✓，**未在 GUI 实测挂载** ✗） |
| `presentationMeta` 可用于我们的工具结果 | 仅见 `index.js:843` 读取点 | **弱**（**语义未确认** ✗） |
| 动态挂/卸工具可用 | 两版 `register()` 返回卸载句柄 | **强** |
| 4 个自持槽位 id 在 0.2.1 仍有效 | **无法从产物确认**（id 动态拼接） | **未知 → 必须实测** |
| 密钥脱敏是否覆盖工具输出 | `dsh-tools` 0 命中 `redact` | **与本插件无关** |

### 需要澄清的命名歧义（沿用 v1）

0.2.1 发布说明里"**极简模式**支持读取图片和自动压缩长对话"中的"极简模式"，与 npm 上的 `@deepseek-ai/dsh-sdk-minimal`（**独立 SDK profile**）很可能是同一件事，但应用内也存在一个叫「极简」的工作视图模式。**二者关系未确认**，本评估不依赖该结论。

### 本文档的改动声明

- 本文档**只做排查与评估**，v1 的结论已由 v2 复核并修正 ✓（见下"v2.1 更新"）。
- 复核产生的临时产物在 `%TEMP%\dsh-compat\`（各版本 tarball 与解包），可随时删除。

---

# v2.1 更新（兼容加固**已实施** + 一处自我更正）

> 时间：2026-10-17 ｜ 范围：**只做"更新 DSH 后能正常跑"相关的改动** ✓（description / license / 展示扩展位 / 动态工具 / `presentationMeta` 一律留到后续优化轮次 ✗）

## 一、自我更正：§一 第 9 条（"根 package.json description 乱码"）**不成立** ✗

- **撤回**。用 **read 工具**直读根 `package.json`：description 是**正常中文** ✓；且 `git status` / `git diff` 证明该文件与 HEAD **完全一致** ✓（blob 未变）⇒ 磁盘上从未损坏 ✓。
- **误报原因**：那一处我**只用 PowerShell（`Get-Content`）看过** ✗，PowerShell 控制台对含中文的 JSON 会输出乱码假象（同一假象在 `plugin/package.json` 上也出现过，而 read 工具下正常 ✓）。
- **教训（已写入 pitfalls P109）**：判断"文件损坏"必须用 **read 工具** 或 **git blob 对照**；**PowerShell 控制台输出不能作为编码损坏的证据** ✗。

## 二、本轮已实施的兼容加固（均有实机验证 ✓）

| # | 改动 | 位置 | 目的 |
|---|---|---|---|
| C1 | **两个 manifest 都加** `"engines": { "dsh": ">=0.2.0-rc.2 <0.3.0-0", "node": ">=22" }` | 根 `package.json` + `plugin/package.json` | 0.2.1 起由 `dsh-app-boot` 按 `engines.dsh` 判定（有它则**忽略 peerDependencies** ✓）；区间按 `includePrerelease` 语义写 ✓ |
| C2 | `defineTool` 解析候选 **4 → 18**（含**无 `dsh/` 前缀**形状）+ `app.asar.unpacked` **有界扫描**兜底 | `plugin/browser-tools.host.mjs` | asar 内部布局不是契约；布局一变旧写法会**静默失联 ⇒ 27 个工具全消失** ✗ |
| C3 | 4 处槽位注册全部改走 **`safeInject`**（失败只降级该槽位并记账，不让 client 插件加载失败 ✗） | `plugin/client.js` | 4 个槽位 id 在 0.2.1 前端里是**动态拼接**的、无法预先确认 ⇒ 必须容错 ✓ |
| C4 | 兼容自检诊断：客户端 `kit-status.compat.slots` + 宿主 `probe-report.json.compat`（**运行时 DSH 版本** / 声明的 `engines.dsh` / `defineTool` 来源与已注册数） | `client.js` + `host.impl.mjs` | 更新后**一眼确认**是否正常 ✓ |

### 实机验证（0.2.0-rc.2 上、插件热更新后 ✓）

```
client kit-status.compat.slots → shell.overlay ✓ / plugins.bundle.config ✓ / plugins.row.config ✓ /
                                 sidebar.right.tab.menu.item ✓        （okCount 4, failCount 0）
host  probe-report.json.compat → dshRuntimeVersion: "0.2.0-rc.2"
                                 dshRuntimeFrom: ...\app.asar\dsh\node_modules\@deepseek-ai\dsh-app-boot\package.json
                                 declaredEnginesDsh: ">=0.2.0-rc.2 <0.3.0-0"
                                 candidateCount: 18
host  tools.registered: 27, errors: []        ← defineTool 仍解析成功 ✓
```
> `dshRuntimeFrom` 命中 `dsh-app-boot/package.json`，正是**官方判定所用的运行时版本来源** ✓（plugin-compatibility.js 的 `getDshRuntimeVersion()` ✓）。
> 测试：`node --test` → **240 项 / 239 过 / 1 跳过**（环境用例需真机 Chrome+CDP），新增 5 项兼容钉子 `test/dsh-021-compat.test.mjs` ✓。

## 三、更新 DSH 之后的**最短验证路径**（比 §六 更快）

```powershell
# 1) 客户端：4 个槽位是否都还在（failCount 应为 0；某个 false ⇒ 该 id 在新版不存在/改名 ✗）
node plugin\.data\probe-compat.cjs

# 2) 宿主：运行时版本 + 声明的 engines.dsh + defineTool 来源 + 工具数
node -e "const r=require('./plugin/.data/probe-report.json');console.log(r.compat,r.tools&&r.tools.registered&&r.tools.registered.length,r.tools&&r.tools.errors)"

# 3) 若工具没全注册：看 compat.candidateCount 与 tools.attempts（逐条解析失败原因 ✓）
```

## 四、更新后**仍必须实机确认**的三件事

- 4 个自持槽位 id 在 0.2.1 是否仍有效（产物里查不到 ✗）⇒ `kit-status.compat.slots`
- `engines.dsh` 是否被官方接受（语义见 §二；若被拒可走官方**豁免机制** `插件名@版本` ✓）
- 27 个 `browser_*` 工具是否仍全部注册（`probe-report.json.tools.registered` ✓）

---

# 五、更新后实测记录（**0.2.1-rc.2** · 2026-10-17）

> 实际更新到的是 **`0.2.1-rc.2`**（比本评估原定目标 rc.1 新一档 ✓）：feed `releaseDate 2026-10-17T09:22:23.750Z`，
> 安装包 `deepseek-harness-0.2.1-rc.2-win-x64.exe`（`289,385,456` B）。

## 1. 一句话结论：**通过** ✓（兼容加固全部生效）

| 检查 | 结果 |
|---|---|
| 插件是否仍被装载（`engines.dsh` 若判定失败会被移除 ✗） | 🟢 仍在 profile `bundles`（`@local/dsh-browser-kit` ✓） |
| **4 个自持槽位** | 🟢 **4/4 ok**（`shell.overlay` / `plugins.bundle.config` / `plugins.row.config` / `sidebar.right.tab.menu.item`） |
| **27 个 `browser_*` 工具** | 🟢 全部注册（`registered: 27`，`errors: []`） |
| `defineTool` 解析 | 🟢 `resourcesPath/app.asar \| import`（候选 18 ✓，`defineToolResolved: true` ✓） |
| 运行时版本自检 | 🟢 `0.2.1-rc.2`，来源 `…\app.asar\dsh\node_modules\@deepseek-ai\dsh-app-boot\package.json` ✓ |
| 功能冒烟 | 🟢 命令通道 `kit-status` ✓ / `browser_tabs` ✓ / `browser_agent_window(status)` ✓ / `browser_annotations(latest)` ✓ |

完整自检快照（更新后的第一手证据 ✓）：

```json
{
  "dshRuntimeVersion": "0.2.1-rc.2",
  "dshRuntimeFrom": "D:\\DeepSeek\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-app-boot\\package.json",
  "declaredEnginesDsh": ">=0.2.0-rc.2 <0.3.0-0",
  "defineToolSource": "resourcesPath/app.asar|import",
  "defineToolResolved": true,
  "defineToolRegistered": 27,
  "candidateCount": 18
}
```

## 2. rc.1 → rc.2 增量核对（结论：**对我们的兼容结论无影响** ✓）

| 包 | 核对项 | 结果 |
|---|---|---|
| `dsh-app-boot` | `engines.dsh` 判定实现 | 🟢 **逐行相同**（`index.js` 均 203,572 B；`satisfies()` 仍 `{ includePrerelease: true }`，L277/281/283 一致 ✓） |
| `dsh-tools` | `lib/index.js` | 🟢 **字节相同**（SHA256 前缀 `1E53932E7C4213EA` 一致 ⇒ 工具契约未变 ✓） |
| `dsh-client-ui-conversation` | 候选 id 集合 | 🟢 `406 → 406`，**无新增无移除** ✓ |
| 展示扩展位 | `conversation.user.text` / `.node` / `conversation.images.content` / `hero.options` | 🟢 均在（§五 的优化机会依旧成立 ✓） |

## 3. 更新过程中修掉的一个真问题

- **compat 采样时机**：工具注册是异步的（`registerBrowserTools().then(...)`），首次采样发生在它之前
  ⇒ `compat.defineToolSource` / `defineToolResolved` 一直是 `null` ✗（而 `tools` 里其实有值 ✓）。
- 修法：注册成功后 `refreshCompat()` 再写一次报告 ✓（提交 `13ce35a`，并有测试钉死 ✓）。
  ⇒ "更新后跑一条命令确认版本/区间/工具链路"这个设计此时才真正成立 ✓。
