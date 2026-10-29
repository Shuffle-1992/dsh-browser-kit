# dsh-browser-kit 解耦/简化/强制优化执行方案（2026-10-24 · 第 3 次派单）

**定位**：可直接执行的施工单。不复述既有三份报告（`zcode-review-deep.md` / `zcode-audit-tests.md` / `zcode-audit-mech.md`），只在其基础上收敛为 Top-N 与批次表；编号 H/M/L/D/S 沿用各报告原文以便对照。

**已修项不重提**：commit d557b62 已采纳 H-1/H-2/M-1/M-2/M-4；bf00a5e 已删 withLimit（L-7）并落地回执文件 2MB 轮转（`plugin/host.impl.mjs:588` 注释在案）。本方案与其零重叠。

**行号口径**：深度 review/机械审计写于 H-2 修复合入**之前**，client.js 行号普遍漂移，本方案全部按当前工作区实测校准（如机械审计的 fmtBytes 5815→现 5820、hidShim 守卫 7056→现 7077；深度 review 的预算段 5270-5271 实为**注释引用行**，真代码在 5283-5284，已用 `sed -n '5289p'`＝race 行交叉验证）。

**纪律基线**（全程有效）：
- 解耦一律 A1 模式：`src/xxx.mjs` 正典 + client.js 内嵌 `/* @xxx-canonical-begin/end */` 副本 + parity 对拍。先例：shot-view（client.js:5939-6020 ↔ `src/shot-view.mjs`，切片法见 `test/shot-view.test.mjs:26`）、annot-mirror-anchor（client.js:1943-1966）、annotator-consume（1459-1467）、annotations-summary（2370-2396）、annotator-sync（2504-2567）。
- 钉子只钉行为/契约（P116）；字面匹配必须配反向断言；切片前必须先断言锚点存在（防"indexOf=-1 假绿"）。
- 客户端改动验收＝`node --test --test-concurrency=1`（基线 256/255/1）+ 实机 **F5** 后巡检；**永不 toggle**（P115）。
- 宿主侧动态 import `../src/?ts=`（P13）照旧；宿主文件可静态 import src/。

---

## 一、解耦 Top 6（A1 模式，按收益/风险排序）

### D1 胶囊落位决策（最高优先：P114+M-1 两次实机打回区）
- **抽什么**：`fuzzyFindKey`（client.js:1550-1558）+ `resolveChipTarget`（client.js:1559-1602）。纯函数，输入 `(rows, rowKeys, model)`，输出行下标。
- **目标**：`src/chip-target.mjs` 导出 `resolveChipTarget(rows, rowKeys, model)`；fuzzy 为模块私有不导出（缩 API 面）。
- **内嵌锚点**：`/* @chip-target-canonical-begin/end */` 包住原 1550-1602；调用点（client.js:1603 的 for 循环）照旧调内嵌副本。
- **测试** `test/chip-target.test.mjs`：行为钉 7 例——①精确键原行重挂 ②attachedKey 失配+相对锚合法→j+1 ③失配+单调守卫不满足→-1 ④未挂过+模糊锚命中晚于 base→f ⑤未挂过+模糊锚命中 base 自身→-1（M-1 场景）⑥attachIdx 越界→-1 ⑦pendingAttach+行数增长→末行。parity：从 client.js 切锚点间文本（先 `assert(source.includes('@chip-target-canonical-begin'))`），`new Function('rows','rowKeys','model', body+';return resolveChipTarget(rows,rowKeys,model);')` 与正典对拍同 fixtures。
- **收益**：~55 行状态决策出仓；落位规则获得全分支回归，改规则不再只能实机验证。
- **风险/回滚**：低（单调用方 :1603）；revert 即回滚，无数据迁移。既有 P114 字面守卫（compat 的"attachedKey 分支不得含 fuzzyFindKey/attachIdx"、`return -1; // ★不跳行`）**保留不动**，与行为钉互补。

