# dsh-browser-kit 全面审查报告（Review / Simplify / 强制优化 / 解耦）

> 审查执行：接手审查 agent（零代码改动，只出意见）· 审查日期：2026-10-06
> 评审对象：HEAD `d17ef4a`（工作区干净）· 后续流程：实施会话逐条采纳/驳回并亲自实施
> 纪律：全程未修改/删除任何文件；本报告是唯一新建文件；未触碰禁触清单、未含禁令类型。

## 0. 基线核实

| 项 | 任务书 §2 | 实测（d17ef4a） | 结论 |
| --- | --- | --- | --- |
| HEAD | `d17ef4a` | `d17ef4a`，工作区干净 | 一致 |
| 测试 | 125 项（124 + 1 已知 flake） | **125 项，124 通过 + 1 失败**（本轮实测失败项为 `hid-fixture-smoke` 的临时目录 EPERM，即任务书所述已知 flake） | 一致 |
| client.js | 2349 行 | **2416 行** | 任务书过时 |
| element-annotator.js | 1502 行 | **1654 行** | 任务书过时（审查已按实际全文通读） |
| host.impl.mjs | 660 行 | **733 行** | 任务书过时 |
| entry.mjs | 44 行 | 66 行 | 任务书过时 |
| wire.host.mjs / annotations-protocol.js / 测试文件数 | 144 / 236 / 12 | 一致 | 一致 |

上轮采纳项（§4 清单）已逐项在 HEAD 中验证生效：共享认领 helper、tick 三拆（`tickChipLifecycle`/`tickToolbarStyles`/`tickSelfHealAndAutoJoin`，client.js:2301-2360）、`rowKeys` 单次计算（1181）、`CE_SEL`/`BUBBLE_SEL`/`MSG_CHIP_MARK`/`TOOLBAR_SEL`、`T.font`/`T.fontLh`、`makeCloseButton`/`ensureChipDangerStyle`（823/836）、canonical 块三处（`@annotator-consume` 1151-1159、`@annotations-summary` 1300-1325、`@annotator-sync` 1402-1465）、诊断句柄含 `ensureAwayBanner`（2036-2041）、host `state.shots` 上限 50 与 clearArtifacts 日志级别修正（host.impl diff 实证）。已采纳项本轮均不重复报告。

---

## 1. Review 意见

### [R-01] 意见输入框的 Enter=确认 / Esc=丢弃键盘路径是死代码——被同容器的 capture 屏蔽层拦截，从未生效
- **位置**：`src/element-annotator.js:1175-1177`（container 的 keydown capture 屏蔽：`container.addEventListener("keydown", function (event) { event.stopPropagation(); }, true)`）与 `1182-1192`（field 的 keydown 处理：Enter→`commitNoteInput()`、Esc→`closeNoteInput(true)`）
- **问题**：意见框容器在 **capture 阶段**对一切 keydown 调用 `stopPropagation()`。DOM 事件派发语义：capture 阶段在祖先（container）上设置 stop propagation 标志后，派发立即终止——**target 阶段不会进入**，field（container 的子元素）上的 keydown 监听永远不被调用。因此 `1182-1192` 的 Enter/Esc 处理是死代码：实际行为 = Enter 在 textarea 里插入换行（默认动作）、Esc 无响应（页面快捷键被屏蔽，用户必须鼠标点击「确认/删除」按钮）。
- **证据**：① 同一机制在同文件被反向证实有效——批注态的 document 级 capture 拦截（`handlePickClick`，1354-1388）阻止**目标元素自身**的 click 监听，`test/annotator-smoke.test.js:42-43` 断言真实 CDP 点击后页面 click-log `childElementCount === 0`（capture stopPropagation 确实挡住 target 监听）；② 该键盘路径**零测试覆盖**——smoke 测试对意见框只驱动 `.value` 赋值 + `[data-dsh-kit-confirm].click()`（test/annotator-smoke.test.js:56），唯一键盘事件是 document 级 Escape（114 行，target 是 document，不经过意见框容器）；③ grep `grep -n "Enter\|Escape\|KeyboardEvent" test/annotator-smoke.test.js` 仅上述两处。
- **建议方案**：把 field 的 Enter/Esc 逻辑**上移合并进容器的 capture 屏蔽监听**（屏蔽监听在 container 上仍会执行，只是阻断了向下的传播——在同一监听里按 `event.target === field` 分流即可），然后删除 field 上的死监听：
  ```js
  container.addEventListener("keydown", function (event) {
    if (event.target === field) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commitNoteInput();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeNoteInput(true);
        return;
      }
    }
    event.stopPropagation();
  }, true);
  ```
  （1175-1177 与 1182-1192 两段合并为这一段；Shift+Enter 换行语义随之复活。）面板的同类屏蔽（1070-1072）**不需要**同改：panel 的子元素只有按钮，键盘激活属默认动作（stopPropagation 不取消默认动作），无死监听。
