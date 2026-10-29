# delivery-10 — 提交回填会话输入框 + 面板「清除」按钮（annotator 1.4.0）

日期：2026-10-05　前置：delivery-09（共享会话真打通）
用户需求：① 批注提交后，在会话输入框出现相关提示；② 批注面板新增「清除」按钮，放展开/收起图标左侧。

## 实现

### 1. 提交 → 会话输入框提示（client.js）

- `primeSessionInput(text)`：找 GUI 聊天输入框（可见 `textarea` 优先，`[contenteditable=true]` 兜底），
  原生 value setter + `input` 事件保证 React 受控组件同步；已有内容**换行追加不覆盖**；写后聚焦，不自动发送。
- `announceSubmission(r)`：拼「已提交 N 条元素批注：<path>」，成功后 `say()` 留痕。
- 接入三条提交链：面板提交（sessionSettled）、命令 `submit-annotations`（共享会话分支）、
  命令 `submit-annotations`（单面板 saveAnnotations 分支）。

### 2. 面板「清除」按钮（src/element-annotator.js，v1.4.0）

- 位置：面板 header `append(icon, title, panelCount, clearBtn, panelChevron)`——chevron 有
  `marginLeft:auto` 靠右，clearBtn 紧贴其左（用户指定位置）。
- 语义 `clearAllAnnots()`：本面板全部批注移除 + **全部 gid 进 `__dshKitDeletedGids` 删除日志**——
  共享会话下必须写日志，否则其他窗口的批注 1.5s 后会被 `addExternal` 推回来；宿主 syncPanes
  合并删除日志后广播 `removeExternal`，实现全窗口同步移除。正开着的批注输入框一并收掉；toast 反馈。
- 新增公开 API `clearAll()`（既有钉死契约 `clear()` 不动——它不写删除日志，仅本面板语义）。

## 验证

- `npm test` 91/91 全绿：
  - 冒烟新增段：clearAll 清空 + 删除日志断言；面板按钮 DOM 顺序断言（`compareDocumentPosition`
    证明在 chevron 左侧）；点击按钮 → 清空 + gid 入日志。
  - 静态契约：`EXPECTED_ANNOT_VERSION = '1.4.0'` 与 annotator 版本双锁；`primeSessionInput` 存在；
    header append 字面顺序断言（注意文件里悬浮 popover 也有 `header.append`，正则需锚定面板实参）。
- 已 toggle 热换：client 半边随插件重启自动换新（delivery-09 实证机制），annotator 源按 mtime
  缓存失效自动重取；旧版本面板在下次会话注入时被 1.4.0 版本检查自动重注入。

## 备注

- 输入框提示是「写入不发送」：用户可补充一句话后自行发送给助手。
- 若 DSH 聊天输入框既非 textarea 也非 contenteditable（自绘编辑器），提示写入会失败并 `say(warn)`
  留痕——目前 GUI 为标准 textarea，实测路径可用。
