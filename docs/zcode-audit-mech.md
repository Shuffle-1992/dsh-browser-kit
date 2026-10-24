# dsh-browser-kit 机械式一致性审计（2026-10-24）

> 范围：只读审计，不改代码。方法：逐符号 `grep -rw` 引用计数 + 逐行比对。所有计数均为
> `plugin/ src/ test/`（排除 node_modules、package-lock）内的**全词匹配行数**（定义行也计入）。
> 不复述 `docs/zcode-review-deep.md` / `docs/zcode-audit-tests.md` 已覆盖项。

## 〇、总表

| # | 类别 | 结论 | 高危 |
|---|------|------|------|
| A | 死代码 | 3 项实锤（引用计数=1）；noop.js 疑似死文件但**实为 require 锚点，排除** | 无 |
| B | 重复实现 | basename 残余第 3 份（tool-presentation）、字节格式化第 2 份（client KitPanelCard）、errOf 逐字两份、ID 生成 3 处内联变体 | 无 |
| C | 常量漂移 | `25000` 默认超时两处独立硬编码；其余对账通过（200/500/4MB/32000/24000 均一致） | 无 |
| D | 注释失实 | 6 处，含两处互相矛盾的注释（keyed 分派归因）与"共 8 方法"实为 18 | 无 |
| E | 签名冗余 | 2 处刻意忽略（官方契约要求，豁免）；无忘处理型遗漏 | 无 |
| F | 两端 face 对账 | 18 方法名/参数/可选参数**逐项一致**；但 5 条 signature 字符串不同（"逐字对账"名不副实）；27 工具 output/presentCall/presentResult 全覆盖 ✓ | 无 |
| G | 正典↔内嵌副本 | shot-view / annotator-consume 逐行等价 ✓；**summarizeSets 内嵌副本缺 Array.isArray 守卫**（正典有）；session-id 无副本（唯一实现 ✓） | 低 |

---

## 一、死代码（引用计数 < 2）

### A1. `hidCloseAllImpl` — 计数 1，注释声称的调用方不存在
- **位置**：`src/hid-bridge.mjs:190`
- **事实**：`grep -rw hidCloseAllImpl` = **1 行**（仅 `export async function hidCloseAllImpl()` 定义行）。`plugin/host.impl.mjs` 全文无引用（onHidRead/onHidList/onHidTrace 在 :811/:815/:817 有接线，onHidCloseAll 不存在）。
- **注释失实叠加**：头注（:188）写"host impl 卸载/热换时调用"，实际卸载路径没有调用它——句柄在热换后泄漏到桥内 Map。
- **建议**：二选一——①删除；②在 `host.impl.mjs` 的宿主卸载/重载路径接线 `hidCloseAllImpl()`（与头注意图一致，顺带修泄漏）。
- **风险**：低（纯新增导出，从未有调用方依赖其行为）。

### A2. `resolveSchemasterySync` — 计数 1，注释自称"保留给测试"但测试不用
- **位置**：`plugin/plugin-config.schema.mjs:57`
- **事实**：计数 **1**（仅定义行）。函数体是 `return null;`，注释（:60）称"此同步口保留给测试/极端降级场景"；`test/` 目录 grep 无引用。
- **建议**：删除；或真写一个消费它的降级测试。
- **风险**：低。

### A3. `DSH_BROWSER_KIT_SCHEMA_SOURCE` — 计数 1，无任何读者
- **位置**：`plugin/plugin-config.schema.mjs:106`
- **事实**：计数 **1**（仅导出行）。kit-status / host.impl / client 均不读取。
- **建议**：删除，或接入 kit-status 诊断输出（若当初意图是暴露 schema 解析状态）。
- **风险**：低。

### A0（排除项，避免后人误删）：`plugin/noop.js` 非死文件
- 内容仅 `noop-placeholder`（18 字节），全仓唯一引用在 `src/hid-bridge.mjs:26`：`createRequire(path.join(here, '..', 'plugin', 'noop.js'))`——作为解析 plugin/node_modules 的 require 锚点。
- **建议**：给 noop.js 补一行头注说明"createRequire 锚点，勿删"，防未来审计误判死文件（本次审计即差点误判）。

---

## 二、重复实现（正典 vs 残余副本）

### B1. basename 逻辑第 3 份：`src/tool-presentation.mjs:49-52`
- **正典**：`src/shot-view.mjs:10` `baseName`（计数 27，含 client 内嵌 parity 副本 client.js:5943——这对是 A1 模式合法副本）。
- **残余副本**：`presentResultOf` 内联 `Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/')); s.slice(i+1)`，与正典逐字等价但未复用。
- **建议**：`tool-presentation.mjs` 与 `shot-view.mjs` 同在 src/（纯 ESM），可直接 `import { baseName } from './shot-view.mjs'`。**风险**：低，两实现逐字相同。