- **风险**：行为面变化 = Enter/Esc 从「无效」变「有效」，属恢复规格意图（调研文档 §5.2 与文件头注 23-24 行均宣称此交互）；页面快捷键屏蔽语义不变（capture 屏蔽保留）。防范：① smoke 测试补一步真实键盘驱动（CDP `Input.dispatchKeyEvent` 向 field 发 Enter，断言批注 note 落定、输入框关闭；再发 Esc 断言丢弃）——pin 强度只增不减；② 实机回归三条键流：Enter 确认 / Esc 丢弃 / Shift+Enter 换行。
- **优先级**：P1

### [R-02] annotator 的 `clear()` 与 `clearAll()` 在共享会话下语义不对称，公开 API 注释未揭示差异
- **位置**：`src/element-annotator.js:1559-1565`（`clear`：仅清 `annotations` + 移除徽标，**不写删除日志**）vs `1567-1570`（`clearAll` → `clearAllAnnots`，1254-1270，全量 gid 写 `window.__dshKitDeletedGids`）
- **问题**：多窗口共享会话中调用 `clear()` 后，本窗口列表清空，但删除不入日志——宿主 `syncPanes`（client.js:1481）合并各窗口快照时，其他窗口的 union 仍含这些 gid，1.5s 内会被 `addExternal` 推回本窗口（「清了又回来」）。`clear` 的注释只写「清空全部批注并移除徽标」，未提示该陷阱。当前 client 全链只用 `clearAll`（client.js:1237 是唯一注入侧调用点，grep `__dshKitAnnotator.clear()` 零命中），故是**潜在契约陷阱**而非现行 bug。
- **证据**：grep `__dshKitAnnotator.clear\b`（非 clearAll）在 plugin/ 零命中；两函数体逐行比对（1559-1565 vs 1254-1270）确认删除日志写入只存在于 `clearAllAnnots`。
- **建议方案**：**不改行为**（公开 API 契约属禁触清单）——只补注释：`clear` 的 JSDoc 增加一行「⚠️ 不写跨面板删除日志：共享会话下其他窗口的同步会在 1.5s 内把批注推回；跨窗口清除一律用 clearAll()」。若实施会话认为语义统一更优，需按契约变更流程（版本 bump + 实施会话裁决）另行走查，本报告不提。
- **风险**：零（纯注释）。
- **优先级**：P3

---

## 2. Simplify 意见

### [R-03] 上轮格式化采纳遗漏：`pickGuestEl` 收尾缩进残留
- **位置**：`plugin/client.js:641`（`pickGuestEl` 函数收尾 `};` 带 12 空格缩进，与 636 行声明的 10 空格不齐）
- **问题**：上轮 [R1-10] 明确列了「614 行（当时行号）pickGuestEl 收尾缩进一并修」，采纳执行时遗漏——`cat -A` 实测 641 行为 `            };`（12 空格），函数体语句与收尾同列。
- **证据**：`sed -n '636,641p' plugin/client.js | cat -A` 输出 641 行 `            };$`；对比 547 行等同类收尾 `          };`（10 空格）。
- **建议方案**：641 行缩进对齐为 10 空格（一个字符的 diff）。
- **风险**：零（纯空白）；`node --check` 护航。
- **优先级**：P3

### [R-04] 测试文件 `.js`/`.mjs` 混用无行为影响——评估后不建议动
- **位置**：`test/`（7 个 `.js` + 5 个 `.mjs`）
- **问题**：命名不统一。但根 `package.json` 已声明 `"type": "module"`（实测），`.js` 测试文件原生按 ESM 解析，**不存在**「依赖 Node 语法探测」的脆弱性；`node --test` 两种后缀同等发现。
- **证据**：`cat package.json` → `"type": "module"`；12 个测试文件全部经 `npm test` 正常运行（125 项）。
- **建议方案**：不做。若未来强制统一，一次重命名 7 个文件即可（无内容改动），但纯整洁收益、diff 噪音大——诚实标注 P3 可不做。
- **风险**：无。
- **优先级**：P3（记录性意见，建议不做）

