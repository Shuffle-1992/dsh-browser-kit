# dsh-browser-kit 重构评审报告（R1-R4 + 研究项）

> 评审执行：ZCode（纯评审，零代码改动）· 评审日期：2026-10-06
> 评审对象：HEAD `613bd97`（工作区干净）· 验收与实施：实施会话
> 纪律遵守：本报告为唯一交付物；评审过程未修改/新建/删除任何仓库文件（asar 调查经内联脚本只读完成，零落盘）。

## 0. 基线核实（先行更正一项任务书数字）

- **实际测试基线：111/111 全绿**（`npm test` 实测），非任务书所写 112。差异根因：`613bd97` revert 删除了「消息引用插入」契约块（test/plugin-impl.test.mjs −25 行，恰 1 个 t.test）后计数未同步。本报告全文以 **111** 为准；「不放宽现有测试断言」的禁令按 111 项执行。
- 文件规模实测：`plugin/client.js` 2386 行、`plugin/host.impl.mjs` 732 行、`plugin/entry.mjs` 66 行、`test/plugin-impl.test.mjs` 683 行——与任务书 §1 一致。
- 行号说明：以下所有行号以 `613bd97` 实际文件为准（已逐一核对）。

## 1. R1 评审：种子清单核实 + 问题清单

### 1.1 种子清单核实结果（§4 六项）

| # | 种子 | 核实结论 |
|---|---|---|
| 1 | 认领制重复 ×3 | **属实**。`ownerBootOf/iAmNewer` 在 ensureAnnotChip（833-834）、ensureAwayBanner（940-941）逐字重复；ensureToolbarButtons（2212-2214）为第三份但形态不同（内联 `owner === myBoot \|\| (owner && owner > myBoot)`，且语义有意差异：工具条对无主/更旧按钮**拆除重挂以接管路由**，胶囊/横条对更新实例**退让**）。收敛点见 [R1-01]。 |
| 2 | 死代码嫌疑 | **属实（stopAllPanes）**：定义于 1238-1247，全仓 grep 仅 1192 行注释提及，**零调用者**（sessionSettled 已改为逐面板 stop+clearAll）。`lastUserRowText`：**无残留** ✓。 |
| 3 | tick 巨循环 | **属实**。2s interval 回调 2281-2331（约 50 行），混合 6 种职责：心跳（tickAt）、面板刷新、胶囊/横条维护、工具条样式同步、成员自愈（重注入+续编号）、自动加入。拆分方案见 [R1-02]。 |
| 4 | stateRef 无文档 | **属实且范围更大**。stateRef 声明于 507-524 共 16 字段，仅 4 个有行内注释（annot/chip/sentChips/autoShotLeft）；另有 7 个后置字段散落各处赋值（toolbarBtnCount/tickAt/cardRender/lastPrime/chipGate/_t/ensureToolbarButtons）无任何汇总文档。见 [R1-04]。 |
| 5 | 魔法串 | **部分属实（有一处已过时）**：标题剥离正则现仅 1 处（789，convoTitle）——种子的「2 处」应是把已 revert 的引用/导出代码计入了。仍存在的重复：`'[class*="_bubble"]'` ×2（1146/1158）、`'[data-dsh-kit-ann-msg]'` ×2（1147/1159）、contenteditable 可见候选选择器 ×2（730/791）、`'form[class*="toolbar"]'` ×3（1644/1647/2201）。见 [R1-06]。 |
| 6 | 测试单文件 683 行 | **属实**。结构：57-391 为 host.impl `_internals` 单测（8 个顶级 test），396-479 为 wire TYPERT 形状，484-683 为 client.js 静态契约（一个父 test 含 12 个子块）。拆分建议见 [R1-07]。 |

### 1.2 问题条目（编号条目，格式按任务书 §2.1 强制）