### D2 命令通道超时预算（P116 事故区数值化）
- **抽什么**：`hostCap`/`clientCap` 两行（client.js:**5283-5284**：`Number(command && command.__timeoutMs) || 25000`、`Math.max(2000, Math.min(80000, hostCap - 2000))`）。
- **目标**：`src/command-budget.mjs`：`clientCapOf(hostCap)` + `DEFAULT_CMD_TIMEOUT_MS = 25000`；同时收编 `plugin/browser-tools.host.mjs` 三处 25000 字面量（:98 形参缺省、:493 spec、:834 兜底——机械审计"常量漂移"项）。
- **内嵌锚点**：`/* @command-budget-canonical-begin/end */` 包 5283-5284；host 侧直接静态 import 常量。
- **测试** `test/command-budget.test.mjs`（用 audit-tests T2 伪码）：`clientCapOf(25000)=23000`、`(80000)=78000`、`(1500)=2000`、`(undefined)=23000`；全 27 个 spec 断言 `clientCapOf(spec.timeoutMs) <= spec.timeoutMs - 1900`（browser_wait 70000→68000 > 页内 60000 上限，H-2 链路不回退）；**反向断言**：从 client.js:5246 切出的 pollCommands 体不得含 `(c && c.__timeoutMs)`（P116）。
- **收益**：公式单点化，再调参只动一处；事故区获得数值级防线；~10 行。
- **风险/回滚**：低；revert 即回滚。**顺带**（S6⑦）：client.js:5271 注释仍写"min(20000, …)"，与代码 80000 漂移（H-2 改码未改注释），本批同步改正。

### D3 唯一轮询者租约状态机（P115 事故判定核心）
- **抽什么**：`cmdOwnerTick`（client.js:2701-2725，含 `CMD_OWNER_KEY`）。闭包依赖全部改形参注入：`cmdOwnerTick({ store, now, bootAt, busy, busySince })`。
- **目标**：`src/cmd-owner.mjs`。
- **内嵌锚点**：`/* @cmd-owner-canonical-begin/end */`；client 侧留薄适配 `() => cmdOwnerTick({ store: localStorage, now: Date.now(), bootAt: stateRef.clientBootAt, busy: cmdBusy, busySince: cmdBusySince })`。
- **测试** `test/cmd-owner.test.mjs`（T8 伪码）：无主→抢占；B 心跳新鲜→A 不抢；心跳超 6s→可抢；自己 busy 超 30s→false 自让；`store.getItem` 抛错→**true**（降级"都能轮询"语义不得变）；parity 对拍。
- **收益**：~25 行"只有实机能验"的状态机变全分支单测。
- **风险/回滚**：低；try/catch 降级语义必须随副本走；revert 即回滚。

### D4 URL 策略（顺带落地 L-9）
- **抽什么**：browser-open 校验段（client.js:4405-4412：trim/URL 解析/协议白名单/凭据/自身 origin）。
- **目标**：`src/url-policy.mjs`：`assertOpenableUrl(raw, { selfHost }) → { ok, href?, error? }`。
- **内嵌锚点**：`/* @url-policy-canonical-begin/end */`；browser-open 改调副本。
- **测试** `test/url-policy.test.mjs`：http/https 放行并归一 href；file:/data:/blob: 拒；`user:pass@` 拒；selfHost 命中拒；空串拒；parity。另在 contract test 补一条**存在性钉**：`navigateAgentTab`（client.js:3621）/`navigateAgentView`（client.js:3657，loadURL 在 3625/3662）体内必须调用 `assertOpenableUrl`——本项同时完成 L-9（自持窗口导航目前对 file:// 不设防，`file:// + browser_eval` 可读本地文件回传）。
- **收益**：一份策略两处共用；堵旁路；~20 行。
- **风险/回滚**：中低（安全路径）。navigate 拒绝时保持现 `{ok:false,error}` 回执形状；revert 即回滚。

### D5 截图磁盘兜底（顺带修 diskFailed 死计数器）
- **抽什么**：ShotToolView 兜底 effect 的取数主体（client.js:6058-6077：内存未命中→waitSvc→shotDataUrl→rememberShot→setFetched）；useState/DOM 留在 client。
- **目标**：`src/shot-disk-fetch.mjs`：`fetchShotFromDisk(name, { svc, unwrap, rememberShot }) → { dataUrl, bytes } | null`。
- **测试** `test/shot-disk-fetch.test.mjs`（T6 伪码）：成功→写回缓存且 `diskFetched+1`；svc 缺失/抛错→null 且不 remember；`r.ok=false`→null；parity。**顺带修**：client.js:6069 默认对象声明的 `diskFailed` 全仓无自增点（audit-tests 已证死计数器）——catch 分支补 `d.diskFailed += 1`，让兜底失败在 kit-status.compat.shotView 可见。
- **收益**：兜底路径首次可测；仪器从死变活；~20 行。
- **风险/回滚**：低（纯展示兜底）；revert 即回滚。