---

## 3. 强制优化意见（含证据门槛要求的度量）

### [R-05] 删除日志 `__dshKitDeletedGids` push 不去重（与 clearAllAnnots 的去重策略不一致），且每 1.5s × N 面板全量序列化回传
- **位置**：写入侧 `src/element-annotator.js:1245-1246`（`removeRecord`：`window.__dshKitDeletedGids.push(record.gid)`，**无去重**）对比 `1258-1259`（`clearAllAnnots`：`indexOf(gid) < 0` 才 push，**有去重**）；回传侧 `plugin/client.js:1481`（`deleted: (window.__dshKitDeletedGids || [])`——整个数组进每个面板的 1.5s 快照）
- **问题**：两处写入策略不一致。去重缺失的实际后果：`removeExternal → removeRecord` 每执行一次就追加一条——同一 gid 若经历「A 窗删除 → 广播 → B 窗 removeExternal → B 写日志 → …」或用户反复「撤销-重做」式操作，日志出现重复条目。数组**单调增长**（页面生命周期内永不修剪），而 syncPanes 每 1.5s 对每个成员面板把它全量 `JSON` 序列化传输一次，且 `planPaneSync` 每轮对每窗口的 deleted 数组逐条重建 `removedGids` 映射（src/annotator-sync.mjs:39-42 的 O(len) 遍历）。
- **证据**：`grep -n "__dshKitDeletedGids" plugin/client.js src/element-annotator.js`（三处写入/一处回传，上列行号）；`removeRecord` 与 `clearAllAnnots` 源码逐行比对；量级估算：单条 gid 序列化约 16-24 字节，删除 500 次（含重复）后日志 ~12KB × 每面板 × 每 1.5s——长会话（批注工作流一天不关页）持续累积且永不收缩。
- **建议方案**：`removeRecord` 的 push 前加与 `clearAllAnnots` 同款的去重（`if (window.__dshKitDeletedGids.indexOf(record.gid) < 0) push`）——语义完全等价（`removedGids` 是集合语义，重复条目无信息量），日志上界变为「历史唯一被删 gid 数」（受批注产生速率约束，天然有界）。**不建议**引入宿主 ack/剪裁协议（见 §6）。
- **风险**：极低——集合语义下去重不改变任何判定（`planPaneSync` 对 deleted 只做 `removedGids[g] = true`）。防范：`test/annotator-sync.test.mjs` 全量回归 + 实机「删除→同步→其他窗口移除」一轮。
- **验证方法**：gui-eval 读 `window.__dshKitDeletedGids.length`——修复前反复删除同一批注可见长度单调增，修复后恒为唯一 gid 数。
- **优先级**：P2

### [R-06] 批注态 window resize 无合帧：每个 resize 事件触发 N 条批注 × （1 次 `querySelector` + 1 次 `getBoundingClientRect`）的强制布局风暴
- **位置**：`src/element-annotator.js:1429-1434`（`handleResize` → `repositionAllBadges` 直调，无节流）→ `836-855`（`positionBadge`：每条 record 调 `isStale`（selector 命中时内含 `document.querySelector`，519-527）+ `docCoordsOf`（内含 `getBoundingClientRect`））
- **问题**：Windows 拖拽窗口边缘时 resize 事件以每秒数十次连续触发（可突发每帧多次）。每次事件对**全部**批注记录做一次 `querySelector`（isStale 的 selector 复核）+ 一次 `getBoundingClientRect`——N 条批注、60 次事件/秒 = 每秒 N×60 次强制布局序列。同文件 mousemove 高频路径已在 1.6.1 用 rAF 合帧治理（B5，1398-1412），resize 是同族问题漏网。
- **证据**：1429-1434 直调无任何节流（源码）；`grep -n "requestAnimationFrame" src/element-annotator.js` 仅 hover 路径（1404）与 endSession 取消（1519）两处；`positionBadge`→`isStale`→`document.querySelector` 调用链（841→512-527）。
- **建议方案**：与 B5 同款 rAF 合帧——模块级 `var resizeRaf = 0`，`handleResize` 改为置挂起标记 + `requestAnimationFrame` 内每帧最多执行一次 `repositionAllBadges()`；`endSession` 里 `cancelAnimationFrame(resizeRaf)` 复位（照抄 1518-1521 的 hover 收尾模式）。
- **风险**：低——每帧一次批处理与逐事件处理在视觉上不可分辨（浏览器每帧至多渲染一次）；会话结束帧丢弃由 `session` 判空兜底。防范：`annotator-smoke` 现有徽标定位断言不受影响（定位语义未变）；实机拖拽窗口观察徽标无滞后/错位。
- **验证方法**：DevTools Performance 录制拖拽窗口 2 秒——修复前 `repositionAllBadges` 调用次数 ≈ resize 事件数（远大于帧数），修复后 = 帧数；Layout/强制回流条目同步下降。
- **优先级**：P2