### B2. 字节格式化第 2 份：`plugin/client.js:5815` `fmtBytes`
- **正典**：`SHOT_VIEW.humanBytes`（同文件 ：5977 已有）。`KitPanelCard` 的 `fmtBytes` 与其语义重叠。
- **行为差异**（非逐字等价）：①KB 精度 `toFixed(1)` vs 正典 `Math.round`（如 1536B → "1.5 KB" vs "2 KB"）；②`0` 输出 `"0 B"` vs 正典 `''`。面板展示 0 字节目录时两者都合理，但口径不同。
- **建议**：改用 `SHOT_VIEW.humanBytes` 前先确认 "0 B" vs 空串哪个是想要的展示；若刻意保留 fmtBytes，加注释声明豁免。**风险**：低（纯展示）。

### B3. `errOf` 逐字重复两份 + 弱化变体 `msg`
- `plugin/browser-tools.host.mjs:31` 与 `plugin/host.impl.mjs:54` 的 `errOf` **逐字相同**（`e.code: e.message` 优先）；`host.impl.mjs:51` 另有 `msg`（不带 code 前缀）。
- **建议**：抽到小共享模块（host 侧可静态 import，无 client 限制）；至少在两处互注"与 xxx 相同，改需同步"。**风险**：低。

### B4. ID 生成 3 处内联变体（刻意分化 + 顺手漂移混合）
- `plugin/client.js:6430`：`'d' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)`
- `plugin/host.impl.mjs:709`：`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
- `src/element-annotator.js:1612`：`"a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)`
- 前缀 `d`/`a`/无 是命名空间区分（**刻意 ✓**）；随机段 4/6/5 位与分隔符各异（**顺手漂移 ✗**）。
- **建议**：统一随机段长度（如 6 位）并各加一行注释指明前缀约定；不建议强行抽工厂（三处运行环境不同：client / host / 注入页）。**风险**：无。

### B5（豁免记录）. `summarizeSetsForDelivery`（`plugin/annot-delivery.host.mjs:166`）vs 正典 `summarizeSets`（`src/annotations-summary.mjs:11`）
- 同核（gid 去重 + index 升序），但交付版多"dirty 过滤 + 按窗口分组计数"，字段映射也不同——**刻意分化**，头注已写明"两处口径必须一致"。
- **建议**：两处头注互相链接（现在只有交付版单边提到），防单边演进。

---

## 三、常量漂移对照表

| 常量 | 位置 1 | 位置 2 | 判定 |
|------|--------|--------|------|
| 命令默认超时 25000 | `browser-tools.host.mjs:98`（形参缺省） | `browser-tools.host.mjs:834`（`spec.timeoutMs \|\| 25000`） | **漂移 ✗**：同一语义两处独立硬编码，改一处必漂。建议提 `DEFAULT_CMD_TIMEOUT_MS` |
| browser_wait 页内上限 60000 vs 宿主期限 70000 | `:509`（参数描述"默认 8000，上限 60000"） | `:506`（spec `timeoutMs: 70000`） | 分层有意（宿主=页内+余量），但 **10000 余量无注释来源**；"默认 8000" 在页内脚本侧，未在本次核验范围 |
| trace 环形 200 条 | `src/hid-bridge.mjs:59` | `wire.host.mjs:54` 文档 | 一致 ✓ |
| hidRead 缺省 500ms | `wire.host.mjs:50` 文档 | `src/hid-bridge.mjs:140`（`: 500`） | 一致 ✓ |
| 截图内联上限 4MB | `host.impl.mjs:848`、`wire.host.mjs:42` 注释 | `client.js:4958`（b64 路径） | 一致 ✓（均 `4*1024*1024`） |
| 批注回执文件 2MB / 尾部 2000 行 / 扫 400 行 | `host.impl.mjs:589-592` | 注释与 `readCommandResultImpl` 缺省 400（`browser-tools.host.mjs:50`） | 一致 ✓ |
| 批注工具 32000 vs 交付内联 24000 | `browser-tools.host.mjs:304` `ANNOT_TOOL_LIMIT` | `annot-delivery.host.mjs:116` `INLINE_LIMIT` | 不同通道、命名已区分 ✓ |
| 胶囊队列 100 / trace 200 / 预览 12 张 24MB | `client.js:1482` / `hid-bridge.mjs:59` / shot-view 正典+副本 | — | 各自单点定义 ✓（预览 12/24MB 是正典↔副本 parity 对，属 A1 模式合法） |