### [R1-01] 认领制 helper 三处重复，一处语义漂移风险
- 位置：plugin/client.js:833-834（ensureAnnotChip）、940-941（ensureAwayBanner）、2212-2214（ensureToolbarButtons）
- 问题：`ownerBootOf/iAmNewer` 两份逐字重复；工具条第三份为内联变体——其 `owner === myBoot || (owner && owner > myBoot)` 保留条件与 `iAmNewer` 的 `!owner || myBoot >= owner` 在「无主元素」分支行为相反（工具条拆除接管、胶囊/横条视为可管理）。三处语义并存且无文档说明差异是有意设计，下一个新增浮层（横条已证明会照抄胶囊）大概率再复制一份。
- 建议方案：在胶囊区（CHIP_ID 附近）提一份闭包级共享 `const ownerBootOf = (el) => …` 与 `const iAmNewer = (el) => …`（P37 语义注释随行），三处改为引用；工具条的无主-接管语义保留在其本地（加一行注释说明「无主按钮要拆重挂路由 click，故不用 iAmNewer」），仅复用 `ownerBootOf`。不改任何判定行为。
- 风险：低——纯引用收敛。防范：收敛后跑全量测试（静态契约 2d/2e 块会钉住 `dataset.ownerBoot` 与 `iAmNewer` 的关键行，注意 606-607 行的两条正则锚定的是实现行文本，收敛后需确认仍匹配——断言不得放宽，必要时锚点随实现行同步，属「移动断言」而非放宽）。
- 优先级：P1

### [R1-02] tick 巨循环六职责耦合，拆具名子函数
- 位置：plugin/client.js:2281-2331（2s interval 回调体）
- 问题：心跳诊断、refreshPanes、胶囊/横条维护、工具条样式同步、成员自愈（4s/8s 超时竞速的重注入+续编号）、自动加入六种职责内联在一个 async 回调里；`autoJoinBusy` 守卫只包住后半段，前半段与后半段的失败域无法区分；维护时任何新浮层都要再往里塞一行（横条接线即如此生长的）。
- 建议方案：拆为同作用域具名子函数——`tickChipLifecycle()`（refreshPanes + ensureAnnotChip + ensureConvoChips + ensureAwayBanner，227-2287 行那四行）、`tickToolbarStyles(activeIds)`（2291-2301）、`tickSelfHealAndAutoJoin(st, activeIds)`（2302-2330，含 autoJoinBusy 守卫与 withTimeout 逻辑原样搬移）；interval 回调体收敛为按序调用 + `stateRef.tickAt` 心跳。**interval 周期 2000ms 与执行顺序保持逐字不变**（禁令：不改 interval）。
- 风险：低——纯搬移不改逻辑；但自愈段内 `await withTimeout(...)` 的异常吞噬语义必须逐字保留（catch 空块注释「下轮再试」）。防范：拆分前后各跑一轮 `node --check` + 全量测试（client 静态契约不锚定 tick 内部行，无断言风险）+ 实施会话真机一轮批注自愈回归。
- 优先级：P1

### [R1-03] 归属行匹配的热路径成本：每模型 × 每行 × 每 tick 的 rowKey 全量重算
- 位置：plugin/client.js:1120（rowKey 定义）、1156（`rows.find((r) => rowKey(r) === model.attachedKey)`）
- 问题：ensureConvoChips 第 2 段对 **queue 里每个模型**做一次 `rows.find(rowKey)`——rowKey 对每行的 `textContent` 做正则替换 + slice(0,120)。queue 上限 100、会话行数十，最坏每 2s 做 100×50 次行文本正则处理；这些行文本在**同一 tick 内不变**，属于重复计算。同时 rowKey 的键数组在消耗检测段（1133 的 sig）已经算过 first/last，中段行键全部弃用。
- 建议方案：ensureConvoChips 开头一次 `const rowKeys = rows.map(rowKey);`，sig 与第 2 段 find 共用（`rows[rowKeys.indexOf(model.attachedKey)]`）；indexOf 找不到返回 -1 时跳过（与现行为 `undefined` 一致，注意 `rows[-1]` 为 undefined，判断 `idx < 0` 更稳）。
- 风险：低——同一 tick 内行文本不可能变化（同步代码段），键数组与逐行重算严格等价。防范：单消耗回归一轮（提交→发送→胶囊落位）。
- 优先级：P1