### [R-07] `updateOverlay` 同目标悬停期间每帧仍读 `popover.offsetWidth/offsetHeight`——内容未变时是纯冗余强制布局
- **位置**：`src/element-annotator.js:782-783`（`var labelWidth = popover.offsetWidth || 240; var labelHeight = popover.offsetHeight || 90;`）
- **问题**：B5 已做到同目标跳过 popover 重建（778-781），但**位置更新**每帧仍读两次 offset——同目标悬停移动期间 popover 内容不变、宽高不变，这两次读的值恒定，却每次都可能触发强制布局（写 overlay 样式后布局已脏）。rAF 合帧后成本上限为 2 次/帧，量级不大，但消除方式简单且无行为差异。
- **证据**：源码 776-787（`renderPopover` 仅在 `target !== hoverTarget` 时执行，而 782-783 无条件执行）；B5 注释（1398-1399）自证该路径是刻意治理的高频路径。
- **建议方案**：在 `renderPopover` 末尾缓存 `labelWidth/labelHeight` 到模块级变量（`popoverSize = { w, h }`），`updateOverlay` 改读缓存（保留 `|| 240 / || 90` 兜底）；popover 重建时（目标变化）缓存自然刷新。
- **风险**：低——popover 尺寸仅由内容决定（定宽 `min(320px, calc(100vw-16px))`，高度随内容），内容不变则尺寸不变；唯一边界是视口宽度跨过 320px 阈值时 popover 宽度会变——缓存略滞后到下一次目标变化，视觉影响为 popover 定位精度一次性偏差（可接受；如需严格可在 resize 分支清缓存）。防范：实机悬停移动观察 popover 无错位。
- **验证方法**：DevTools Performance 悬停移动 2 秒对比强制布局条目数。
- **优先级**：P3（收益中等偏小，诚实标注；实现成本同样小）

---

## 4. 解耦意见（含纯度论证）

**本轮未发现值得抽取的新候选。** 上轮 R3-1/R3-2（`annotator-consume`/`annotations-summary` 正典 + 内嵌副本 + parity）已落地并经实测验证；对其余候选逐项评估如下（诚实记录，防过度工程）：

### [R-08] `samePageHref` 抽 src 正典——评估后不推荐
- **位置**：`src/element-annotator.js:496-510`
- **问题/评估**：函数是纯的（两个 URL 字符串 → boolean，无 DOM/状态），符合抽 取的纯度门槛；但它是**单端函数**——只有 annotator 自己用（同页门控在 `addExternal`），client/host 均无第二个消费方（grep 证实）。sanctioned 模式的价值在于「双端共享 + 单测固化」，单端 12 行函数抽出只产出「正典 + 内嵌副本 + parity 测试」三份维护面，收益仅为可单测——而该函数的分支（a===b 快路径 / URL 解析异常回退 false）已经在实机串窗事故中验证过（P28）。
- **证据**：`grep -rn "samePageHref" plugin/ src/` 仅 element-annotator.js 一处定义一处调用。
- **建议方案**：不抽取。若未来 client 侧出现同页判定需求（如诊断上报页面指纹），届时按 A1 模式抽取并与 annotator 内嵌副本 parity。
- **风险**：不抽取无风险。
- **优先级**：P3（评估记录）