### D6 自持窗口几何（成本最高，放最后，可裁）
- **抽什么**：`applyAgentViewLayout`（client.js:3274）纯几何段 3281-3302（dpr/zoom/k/panelW/panelH/stageW/stageH/topOffset）+ `agentViewResolvePreset`（client.js:2822）。
- **目标**：`src/agent-view-layout.mjs`：`computeAgentViewLayout({ preset, ui, windowW, windowH })` → 布局量；`setZoomFactor`/style 写回留 client。
- **测试** `test/agent-view-layout.test.mjs`：v12-v20 调参场景数值断言（极小窗/4K/dpr=2/fit 开关/展开 vs 停靠 260px）；parity。
- **收益**：~35 行反复实测调参区获得单测。
- **风险/回滚**：中——几何与 DOM 耦合，`window.innerWidth/innerHeight` 读取必须参数化，易漏；放 D1-D5 稳定后做；revert 即回滚。

---

## 二、简化 Top 6（引用计数证据；全部零/极低行为风险）

| # | 项（文件:行） | 证据 | 为什么安全 |
|---|---|---|---|
| S1 | 删 `hidCloseAllImpl`（src/hid-bridge.mjs:190，头注 :188 一并改） | `grep -rw hidCloseAllImpl` 全仓=1（仅定义）；host.impl.mjs 只接线 onHidRead/List/Trace（:811/:815/:817） | 从未有调用方；若想修句柄泄漏属行为变更，归 O 批另行接线，本批只删+纠偏头注 |
| S2 | 双删 `resolveSchemasterySync`（plugin-config.schema.mjs:57）与 `DSH_BROWSER_KIT_SCHEMA_SOURCE`（:106） | 引用计数各=1；test/ 零引用 | 纯死导出；:106 只依赖本文件内的 z 表达式 |
| S3 | basename 第 3 份 → `import { baseName } from './shot-view.mjs'`（src/tool-presentation.mjs:52-56） | 与 src/shot-view.mjs:10 逐字等价；两文件同在 src/ 可静态 import | 零行为（删实现不删语义）；改后跑 `node --test test/shot-view.test.mjs` |
| S4 | `panel.appendChild(addrRow)` 双写删一行（client.js:3236-3237） | 相邻两行同参调用 | DOM append 同一节点幂等（移动而非复制），删一处无视觉差 |
| S5 | `findings.gui` 重复键 `annotActive`（client.js:740 与 :743）合并为一 | 两行表达式逐字相同（:4185 是另一对象，不动） | 对象字面重复键后者覆盖前者、值相同 ⇒ 合并零差 |
| S6 | 注释漂移批量修正：①wire.host.mjs:4"共 8 方法"→18；②wire.host.mjs:59-71 JSDoc 补 8 个 hooks 参数（onShotDataUrl/onGetHidShim/onHid* 六件套）；③browser-tools.host.mjs:806"keyed 分派不触发"改写为"官方契约要求；归因更正见 src/tool-presentation.mjs 头注"；④wire.host.mjs:54 hidTrace 签名串补 `handles?`（实现 src/hid-bridge.mjs:201-208 多返回它）；⑤src/hid-bridge.mjs:188 头注随 S1 改写；⑥plugin-config.schema.mjs 注释随 S2 删；⑦client.js:5271"min(20000, …)"→"min(80000, …)"（H-2 改码未改注释，本次实测新发现） | 机械审计§四 6 处逐条核对 + 本次实测 ⑦ | 纯注释/文档；现 W3 不比对签名串，④不会红（M-3 若实施需同步） |

---

## 三、强制优化 Top 5