### [R1-04] stateRef 字段无文档 + 后置字段游离
- 位置：plugin/client.js:507-524（声明处）、841（chipGate）、723/755（lastPrime）、2248（toolbarBtnCount）、2002（_t）、2282（tickAt）、2081/2092/2095/2169（cardRender）、2251（ensureToolbarButtons）
- 问题：16 个声明字段仅 4 个有注释；7 个后置字段在运行途中散挂到 stateRef 上，无任何一处能看全模型形状——新人（或评审者）必须通读 2400 行才能知道 stateRef 有什么。`_t` 这种单字母字段更是无处可查。
- 建议方案：stateRef 声明上方加一个字段文档块（字段/类型/写入点/读取点一览，含后置字段），声明处给无注释字段补齐行内注释；后置字段中 `_t` 改名为 `autoProbeTimer`（仅一处读写，2002/2003）。纯注释与改名，不动逻辑。
- 风险：几乎为零（注释 + 单处改名）；改名需同步 grep 确认 `_t` 无其他引用（已核：仅 2002/2003 两行）。
- 优先级：P1

### [R1-05] contenteditable 可见候选查询两份，C7 纪律被自己的注释戳穿
- 位置：plugin/client.js:730（primeSessionInput）、790-793（findComposer）
- 问题：同一选择器串 `'[contenteditable="true"],[contenteditable="plaintext-only"],[contenteditable=""]'` + `isVisibleEl` 过滤出现两份；695-697 注释明言「primeSessionInput 与 findComposer 共用，勿再各写一份」指的是 isVisibleEl，但**选择器本身**仍是两份——选择器漂移（如 DSH 未来加 `contenteditable="inherit"`）会改一处漏一处。P36 的教训（重命名漏改）正是这种重复的必然结局。
- 建议方案：提取 `const visibleCEs = () => Array.from(document.querySelectorAll(CE_SEL)).filter(isVisibleEl);`（`CE_SEL` 常量承载选择器串）；primeSessionInput 用 `const ces = visibleCEs()`（保留 candidates 诊断计数），findComposer 用 `visibleCEs()[visibleCEs().length - 1]`（或 `ces.pop()`，注意只求值一次）。
- 风险：低——语义逐字等价。防范：P36 回归钉（`doesNotMatch(/filter\(visible\)/)`）与输入框提示回归（提交后 primeSessionInput 落地）各跑一次。
- 优先级：P2

### [R1-06] 跨 DOM 语义选择器未常量化（种子 5 修正版清单）
- 位置：`'[class*="_bubble"]'` 1146/1158；`'[data-dsh-kit-ann-msg]'` 1147/1159；`'form[class*="toolbar"]'` 1644/1647/2201；contenteditable 选择器见 [R1-05]；标题剥离正则 789（已单点，无需动作）
- 问题：这些是「CSS-module 哈希前缀 + 稳定后缀」的宿主结构契约，散落字面意味着 DSH 结构调研更新时（如 `_bubble` 改名）要全文件 grep；且两处 `_bubble` 分属消耗检测与补挂两段，改一漏一会直接复刻「消耗了但补挂不认」类症状。
- 建议方案：文件顶部（或各分区头）常量化：`const BUBBLE_SEL = '[class*="_bubble"]'`、`const MSG_CHIP_MARK = '[data-dsh-kit-ann-msg]'`、`const TOOLBAR_SEL = 'form[class*="toolbar"]'`，逐处替换为常量引用（字符串内容逐字不变）。
- 风险：低——纯字面收敛；静态契约锚定 `'[class*="_userRow"]'` 的 587 行断言锚的是 userRows 定义行，不受影响；2c 块锚定 `target.querySelector('[class*="_bubble"]') || target`（601 行）——常量化后该行变为 `target.querySelector(BUBBLE_SEL) || target`，**断言锚点需随实现行同步**（移动断言，非放宽）。
- 优先级：P2

