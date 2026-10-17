# dsh-browser-kit 任务书 02：host impl 内部助手单元测试（ZCode 实施）

> 派发建议：cwd = F:\My Code\dsh-browser-kit，mode = build/edit，write 仅限
> `plugin/host.impl.mjs`（只在文件末尾追加导出，不改既有逻辑）与 `test/plugin-impl.test.mjs`（新建）。
> 上下文完备性：本任务书自足；被测对象为纯 Node 函数，无 Electron/网络依赖。

## 0. 一句话目标

为 DSH 插件 `@local/dsh-browser-kit` 的 host 业务层（`plugin/host.impl.mjs`）的**纯函数助手**补齐
`node:test` 单元测试，并把它们以 `_internals` 导出面暴露——不改变任何既有行为。

## 1. 必读上下文（按序）

1. `plugin/host.impl.mjs` —— 被测函数所在（全部为模块级 function，当前未导出）；
2. `plugin/wire.host.mjs` —— TYPERT 描述符（测其清单形状，不测网络）；
3. `pitfalls.md` 的 **P18**（BOM 剥除行为是 takeCommandImpl 的验收点）。

## 2. 硬边界

- **只写**：`plugin/host.impl.mjs`（仅允许在文件末尾追加 `export const _internals = {...}` 形式的导出，
  汇总既有函数引用；禁止改动任何既有函数体/逻辑/顺序）、`test/plugin-impl.test.mjs`（新建）；
- **禁止**：改动 plugin/ 其他文件、src/、docs/、README、本任务书；不触网；不起长驻服务；
  测试用临时目录（`fs.mkdtempSync(os.tmpdir())`），结束后清理；
- 依赖策略：零 npm 依赖，`node:test` + `node:assert/strict`；
- 完成判据：`node --test test/plugin-impl.test.mjs` 全绿，且**项目既有测试不受影响**
  （`npm test` = `node --test` 全绿，45 项为基线，新增后总数只增不减）。

## 3. 被测对象与覆盖点

### 3.1 `slugify(s)`
- Windows 非法字符 `\ / : * ? " < > |` 与换行/制表 → 替换或剔除；
- 中文保留（如 `结算卡`）、空格折叠为 `-`、首尾 `-.` 修剪、截断 40 字、空输入回退 `'page'`。

### 3.2 `tsStamp(d?)`
- 输出形如 `YYYYMMDD-HHmmss`（用固定 Date 断言，不比较当前时刻——参见 pitfalls P7 教训）。

### 3.3 `saveShotImpl(paths, meta, dataUrl)`
- 合法 `data:image/png;base64,` + ≥500B 的随机字节 → 写出 `<shotsDir>/<ts>-<slug>.png` +
  `index.jsonl` 一行（含 file/url/title/bytes），返回 `{ok:true, path, bytes}`；
- PNG 字节 < 500 → `{ok:false}`（1×1 假成功防线，文案含「假成功」）；
- 非 png dataURL / 解码为空 → `{ok:false}`；
- meta 缺失/非对象不抛（title/url 回退 slug）。

### 3.4 `saveAnnotationsImpl(paths, markdown, meta?)`
- 正常 markdown → `annotations/<ts>.md` + `index.jsonl`（count 从首行
  `# Web page annotations: N` 解析；meta 缺席时 url/title 为 null）；
- 空/非字符串 → `{ok:false}`。

### 3.5 `takeCommandImpl(paths)`
- 文件不存在 → `{ok:true, command:null}`；
- 合法 JSON → 返回对象且**文件已被删除**；
- 带 BOM 的合法 JSON → 正常解析（P18 回归点）；
- 非法 JSON → `{ok:false, error 含「解析失败」}` 且文件已删。

### 3.6 `commandResultImpl(paths, id, result)`
- 追加一行 JSONL（at/id/result），result 为 undefined 时落 null。

### 3.7 `shapeOf(mod)` / `extractApi(mod)`
- jiti 互操作形 `{default:{}, "module.exports":{webContents:{}}}` → extractApi 命中 module.exports；
- `{default:{app:{}}}` → 命中 default；
- 全空 → null；shapeOf 记录 keys/defaultKeys/moduleExportsKeys。

### 3.8 `wire.host.mjs` 的 `TYPERT`
- package == '@local/dsh-browser-kit'、service == 'dshBrowserKit'；
- invocations 恰 6 个：reportClient/saveShot/saveAnnotations/getInjectScript/takeCommand/commandResult；
- 每项 id 形如 `@local/dsh-browser-kit#dshBrowserKit/<method>`，parameters 均有 codec.mode='strict'；
- saveAnnotations 的 meta 参数带 `acceptsUndefined:true`。

## 4. 交付

1. `plugin/host.impl.mjs` 末尾追加 `_internals` 导出（唯一改动点）；
2. `test/plugin-impl.test.mjs`：上述 8 组覆盖点，子测试分节；
3. 运行证据：`node --test test/plugin-impl.test.mjs` 输出全绿摘要 +
   `node --test` 全量摘要（基数 45 只增不减）；
4. 踩坑记 `pitfalls.md`（若有，格式：现象→根因→对策，追加分节「任务02 实施期」）。
