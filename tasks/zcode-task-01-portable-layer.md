# dsh-browser-kit 任务书 01：可移植资产层（ZCode 实施）

> 派发建议：`cwd = F:\My Code\dsh-browser-kit`，mode = build/edit，write 仅限本目录。
> 上下文完备性：本任务书自足；深入规格引用调研文档（同目录）与 ZCode 参照源码（本地克隆，只读）。

## 0. 一句话目标

实现与宿主无关的**可移植资产层**：`hid-observer.js`（L1 通用设备观测）+ `element-annotator.js`（网页批注层）+ `annotations-protocol.js`（批注协议 v2）+ `virtual-hid-device.js`（mock 设备）+ `cdp/drive.mjs`（CDP 驱动）+ 单元/冒烟测试。全部产物**零 DSH 依赖**，在纯 Node/Chrome 环境即可验收；DSH 插件接入（MVP-0）由主会话后续完成，不在本任务内。

## 1. 必读上下文（按序）

1. `F:\My Code\dsh-browser-kit\browser-annotation-and-screenshot-research.md` —— **§1 目标定义、§2.1 ZCode picker 解剖、§5.2 批注模式规格（本任务核心规格）、§5.5 设备观测规格（本任务核心规格）**；
2. 移植参照（只读，Apache-2.0）：`F:\My Code\ZCode\packages\ui\src\lib\webElementPickerScript.ts`、`webElementContext.ts`、`hooks\useWebElementPicker.ts`；
3. `F:\My Code\dsh-browser-kit\README.md`（项目定位与边界）。

## 2. 硬边界（越界即返工）

- **只写**：`F:\My Code\dsh-browser-kit\` 下的 `src/`、`test/`、`NOTICE.md`、`package.json`、`pitfalls.md`、`README.md`（仅允许更新「目录结构」段）；
- **禁止**：改动 `keysion dac vue` / `dsh-plugins` / `F:\My Code\ZCode`（只读参照）/ `D:\DeepSeek` 任何内容；
- **依赖策略**：优先零 npm 依赖（Node ≥ 22 原生 WebSocket / 内置 `node:test`）；确需引入依赖（如 `ws`）必须在交付说明记录理由；
- 不起长驻服务；集成冒烟用临时 `--user-data-dir` 的 Chrome，脚本结束必须关闭进程并清理临时目录；
- 移植 ZCode 代码：文件头保留 Apache-2.0 归属注释（来源文件路径），并在 `NOTICE.md` 登记。

## 3. 产出与规格

### 3.1 `src/hid-observer.js` —— L1 通用设备观测（自包含 IIFE，可被 executeJavaScript / CDP addScriptToEvaluateOnNewDocument 注入）

规格全文见调研文档 §5.5「通用观测分层」+「SDK 无关性」。钉死契约：

```js
window.__hidLog = {
  version: "1",
  entries: [],                                   // ring buffer 只读视图，默认上限 500
  dump(opts?) => Entry[],                        // opts: {dir?, api?, device?, since?, op?, limit?}
  export() => string,                            // JSONL
  clear() => void,
  filter(opts) => Entry[],
  registerDecoder(name, fn) => void,             // fn(entry) => {op, note?} | null；命中后 entry.op/note 自动填充
  config({max?, consoleChannel?}) => void        // consoleChannel: 'debug'（默认）| 'off'
}
window.__dshKitHidObserver = { detach() }        // 撤销全部 patch 恢复原生
```

`Entry = { seq, t(ISO), dir:'TX'|'RX'|'OPEN'|'CLOSE'|'EVENT', api:'hid'|'serial'|'usb', device:{vendorId, productId, serialNumber?}, reportId?, bytes(Uint8Array 拷贝), hex, ascii, len, op?, note? }`

- **覆盖深度**：HID = `sendReport`（TX）+ `inputreport` 镜像监听（RX，DOM 事件多播，镜像不消费）+ open/close；USB = `transferIn/Out` + `controlTransferIn/Out`；Serial = `write`（TX）全量 + RX best-effort（`data` 事件镜像，注明局限）；
- **手法**：代理 `navigator.hid/serial/usb` getter + wrap 对应 prototype 方法；`document_start` 语义由注入方保证，脚本自身在首次调用时惰性 patch；
- **防重注入**：`window.__DSH_KIT_OBSERVER_VERSION` 已存在则先 `detach()` 再装；
- **安全**：bytes 拷贝（防页面事后改写）；ascii 只保留可打印段；序列化禁止循环引用崩溃；console 输出格式 `[HID]` dir/api/hex(前 32 字节截断)/op。

### 3.2 `src/element-annotator.js` —— 网页批注层（自包含 IIFE）

以 ZCode `webElementPickerScript.ts` 为基座移植（hover 高亮 + capture 阶段事件拦截 + 元素采集 payload 全字段），按调研文档 **§5.2 状态机与交互规格** 扩展为批注模式：编号徽标钉标（文档坐标，滚动/缩放跟随）→ 就地意见输入框（可留空）→ 批注列表面板（in-page 版）→ 提交打包。钉死契约：

```js
window.__dshKitAnnotator = {
  start(opts?) => Promise<'cancelled' | 'submitted'>,
  stop() => void,
  submit() => { markdown, annotations },
  list() => Annotation[],
  clear() => void
}
// Annotation = { index, note?, element: Payload, stale?: boolean }
// Payload 与 ZCode webElementContext.ts 同构（pageUrl/pageTitle/tagName/role/accessibleName/
//   selector/xpath/text/nearbyText/htmlExcerpt/attributes/rect/style/capturedAt）
// opts.onSubmit?.({markdown, annotations}) 回调出口（宿主后续接入点，必须保留）
```

- 提交时尝试剪贴板（`navigator.clipboard.writeText` → `execCommand('copy')` 降级，失败不抛错），但**始终返回** `{markdown, annotations}` 给调用方；
- 标记命名：`data-dsh-kit-picker-overlay` / `data-dsh-kit-marker` / 单例键 `window.__dshKitAnnotator`；
- 边界按 §5.2：意见框 keydown `stopPropagation`、批注态点击 capture 拦截、密码框/iframe 跳过、selector 失联徽标置灰 + `[element no longer matched]`。

### 3.3 `src/annotations-protocol.js` —— 协议 v2（纯函数 ESM，Node 可直接单测）

- `buildAnnotationsMarkdown(annotations) => string` / `parseAnnotationsMarkdown(text) => { annotations, visibleContent }`，格式严格按调研文档 §5.2 协议 v2 样例（`# Web page annotations: N` / `## Annotation k` / `Note:` 行可缺席 / 字段行 / `Text:`、`Nearby context:`、`HTML excerpt:` 围栏）；
- 对偶性：build→parse 必须无损还原（含含 Note / 无 Note / 字段截断 8000 + `[truncated]` / stale 标记 / CRLF 容忍）。

