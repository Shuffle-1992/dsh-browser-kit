# delivery-12 — 批注胶囊（ZCode 式）+ 撤回 face 方法（deleteAnnotations）

日期：2026-10-05　前置：delivery-09/10/11
用户需求（附 ZCode 截图）：输入框的批注信息改成**胶囊**形态——「N 条批注 ×」，× 可删除批注。

## 同轮根因修复（承接上轮）

- **P29**：`REMOTE_CONTRIBUTION` 缺 `saveMerged` descriptor（client 6 个 vs wire 表 7 个）→ 提交
  静默失败（`svc.saveMerged is not a function`）、文件不落盘、提示不出现。已补第 7/8 方法并对账。
- **P30**：会话输入框是 **Lexical** contenteditable（全文档 0 textarea）——execCommand insertText
  可写入但异步 reconcile，同步回读误报失败。已改**延迟回读**（300/350ms），lastPrime 记录
  `at/verifiedAt/ok` 随 kit-status 上报。真机实证：写入成功、文本在框。

## 胶囊（client.js）

- `#dsh-kit-annot-chip`：document.body 直挂（fixed 定位，React 重渲染不吞），锚定输入框上方，
  每 2s tick 重定位。深色圆角胶囊：标签图标 + 文案 + × 圆钮。
- **双模式**：
  - live（会话进行中，count>0）：`N 条批注`；× = 清空全部成员批注（逐面板 `clearAll()`，
    删除日志广播所有窗口同步移除）；count→0 自动隐藏。
  - saved（提交成功）：`N 条批注 · 已保存`（stateRef.chip 模型，title 带文件路径）；× = 撤回。
- `announceSubmission`：提交成功 → 挂 saved 胶囊；输入框找不到（无法锚定）才退回文本提示
  （primeSessionInput 保留为 fallback）。
- 纪律：**绝不写入/清理用户输入框内容**（P30 教训）——胶囊是 overlay，不碰 Lexical。

## 撤回 face 方法（第 8 个；P29 教训——两端同时装配）

- host：`deleteAnnotationsImpl(paths, filePath)`——安全线：解析后路径必须位于 `<项目>/annotations/`
  内（`pathResolve` + 前缀检查，拒绝越界删除）；删文件 + 按 file 名整行过滤 `index.jsonl`。
- wire：FACE_METHOD_TABLE/TYPERT/face 类加 `deleteAnnotations(path)`（顺带清理了重复的 saveMerged
  类方法定义）；client descriptor 同步补齐。
- 单测：撤回回环（文件消失 + 索引清空）、越界拒绝、缺文件、空 path。

## 验证

- `npm test` 98/98 全绿（wire 8 方法、deleteAnnotationsImpl 4 子测、胶囊静态契约）。
- 真机闭环（命令通道 + gui-eval + `window.__dshKitClientDiag` 诊断句柄）：注入 saved 模型 →
  胶囊渲染 `3 条批注 · 已保存` → 点 × → **文件经真实 client→host face 通道删除**（盘上确认消失）。
- live 模式（会话中实时计数）逻辑同一渲染路径，等用户开浏览器窗口后实测。

## 已知边界

- 窗口最小化/失焦时 `checkVisibility()` 为 false → 胶囊暂不重锚（模型保留，窗口回前台后下一轮
  tick 自动重现）。
- 胶囊由 2s tick 驱动，位置/计数更新最大滞后 2s。