### [R1-07] 测试单文件 683 行按域拆分
- 位置：test/plugin-impl.test.mjs（57-391 host.impl 单测 / 396-479 wire TYPERT / 484-683 client 静态契约）
- 问题：三个测试域混在一文件，client 契约块（最长且增长最快——横条/导出等每功能 +1 块）持续推高文件规模；`node --test` 默认发现模式天然支持多文件。
- 建议方案：仅移动断言、不重写——`test/plugin-impl.test.mjs`（保留 host.impl `_internals` 单测 + wire TYPERT，57-479 行域）+ 新增 `test/plugin-client-contract.test.mjs`（搬 484-683 的 clientSource 父块，`clientSource` 读取逻辑一并搬移）。两个文件都命中 `node --test` 默认发现。
- 风险：低——测试发现自动覆盖新文件；但既有文档/任务书引用「plugin-impl.test.mjs 行数/条数」的表述会过时（含本报告 §0），实施会话采纳时同步口径。**注意：新增测试文件属实施会话执行范围，非本评审动作。**
- 优先级：P2

### [R1-08] sessionMaxIndex 未先 refreshPanes，死节点静默跳号风险
- 位置：plugin/client.js:662-671（sessionMaxIndex）；调用点 1301（joinPane）、2313（tick 自愈）
- 问题：直接遍历 `stateRef.annot.panes` 取号，未先 `refreshPanes()`。tick 自愈路径 tick 开头已刷新（2284）故安全；但 joinPane 在 `st.panes.push(target)` 之后调 sessionMaxIndex（1301），此时既有成员若含被 DSH 重渲染替换的旧节点（P27 场景），其 `executeJavaScript` 抛错被 catch 静默跳过 → maxUsed 偏小 → 新成员编号与页内实际最大号冲突（回到 P26 家族症状的温和变体）。
- 建议方案：sessionMaxIndex 开头加 `refreshPanes();`（与 mergeAndSave 1253 行同款做法——mergeAndSave 已有此纪律，sessionMaxIndex 是漏网的那个）。
- 风险：极低——refreshPanes 幂等且 joinPane 场景已保证 active。防范：真机两窗口重渲染场景回归一轮（实施会话）。
- 优先级：P3

### [R1-09] 诊断句柄未覆盖 ensureAwayBanner
- 位置：plugin/client.js:2018-2024（window.__dshKitClientDiag）
- 问题：诊断句柄只挂 `ensureAnnotChip/ensureConvoChips`；横条（1.6.x 新增）的 ensureAwayBanner 是闭包内 const，实施会话经 gui-eval 无法手动触发自检（「横条为什么不出现」类问题少一个取证抓手）。
- 建议方案：诊断句柄补 `ensureAwayBanner` 一行（与现有两项并列）。
- 风险：零——只增诊断面。
- 优先级：P3

### [R1-10] C2 拆表遗留的格式债：commandHandlers 分隔与缩进破损
- 位置：plugin/client.js:1499-1850（commandHandlers 表，条目间 `,` 悬挂在独立行 + 函数体缩进错位）；另 614 行 pickGuestEl 收尾 `};` 缩进异常
- 问题：1499-1850 的表条目形如 `'inject-annotator': async function (svc, c) {\n      await …\n    }\n    ,`——函数体缩进比键名多 4 列、逗号悬挂在下一行行首。这是 C2 从 switch 拆表时的机械搬移痕迹，阅读 diff 与审阅逐条 case 时噪音很大（A6 静态契约的对账表 654 行已钉死键清单，格式修复零语义风险）。
- 建议方案：纯格式化——键名/函数体对齐、逗号跟随条目尾（`},`），`node --check` + 全量测试护航；614 行缩进一并修。
- 风险：零语义风险（纯空白字符）；唯一风险是 diff 噪音大，建议单独一个格式化 commit。
- 优先级：P3