---

## 四、注释与实际不符（6 处）

1. **`wire.host.mjs:4`**："face 契约共 8 方法" → `FACE_METHOD_TABLE` 实际 **18 条**。改数字即可。
2. **`wire.host.mjs:59-71`**：`createRemoteFace` 的 JSDoc `@param` hooks 只列 10 个，漏 `onShotDataUrl` / `onGetHidShim` / `onHidList/Open/Read/Write/Close/Trace` 共 8 个（:72 解构签名里有）。补齐。
3. **`browser-tools.host.mjs:803` ↔ `src/tool-presentation.mjs:11-18` 互相矛盾**：前者写"缺它则 `tool.call.toolview` 的 keyed 分派不触发 ✗"；后者头注已**引 asar README 逐字更正**该说法为误判（"Host presentCall/presentResult 不会进入 Client…不是分派开关"，真因是 block.call 包裹）。前者是更正前的旧结论，未回改。建议 803 改为："官方契约要求（宿主侧展示）；不影响 client 渲染（归因更正见 src/tool-presentation.mjs 头注）"。
4. **`src/hid-bridge.mjs:188`**：hidCloseAllImpl 头注"host impl 卸载/热换时调用"→ 无调用方（见 A1）。
5. **hidTrace 返回形状文档缺字段**：签名串（`wire.host.mjs:54`、`client.js:99`）只写 `trace:[...]`，实现（`src/hid-bridge.mjs:201-208`）还返回 `handles`。文档补 `handles?` 或实现侧注明 handles 为调试附加字段、不属契约。
6. **`plugin-config.schema.mjs:60`**："保留给测试" → test/ 无引用（见 A2）。

---

## 五、签名冗余

| 位置 | 事实 | 判定 |
|------|------|------|
| `browser-tools.host.mjs:808` `presentResult: (args, result) => presentResultOf(spec.name, result)` | `args` 未用 | **刻意忽略 ✓**（官方契约固定两参签名，见 src/tool-presentation.mjs:6-9） |
| `browser-tools.host.mjs:376` `render: (args, value)` | `args` 未用 | **刻意忽略 ✓**（官方 render 契约） |
| `src/hid-bridge.mjs:201` hidTraceImpl 返回 `handles` | 描述符/TYPERT 文档均未声明 | 归入 D5（文档欠账，非签名错误） |
| 其余 src/ 全部导出 | 计数均 ≥ 2（mirrorPlacement 20、planPaneSync 24、faceUnwrap 32、hid*Impl 2-4、workspacePathOf 2 等） | 无死参数/无死导出（除 A1-A3） |

未发现"返回值被遗忘未处理"型问题：`hidCloseAllImpl` 的返回值问题是**无人调用**（A1），不是调了不接。

---

## 六、两端一致性：FACE_METHOD_TABLE ↔ REMOTE_CONTRIBUTION.descriptors

**逐项比对结果（18 方法 × 名称/参数/可选/形状）**：

- 方法名 18/18 一致 ✓（reportClient, saveShot, saveAnnotations, saveMerged, deleteAnnotations, getStats, clearArtifacts, shotDataUrl, getInjectScript, takeCommand, commandResult, hidList, hidOpen, hidRead, hidWrite, hidClose, getHidShim, hidTrace）。
- 参数名与顺序 18/18 一致 ✓；可选参数集合一致（仅 `saveAnnotations.meta`、`hidRead.timeoutMs` 两处 `acceptsUndefined: true`）✓。
- id/service/namespace/invocation/codec 形状逐字段一致 ✓（client.js:100-127 与 wire.host.mjs:151-173 同构）。
- `FACE_NAME` 两端均为 `'dshBrowserKit'`（client.js:37 / wire.host.mjs:23）✓。

**signature 字符串不一致 5 条**（两端注释均声称"逐字对账" ⇒ 名不副实，属 D 类；仅注释文案，无行为影响）：

| 方法 | wire.host.mjs | client.js | 差异 |
|------|--------------|-----------|------|
| takeCommand | :45 `…\|{ok:true, command:null}\|…（命令通道：取走即删）` | :96 `…（command=null 表示无命令）` | 文案两样 |
| saveMerged | :37 `（多面板批注合并：…` | :79 `（多面板合并：…` | "批注"两字 |
| hidOpen | :49 `（独占打开设备，返回句柄 id 供 read/write/close 引用）` | :92 `（独占打开设备）` | client 版缺后半句 |
| hidRead | :50 `…error:"timeout"…（阻塞读一次上报，timeoutMs 缺省 500）` | :94 `（读一次上报，超时返回 timeout）` | client 版缺缺省值与 error:"timeout" 明示 |
| hidTrace | :54 `（…环形 200 条——通讯调试）` | :99 `（桥收发 trace）` | client 版缺环形上限 |

