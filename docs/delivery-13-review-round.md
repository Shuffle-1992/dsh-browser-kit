# delivery-13 — 全项目 review 轮（简化 · 解耦 · 强制优化 · 测试验收）

日期：2026-10-05　方式：**双派发只读评审**（ZCode 派发台 ×2，plan 模式不占写锁）+ 主会话自查，主会话统一落地。

## 评审输入

- 派发 1（j-muv1kpjs）：plugin/client.js + host.impl.mjs + wire.host.mjs 深审 → C1–C16 / H1–H5 / W1–W3 / S1。
- 派发 2（j-muv1l0ai）：element-annotator.js + test/ 盲区 → A1–A7 / B1–B10 / F1–F3。
- 主会话自查：mergeAndSave 废形参、visible 双份、stop 表达式重复、ProbePanel 隐藏态空转。

## 落地（按批）

### 批1 真实 bug（4 个）
- **F1【高】** `tbLeft` 未声明 → 工具条 MutationObserver 同步重挂快速路径整体失效（P32）。
- **F2/C1** `page-inject` case 重复定义（第二块死代码，「改它不生效」陷阱）→ 删除合并，case 唯一性静态钉。
- **H1** onReport 读 findings.webviews（字段不存在）→ 补测触发恒死 → 改 webviewCount。
- **C3** syncPanes 守卫 `<2` → 单窗口会话 count 恒 0（面板徽标/live 胶囊永不出现）→ 放宽 `<1`，单面板也更新。

### 批2 简化/解耦（机械安全）
- C7 `isVisibleEl` 合一；C8 `GUEST_META_JS/metaOf` 三合一；C9 `ANNOT_ICON_SVG` 三合一（面板是另一枚 16-viewBox 图钉，独立保留）；C10 `readPanelHidden` 四合一；C11 删 mountAttempted / panel-collapsed 假持久化 / mergeAndSave 废形参；C15 工具条强调色常量化（豁免注释）；H3 dirnameCompat→内置；H4 删 state.merged；W1/W2 wire JSDoc 补齐 + FACE_METHOD_TABLE 上移；**C12** annotSourceCache 假 mtime 删除（版本号即失效机制，文档化）。
- **C13** reportToHost 复用 waitForSvc（原 27×300ms 循环两处各写一遍）；**C14** 看门狗代际标记（过期 finally 不清新 busy）。
- **C6** 五个常驻 setInterval 挂 ctx.effect 统一清理（P20 双实例危害）。

### 批3 测试增量（98 → 109）
- W3：client descriptors ↔ wire FACE_METHOD_TABLE **逐字对账**（P29 防复发）。
- A6a：executeCommand case 标签唯一性（F2 复发钉）；A6b：guest-eval document 参数遮蔽（P23 钉）。
- H2：`writeArtifact` 三合一提取（mkdir/dedupe/write/index 尾部）+ 单测 + _internals 导出。
- A2/A3（smoke 追加）：addExternal 更新分支、removeExternal 删除日志、startIndex 编号下限。

### 批4 解耦旗舰（A1）
- **syncPanes 同步判定抽纯函数 `planPaneSync`**（src/annotator-sync.mjs 正典 + client.js 内嵌副本 + parity 对拍防漂移，同协议 builder 先例）：origins 登记 / 删除双来源判定 / gid 去重 / 推送计划（附 _originUrl 同页门控）/ 删除广播 / 来源表清理（顺带修 originUrls 泄漏）——7 项全分支单测，最大测试盲区消除。

### 插件管理卡片全链路（用户新需求，多轮取证）
- 插槽 = `plugins.bundle.config`（Cordis Inspect client/Slots 取证：keyed、key=包名、view='page' only）；
- 组件接 ownerProps `view`（summary 一行摘要 / page 完整表单）+ 错误边界；stats 走 face `getStats`（须 unwrap，信封双层）；
- × 撤回走 face `deleteAnnotations`（annotations/ 围栏）；`plugins.row.config` 补注册（key = `<包名>#<patch 行 id>`）；
- **P33**：bundle 必须导出 schemastery 实例的 Config——JSON 字面量 → status=unsupported → fiberPhase=failed（候选链解析 schemastery，失败退 absent 宁缺勿 failed）；
- **P34**：列表/详情的标题与说明来自 **locale/zh.json + locale/en.json 的 meta 段**（dsh-app-boot dictionaries），非 package.json。

## 验收

- `npm test` **109/109** 全绿（新增 11 项：W3 对账、A6、H2、A2/A3、sync 7 项 + parity）。
- 真机：卡片统计显示真实数据（批注 24 · 34.6KB / 截图 38 · 12.6MB）；`clearArtifacts` kind 白名单拒绝生效；`getStats`/`clearArtifacts` 经真实 face 通道验证。
- 已知遗留（有意押后）：C2 executeCommand 拆表（需全 action 命令回放回归）、B5 popover rAF 合帧、B10 samePageHref 忽略 query 的 SPA 边界（已注释钉死）。