### 3.4 `src/virtual-hid-device.js` —— mock 设备（双形态：ESM 模块 + 可注入 IIFE）

实现 `navigator.hid` 的最小假象（fake `HIDDevice` + `requestDevice/getDevices`），支持脚本化喂 inputreport（`pushInput(reportId, bytes, delayMs?)`），与 hid-observer 联测实现无硬件配对帧断言。

### 3.5 `src/cdp/drive.mjs` —— CDP 驱动（Node 脚本）

- `launch({chromePath?, port=9222, userDataDir?})`（`--remote-debugging-port --user-data-dir --no-first-run`，默认非 headless）/ `connect(portOrWsUrl)` → `{send, on, close}` / `inject(cdp, scriptSource)`（`Page.addScriptToEvaluateOnNewDocument` + 对当前文档 `Runtime.evaluate` 兜底）/ `evalJs(cdp, expr)`（`returnByValue` + `awaitPromise`，异常透传）/ `consoleStream(cdp, cb)`（`Runtime.consoleAPICalled` 归一化）/ `screenshot(cdp, {fullPage?})` → Buffer / `close()` 清理进程与临时目录。

### 3.6 `test/` —— Node:test 单测 + fixtures + Chrome 冒烟

1. 协议 round-trip 全分支；
2. hid-observer 沙箱测试（Node mock 出 fake navigator.hid → 断言 TX/RX 记录、ring 上限、filter/decoder/dump、detach 还原）；
3. `test/fixtures/hid-mock-page.html`：加载 observer **前**内联伪造 navigator.hid，页面按钮触发收发 → drive.mjs 注入后 `evalJs('__hidLog.dump()')` 断言（无硬件、无手势）；
4. annotator 冒烟：`test/fixtures/page.html` 上模拟点击/意见输入/submit，产出 markdown 与协议 parse 对拍；
5. cdp 冒烟：注入→evaluate→截图→console 采集各跑通一次。

## 4. 命名钉死（防漂移）

`window.__hidLog`、`window.__dshKitHidObserver`、`window.__dshKitAnnotator`、`data-dsh-kit-*`、协议头 `# Web page annotations:`。与调研文档冲突时以调研文档 §5.2/§5.5 为准并在交付说明提出。

## 5. 验收（DoD 以运行时表现为准）

1. `node --test` 全绿；
2. 协议 round-trip 全分支通过；
3. hid-observer 沙箱与 fixture 双测通过（含 detach 还原、重注入防重）；
4. annotator 冒烟产出合法协议 v2 文本且 round-trip 无损；
5. cdp 冒烟五项（launch/connect/inject/evalJs/screenshot/consoleStream）在真实 Chrome 跑通；
6. `NOTICE.md` 完整登记 ZCode 移植来源；
7. 交付说明 `docs/delivery-01.md`：改动清单 + 每条验收的命令与输出摘录 + 未决问题；踩坑记 `pitfalls.md`。

## 6. 明确不做（本任务外）

- DSH 插件接入与 Path A/B 验证（MVP-0，主会话负责）；
- composer/剪贴板宿主集成、DSH GUI 悬浮工具条；
- keysion dac vue 仓库任何改动（含 L2 语义解码器——后续单独任务）；
- 真实硬件断言（属 MVP-5 用户验收环节）。