| # | 问题（文件:行） | 改法 | 验收判据 |
|---|---|---|---|
| O1 | M-5：`ctx.on('agent/pre-step')` 在 async `wire()` 内注册（plugin/annot-delivery.host.mjs:252）——apply 返回后才注册，fiber 归属不定 ⇒ toggle 后监听可能堆积、老会话重复注入 BROWSER_PRIMER | `ctx.on` 改为 apply 内**同步**注册；`createUserMessage` 回调内部惰性 `loadCreateUserMessage()`，解析失败只跳过注入并记账 | ①`node --test test/annot-delivery.test.mjs` 绿；②实机 F5：连续 toggle 3 次→发 1 条消息→会话中 BROWSER_PRIMER 恰 1 次 |
| O2 | L-1：hidShimCache 守卫写反（client.js:7077 `if (!hidShimCache.source \|\| hidShimCache.mtime !== null)` ⇒ 首拉后 mtime 恒非 null ⇒ 永不重拉，shim 源冻结；注释却称"每次重注都重拉"） | 改 `if (!hidShimCache.source)`；重注判定改用"刚拉到的 mtime"对比（联动 :7073-7074 needInject 与 :7088 注入行） | ①改 src/webhid-shim.js 任一注释→F5→日志/kit-status 显示新 mtime 已注入；②guest 重建 3 次后 `hidShimCache.mtime` 与磁盘一致 |
| O3 | L-3：命令 id `tool-<ms36>-<seq36>`（browser-tools.host.mjs:101-102，seq 于 :89）因 `?ts=` 热重载归零 ⇒ 可与历史回执撞 id（假成功） | id 掺 4 位随机段：`` `tool-${Date.now().toString(36)}-${commandSeq.toString(36)}-${Math.random().toString(36).slice(2,6)}` ``。**L-2 注记**（takeCommandImpl 读→删 TOCTOU，host.impl.mjs:553-573）：维持"unlink 失败返回 ok:false、client 收到 ok:false 不执行"现状，**不得**改成"unlink 失败也返回命令" | `node --test test/browser-tools-host.test.mjs` 绿 + 新增 id 形状断言 `/^tool-[a-z0-9]+-[a-z0-9]+-[a-z0-9]{4}$/` |
| O4 | L-4：`hidPumpStopped/hidPumpTimer` 声明（client.js:7177-7178）滞后于 effect 引用（:676-677）⇒ apply 中途抛错时 dispose 期 TDZ。L-5：`agentView.statusTimer`（:2979-2980）在 `releaseAgentView`（:2786）与 ctx.effect 均不清 | ①两个 let 上移到 `trackedIntervals` 旁（~:662）；②`releaseAgentView` 首行加 `try { if (agentView.statusTimer) clearTimeout(agentView.statusTimer); } catch {}` | `node --check plugin/client.js` 0 错；三敏感测试绿；实机触发 1 次 dispose 无 TDZ 报错 |
| O5 | P116 事故区唯一防线仍是字面钉（compat `/命令执行异常/`）：执行异常强制回执（client.js:5293-5294 catch 分支）、take 10s 保底（:5262-5264）、回执 5s 上限（~:5301-5310）全部零行为覆盖 | 按 audit-tests T1/T7 伪码补 `test/poll-receipt.test.mjs`：切 pollCommands 体（**先断言 client.js:5246 锚点存在**）、假 svc 注入；断言"未知 action 也产出 `{ok:false,error}` 回执"+"回执竞速约 5s 退出并告警"+"take 永不返回时 10s 抛出" | 新测试绿；反向断言在位：pollBody 不得含 `(c && c.__timeoutMs)`；全量 256+3/255+3 |

可选（不占 Top5，收益明显时做）：D-2 陈旧胶囊退避（client.js:1591-1628 循环：retracted 只 `continue` 不出队、noTarget 空转 12 万次级）——retracted 出队 + `attachTries>100` 后降频；D-3 `captureDraftIdle`（~:2580）空扫隔 N 轮。

---

## 四、不该动清单（防后人反复折腾）