### [R1-11] 文件头注停留在 MVP-0 叙事，与 2386 行现状脱节
- 位置：plugin/client.js:1-15
- 问题：头注五点职责（探测/上报/面板…）是 MVP-0 时期的描述；现文件含共享批注会话、胶囊/横条、命令通道（23 action）、插件管理卡片、工具条注入等五大分区，无分区导航图。新会话按头注索引代码会迷路。
- 建议方案：重写头注为「分区导航图」：按现有 `/* ─────── 分区名 ─────── */` 注释列出各分区行号区间与一句话职责，保留「全部兜底不许冒泡」与「样式零字面色值」两条总纪律。纯注释。
- 风险：零；唯一代价是行号区间随代码漂移需偶尔维护（建议导航图只写分区名不写行号，规避维护成本）。
- 优先级：P2

## 2. R2 意见：简化（删死代码、并重复、命名统一）

### 2.1 删死代码（种子 2 落实）
| 项 | 位置 | 改法 | 风险 | 优先级 |
|---|---|---|---|---|
| stopAllPanes 整函数 | client.js:1238-1247 | 删除（全仓零调用者，唯一引用是 1192 注释；该注释一并改写为「旧实现（stopAllPanes，已删）的 clear()…」保留历史语义）。 | 零——dead code；`node --check` 护航。 | P1 |
| stateRef.toolbarBtn 死字段 | client.js:516 | 删除（声明后全文无读写；工具条用的是 toolbarBtnCount 与局部变量 btn）。 | 零。 | P1 |

### 2.2 并重复
| 项 | 位置 | 改法 | 风险 | 优先级 |
|---|---|---|---|---|
| captureShot 的 guest meta 表达式与归一化自写一份 | client.js:1937-1938 vs 700-701 | 1937 改用 `GUEST_META_JS`（表达式逐字相同），1938 改用 `metaOf(m) \|\| { url: null, title: null }`（C8 助手本为此而生）。 | 极低——表达式逐字一致。 | P3 |
| ×关闭按钮样式 + hover 危险色 style 标签双份 | client.js:862-880（胶囊）vs 1081-1099（消息胶囊） | 提 `makeCloseButton(title)`（createElement+样式+type/title）与 `ensureChipDangerStyle()`（style 标签幂等插入，两处 id 合一——`dsh-kit-annot-chip-style` 的选择器 `[data-dsh-kit-ann-msg] [data-role=close]:hover` 已覆盖两种容器，合一后连胶囊自己的 hover 也走同一条规则，需把选择器改为两容器通配）。 | 低——纯样式；真机核对 hover 变红即可。 | P2 |
| 系统字体栈字面 ×9 | client.js:857/961/1011/1076/1801(无)/2157… 等（`12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif` 及其 1.5 变体） | T 增加两个出口：`T.font = '12px/1.4 …'`、`T.fontLh = '12px/1.5 …'`（T 是本项目字面出口的既有先例，注释注明「系统字体栈，非主题令牌」）。逐处替换。 | 低——字符串逐字等价；真机看一眼面板/胶囊无样式漂移。 | P2 |

### 2.3 命名与文档统一
| 项 | 位置 | 改法 | 优先级 |
|---|---|---|---|
| `_t` → `autoProbeTimer` | client.js:2002/2003 | 见 [R1-04]。 | P1（并入该条） |
| 文件头注重写为分区导航图 | client.js:1-15 | 见 [R1-11]。 | P2 |
| host.impl：`log(r.ok ? 'warn' : 'warn', …)` | host.impl.mjs:687 | clearArtifacts 日志两分支同为 'warn'，疑似笔误（成功应是 'info'，与同文件 659/664/669 等同款三元一致）。 | P3 |
| host.impl：`state.shots` 无上限累积 | host.impl.mjs:604/658 | 每次saveShot push 一条元数据，长驻进程不清理；cap 至最近 50 条（`if (state.shots.length > 50) state.shots.splice(0, …)`），与 client sentChips 的 1131 行同款纪律。 | P3 |

## 3. R3 意见：解耦（纯逻辑抽取候选，A1 先例模式）