### [R-09] payload 采集函数族（`getSelector`/`getXPath`/`getImplicitRole`/`getAccessibleName` 等）——纪律性排除，不抽
- **位置**：`src/element-annotator.js:274-446`
- **问题/评估**：这批函数以 **DOM Element 为参数**（`element.closest`/`element.attributes`/`getComputedStyle`），不满足「参数注入、无 DOM」的解耦纪律（任务书 §5.4 明文「含 DOM 的一律不抽」）；且 IIFE 形态（P11 file:// 约束下不可改 ESM）决定了只能内嵌。`annotator-protocol-parity.test.js` 已覆盖其中唯一可脱 DOM 的部分（协议 builder）。
- **证据**：参数签名逐个核对；任务书 §5.4 纪律条款。
- **建议方案**：不抽取。
- **风险**：无。
- **优先级**：P3（评估记录）

---

## 5. 文档漂移与工程卫生

### [R-10] README 状态行停留在 MVP-0 时点（2026-10-04），与 d17ef4a 现状差四个里程碑
- **位置**：`README.md:4`
- **问题**：状态行写「MVP-0 接入验证完成（2026-10-04），主路径 = client plugin（混合架构）」；实际 HEAD 已含 MVP-2 批注（1.6.1）、共享会话（delivery-08/09）、命令通道 23 action（MVP-4）、防呆横条与两轮重构采纳。新会话按 README 判断项目进度会低估现状。
- **证据**：`head -8 README.md`；git log 里程碑序列（9a70409→f48fefa）。
- **建议方案**：状态行更新为「共享批注会话 + 命令通道 + 设备观测可用（2026-10-06，annotator 1.6.1）」，或改为指向 `docs/delivery-13-review-round.md` 的「以最新交付文档为准」措辞（规避再次漂移）。
- **风险**：零（纯文档）。
- **优先级**：P3

### [R-11] `docs/delivery-01.md` 记载的「密码框跳过」与现行行为相反，历史交付文档缺少「时点快照」声明
- **位置**：`docs/delivery-01.md:15`（「密码框跳过；stale 置灰…」）vs 现行为 `src/element-annotator.js:1374-1375`（注释明言「密码框不再跳过（2026-10-05 用户反馈移除）……输入值永不被采集」）
- **问题**：delivery 文档是交付时点快照，行为被后续需求推翻后未回标——读者（尤其公开库访客）按 delivery-01 理解批注行为会得出相反结论（以为密码框不可批注）。
- **证据**：两处源码/文档逐字比对（上列）。
- **建议方案**：不做逐份回改（13 份历史文档逐时点回改不可维护）；在 README「参考资料」或 `docs/` 目录加一行总声明：「delivery-*.md 为各功能交付时点快照，现行行为以 `src/`+`pitfalls.md` 为准」。若采纳 [R-10] 的「指向最新文档」措辞，可合并处理。
- **风险**：零。
- **优先级**：P3

### [R-12] client.js 的 stateRef 文档块记载 `chipAwayFrom(预留)` 字段——实际不存在
- **位置**：`plugin/client.js:527`（文档块「chip/sentChips[]/chipAwayFrom(预留)/chipGate…」）；grep `chipAwayFrom` 全文件仅此一处
- **问题**：上轮 [R1-04] 新增的字段总览把一个**未实现的预留字段**写进了权威文档——预留从未落地（防呆横条最终直接读 `stateRef.chip`，未引入该字段）。字段总览的价值在于「看这一处就知道模型形状」，幽灵字段破坏这个契约。
- **证据**：`grep -n "chipAwayFrom" plugin/client.js` → 仅 527 行注释命中；stateRef 声明（535-551）无此字段。
- **建议方案**：删除「chipAwayFrom(预留)」一词（横条模型说明并入 chip 行即可）。
- **风险**：零（纯注释）。
- **优先级**：P3

---

## 6. 明确不建议做的项（诚实记录，防过度工程）

