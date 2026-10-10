# MVP-0 接入探测·进度与重启交接（2026-10-04）

> **【已完成，本文仅作历史留档】** 最终结论见 [delivery-02-mvp0.md](delivery-02-mvp0.md)（主路径 A 混合架构；Path B 否决）。
>
> 本文件是**会话交接件**：DSH 重启后新会话按此继续。任务上下文：README §3 第一步（MVP-0 四步验证），
> 调研文档 §5.1 三路径表。任务01（ZCode 可移植资产层）已交付（docs/delivery-01.md）。

## 已完成

1. **Inspect Provider 清单**（README 步骤1）：host 侧 Service/Event/Config/Tool，client 侧
   Service/Event/Builtin/Slots/Theme。注意：host `Service.listService` 是**静态声明目录**（连
   zcodeDispatch 都不出现），不能用于验证运行期 face 注册；`cordis_inspect_query` 的 `input`
   参数在本 harness 版本有 bug（传什么都报 "input must be an object"），无参调用可用。
2. **插件形态确认**（README 步骤2）：范例仓在 `F:\My Code\zcode-dispatch\`（README 写的
   `dsh-plugins\` 已不存在）。host 半边 `apply(ctx,config)` + `ctx.provide` + `defineTool`；
   client 半边 `window.__ModuleLoader__.load` + `inject:['slots','remote','typert']` +
   `ctx.remote.$mount`；bundle = package.json(exports+`dsh` 字段) + cordis.patch.yml + junction
   到 profile node_modules + `plugin_manager install_bundle`。
3. **探测插件已安装且激活**：`@local/dsh-browser-kit` → `F:\My Code\dsh-browser-kit\plugin\`
   （junction + install_bundle，`application:"applied"`；条目 id `include:dsh-browser-kit`）。
   host 探测首跑结论（plugin/.data/probe-report.json）：
   - **host 插件运行在 DSH main 进程**：`process.versions.electron = 44.0.0`、
     `resourcesPath = D:\DeepSeek\resources`，`import('electron')` 不抛错 —— **Path B 基座成立**；
   - electron 模块命名空间形状与预期不符（`webContents` 取不到）→ 修正版 impl
     （extractApi 多形状探测 + shape 诊断 + CJS 降级）**等 DSH 重启后生效**（见 P13）。

## 待办（重启后按序）

1. **重启 DSH**（必须）：入口模块被 Node ESM 缓存，薄壳 entry.mjs 首次生效需要它；
   今后业务改动一律走 host.impl.mjs 的 `?ts=mtime-seq` 热换（pitfalls P13），不再重启。
2. 确认报告文件出现 `implLoadedAt` 字段（= 新代码已生效）→ 读 host 探测结论：
   `F:\My Code\dsh-browser-kit\plugin\.data\probe-report.json`。
3. **用户打开 DSH 内置浏览器**（任意 lease guest）：client 半边的 MutationObserver 会自动补测
   并上报（client.js 挂在 GUI 页左下角，有「重新探测 / 上报 host」按钮）。
4. 再读 probe-report.json：`client` 字段 = Path A 实测（webview 数量/方法存在性/
   executeJavaScript('1+1')/capturePage()）；`host.guestProbe` = Path B 实测
   （executeJavaScript/capturePage/debugger fullPage）。
5. 产出 A/B/C 选型结论 → 更新 README §6 + pitfalls + 本文档，进 MVP-1（截图管线）。

## 探测插件文件（plugin/）

| 文件 | 角色 |
|---|---|
| entry.mjs | host 入口**薄壳**（永久不改；动态 import impl，`?ts=mtime-seq` 击穿缓存） |
| host.impl.mjs | host 业务（electron 探测 + face reportClient + 报告落盘 .data/probe-report.json） |
| wire.host.mjs | TYPERT 描述符 + createRemoteFace（exports["./typert"]；zcode-dispatch 同款） |
| client.js | client 探测（webview 静态+实测四路出口：window.__dshKitProbe / localStorage / host face / 左下角面板） |
| cordis.patch.yml / package.json | bundle 声明（exports["."] → entry.mjs） |

## 运维要点（已实测）

- 重载 host 代码：`plugin_manager set_plugin` target=`include:dsh-browser-kit` disable→enable
  （impl 变了才有效果；entry 变了无效——别改 entry）。
- 已知无害噪音：install_bundle 时 pnpm 对 `dsh-connect-trae`/`dsh-workbuddy-connect` 的
  registry 拉取 TLS 失败（ERR_TLS_CERT_ALTNAME_INVALID），不影响本地 link 包安装。