> A1 先例 = `src/annotator-sync.mjs` 正典 + client.js 内嵌副本（`@annotator-sync-canonical-begin/end` 锚注释，1363-1426）+ `test/annotator-sync.test.mjs` 全分支单测 + parity 对拍。以下候选全部遵守：只抽**纯逻辑**（含 DOM 的部分留在 client，参数注入）；新增 `src/<name>.mjs` 正典不影响 client 单文件形态（禁触条款不受挑战——研究项 A 已确认相对 import 不可行，正典文件仅供 Node 测试与 host 侧 import，client 永远跑内嵌副本）。

### [R3-1] 消耗判定 `planChipConsume(sig, base)` → `src/annotator-consume.mjs`
- 抽取内容：ensureConvoChips 第 1 段的判定核心（client.js:1137-1151 的 `sameView` / 行数增长 / 末行变化 / 视图重置四分支），收敛为纯函数：
  `planChipConsume(sig, base) → { action: 'consume' | 'reset' | 'idle' }`（sig/base 均为 `{n, first, last}` plain object；判定规则：`base` 缺省视为 idle；`sig.first !== base.first` → reset；`sameView && (n > base.n \|\| (last !== base.last && n >= base.n))` → consume；否则 idle）。
- 纯度论证：**全部参数注入**——sig 由 client 的 `userRows()+rowKey()` 构建（DOM 留在 client），base 来自 `stateRef.chip.base`（模型态留在 client）；函数体零 DOM/零状态读写（现实现内联消费/重置的副作用留在 client 调用侧：consume → push queue + `stateRef.chip = null` + removeAnnotChip + 落位；reset → `m.base = sig`）。
- 预期单测用例（src 版全分支）：① 无 base → idle；② 顶行键变化（切会话/虚拟化重组）→ reset；③ 同视图行数增长 → consume；④ 同视图末行变化且 n ≥ base.n → consume；⑤ 同视图行数与末行均不变 → idle；⑥ base.n > sig.n（行数减少——消息被删/虚拟化收窄）且末行未变 → idle（现语义防误耗，单测钉死）。
- 现实收益校准：判定现仅 ~10 行，抽取的主要价值是把「误耗/漏耗」这个踩过两次坑（跨会话误耗、末行键跨视图比对）的判定固化成可单测契约，防未来改动靠真机回归。属**语义保险**型抽取。
- 风险：低——parity 对拍防漂移（A1 同款）；client 侧行为逐字不变（判定结果消费方式不变）。
- 优先级：P2

### [R3-2] 提交摘要 `summarizeSets(sets)` → `src/annotations-summary.mjs`
- 抽取内容：mergeAndSave 的摘要构建（client.js:1270-1287）：gid 去重 → `{index, gid, selector, text(≤60, text 回退 accessibleName), url}` → 按 index 升序。
- 纯度论证：输入 `sets`（plain array，client 从各面板收集）；无 DOM、无状态；`60` 截断与去重规则常量化在函数内。
- 附加价值（超出 client 自身）：**host 侧 saveMergedImpl 的 gid 去重（host.impl.mjs:408-419）与 client 摘要去重（1270-1285）是同一规则的两处实现**——抽出后 host 可直接 `import { summarizeSets } from '../src/annotations-summary.mjs'`（host 已有 `import buildAnnotationsMarkdown from '../src/annotations-protocol.js'` 的先例，host.impl.mjs:19），两端规则单点化；client 侧仍走内嵌副本 + parity（client 不能 import，见研究项 A）。注意 host 侧语义有细微差别（host 去重后重编号落盘、client 去重后排序展示）——抽的是「gid 去重 + 序化」公共核，重编号/展示映射留在各自调用侧，需在正典文件头注写清边界防误用。
- 预期单测用例：① 跨组同 gid 去重保序；② 无 gid 条目不去重；③ index 升序（含字符串数字容错）；④ text 空回退 accessibleName 再空为 ''；⑤ 60 字截断；⑥ url 取所属组。
- 风险：低——client 侧逐字等价搬移；host 侧属重构采纳项（需实施会话确认是否同轮做，host.impl 不在禁触清单）。
- 优先级：P2

