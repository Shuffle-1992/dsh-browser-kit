# 任务04 交付说明：MVP-2 批注模式接入（主会话实施）

> 任务上下文：README §6 路线表 MVP-2 · 调研文档 §5.2 批注模式规格 · 完成日期：2026-10-05 凌晨
> 前置：MVP-0 架构定论（delivery-02）、MVP-1 截图管线（delivery-03）· 批注层本体为任务01 资产（src/element-annotator.js，零改动复用）

## 1. 一句话结论

**MVP-2 机器全链路验收通过**：client 面板/命令通道把 `element-annotator.js`（45KB IIFE）注入
公网 Vue 站点 guest → 合成事件驱动完整批注流（点选 3 元素：2 条带 Note + 1 条留空）→ 面板提交 →
协议块经 face `saveAnnotations` 落盘 `annotations/20261005-001932.md`（1871B）→ 任务01 解析器
round-trip 无损还原（note/selector/rect 逐字段核对）。人手真实批注通道同按钮可用（[批注] 键）。

## 2. 实测证据

- `annotations/20261005-001932.md`：`# Web page annotations: 3`，Annotation 1（h1 品牌字标，Note+
  Selector `div#loginPage > div.login-box:nth-of-type(5) > h1`+Rect+Font 全套字段）、Annotation 2
  （`a#forgotPasswordBtn`，**无 Note 行 = 快速引用分支**）、Annotation 3（HarmonyOS 卡片 span，Note+）；
- 解析还原（src/annotations-protocol.js）：3 条，note/selector/rect 与文件逐字一致（含 null note 分支）；
- 命令通道自测记录 `.data/command-results.jsonl` cmd-1…cmd-15：注入 ✓ / status ✓ / start ✓ /
  stop ✓ / guest-eval（合成批注脚本）✓ / submit ✓，全程零重启、零用户操作。

## 3. 改动清单

| 文件 | 说明 |
|---|---|
| `plugin/wire.host.mjs` | face 契约扩至 6 方法：`getInjectScript`（按 mtime 供注入源）/ `takeCommand` / `commandResult` |
| `plugin/host.impl.mjs` | 注入源供给（读 `src/element-annotator.js`）；命令文件通道（`.data/command.json` 取走即删 + BOM 剥离；`.data/command-results.jsonl` 回传） |
| `plugin/client.js` | 批注会话流（注入→`start({onSubmit:全局暂存桥})`→executeJavaScript await start 的 Promise→取回 payload→saveAnnotations）；条数轮询；面板 [批注]/[结束批注] 切换 + 状态行；**MVP-4 种子**：命令轮询（2.5s）+ `guest-eval` 原语（agent 任意求值 guest） |
| `src/element-annotator.js` | **零改动**（任务01 资产按契约直接复用：start/stop/submit/list/clear + data-dsh-kit-* 钩子） |

## 4. 关键机制（pitfalls P18/P19）

1. **onSubmit 桥接**：executeJavaScript 传不了函数 → 注入侧 `start({onSubmit: r => window.__dshKitLastSubmit = r})`，
   提交后 client 取全局变量；`start()` 返回的 Promise 由 webview.executeJavaScript 原生 await——
   会话结束（submitted/cancelled）即 resolve，无轮询歧义；
2. **命令文件 BOM**：Windows PowerShell 5 `Set-Content -Encoding UTF8` 带 BOM，JSON.parse 呛——host 侧
   `raw.replace(/^\uFEFF/,'')` 防御（P18）；
3. **命令不许 await 长生命周期动作**：start-annotator 曾 await 会话 Promise 卡死轮询队列（cmdBusy）——
   改为立即返回 `{ok,started:true}`、会话后台收尾（P19）；
4. **guest JS 异常透传**：executeJavaScript 的脚本错误以 `GUEST_VIEW_MANAGER_CALL` 包装回到 client——
   命令结果里能看到原始错误消息，调试体验良好。

## 5. 未决问题（不阻塞验收）

1. **人手真实批注未走**（机器驱动已全通）：面板 [批注] 按钮即人手通道，交互手感待用户实际使用反馈；
2. **Annotation 3 的 Rect=0×0**：目标 span 在页面当前态为零尺寸（真实数据如实记录）——提示批注
   「失效/零尺寸」检测或可加强（任务01 层已有 stale 机制，零尺寸暂不拦截）；
3. **README MVP-2 完整口径**（5173 三处批注 → agent 逐条修改）需要真实 dev server 上的修改闭环，
   归入 MVP-3「连续 3 轮批注→修改→截图确认」验收；
4. **`visibleContent` 空**：ZCode 可选说明字段，本流程未传——面板/命令可后续加「公共说明」输入。

## 6. MVP-4 种子已埋（顺带交付）

命令通道（`takeCommand`/`commandResult` + `guest-eval`）= F3「agent 主动操作内置浏览器」的最小骨架：
agent 写 `.data/command.json` 即可驱动 client 做注入/求值/截图/提交。后续补
navigate/click/type/snapshot 等动作时只扩 `executeCommand` 的 switch。
