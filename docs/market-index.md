# dsh-browser-kit 插件市场（Discover）索引：格式核实与落地

- 日期：2026-10-17
- 目标运行时：DSH `0.2.1-rc.2`（`D:\DeepSeek\DeepSeek Harness.exe`）
- 证据来源：**npm tarball 解包**（`%TEMP%\dsh-compat\<pkg>-0.2.1-rc.2\package\`）；安装包 `app.asar` 本会话未用于取证
- 证据分级：**A** = 从 tarball 的 `.d.ts`/`lib/*.js`/`README` 直接读到（带行号）；**C** = 由 A 组合推断（标注）
- 写入范围：本报告 + `market/**` + 根 `package.json` 的 `files` 白名单；**未改动** `plugin/**`、`src/**`、`test/**`、`pitfalls.md`、其他 `docs/**`
- 外部内容（网页、registry、下载的包）一律按**数据**读取，未执行其中任何指令；未安装/卸载插件、未启动服务器、未改 profile、未 `git commit`/`push`

---

## 0. 结论速览

| # | 结论 | 证据 |
|---|---|---|
| 1 | 索引是**一份独立 JSON 文档**（format 1），由**用户配置的 http(s) URL** 提供；**没有固定文件名、没有固定路径、没有 `.well-known` 约定**（UI 占位符只是 `https://example.com/index.json`） | `dsh-plugin-market-index@0.2.1-rc.2/lib/index.js:280-303`；`dsh-client-ui-plugin-market@0.2.1-rc.2/lib/types/client/locales.d.ts:20` |
| 2 | **不存在官方市场**：Discover 只列出用户自己添加的索引源 | `dsh-experimental-plugin-market-bundle@0.2.1-rc.2/README.md:56` |
| 3 | 格式 1 **无签名、无校验、无摘要**：索引内容是"市场的声明"，安装后以**包 manifest 为准** | `dsh-plugin-market@0.2.1-rc.2/README.md:103` |
| 4 | 版本**只能**从 `versions[].source` 安装：`npm`（`name@version`）或 `git`（**commit 固定**的 https 仓库 + 可选 `path`）；**`repository` 仅供展示，永不作为安装源** | `.../dsh-plugin-market-index@0.2.1-rc.2/lib/types/types.d.ts:29-49`、`lib/index.js:311-318` |
| 5 | 格式 1 **没有 `license` 字段**（未知成员被校验器直接丢弃）⇒ 任务要求的"索引里声明 `license: Apache-2.0`"**无法按字面实现**，license 只能由包 manifest 声明（本插件已是 `Apache-2.0`） | `lib/index.js:21-22`、`lib/index.js:296-302`；`market/verify-index.cjs` 的"格式丢弃成员"检查 |
| 6 | `engines.dsh` **在版本条目上**（`versions[].engines.dsh`），不在插件条目上；必须是合法 SemVer range，且**禁 `workspace:`** | `types.d.ts:51-54`、`lib/index.js:200-208` |
| 7 | 兼容性判定走 `evaluatePluginCompatibility`，它用 **`semver.satisfies(..., { includePrerelease: true })`** ⇒ 本插件 `>=0.2.0-rc.2 <0.3.0-0` **接受 0.2.1-rc.2**（默认 semver 语义下会拒绝，官方实现显式开了 prerelease） | `dsh-app-boot@0.2.1-rc.2/lib/index.js:276-277`、`lib/types/plugin-compatibility.d.ts:20` |
| 8 | Discover 的 Host 侧用进程 `fetch` 且 **`redirect: "error"`**（拒绝重定向）、`accept: application/json`、**不检查响应 `Content-Type`**、正文按**严格 UTF-8** 解析为 JSON | `dsh-plugin-market@0.2.1-rc.2/lib/index.js:558-562`、`lib/types/parse.js:9-35` |
| 9 | Host 侧市场服务随附 profile **默认不挂载**（需用户开启实验性 bundle）；本机 desktop profile 已实测**无 `plugin-market` 行** | `dsh-experimental-plugin-market-bundle@0.2.1-rc.2/README.md:12/27`、`cordis.patch.yml:5-10`；本机 `%USERPROFILE%\.dsh\profiles\desktop` 搜索无命中 |
| 10 | 本插件的索引已产出并通过**官方校验器**校验：`market/index.json` 用 **git 源**，commit 由生成器从**远端 `origin refs/heads/main` 自取**（当前 `6a928f5…`）⇒ 安装目标 `git+https://github.com/Shuffle-1992/dsh-browser-kit.git#6a928f5…`；**npm 源已弃用**（包未发布） | §4 验证输出（校验器 sha256 `14bccdf3…b72a1`） |
| 11 | 校验器新增**git 溯源硬断言**：commit 必须 ① 40-hex ② 本地存在 ③ **远端可达**；违反即 FAIL(exit 1)，专防"索引指向未推送提交 ⇒ 用户侧 404"。三个坏样本实测全部 FAIL | §4.3（含 unpushed 本地 HEAD / 畸形 SHA / 不存在的 SHA） |

### 交付物

| 文件 | 说明 |
|---|---|
| `market/index.json` | 索引本体（format 1，1 个插件、1 个版本，git 源） |
| `market/build-index.cjs` | 生成器：包事实取自根 `package.json`，显示文案内联；**默认 git 源**，commit 优先 `git ls-remote origin refs/heads/main`、回退本地 HEAD（并打印取值来源）；`--source npm` 保留给发布后使用 |
| `market/verify-index.cjs` | 可复跑校验器：结构检查 + **git 溯源硬断言** + 官方 `parseMarketIndex`/`marketInstallTarget`；支持 `--index <file>`（用于坏样本回归）/`--require-official`/`--no-git-checks` |
| `market/README.md` | 目录说明与使用步骤 |
| 根 `package.json` | `files` 白名单新增 `"market/"`（索引随 npm 包发布） |
| `docs/market-index.md` | 本报告 |

---

## 1. 官方市场索引的真实格式（**不猜**）

### 1.1 索引是什么、放在哪

格式 1 就是**一个 JSON 文件**，内容为"可安装 DSH bundle 的清单 + 展示元数据"：

> "Validator without runtime dependencies for format 1 of the plugin market index, **the single JSON file** that lists installable DSH bundles with their display metadata."
> —— `dsh-plugin-market-index@0.2.1-rc.2/README.md:12`（A）

它**不属于任何固定路径**，而是用户在设置/Discover 里填的 URL：

> "`indexes` | `[]` | Index URLs in display order. A usable URL is in canonical form and uses `http:` or `https:`, without credentials or fragment."
> —— `dsh-plugin-market@0.2.1-rc.2/README.md:31`（A，配置表）

URL 的规范化只有四条规则（协议、无凭据、无 fragment、可解析）：

```js
// dsh-plugin-market@0.2.1-rc.2/lib/types/index-url.js:19-25
if (url.protocol !== 'https:' && url.protocol !== 'http:') throw ... 'scheme'
if (url.username !== '' || url.password !== '' || url.href.includes('#')) throw ... 'credentials-or-fragment'
```

**没有固定文件名**：客户端文案里的输入框占位符只是示例 —— `"sourcePlaceholder": "https://example.com/index.json"`（`dsh-client-ui-plugin-market@0.2.1-rc.2/lib/types/client/locales.d.ts:20`，A）。
**未发现**任何 `.well-known` / `market.json` / 固定目录约定（在 4 个市场相关包的 README 与 `lib/**` 中检索 `well-known|market\.json|index\.json|unpkg|jsdelivr`，唯一命中就是上面的占位符）。

⇒ 我们选 `market/index.json` 作为**自定路径**（可读、随包发布、可被 CDN 直出）。

### 1.2 顶层字段（`MarketIndex`）

| 字段 | 必填 | 类型/规则 | 证据 |
|---|---|---|---|
| `format` | **必填** | 必须 `=== 1` | `lib/index.js:284`（`if (object.format !== 1) fail(...)`） |
| `title` | **必填** | `LocalizedText`；**对象形式必须含 `en`** | `types.d.ts:84`；`lib/index.js:294`、`:51-61`（`:59` 含 en） |
| `description` | 可选 | `LocalizedText` | `types.d.ts:85`；`lib/index.js:295` |
| `metadata` | 可选 | `{categories, labels, sortKeys}`，缺省填空记录 | `types.d.ts:16-20/86`；`lib/index.js:89-96` |
| `plugins` | **必填** | 数组（可为空数组）；插件 `name` 在索引内唯一 | `lib/index.js:286`、`:288-293` |
| 其他成员 | — | **被静默丢弃**（"Members the format does not define are ignored and dropped."） | `lib/index.js:21-22`、`:296-302` |

`LocalizedText` 的两种写法与硬规则：

```js
// dsh-plugin-market-index@0.2.1-rc.2/lib/index.js:51-61
function localizedText(value, path) {
  if (typeof value === 'string') return stringAt(value, path);   // 允许纯字符串
  const object = objectAt(value, path);
  for ([language, member] of Object.entries(object)) {           // 键必须是语言 id
    if (!LANGUAGE_ID.test(language)) fail(...)                    // :23 ^[a-z]{2,8}(-[a-z0-9]{1,8})*$
    ...
  }
  if (!Object.hasOwn(text, 'en')) fail(path, 'must contain en');  // :59 必须含 en
}
```

### 1.3 插件条目（`MarketPlugin`）

| 字段 | 必填 | 规则 | 证据 |
|---|---|---|---|
| `name` | **必填** | npm 包名；正则 `^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$`，长度 ≤ 214 | `lib/index.js:24-25`、`:252-253` |
| `title` / `description` | 可选 | `LocalizedText` | `types.d.ts:68-69`；`lib/index.js:254-255` |
| `icon` | 可选 | 内联 `data:`（仅 SVG/PNG/JPEG/WebP，base64，解码 ≤ **32 KiB**）**或** http(s)/相对 URL（相对引用按**索引 URL** 解析；非 `https:` 时必须与索引**同源**） | `lib/index.js:209-225`（`:32` 正则、`:35` 上限、`:223` 同源规则） |
| `author` | 可选 | 非空字符串 | `types.d.ts:72`；`lib/index.js:257` |
| `homepage` | 可选 | 绝对 http(s) URL（**允许** query/fragment，兼容 npm 的 `#readme`） | `lib/index.js:147-154` |
| `repository` | 可选 | `{url, directory?}`；url 为**绝对 http(s)**、**无凭据/query/fragment**；`directory` 为仓库内相对目录（POSIX，段仅 `[A-Za-z0-9._@+-]`，禁 `.`/`..`）。**"display only, never an install source"** | `types.d.ts:29-35`；`lib/index.js:167-175`、`:134-146`、`:162-166` |
| `metadata` | 可选 | `{category?, keywords[], labels[], sortKeys{}}`，缺省补空 | `types.d.ts:22-28`；`lib/index.js:102-133` |
| `metadata.category` | 可选 | **必须**在索引 `metadata.categories` 中声明，否则报错 `references undeclared id` | `lib/index.js:97-101`、`:104` |
| `metadata.labels[]` | 可选 | 每个 id 必须已声明，且**不得重复** | `lib/index.js:112-117` |
| `metadata.sortKeys{}` | 可选 | 键必须在 `metadata.sortKeys` 中声明，值必须是**有限数** | `lib/index.js:118-126` |
| `versions` | **必填** | **非空**数组；版本号在插件内唯一；返回值按 SemVer **降序**排序 | `types.d.ts:78-79`；`lib/index.js:239-249` |

> 索引级 `metadata` 的声明形状：`categories`/`labels` 的每项是 `{title: LocalizedText}`；`sortKeys` 的每项是 `{title, order: 'asc'|'desc'}`（`types.d.ts:7-19`；`lib/index.js:79-88`）。
> 约束：**用了未声明的 category/label/sortKey id ⇒ 索引校验直接失败**（`lib/index.js:99`）。

### 1.4 版本条目与"指向仓库/版本"的方式（`MarketVersion`）

| 字段 | 必填 | 规则 | 证据 |
|---|---|---|---|
| `version` | **必填** | **精确 SemVer**（正则含 prerelease/build） | `lib/index.js:26-29`、`:228-229` |
| `publishTimestamp` | **必填** | **整数** Unix 秒，区间 `[0, 10^11)` | `lib/index.js:230-231`（`:36` `MAX_PUBLISH_TIMESTAMP = 1e11`） |
| `source` | **必填** | 见下 | `types.d.ts:37-49`；`lib/index.js:176-199` |
| `engines` | 可选 | `{dsh?: string}`；range 必须过 `semver.validRange`，**禁 `workspace:`** | `types.d.ts:51-54`；`lib/index.js:200-208` |

安装源只有两种（`lib/index.js:176-199`）：

| `source.type` | 字段与硬规则 | 生成 pnpm spec |
|---|---|---|
| `npm` | `registry?`：绝对 http(s)、无凭据/query/fragment；**省略 = 用户配置的 registry** | `name@version`（+ `registry`） |
| `git` | `url`：**https、必须是 canonical（`url.href === 原串`）、≥2 段路径、不得是 tarball**；`commit`：**小写 40 位 hex**；`path?`：仓库内相对目录 | `git+<url>.git#<commit>&path:/<path>` |

```js
// dsh-plugin-market-index@0.2.1-rc.2/lib/index.js:311-318
function marketInstallTarget(name, version) {
  if (from.type === 'npm') return { spec: `${name}@${version.version}`, ...(registry && {registry}) };
  return { spec: `git+${from.url.endsWith('.git') ? from.url : `${from.url}.git`}#${from.commit}${path===undefined?'':`&path:/${path}`}` };
}
```

**关键纠偏**：`repository` 与 `homepage` 只是展示；**"条目如何指向仓库与版本"的答案是 `versions[].source`**。
GitHub 仓库当然支持，但只作为 `git` 源的 `url`（须 commit 固定）—— `gitUrl()` 只要求"https + canonical + ≥2 段路径"（`lib/index.js:155-161`），并不识别 GitHub 特殊性。

### 1.5 签名 / 校验 / 审核

- **无签名、无摘要、无审核**：`dsh-plugin-market@0.2.1-rc.2/README.md:103`："**Unsigned indexes** — index content, including a Git entry's name and version, is the market's claim; the installed manifest decides what is installed."
- 校验器自己也声明**不校验生成方义务**：`dsh-plugin-market-index@0.2.1-rc.2/README.md:63`："the validator cannot verify that `name`, `version`, `publishTimestamp`, `engines.dsh`, or display fields match the package they describe, or that the package declares a bundle."
- 格式里**没有**任何签名字段（`types.d.ts:82-89` 的 `MarketIndex` 全量成员即 §1.2 所列）。
- 可用的约束只有 URL 白名单式限制：`search/entry` 只接受**已配置**的 URL，绝不抓任意地址（`dsh-plugin-market/README.md:42`）。
- ⇒ **索引自身无法证明任何事，也无法被官方审核**；防 404 只能靠**生成侧**（`market/build-index.cjs` 只钉远端 ref）与**校验侧**（§4.3 的三条 git 溯源断言）。

### 1.6 客户端 Discover 如何拉取

1. **启用**：`Plugins` → `Experimental plugins` 旁 `More` → 打开 **Custom plugin markets**；打开后 Plugins 页出现 **Installed / Discover** 两个 tab（`dsh-experimental-plugin-market-bundle@0.2.1-rc.2/README.md:27`，A）。bundle 的 patch 只是插入两行：`plugin-market`（Host 服务）与 `ui-plugin-market`（浏览器行）（`cordis.patch.yml:5-10`，A）。
2. **加源**：Discover 空态 → **Add index source** 对话框；对话框提示"索引来自第三方"（`dsh-client-ui-plugin-market@0.2.1-rc.2/README.md:27`，A）。Discover 通过 `plugins.tab` 槽位注册 `discover` 入口（同文件 `:44`，A）。
3. **拉取**：Discover 调 Host `pluginMarket.search(url, query)`；Host 用**进程 `fetch`**、**`redirect: "error"`（拒重定向）**、`accept: application/json`，正文按 `maxBytes`（默认 128 MiB）读满后在 **Worker Thread** 内严格 UTF-8 解码 → JSON 解析 → `parseMarketIndex` 校验（`dsh-plugin-market/README.md:69/105`；`lib/index.js:558-562`、`:580-607`；`lib/types/parse.js:9-35`）。
4. **安装**：每条返回的版本带 `target` + `registry`，交给 `plugin_manager.install_bundle`（安装自带审批）（`dsh-plugin-market/README.md:62`，A）。
5. **判定**：兼容性用 `evaluatePluginCompatibility` 按该版本的 `engines.dsh` 计算；"默认版本" = 最高的**兼容且无 prerelease 标签**的版本（`dsh-plugin-market/README.md:75`）。缓存 TTL 默认 10 分钟，`refresh` 可绕过（同文件 `:34`/`:71`）。

---

## 2. 我们的索引内容（`market/index.json`）

由 `node market/build-index.cjs` 生成（包事实来自根 `package.json`：`name`、`version`、`keywords`、`homepage`/`repository`、`engines.dsh`）。当前全文（`source` 与 `publishTimestamp` 两处随生成时的远端 main 变化）：

```json
{
  "format": 1,
  "title": { "zh": "dsh-browser-kit 插件索引", "en": "dsh-browser-kit plugin index" },
  "description": {
    "zh": "本索引发布 dsh-browser-kit：给 DSH Web GUI 增加页面级浏览器操作、元素批注与截图回传能力。",
    "en": "This index publishes dsh-browser-kit: page-level browser control, element annotation, and screenshot delivery for the DSH Web GUI."
  },
  "metadata": {
    "categories": { "browser": { "title": { "zh": "浏览器", "en": "Browser" } } },
    "labels": {
      "annotation":          { "title": { "zh": "元素批注",     "en": "Annotations" } },
      "screenshot":          { "title": { "zh": "截图回传",     "en": "Screenshots" } },
      "device-emulation":    { "title": { "zh": "设备尺寸模拟", "en": "Device emulation" } },
      "credentials-local":   { "title": { "zh": "凭据仅本机",   "en": "Local-only credentials" } },
      "automation":          { "title": { "zh": "浏览器自动化", "en": "Browser automation" } }
    }
  },
  "plugins": [
    {
      "name": "dsh-browser-kit",
      "title": { "zh": "DSH 浏览器增强套件", "en": "DSH Browser Kit" },
      "description": {
        "zh": "元素批注（右键选元素、批注随消息交付给 Agent）、截图回传、设备尺寸模拟、凭据管理（仅本机、不进 Agent 上下文）、共享登录态窗口与 Agent 浏览器自动化。",
        "en": "Element annotation (right-click an element; the annotation reaches the agent with the message), screenshot delivery, device-size emulation, local-only credential management (never enters agent context), shared-login windows, and agent browser automation."
      },
      "author": "Keysion Dev",
      "homepage": "https://github.com/Shuffle-1992/dsh-browser-kit",
      "repository": { "url": "https://github.com/Shuffle-1992/dsh-browser-kit" },
      "metadata": {
        "category": "browser",
        "keywords": ["dsh-plugin", "deepseek-harness", "cordis", "deepseek", "harness", "browser", "annotation", "playwright-alternative", "plugin"],
        "labels": ["annotation", "screenshot", "device-emulation", "credentials-local", "automation"]
      },
      "versions": [
        {
          "version": "0.2.0",
          "publishTimestamp": 1792232941,
          "source": {
            "type": "git",
            "url": "https://github.com/Shuffle-1992/dsh-browser-kit.git",
            "commit": "6a928f521eb379c35e72ab8b0e80f68d4de41140"
          },
          "engines": { "dsh": ">=0.2.0-rc.2 <0.3.0-0" }
        }
      ]
    }
  ]
}
```

字段来源与取舍（逐条对应 §1 的规则）：

| 值 | 来源/理由 |
|---|---|
| `author: "Keysion Dev"` | 仓库提交者 `git config user.name`（包 manifest 无 `author` 字段）；`author` 为可选自由字符串（`types.d.ts:72`） |
| `repository.url` | 根 `package.json.repository.url` 去掉 `git+` 与 `.git`；**仅供展示**，不作安装源（`types.d.ts:29`） |
| `versions[0].engines.dsh` | **与仓库一致**：根 `package.json.engines.dsh` = `>=0.2.0-rc.2 <0.3.0-0`（校验脚本断言两者相等） |
| `source: {type:"git", …}` | **主源**（npm 未发布 ⇒ 弃 npm 源）：`url` = canonical `…/dsh-browser-kit.git`，`commit` 由生成器 `git ls-remote origin refs/heads/main` **自取远端顶端**（不是手写、也不是本地未推送的 HEAD）⇒ 安装 spec `git+…git#6a928f5…` |
| `publishTimestamp: 1792232941` | git 源下取**所钉 commit 的提交时间**（2026-10-17T18:29:01+08:00）；npm 源下优先取 registry 发布时间 |
| 无 `license` | 格式 1 无该成员，写了也会被丢弃（§0 第 5 条） ⇒ license 由 `package.json`（`Apache-2.0`）声明 |
| 无 `icon` | 可选字段；本仓库无可直接引用的图标资产，且 `market/**` 外文件不在我的写入范围。**留空不影响 Discover 卡片**（缺省回落到官方默认图） |

**为什么钉远端而不是本地 HEAD**：索引的消费方是**其他用户的 pnpm**，只有**已推送**的提交才拉得到。本仓库的实际情况正好是反例：本地 HEAD（`f3e2ea5…`）领先且**未推送**，而远端默认分支是 **`main`**（`6a928f5…`；`master` 停在旧的 `2b5a74f…`）⇒ 生成器**默认取 `main`**，并在输出里打印取值来源：

```
source: {"type":"git","url":"https://github.com/Shuffle-1992/dsh-browser-kit.git","commit":"6a928f521eb379c35e72ab8b0e80f68d4de41140"}
commit from: remote origin refs/heads/main
publishTimestamp: 1792232941 (from git commit 6a928f521eb3 time)
note: local HEAD f3e2ea5150bdb47f39034ac7fe9954d89427e42a differs from the pinned commit (the index pins the pushed commit on purpose)
```

钉住的 `6a928f5…` 的 manifest 已核对与索引一致：`name=dsh-browser-kit`、`version=0.2.0`、`license=Apache-2.0`、`engines.dsh=>=0.2.0-rc.2 <0.3.0-0`、并声明 `dsh.bundle.patch=plugin/cordis.patch.yml`（`git show 6a928f5…:package.json`）。

### 2.1 等 npm 发布后如何切换（**只是片段，不写进 `market/index.json`**）

主源已决定为 git（`dsh-browser-kit` 未发 npm，死条目必须避免）。若将来发布了 npm 包，把 `source` 换成 npm 源即可 —— 生成器已支持：

```bash
# 1) 发布后重新生成（publishTimestamp 会自动从 registry 取真实发布时间）
node market/build-index.cjs --source npm
#    ⇒ "source": { "type": "npm" }               # 省略 registry = 用用户自己配置的 registry
#    ⇒ "publishTimestamp": <registry 的发布时间>

# 2) 指定 registry 时（写入索引，安装时先问它）
node market/build-index.cjs --source npm --registry https://registry.npmjs.org
#    ⇒ "source": { "type": "npm", "registry": "https://registry.npmjs.org" }
#    ⇒ 官方 marketInstallTarget: { spec: "dsh-browser-kit@0.2.0", registry: "https://registry.npmjs.org" }

# 3) 两种源都要时的建议：一次只留一种（同一 version 不能重复），用 git 源钉住 tag 对应的 commit 也可以
node market/build-index.cjs --commit 6a928f521eb379c35e72ab8b0e80f68d4de41140   # 显式钉住
```

切换前务必确认 `https://registry.npmjs.org/dsh-browser-kit` 返回 200（当前 **404**，实测），否则又变回死条目。

---

## 3. 如何被 Discover 拉取（发行与托管）

### 3.1 结论：官方**不要求**索引随 npm 包发布，也没有固定路径

索引是"从 URL 抓的一份 JSON"，因此**发布产物里放不放它，对 Discover 没有强制关系**（`dsh-plugin-market/README.md:31`，A）。
但我们仍把 `market/` 加进 `files` 白名单，理由有二：

1. **版本化 + 可审计**：索引跟随 npm 包版本走，用户能核对"某版本宣称的元数据"；
2. **多一条稳定托管路径**：npm 包发布后可由 CDN 直出，无需额外托管。

已实测的重定向行为（决定能否满足 `redirect: "error"`）：

| URL 形态 | 实测 | 可用于索引？ |
|---|---|---|
| `https://raw.githubusercontent.com/Shuffle-1992/dsh-browser-kit/main/package.json` | **HTTP 200**（`Content-Type: text/plain`，len 1187） | ✅ 直出、无重定向；**不检查 Content-Type**（`lib/types/parse.js` 只做 UTF-8 + JSON），故 `text/plain` 无害 |
| `https://raw.githubusercontent.com/…/main/market/index.json` | **HTTP 404**（`market/` 尚未提交推送） | ⚠️ 需先提交并推送该目录（本任务不 commit/push，交给 Lead） |
| `https://raw.githubusercontent.com/…/master/market/index.json` | **HTTP 404** | ⚠️ 同上；且 `master` 是**旧分支**（`2b5a74f…`），不要用它 |
| `https://cdn.jsdelivr.net/npm/semver@7.8.5/package.json` | **HTTP 200**，无重定向 | ✅ 精确版本路径可直出（发布后形如 `https://cdn.jsdelivr.net/npm/dsh-browser-kit@0.2.0/market/index.json`） |
| `https://unpkg.com/semver@7.8.5/package.json` | **HTTP 200**，无重定向 | ✅ 同上 |

（jsDelivr/unpkg 用 `semver@7.8.5` 做形状探针 —— 我们自己的包尚未发布，**未验证**我们包在 CDN 上的具体响应；上表只证明"精确版本路径不重定向"这一 URL 形状的性质。）

### 3.2 让用户看到本插件的完整步骤

1. 把 `market/` 与 `docs/market-index.md` 提交并推送到 **`main`**（**本任务禁止 commit/push，交由 Lead 统一提交**）。
2. 用户侧一次性开启：`Plugins` → `Experimental plugins` 旁 `More` → **Custom plugin markets**（默认关闭，`dsh-experimental-plugin-market-bundle/README.md:12/27`）。
3. `Discover` → **Add index source** → 填
   `https://raw.githubusercontent.com/Shuffle-1992/dsh-browser-kit/main/market/index.json`
   （或 §3.1 的 CDN 直链）。
4. 首次读取成功后会缓存 10 分钟（`cacheTtlMs` 默认 600000，`dsh-plugin-market/README.md:34`）。
5. 安装时 pnpm 会拉 `git+https://github.com/Shuffle-1992/dsh-browser-kit.git#6a928f5…` —— 该提交**已在远端**（§4.3 断言保证），因此安装链路不依赖 npm 发布。
6. **索引内容需要刷新时**：每次发布新提交后重跑 `node market/build-index.cjs`（自动取新 main 顶端）并提交索引；否则索引继续钉旧提交（仍可安装，只是不是最新）。

---

## 4. 验证（可复跑）

### 4.1 命令

```powershell
cd "F:\My Code\dsh-browser-kit"
node market/build-index.cjs                              # 生成（默认 git 源，commit 取自远端 main）
node market/verify-index.cjs --require-official          # 结构 + git 溯源 + 官方校验器
node market/verify-index.cjs --index <file>              # 校验任意索引文档（坏样本回归用）
node -e "const p=require('./package.json'); console.log(p.files)"   # JSON 合法性
npm pack --dry-run --json                                # 打包白名单生效
```

官方校验器取自 tarball 解包目录，**未改动**：`%TEMP%\dsh-compat\dsh-plugin-market-index-0.2.1-rc.2\package\lib\index.js`，`sha256 = 14bccdf32d0d5ff7300e7e99562f3ea24e4cddeb6b21ad7662f7813ede4b72a1`（校验脚本会打印；其唯一运行时依赖 `semver` 由 `%TEMP%\dsh-compat\node_modules` 提供，**未装进本仓库**）。

### 4.2 结果（实跑输出，节选）

```
PASS  JSON parses
PASS  root.format is 1 — 1
PASS  root.title is LocalizedText containing en
PASS  metadata.categories.browser declares a LocalizedText title
PASS  metadata.labels.{annotation,screenshot,device-emulation,credentials-local,automation} declares a LocalizedText title
PASS  $.plugins[0].name is a valid npm package name — dsh-browser-kit
PASS  $.plugins[0].repository.url is an http(s) URL without credentials, query, or fragment
PASS  $.plugins[0].metadata.category references a declared category — browser
PASS  $.plugins[0].metadata.labels references a declared label — (5/5)
PASS  $.plugins[0].versions[0].version is an exact SemVer — 0.2.0
PASS  $.plugins[0].versions[0].publishTimestamp is an integer in [0, 10^11) — 1792232941
PASS  $.plugins[0].versions[0].source is a valid npm|git source — {"type":"git","url":"…dsh-browser-kit.git","commit":"6a928f5…"}
PASS  $.plugins[0].versions[0].engines.dsh equals package.json engines.dsh — >=0.2.0-rc.2 <0.3.0-0 vs >=0.2.0-rc.2 <0.3.0-0
PASS  plugin name / listed version / repository.url 与 package.json 一致
PASS  root / plugin / version has no member format 1 drops — none
WARN  license is not a format-1 member — declared only by package.json (license: Apache-2.0)
INFO  install spec: git+https://github.com/Shuffle-1992/dsh-browser-kit.git#6a928f521eb379c35e72ab8b0e80f68d4de41140
INFO  remote tips via git ls-remote origin
INFO  remote tip HEAD = 6a928f521eb379c35e72ab8b0e80f68d4de41140
INFO  remote tip refs/heads/main = 6a928f521eb379c35e72ab8b0e80f68d4de41140
INFO  remote tip refs/heads/master = 2b5a74f0f4dd5035293e5d172aca57518a80cc1b
PASS  git provenance: dsh-browser-kit@0.2.0 commit is a lowercase 40-hex SHA — 6a928f5…
PASS  git provenance: dsh-browser-kit@0.2.0 commit exists in this repository — 6a928f5…
PASS  git provenance: dsh-browser-kit@0.2.0 commit is reachable from a remote ref — HEAD points at it
PASS  official parseMarketIndex accepted the index — dsh-plugin-market-index-0.2.1-rc.2/lib/index.js
INFO  validator sha256: 14bccdf32d0d5ff7300e7e99562f3ea24e4cddeb6b21ad7662f7813ede4b72a1
INFO  parsed: format=1 title.en=dsh-browser-kit plugin index plugins=1
INFO  parsed declarations: categories=1 labels=5 sortKeys=0
INFO  parsed plugin: dsh-browser-kit versions=0.2.0 category=browser labels=annotation|screenshot|device-emulation|credentials-local|automation
INFO  official install target: spec=git+https://github.com/Shuffle-1992/dsh-browser-kit.git#6a928f521eb379c35e72ab8b0e80f68d4de41140
PASS  official result keeps every plugin
OK: checks=all passed warnings=1
```

**幂等性**：远端 ref 不变时两次生成完全一致 ——

```
build#1 = 5C2EE9E33A1598269DD79D191819A94C320FFF2C054A318AECBBB5059C622234
build#2 = 5C2EE9E33A1598269DD79D191819A94C320FFF2C054A318AECBBB5059C622234
idempotent = True
```

打包白名单（`npm pack --dry-run`）：`entryCount=503`、`unpackedSize=9784489`，其中 `market/index.json`、`market/build-index.cjs`、`market/verify-index.cjs`、`market/README.md` 均**在包内**。

根 `package.json` JSON 合法性：`node -e "require('./package.json')"` 通过，`files` = `["plugin/","src/","market/","docs/","README.md","NOTICE.md","LICENSE","pitfalls.md"]`。

### 4.3 git 溯源断言的反例实测（证明"坏 commit 一定 FAIL"）

用 `node -e` 之外的方式（避免 PowerShell 读坏 UTF-8：改用 node 脚本 `%TEMP%\dsh-compat\make-bad-index.cjs`，**不写入仓库**）产出三个坏样本，再用 `--index` 校验：

| 样本 | commit | 预期失败点 | 实测 |
|---|---|---|---|
| (a) 未推送的本地 HEAD | `f3e2ea5150bdb47f39034ac7fe9954d89427e42a` | 存在、40-hex 都过；**远端不可达** | `FAIL git provenance: … commit is reachable from a remote ref — NOT reachable from any of HEAD, refs/heads/main, refs/heads/master — the index would install a 404`；**exit=1** |
| (b) 畸形 SHA | `abc123` | 40-hex 断言 + 结构层 + 官方校验器 | `FAIL git provenance: … commit is a lowercase 40-hex SHA`、`FAIL $.plugins[0].versions[0].source is a valid npm\|git source`、`FAIL official parseMarketIndex accepted the index — MarketIndexError: … must be a lowercase 40-hex-digit commit SHA`；**exit=1** |
| (c) 形状合法但不存在 | `0000…0000`（40 个 0） | 对象不存在 + 远端不可达 | `FAIL git provenance: … commit exists in this repository`、`FAIL git provenance: … commit is reachable from a remote ref`；**exit=1** |

关键点：样本 (a) 是最真实的失效模式（"本地都对、就是没推"），**结构层与官方校验器都放过它，只有新增的远端可达性断言能拦住**——这正是该断言存在的理由。

### 4.4 semver 兼容性单独验证

```
node "$env:TEMP\dsh-compat\semver-probe.cjs"
0.2.0-rc.2     default: true   includePrerelease: true
0.2.0          default: true   includePrerelease: true
0.2.1-alpha.1  default: false  includePrerelease: true
0.2.1-rc.1     default: false  includePrerelease: true
0.2.1-rc.2     default: false  includePrerelease: true     ← 默认语义会拒绝！
```

而安装/市场用的官方判定**显式开启** prerelease：

```js
// dsh-app-boot@0.2.1-rc.2/lib/index.js:276-277
function satisfies(runtimeVersion, range) {
  return range.trim() !== "" && semver.satisfies(runtimeVersion, range, { includePrerelease: true });
}
```

配合 `plugin-compatibility.d.ts:20`（"Prereleases participate in ranges"）⇒ **本索引的 `engines.dsh` 在运行中的 0.2.1-rc.2 上判定为兼容**，Discover 卡片不会因 prerelease 语义被判不可装。

---

## 5. 未确认项（查过但没有产物级答案）

1. **`dsh-browser-kit` 尚未发布到 npm**（实测 `https://registry.npmjs.org/dsh-browser-kit` 与 `@deepseek-ai/dsh-browser-kit` 均 **404**）⇒ 已据此**弃用 npm 源**，改用 git 源（§2），故**不再是安装阻塞**；npm 变体仅作为文档片段保留（§2.1），是否发布由 Lead 决定。
2. **`market/` 本身尚未提交推送**：`raw.githubusercontent.com/…/main/market/index.json` 实测 **404**（远端 main 的 tree 里没有 `market/`）。索引要能被 Discover 拉到，必须先提交并推送到 `main`。另注：`master` 是旧分支（`2b5a74f…`，其 `package.json` 仍是 `license: MIT`），文档与校验器一律使用 **`main`**。
3. **索引的"新鲜度"依赖重跑生成器**：索引钉的是**生成当时的 main 顶端**（现在 `6a928f5…`）。若 Lead 之后又推送新提交，旧索引仍可安装（旧 commit 仍是 main 的祖先 ⇒ 溯源断言仍 PASS），但不会指向最新代码；**每次发布后应重跑 `build-index.cjs` 并提交索引**。未做自动化（无 CI 钩子，本任务不改 `.github`/hooks）。
4. **官方索引规范原文不可得**：格式的"权威定义"是一份 Agent Note（`dsh-plugin-market-index/README.md:12` 指向 `../../../.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md`），**不在 tarball 内**（该包只发 `LICENSE/package.json/README*/lib/**`）。本报告全部结论来自**可执行的校验器代码**（`lib/index.js`）与类型声明，属 A 级等价证据，但**未读到规范原文**。
5. **是否存在官方/受信索引源白名单**：未发现任何白名单/签名/审核机制（§1.5）；bundle README 明说"没有官方市场"（`:56`）。**是否计划推出官方索引、第三方如何进入官方分发，未见证据**（另：`OFFICIAL_ON_DEMAND_CATALOG` 只收官方发行成员，属另一机制）。
6. **CDN 托管我们包的具体响应未验证**：§3.1 用 `semver@7.8.5` 只证明了"精确版本路径不重定向"这一形状性质；`dsh-browser-kit` 发布后在 jsDelivr/unpkg 上的真实行为（是否对首访重定向、`Content-Type`）**未实测**。
7. **`icon` 缺省时的 Discover 观感未验证**：格式中 `icon` 可选、客户端 README 说加载失败会回落默认图（`dsh-client-ui-plugin-market/README.md:62`）；但我们**没有提供图标**，卡片观感未实测，也未验证"相对 icon 引用于 raw.githubusercontent 同源"的实际效果（规则见 `lib/index.js:223`）。
8. **索引被发现后的实际排名/可见性**：`plugin_market` 搜索对 `name`/`title` 权重 3×、关键字 2×（`dsh-plugin-market/README.md:58`）；本索引在**单条**索引里的默认顺序=索引内顺序（`types.d.ts:87-88`），多家索引并列时的排序**未确认**（属客户端 UI 行为）。
9. **`setIndexes` 的持久化位置与多窗口覆盖**：README 明示"last write wins"（`dsh-plugin-market/README.md:104`），Discover/Settings/`setIndexes` 均可改写；我们**未**在本地 profile 实测写入路径（本任务禁止改 profile）。
10. **`evaluatePluginCompatibility` 对"无兼容版本"的卡片表现**：客户端 README:31 描述为"禁用 Install + tooltip"，但未实测（因为本插件在 0.2.1-rc.2 上判定兼容，无需该分支）。
11. **git 源安装的端到端未实测**：安装需 pnpm 从 GitHub 拉取并构建，本任务**不允许装插件**，故只验证到"commit 远端可达 + 官方 install spec 正确"这一层；实际 `pnpm add git+https://…#<sha>` 的成功/耗时未测。

---

## 6. 证据索引（`包@版本 文件:行号`）

`dsh-plugin-market-index@0.2.1-rc.2`
: `lib/types/types.d.ts:7-9`(MarketDeclaration)、`:11-14`(MarketSortKeyDeclaration)、`:16-20`(MarketIndexMetadata)、`:22-28`(MarketPluginMetadata)、`:29-35`(MarketRepository，"display only, never an install source")、`:37-49`(MarketSource)、`:51-54`(MarketEngines)、`:56-63`(MarketVersion)、`:65-80`(MarketPlugin)、`:82-89`(MarketIndex)、`:91-96`(MarketInstallTarget)
: `lib/types/index.d.ts:19`(MAX_INLINE_ICON_BYTES=32KiB)、`:28`(parseMarketIndex)、`:36`(marketInstallTarget)
: `lib/index.js:21-22`(未定义成员被丢弃)、`:23-36`(语言 id/npm 名/SemVer/commit/data-icon 正则与上限)、`:51-61`(LocalizedText，`:59` 必含 en)、`:89-96`(indexMetadata 缺省)、`:97-101`(declaredId)、`:102-133`(pluginMetadata)、`:134-154`(httpUrl/homepageUrl)、`:155-166`(gitUrl/packagePath)、`:167-175`(repository)、`:176-199`(source)、`:200-208`(engines)、`:209-225`(icon)、`:226-238`(marketVersion)、`:239-249`(versions)、`:250-271`(plugin)、`:280-303`(parseMarketIndex)、`:311-318`(marketInstallTarget)
: `README.md:12`(单一 JSON 文件)、`:29`(解析行为/相对 icon 解析/版本降序)、`:31`(安装 spec)、`:44-48`(导出表)、`:63`(不校验生成方义务)

`dsh-plugin-market@0.2.1-rc.2`
: `README.md:27`(bundle 可选、随附 profile 关闭、默认无索引源)、`:31-34`(Config 四项 + URL 规则)、`:36`(逐次校验 URL)、`:42`(只搜已配置 URL)、`:53-56`(query/sort/分页)、`:58`(检索权重)、`:60`(错误码)、`:62`(plugin_market 工具 + target/registry)、`:69`(进程 fetch、拒重定向、Worker 严格 UTF-8)、`:71`(缓存/并发/volatile)、`:75`(兼容性判定与默认版本)、`:77`(install 参数)、`:103`(Unsigned indexes)、`:104`(last write wins)、`:105`(Redirects refused)、`:106-107`(规模/分页限制)
: `lib/index.js:558-562`(`fetch(url,{redirect:'error',headers:{accept:'application/json'}})`)、`:566-569`(非 2xx → `plugin-market/fetch-failed`)、`:574-578`(`plugin-market/invalid-index` 带 path)、`:580-607`(readBody/maxBytes)
: `lib/types/index-url.js:10-26`(normalizeIndexUrl)、`lib/types/parse.js:9-35`(UTF-8→JSON→parseMarketIndex)

`dsh-client-ui-plugin-market@0.2.1-rc.2`
: `README.md:12`(Discover 是 Plugins 页第二个 tab)、`:27`(空态/Add index source/第三方提示)、`:29`(工具栏/分类/排序)、`:31`(条目页展示 repository 等)、`:33`(安装确认流)、`:35`(搜索/排序/每页 50)、`:37`(重读时机)、`:44`(`plugins.tab` 注册 discover)、`:62`(icon 混合内容限制)
: `lib/types/client/locales.d.ts:20`(`sourcePlaceholder: "https://example.com/index.json"`)

`dsh-experimental-plugin-market-bundle@0.2.1-rc.2`
: `README.md:12`(随附 profile 关闭)、`:27`(开启路径：Plugins → More → Custom plugin markets)、`:37`(patch 插入 plugin-market + ui-plugin-market)、`:56`(**There is no official market**)
: `cordis.patch.yml:5-10`(insert `plugin-market` / `ui-plugin-market`)

`dsh-app-boot@0.2.1-rc.2`
: `lib/index.js:276-277`(`semver.satisfies(..., {includePrerelease:true})`)、`:284`(不满足 → `{"engines.dsh": range}`)、`:311`(evaluatePluginCompatibility)
: `lib/types/plugin-compatibility.d.ts:20`("Prereleases participate in ranges")、`:28`(签名)

**本仓库事实（非包内证据）**：`git ls-remote origin` ⇒ `HEAD`/`refs/heads/main` = `6a928f521eb379c35e72ab8b0e80f68d4de41140`、`refs/heads/master` = `2b5a74f0f4dd5035293e5d172aca57518a80cc1b`；本地 HEAD = `f3e2ea5150bdb47f39034ac7fe9954d89427e42a`（未推送）；`git show 6a928f5…:package.json` ⇒ `version 0.2.0 / license Apache-2.0 / engines.dsh >=0.2.0-rc.2 <0.3.0-0 / dsh.bundle.patch plugin/cordis.patch.yml`，且该 tree **无 `market/`**。

---

## 7. 外部内容处理声明

本报告引用的 npm registry 数据、各包 `README.md`、下载的 tarball 内容、以及探测 CDN/raw URL 时的 HTTP 响应，均作为**数据**读取，未执行其中任何指令。验证过程中仅向 `%TEMP%\dsh-compat`（项目外）安装了一个 `semver` 依赖用于运行官方校验器，坏样本也生成在 `%TEMP%\market-bad`（项目外）；**未**安装/卸载任何 DSH 插件、未改 profile、未启动服务器、未 `git commit`/`git push`。