### [R3-3] 评估后**不推荐**抽取的两项（诚实记录，防过度工程）
- `prettySel`（client.js:991-999）：9 行纯字符串函数，独立成文件的成本（正典+内嵌+parity 三份维护）大于收益；若 [R3-1] 落地且同域，可顺带迁入同一文件，否则不动。
- `rowKey`（client.js:1120）：3 行；热路径问题已由 [R1-03] 的键数组方案在 client 内解决，无需抽取。

## 4. R4 意见：优化（严格限定任务书四范围）

### 4.1 tick 内 DOM 查询收敛
实测每 2s tick 的全文档查询清单：`userRows()` ×1（1132）；`findComposer()` ×1-2（846/952——胶囊挂载时 + 横条 away 时各一，含 contenteditable 全查 + isVisibleEl 逐个 checkVisibility）；`refreshPanes()` → **每个成员各一次** `document.querySelectorAll('webview')`（647，livePane 内联——3 窗口 = 3 次）；`toolbarForms()` ×1（2201，querySelectorAll('form') + per-form querySelector('webview')）；自动加入段 ×1（2319，仅会话活跃时）。
**建议**：tick 回调顶部一次 `const webviews = Array.from(document.querySelectorAll('webview'));`，`refreshPanes` 改为接受可选参数 `refreshPanes(webviews)`（缺省时自取，保证非 tick 调用点 1200/1432 不受影响）；其余查询保持原位。**收敛仅限单 tick 内传参复用，绝不在 tick 间缓存节点**（禁令红线——P27 的教训就是旧节点跨时刻身份失配）。预期每 tick 全文档查询从 6-10 次降到 4 次左右（webview/contenteditable/form/message-rows 各一次）。
风险：低——livePane 的映射语义逐字不变；真机回归窗口批注自愈一轮。优先级：P2（配合 [R1-02] 拆分同轮做，搬移成本归零）。

### 4.2 重复选择器/正则常量化
清单见 [R1-06]（`_bubble` ×2、`[data-dsh-kit-ann-msg]` ×2、toolbar ×3、CE 选择器 ×2 [R1-05]）；**修正**：标题剥离正则已单点（789），种子「2 处」过时，无需动作。`_userRow` 已由 `userRows()` 单点承载（986），无需动作。优先级：P2。

### 4.3 document.addEventListener 注册点 dispose 审计
**审计结论：通过，零裸注册。** 全文件仅 1 处顶层事件注册：`window.addEventListener(PANEL_TOGGLE_EVENT, onToggle)`（309，React useEffect 内，return 已 `removeEventListener` ✓）。胶囊/消息胶囊/横条的 addEventListener 全部挂在**自有元素**上（随元素生死，无需 dispose）。两个 MutationObserver（1994-2012、2259-2267）均挂 `ctx.effect` disconnect ✓。五个 setInterval（1488/1899/1903/2268/2281）全部 `trackInterval` ✓（C6 已闭环）。历史注记：引用按钮的 document 委托监听已随 613bd97 revert 移除，无残留（grep 证实）。本轮无需动作。

### 4.4 热路径 JSON.stringify 审计
**审计结论：通过，一处低危备注。** 1.5s 同步循环（syncPanes）内的 stringify 仅 1464/1473 两处——且仅当 plan 产生推送/删除时执行，payload 为增量 items（正常 ≤ 数 KB）与单个 gid，量级安全；2s tick 主路径（胶囊/横条/工具条样式）无 stringify。命令/探测路径的 stringify（268/1509/1520/1888/1915 等）非热路径。**真正的热路径字符串成本在 rowKey**（`textContent.replace(/\s+/g,' ')` 每模型×每行×每 2s，见 [R1-03]）——这才是值得修的那一个。本轮 JSON.stringify 本身无需动作。

## 5. 研究项（只调查写结论，未动代码）

