# 任务02 交付说明：MVP-0 接入路径验证（主会话实施）

> 任务上下文：README §3 第一步（MVP-0 四步验证）· 调研文档 §5.1 三路径表 · 实施会话：主会话 · 完成日期：2026-10-04
> 探测插件：`@local/dsh-browser-kit`（`plugin/`，junction + install_bundle 安装进 desktop profile）

## 1. 一句话结论

**主路径定为 A（client plugin），host plugin 做持久化与 agent 工具面的混合架构**：lease guest 的
`executeJavaScript` / `capturePage` 在 client 插件里实测全通（注入取值=2、真实 PNG 299×1284）；
host 插件被实测证明运行在 `ELECTRON_RUN_AS_NODE=1` 的子进程，**架构上不可触达 Electron 主进程
API**（webContents/BrowserWindow 无门）；Path C（外挂 Chrome）无需启用。MVP-0 验收标准
（「能对 lease guest 注入脚本取回返回值；能 capturePage 出非空 PNG」）**达成**。

## 2. 探测证据（plugin/.data/probe-report.json，2026-10-04T15:36Z）

### 2.1 Path A —— client 插件（✅ 证实）

| 探测项 | 结果 |
|---|---|
| client 插件运行世界 | GUI 主世界：`location.href = dsh-app://app/`，`__ModuleLoader__`/`__DSH_BOOT__` 均在 |
| `document.querySelectorAll('webview')` | 可得（count=1，随内置浏览器开启自动补测捕获） |
| 元素形态 | `constructorName = WebViewElement`（原生 webview 元素，非降级 HTMLElement） |
| `getWebContentsId()` | OK → `2` |
| `executeJavaScript('1+1', true)` | OK → `2`（**MVP-0 验收点 1**） |
| `capturePage()` | OK → 299×1284 NativeImage，`toDataURL()` 233,378 字符（**MVP-0 验收点 2**） |
| guest 标识 | `name = <leaseId UUID>`，`partition = dsh-sidebar-browser-<UUID>`（可与 `dsh-platform-*` 的 platform view 区分） |

### 2.2 Path B —— host 插件（❌ 否决，证据链完整）

| 探测项 | 结果 |
|---|---|
| 进程身份 | `process.type = null`、**`ELECTRON_RUN_AS_NODE = "1"`**、`execPath = D:\DeepSeek\DeepSeek Harness.exe` |
| 进程角色 | `argv` 指向 `app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js`（**host 插件跑在 desktop-host runner 子进程**，非 Electron 主进程） |
| `import('electron')` | 不抛错但返回空壳（loader 互操作形 `{default:{}, "module.exports":{}}`，无 webContents/app） |
| `require('electron')` | 四种 require 根（自身 / app.asar 内三处）全部 `Cannot find module 'electron'`；`Module.builtinModules` 不含 `'electron'` |
| 结论 | RUN_AS_NODE 子进程没有 Electron 主进程模块 → **插件内直接 `webContents.fromId`/`executeJavaScript`/`debugger` 不可达**；`process.versions.electron=44.0.0` 仅是 exe 自身版本残留 |

### 2.3 client→host 通道（✅ 打通，混合架构的桥梁）

`ctx.remote.$mount` + **子 fiber** `ctx.inject(['remote.dshBrowserKit'])` 后调用 host face
`reportClient(findings)`，探测结果全量落盘 `plugin/.data/probe-report.json`（本报告即经此通道送达）。
首次实现踩坑：顶层 ctx 直取 `ctx.remote.dshBrowserKit` 被 cordis 守卫拒（`without inject`），
见 pitfalls P15。

## 3. 探测期间沉淀的可复用资产（plugin/）