**27 个工具的 output / presentCall / presentResult**：`registerBrowserTools` 对 `BROWSER_TOOL_SPECS` 全量循环统一注入 `output: OUT`（:805，OUT 定义 :374）与 `presentCall/presentResult` 包装（:807-808，缺省兜底 :789-790 加载失败退化 generic）✓。规格表实数 27 条（:429-727），与注释"27 个工具"（:797）一致 ✓。无遗漏工具。

---

## 七、src/ 正典 ↔ client 内嵌副本逐函数比对

| 正典 | 内嵌副本 | 判定 |
|------|----------|------|
| `src/shot-view.mjs`（baseName/shotNameOf/humanBytes/createShotStore） | `client.js:5941-6019`（@shot-view-canonical-begin/end 标记） | **逐行等价 ✓**（4 函数含 try/catch、兜底顺序、12/24MB 双闸全同；对拍 test/shot-view.test.mjs） |
| `src/annotator-consume.mjs:13` planChipConsume | `client.js:1461-1466`（canonical 标记） | **逐行等价 ✓** |
| `src/annotations-summary.mjs:11` summarizeSets | `client.js:2373-2395`（canonical 标记） | **功能等价但两处微小漂移 ✗**：①内嵌副本缺 `Array.isArray(sets) \|\| []` 兜底（正典 :12 有）——传非数组时内嵌副本抛 TypeError；②截断长度硬编码字面量 `60`（正典用 `SUMMARY_TEXT_MAX` 常量）。parity 测试（test/annotations-summary.test.mjs:57-63）只做正常形状 fixtures 对拍，覆盖不到差异 ① |
| `src/session-id.mjs` sessionIdOfAgent | **无内嵌副本** | ✓ 唯一实现：宿主两侧（browser-tools.host.mjs:26/:390、annot-delivery.host.mjs:33/:262）均 import 正典；client 侧用的是 `annotScopeId()`（会话身份语义不同，非副本） |

**建议**：client.js:2373 补 `const list = Array.isArray(sets) ? sets : []` 与正典对齐，并在 test/annotations-summary.test.mjs 加一个非数组 fixture（内嵌副本提取后喂 `null`/`42`，正典应返回 []）。

---

## 八、Top 10 低风险可立即执行项

1. **删** `hidCloseAllImpl`（`src/hid-bridge.mjs:190`，全仓引用计数 **1**=仅定义行）；或改为在 host.impl 卸载路径接线（顺带修句柄泄漏，见 A1）。
2. **删** `resolveSchemasterySync`（`plugin/plugin-config.schema.mjs:57`，计数 **1**，test/ 零引用）。
3. **删** `DSH_BROWSER_KIT_SCHEMA_SOURCE`（`plugin/plugin-config.schema.mjs:106`，计数 **1**，无读者）。
4. **去重**：`src/tool-presentation.mjs:49-52` 改 `import { baseName } from './shot-view.mjs'`，消除第 3 份 basename（两实现逐字相同，零行为风险）。
5. **提常量**：`plugin/browser-tools.host.mjs:98` 与 `:834` 的 `25000` 合并为 `DEFAULT_CMD_TIMEOUT_MS`（同一语义两处独立硬编码）。
6. **去重**：`plugin/client.js:5815` `fmtBytes` 改用同文件 `SHOT_VIEW.humanBytes`（先确认 "0 B" vs 空串展示口径，或加豁免注释）。
7. **改注释**：`plugin/wire.host.mjs:4` "共 8 方法"→"共 18 方法"（表实有 18 条）。
8. **补 JSDoc**：`plugin/wire.host.mjs:59-71` 补齐缺失的 8 个 hooks 参数（onShotDataUrl/onGetHidShim/onHid* 六件套）。
9. **改注释**：`plugin/browser-tools.host.mjs:803` 的"keyed 分派不触发"说法已被 src/tool-presentation.mjs:11-18 引 asar 文档证伪，改写为"官方契约要求 + 归因更正见正典头注"。
10. **补守卫**：`plugin/client.js:2373` 内嵌 summarizeSets 补 `Array.isArray` 兜底（正典 src/annotations-summary.mjs:12 已有），并在 test/annotations-summary.test.mjs 增非数组 fixture 锁 parity。