### 5.1 client 端相对 import（`import './x.mjs'`）可行性 —— **结论：不可行**
调查方法：只读探查 `D:\DeepSeek\resources\app.asar`（沿 `plugin/.data/asar-explore3.cjs` 的读取模式，内联脚本零落盘），定位并抽读 `@deepseek-ai/dsh-client-modules`（lib/client.js 40KB + lib/index.js 41KB）。
证据链：
1. **加载形态**：插件 client 半边是经典脚本工厂——`window.__ModuleLoader__.load({ id, factory(require) })`（本项目 client.js:16-18 即此形态）。`import` 声明在该形态下语法非法；factory 拿到的是**同步 require**（lib/client.js：「The synchronous `require` handed to factories walks the same order」）。
2. **require 只解析 boot graph 行**：非图内标识符直接抛错——lib/client.js@34840 附近：「not a row in the boot graph (the runtime mirror of the bundle purity gate)」。规格化仅认包名/`cordis:`/`node:`/URL（`exactPackageSpecifier`，@4383），**不存在相对说明符的解析域**（`stripClientSuffix` 把 `<id>/client` 归一到包名，@4844「a plugin bundle IS its package's client half」）。
3. **路由形态**：宿主 webserver 以 **combo script** 方式投放——lib/index.js@5621「serves one-or-more-plugin combo scripts plus their source maps…contributes…graph to the webserver's index injection table」；插件经 `package.json exports["./client"]` 被解析为相对产物路径（`clientExportOf`，@9332，本项目 plugin/package.json 即声明 `"./client": "./client.js"`）后**并入组合脚本**。页面上不存在「插件目录内逐文件可寻址」的 URL 路由——页内动态 `import('./x.mjs')` 的相对基是 GUI 文档地址（`dsh-app://app/`），不是插件目录。
4. **热换机制以单文件为前提**：`rebuilt(id)`（lib/index.js@27330）按 `record.meta.clientPath` 重读**单个**产物、`artifactRevision` 比对推进 rev、graph 行替换——多文件相对引用没有进入这个模型。
结论：`import './x.mjs'` 在当前 DSH 装载体系内**不可行**；任务书禁触条款「client.js 保持单文件（除非本研究证明可行且实施会话采纳）」的解禁条件**不成立**。代码共享唯一 sanctioned 形态维持 A1 模式（src 正典 + client 内嵌副本 + parity 对拍，R3 两项即按此表述）。附注：若未来 DSH 升级把 client 模块改为真 ESM URL 化（每文件可寻址），本研究结论需重评。
（调查过程合规声明：全程只读 asar，无文件落盘、无仓库改动。）

### 5.2 stopAllPanes 调用者核查 —— **结论：零调用者，可删**
定义于 client.js:1238-1247；全仓（plugin/ test/ docs/）grep 仅两处命中：定义本身与 1192 行注释（sessionSettled 里描述「旧实现 stopAllPanes(true) 的 clear()…」的历史对比）。sessionSettled 的单次消耗改造（1195-1200 逐面板 stop+clearAll+syncPanes 广播）已完全取代它。`lastUserRowText`：全仓零命中（无残留）。删除动作归入 R2 §2.1。

## 6. 交付自检

- `git status`：仅 `?? docs/refactor-report.md` 一项（本报告），无任何其他改动 ✓
- `npm test`：**111/111 全绿**（评审零代码改动的实证；任务书「112」为 revert 后未同步的过时计数，见 §0）✓
- 意见合规：全部建议未触碰禁触清单（entry.mjs/wire.host.mjs/plugin package.json/element-annotator.js/profile 与 composition/face 签名与 descriptors/零新依赖/单文件形态）；未提出任何禁令类型建议（无跨 tick DOM 缓存、无 interval 周期变更、无异步化改造、无打包器/TS、无测试断言放宽）✓
- 建议实施轮次汇总：**P1** = [R1-01][R1-02][R1-03][R1-04] + R2 §2.1 两项删除；**P2** = [R1-05][R1-06][R1-07][R1-11] + R2 §2.2 后两项 + [R3-1][R3-2] + R4 §4.1；**P3** = [R1-08][R1-09][R1-10] + R2 §2.3 三项。