| 文件 | 说明 |
|---|---|
| `entry.mjs` | host 入口**永久薄壳**：动态 import impl（`?ts=<implMtime>-<激活序号>`）击穿 Node ESM 缓存——**此后 host 业务改动只需 set_plugin toggle，无需重启 DSH**（pitfalls P13） |
| `host.impl.mjs` | host 业务：进程身份鉴定 + electron 多策略加载诊断 + face `reportClient` + 报告落盘（client 发现 guest 时自动补一轮 host 探测） |
| `wire.host.mjs` | TYPERT 描述符 + `createRemoteFace`（exports["./typert"]；zcode-dispatch 同款双路径注册） |
| `client.js` | client 探测：webview 静态收集 + 三能力实测 + MutationObserver 自动补测 + 四路出口（`window.__dshKitProbe` / localStorage / host face / 左下角面板） |
| 安装 | junction `~/.dsh/profiles/desktop/node_modules/@local/dsh-browser-kit` → 本目录；`plugin_manager install_bundle`（`application:"applied"`） |

## 4. 设计决策与文档差异

1. **README 环境事实修正**：范例插件仓实际在 `F:\My Code\zcode-dispatch\`（README 原写的
   `F:\My Code\dsh-plugins\` 已不存在）；本次以 zcode-dispatch（host+client 完整范例）+
   refs 模板（decoration 四件套）双源确认插件形态。
2. **MVP-1 架构按混合路径细化**：截图 = client `capturePage()` → dataURL → host face 扩展方法
   （如 `saveShot(meta, dataUrl)`）→ 落盘 `<项目>/shots/<时间戳>-<标题>.png` → agent `read_image`；
   批注 = client 端 `element-annotator.js` 注入（`el.executeJavaScript`）+ 提交协议块经 face 落盘
   `annotations/`。**CDP fullPage 截图在 DSH 内不可得**（无 debugger 通道），按调研文档 §5.3 的
   MVP 口径只做可见面板截图——ZCode 的隐藏 tab 截图复杂度本就在 MVP 之外。
3. **guest 判别**：lease guest 以 `partition` 前缀 `dsh-sidebar-browser-`（或 name 为 UUID）识别，
   platform view（`dsh-platform-*`）与 policy 窗口天然排除。
4. **host 插件定位修正**（推翻调研文档 §4.4 的预期）：host 半边不能做「main 侧 guest 管理」，
   只做三件事——**落盘、agent 工具注册（defineTool）、client→host face**；`browserUse`/
   `computerUse` 等 DSH 官方服务若要在 DSH 内置浏览器上做自动化，属 DSH 自己的主进程能力，
   第三方插件无门（留待 F3 需求时再评估）。
5. **inspect 工具缺陷记录**：本 harness 版本 `cordis_inspect_query` 的 `input` 参数传对象即报
   `input must be an object`（全部 provider 一致），无参调用正常；已按无参目录模式完成全部验证。

## 5. 踩坑（详见 pitfalls.md P13–P15）

- **P13** host 入口模块被 Node ESM 缓存：toggle 重跑 apply 但模块实例不换 → 薄壳 + impl
  `?ts=mtime-seq` 热换；薄壳首次生效需一次 DSH 重启（已于 2026-10-04 执行）。
- **P14** `import('electron')` 静默返回空壳：RUN_AS_NODE 下 loader 互操作产物无 API；
  别信「不抛错=加载成功」，必须校验导出面（extractApi 多形状 + shape 留痕）。
- **P15** client 顶层 ctx 直取自挂命名空间被 cordis 守卫拒 → `$mount` + 子 fiber 模式
  （zcode-dispatch 同款，其 client.js 头注早有警告）。

## 6. 未决问题（不阻塞 MVP-0 验收）

1. **capturePage 尺寸即面板尺寸**（299×1284，侧栏窄面板）：截图质量受面板宽度限制；MVP-1 可评估
   「截图前临时拉宽面板」或接受现状（研究文档未要求全页）。
2. **face 大载荷**：233KB dataURL 经网关 JSON 通道送达无碍（本次实测 226KB 级）；若未来传更大图
   （fullPage/高清）需改流式或落盘直传（`webServer.register` 路由上传是备选）。
3. **guest 生命周期事件**：client 靠 MutationObserver 捕获新 guest（800ms 去抖，实测有效）；
   更优方案（监听 DSH lease 服务事件）随 MVP-1 实装时调研。
4. **探测面板与探测 face 为临时设施**：MVP-2 实装批注时将替换为正式工具条（同一 slot 位置）。