1. `plugin/noop.js` —— `src/hid-bridge.mjs:26` 的 createRequire 解析锚点，非死文件（机械审计 A0）。建议顺手补头注"createRequire 锚点勿删"。
2. `resolveChipTarget` attachedKey 分支的 `return -1; // ★不跳行` 与"不得含 fuzzyFindKey(/attachIdx"字面守卫 —— P114 语义钉（pitfalls.md:909），改动必须与 compat 同步，且只许收紧不许放松。
3. FACE_METHOD_TABLE ↔ REMOTE_CONTRIBUTION.descriptors 的 18 方法名/参数序/可选集 —— W3 钉子的守护对象；M-3 签名串文案漂移修哪端都要过 contract test。
4. `summarizeSetsForDelivery`（annot-delivery.host.mjs:166）vs `summarizeSets`（src/annotations-summary.mjs:11）—— 刻意分化（B5 豁免），只许加互链头注，不许合并。
5. 三处 ID 前缀约定（client.js:6433 'd' / host.impl.mjs:709 无前缀 / element-annotator.js:1612 'a'）—— 命名空间刻意分化；只可统一随机段长度并注释约定，不许抽工厂。
6. client 侧"不能相对 import ⇒ A1 内嵌副本"这一模式本身 —— 不要引入打包器/bundler 改造 client.js。
7. `clientCapOf` 不变式 `clientCapOf(h) < h`（客户端必须先于宿主回执）—— 任何调参不得破坏。
8. `cmdOwnerTick` 的"localStorage 不可用 ⇒ 返回 true（都能轮询）"降级语义 —— 不能改成 false（会变成没人轮询）。
9. `SHOT_VIEW.humanBytes` 与 `fmtBytes`（client.js:5820）展示口径差异（"0 B" vs 空串、toFixed(1) vs 取整）—— 待用户裁定前先加豁免注释，不合并。
10. 客户端改动验证一律 F5/重启（P115），永不 toggle；宿主半边问题才允许 toggle。
11. `takeCommandImpl` 的"unlink 失败 ⇒ ok:false ⇒ client 不执行"链路（O3 注记）—— 看似"丢命令"，实为防重复执行的防线，别"修"它。

---

## 五、执行顺序表（每批一个 commit；B1 可拆"纯删"+"注释"两个）

| 批次 | 内容 | 验收命令（PowerShell，cd "F:\My Code\dsh-browser-kit"） |
|---|---|---|
| B0 | 基线确认（不改码） | `node --test --test-concurrency=1` → 期望 256/255/1 |
| B1 | S2→S4→S5→S3→S1→S6（Simplify 一把梭） | `node --check` 逐个改动文件；`node --test test/shot-view.test.mjs test/plugin-impl.test.mjs`；三敏感：`node --test test/dsh-021-compat.test.mjs test/plugin-client-contract.test.mjs test/credential-manager.test.mjs` |
| B2 | O3→O4（小改） | `node --test test/browser-tools-host.test.mjs test/plugin-impl.test.mjs` + 三敏感 |
| B3 | D2（最小解耦练手） | 新 `test/command-budget.test.mjs` + 三敏感 + `node --check plugin/client.js` |
| B4 | D3 | 新 `test/cmd-owner.test.mjs` + 三敏感 |
| B5 | D1（最大解耦） | 新 `test/chip-target.test.mjs` + `node --test test/annotator-v36-v37.test.mjs`（P114 字面守卫仍在）+ 三敏感 |
| B6 | O1→O5（注册时机 + 行为钉） | `node --test test/annot-delivery.test.mjs test/poll-receipt.test.mjs` + 三敏感 |
| B7 | D4（url-policy + L-9） | 新 `test/url-policy.test.mjs` + contract test（含新存在性钉） |
| B8 | D5、D6（D6 可裁） | 新测试各自绿 + **全量** `node --test --test-concurrency=1` 收官 |

- 全量基线只在 B0/B8 必跑，其余批次以三敏感+定向测试反馈（省时）。
- 实机验收（O1②/O2②/O4）在 B6/B7 完成后一次 F5 巡检：27 工具 0 错误、kit-status 无新增 warn、`compat.shotView.diskFailed` 有值仅当兜底真失败。
- 每 commit 信息注明批次号与对应项编号（如 `refactor(B5): chip-target 抽 src/ 正典 + parity（方案 D1）`）。