1. **删除 MVP-0 探测代码**（`runProbe`/`pickProbeTarget`/`collectStatics`/`probeGuest`，client.js 110-260 区域）——任务书 §5.2 点名评估。结论：**保留**。它们不是死代码：`probeAndPublish`→`reportClient` 是 face 第 1 方法且 `probe-report.json` 是 P39 判据的关键取证（「implLoadedAt 停留即后台节流」）、`kit-status`/`findings.gui` 自诊断消费 `findings`、`pickProbeTarget` 被 `pickGuestEl`/`captureShot` 复用。grep 调用者齐全，运维诊断链路依赖它。
2. **为删除日志引入宿主 ack/剪裁协议**——[R-05] 去重后上界即「历史唯一 gid 数」，增长速率受批注产生速率约束；ack 协议要改 syncPanes 往返形状，复杂度与收益不匹配。
3. **annotator 拆 ESM / client.js 拆多文件**——file:// CORS（P11）与 client-modules 纯度门（上轮研究项 A）双重不可行，维持 IIFE + 单文件。
4. **给批注徽标加滚动监听重定位**——徽标用 absolute 文档坐标，滚动天然跟随（`docCoordsOf` 设计意图）；加监听是纯负担。
5. **`renderPanel` 行级增量更新**——面板列表仅在 commit/clear/addExternal 变更时重建，非热路径；全量重建代码简单且无状态残留风险。
6. **test/ 文件后缀统一**（[R-04]）——无行为收益。

---

## 7. 交付自检

1. **`git status --short`**：交付前实测仅 `?? docs/review-report-20261006.md` 一项（零代码改动实证）✓
2. **`npm test`**：125 项（124 通过 + 1 已知 flake `hid-fixture-smoke` EPERM，与任务书 §2 基线一致）✓
3. **格式齐全**：R-01 至 R-12 每条均含 位置/问题/证据/建议方案/风险/优先级 六要素 ✓
4. **合规**：未触碰禁触清单（entry.mjs / face 契约与 descriptors / plugin package.json / annotator 公开 API 契约与版本锁 / profile / 新依赖与构建工具——[R-02] 明确以注释澄清方式规避契约变更）；未含禁止类型（无跨 tick 节点缓存、无 interval 周期变更、无异步化改造、无测试断言放宽、无 client 拆文件）；未重提 §4 已采纳清单中任何一项 ✓
5. **意见分布**：Review 2 条（其中 1 条 P1 真缺陷）、Simplify 2 条（其中 1 条为上轮采纳遗漏）、强制优化 3 条（全部带可度量成本与验证方法）、解耦 0 抽取 + 2 条评估记录、文档漂移 3 条——合计 12 条，宁少而实。

---

## 8. 实施会话裁决与执行记录（2026-10-06 追加）

| 条目 | 裁决 | 执行结果 |
| --- | --- | --- |
| R-01 意见框 Enter/Esc 死代码 | **采纳（P1 真缺陷）** | capture 监听按 target 分流修复；smoke 补真实键盘驱动（Enter 提交+关框+note 入列、Esc 丢弃+关框+不入列，A4 块） |
| R-02 clear/clearAll 语义不对称 | 采纳（P3 注释） | `clear` JSDoc 补「不写跨面板删除日志」警示；行为不变（公开 API 契约） |
| R-03 pickGuestEl 缩进残留 | 采纳（P3） | 对齐为 10 空格 |
| R-04 测试后缀混用 | **驳回（同意报告：不做）** | — |
| R-05 删除日志 push 不去重 | **采纳（P2）** | removeRecord 按 gid 去重（与 clearAllAnnots 同款）；上界变为历史唯一 gid 数 |
| R-06 resize 无合帧 | **采纳（P2）** | rAF 合帧（照抄 B5 模式）+ endSession 复位 |
| R-07 popover 尺寸重复读取 | 采纳（P3，含 resize 清缓存边界） | renderPopover 末尾缓存 `popoverSize`，updateOverlay 读缓存 |
| R-08 samePageHref 不抽取 | **驳回（同意报告：不抽取）** | — |
| R-09 payload 函数族纪律性排除 | **驳回（同意报告：不抽取）** | — |
| R-10 README 状态行过时 | 采纳（P3） | 状态行更新至 2026-10-06 / annotator 1.6.2 |
| R-11 delivery 文档时点漂移 | 采纳（P3，合并 R-10 处理） | README 增「delivery-*.md 为交付时点快照」总声明 |
| R-12 幽灵字段 chipAwayFrom | 采纳（P3） | 字段总览删除该词，横条模型说明并入 chip 行 |

版本影响：annotator **1.6.1 → 1.6.2**（R-01/R-05/R-06/R-07 均为行为变更；client `EXPECTED_ANNOT_VERSION` 与测试钉同步）。测试：125 项全绿（含 R-01 新增 A4 键盘冒烟块）。实机验收：annotator 版本、意见框键盘流、胶囊生命周期由实施会话在热换后复测（见后续提交记录）。
