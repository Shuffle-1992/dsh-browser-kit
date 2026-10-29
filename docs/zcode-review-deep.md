# dsh-browser-kit 深度代码 Review（2026-10-24）

- 评审范围：`plugin/client.js`（7391 行全文精读）、`plugin/browser-tools.host.mjs`、`plugin/host.impl.mjs`、`plugin/annot-delivery.host.mjs`、`plugin/wire.host.mjs`、`plugin/entry.mjs`、`src/{session-id,shot-view,tool-presentation,annotator-consume,annotations-summary,annot-mirror-anchor}.mjs`、`test/plugin-client-contract.test.mjs`（W3/A6/R-INPUT 等钉子）、两份 package.json。
- 评审方式：只读；测试基线实跑一遍；wire↔client 方法表、工具 action↔commandHandlers、内嵌副本↔src 正典逐项对账。
- 纪律遵守：pitfalls P97–P116 已先读；未重复提已被否决的方案（不碰"相对 import"、不碰 gui-eval 语义、不 propose toggle 验证客户端改动）。

## 0. 测试基线（实跑）

`node --test --test-concurrency=1` 实跑结果：**256 项 / 254 过 / 1 失败 / 1 跳过**（任务交代的"256/255/1 跳过"不成立）。

- 失败项：`test/cdp-smoke.test.js:14` — `Error: EPERM ... rmSync ... dsh-kit-chrome-SEZyiR`（`src/cdp/drive.mjs:172` 的 `close()` 清临时 profile 目录被拒）。
- **单跑复验：`node --test test/cdp-smoke.test.js` ⇒ 2/2 通过**。判定为环境性偶发（Windows 临时目录句柄/杀软占用），非逻辑回归；但"全套并发跑时 close() 无重试"本身是健壮性小缺口（见 D-1）。

---

## 1. 结论速览表

| 编号 | 位置 | 问题（一句话） | 风险 | 维度 |
|---|---|---|---|---|
| H-1 | client.js:5310-5314 | 全局命令轮询器闭包持有**旧实例 stateRef**，toggle 后 svc 可能永远为 null ⇒ 通道"活着但没人取命令" | 高（影响大/前提未验证） | 正确性/生命周期 |
| H-2 | client.js:5270-5271 ↔ browser-tools.host.mjs:506-517 | `browser_wait` 页内等待上限 60s，但客户端 20s 硬上限先行截断 ⇒ >20s 的等待必回"超时"错误而非 `matched:false` | 高（确定发生） | 契约/正确性 |
| M-1 | client.js:1577-1589 | 未挂过的胶囊模型可经"模糊锚"挂到 base.last 自身（=上一条消息），并锁死 attachedKey —— P114 修复未覆盖的残余路径 | 中 | 正确性 |
| M-2 | host.impl.mjs:576-585 ↔ browser-tools.host.mjs:50-78 | `command-results.jsonl` 只增不轮转，且宿主每 250ms **全文件**读入+split | 中 | 性能/资源 |
| M-3 | contract test:200-218 | W3"逐字对账"实际**不比对签名串**，两端签名描述已漂移 6 处 | 中 | 契约 |
| M-4 | contract test:220-232 ↔ client.js:4058 | A6"全量动作清单"漏掉 `annot-consume`（handler 无 `(svc,c)` 参数 ⇒ 正则不匹配）——P97 验收入口无钉子保护 | 中 | 契约/测试 |
| M-5 | annot-delivery.host.mjs:237-303 | `ctx.on('agent/pre-step')` 在 **async wire()** 里注册（apply 返回后才执行）⇒ 注册作用域不确定，热重载可能堆积监听/每会话重复注入 primer | 中（未验证） | 生命周期 |
| L-1 | client.js:7051-7063 | hidShimCache 源缓存守卫写反 ⇒ shim 源在 client 生命周期内冻结，改 `webhid-shim.js` 永不生效 | 低 | 正确性 |
| L-2 | host.impl.mjs:553-573 ↔ browser-tools.host.mjs:81-107 | take(读→删) 非原子 + host 写入与 client 删除竞态：极端时序下**新命令被旧回执的删除动作吞掉** | 低 | 正确性 |
| L-3 | browser-tools.host.mjs:88-102 | 命令 id 含模块级 seq，`?ts=` 重载后 seq 归零 ⇒ 可能与结果文件旧行撞 id ⇒ 旧结果冒充新回执（假成功） | 低 | 正确性 |
| L-4 | client.js:676-677 vs 7153-7154 | `hidPumpStopped/hidPumpTimer` 声明在 ctx.effect 回调引用之后（apply 中途抛错时 dispose 落 TDZ） | 低 | 生命周期 |
| L-5 | client.js:2975-2977 | `agentView.statusTimer`（6s setTimeout）未纳入统一清理，releaseAgentView 不清 | 低 | 生命周期 |
| L-6 | contract test 全文（如 14/100/243-252 行） | 大量钉子断言**字面写法**（连换行格式都钉）——P116 已证明这类钉子会"测试全绿、实机全死" | 低（技术债） | 可维护性 |
| L-7 | browser-tools.host.mjs:306-313 | `withLimit` 死代码（annotationsLocal 内联了同逻辑） | 低 | Simplify |
| L-8 | client.js:1580-1584 / 740+743 / 3229-3230 / 3011-3023 | 死代码/重复键/重复 appendChild/identity 三连赋值等小清理 4 处 | 低 | Simplify |
| L-9 | client.js:4834-4841（agent-view navigate） | 自持窗口 loadURL 无协议过滤（`browser_open` 拒 file:/带凭据，自持窗口不拒）⇒ 策略不一致 | 低 | 安全 |
| L-10 | browser-tools.host.mjs:154-155 / annot-delivery.host.mjs:61-62 | 硬编码 `D:/DeepSeek/...` 兜底路径（机器耦合，已有 env 覆盖口） | 低 | 可维护性 |
| L-11 | client.js:7201（enforceAnnotSessionScope） | 上一会话面板为空时退化为**清全部 webview** 的 stop+clearAll —— 跨会话面板被顺带清理（当前单 client 实例下无害，多实例假设变更即踩） | 低 | 正确性 |
| ✅ | — | 值得肯定：路径围栏（shotDataUrl/deleteAnnotations）、凭据可达面（P102 断言齐全）、回执必达（P115/P116 修复）、1×1 假成功防线、有界缓存族（shots 12/24MB、sentChips 100、mirrorDiag）、src 正典+parity 模式运转良好（6 个纯函数副本逐字一致） | — | — |

---

## 2. 逐项清单（证据 / 影响 / 改法 / 风险）

### 2.1 正确性（状态机 / 并发 / 边界）

#### H-1 全局命令轮询器闭包持有旧实例 stateRef
- **证据**：`plugin/client.js:5304-5314` —— P115 修复把轮询器挂到 `globalThis.__dshKitCmdPoller`（**不**进 `trackInterval`），并加 `if (!globalThis[pollerKey])` 守卫。`pollCommands`（5237-5303）闭包引用**当次 apply 的 `stateRef`**；svc 取值链是 `stateRef.getRemote()` → 兜底 `waitSvc()`（5339，同样读该 stateRef）。而 `stateRef.remoteSvc` 的清理由 `ctx.inject([remote…], cb)` 子作用域的 effect 负责（client.js:718-722）：dispose 时置 null。
- **影响**：toggle 插件时，若 cordis dispose 了 client 侧 fiber（P115 证实 effect 会跑），旧 stateRef.remoteSvc = null；client bundle 被缓存不重新 apply（P115）⇒ 没有任何代码再给**旧 stateRef** 赋 svc ⇒ 轮询器每 2.5s 空转（`waitSvc` 白等 8.1s）⇒ `.data/command.json` 堆积、全部工具无回执——正是 P115 要根治的症状。若新实例 apply 有跑（`clientModules.rebuilt` 触发），`globalThis[pollerKey]` 已存在 ⇒ 新实例**不会**装自己的轮询器，问题同样成立。
- **改法**：把"活实例引用"也挂到全局：每次 apply 写 `globalThis.__dshKitLiveRef = { stateRef, bootAt: stateRef.clientBootAt }`；`pollCommands` 每轮先取 `globalThis.__dshKitLiveRef.stateRef` 再走 getRemote/waitSvc；inject 回调里同步刷新该引用。一行级改动，代价≈0，同时保住 P115 的"轮询器不随 effect 清理"语义。
- **风险**：高（一旦触发=全工具无回执）；**触发前提未验证**（toggle 时 client fiber 是否整体 dispose、inject 是否会因 host 重注册 face 而重 firing）——见 §5 未验证项。

#### H-2 `browser_wait` 的页内等待被客户端 20s 上限截断
- **证据**：client.js:5270-5271 `clientCap = Math.max(2000, Math.min(20000, hostCap - 2000))`（P115③引入，防"宿主先到点只见无回执"）；client.js:4685-4724 `wait` handler 页内 deadline 上限 60000ms；browser-tools.host.mjs:506-517 `browser_wait` 工具 timeoutMs=70000、参数描述"上限 60000"。
- **影响**：agent 传 `timeoutMs=30000~60000` 时，页内 Promise 要等到自身 deadline 才 resolve，而客户端在 20s 就 race 掉并回 `ok:false, error:"命令超时(客户端侧 20000ms 上限…)"`——描述承诺的"超时不报错、以 matched:false 返回"被破坏；且页内 interval 继续空转到 deadline（僵尸轮询）。
- **改法**（两选一，推荐①）：① `wait` handler 里把页内 deadline 夹到通道预算内：`const budget = Math.max(2000, Math.min(60000, (Number(c.__timeoutMs) || 25000) - 4000)); const timeoutMs = Math.min(原值, budget)`，并在工具 description 同步说明；② pollCommands 对 action==='wait' 放宽 clientCap 至 `hostCap - 2000`（仍受宿主期限约束，不会回退到"无回执"）。
- **风险**：高（确定发生，agent 高频工具）。

#### M-1 未挂过的胶囊可经"模糊锚"挂到上一条消息（P114 残余）
- **证据**：client.js:1577-1589（`resolveChipTarget` 无 attachedKey 分支）：相对锚要求 `j+1 < rows.length`；当新用户行尚未渲染（P101：流式中不渲染）时 `j+1 === rows.length` ⇒ 落到 `fuzzyFindKey(base.last)`（1550-1558）——probe 就是 base.last 的前缀，**必然命中 base.last 自身**（返回 j）⇒ `attachMsgChip` 挂到**上一条**用户消息行；随后 1625 行 `model.attachedKey = rowKeys[idx]` 把错误行锁死（P114 的"已挂过只许同行重挂"反而把它钉在错误行上）；1588 行的 pendingAttach"等新行"分支永远轮不到。发送钩子路径（consumeDraft(null)，client.js:1799-1812）正是 base.last=上一条消息的场景。
- **影响**：批注胶囊挂错消息/丢失——与 P114 用户实拍打回的症状同族（该修复只钉了"已挂过模型"分支 1560-1575）。
- **改法**：无 attachedKey 模型的模糊锚命中必须**晚于** base 行：`const f = fuzzyFindKey(base.last); if (f >= 0 && (typeof base.n !== 'number' || rows.length > base.n || f > rowKeys.indexOf(base.last))) return f;`；更简：pendingAttach 且 `rows.length === base.n` 时直接 `return -1`（等新行）。修复请落在**纯函数层**并加 parity 钉（见 G-3），勿只改内嵌副本。
- **风险**：中；**未实机复现**（DSH 行渲染时序可能掩盖），但代码路径推演成立。

#### L-2 命令通道 take/写竞态（读→删 TOCTOU）
- **证据**：host.impl.mjs:553-573 `takeCommandImpl` = readFileSync → unlinkSync 两步；browser-tools.host.mjs:81-107 `waitChannelFree`（existsSync 轮询）→ writeCommandImpl(原子 rename)。client"读到旧命令内容 → 此刻 host 写入新命令（rename 成功）→ client unlink 把**新命令**删掉"。
- **影响**：新命令丢失 ⇒ 宿主等回执超时（25-70s 白等）；概率低（2.5s 轮询窗口 vs 命令间隔），但排障代价高（表象=偶发无回执）。
- **改法**：client 侧读后删除时做**内容核对**：读到的 `command.id` 存本地，`takeCommand` 宿主删除前比对文件内 id 与请求头——单文件方案下最简做法是 client 改为"读 + 立即 rename 到 `command.taken-<id>`"由 face 一次性完成（把 read+delete 合并进宿主 face 方法内部，消除跨进程两步）。或至少在 client 收到命令后按 `command.id` 幂等（重复取到同 id 直接重发上次结果）。
- **风险**：低。

#### L-3 命令 id 可撞旧 id（热重载后）
- **证据**：browser-tools.host.mjs:88-102 `commandSeq` 模块级；browser-tools.host.mjs 由 `?ts=` 动态 import（host.impl.mjs:44-49）⇒ 每次激活新模块实例，seq 归零；id 形如 `tool-<ms36>-<seq36>`。`readCommandResultImpl`（50-78）按尾部 indexOf 预筛 + `obj.id === id` 精确匹配——若历史行里有同 id（同毫秒+同序号），会返回**旧结果**给新命令（假成功）。
- **改法**：id 掺随机段：`` `tool-${Date.now().toString(36)}-${commandSeq.toString(36)}-${Math.random().toString(36).slice(2, 6)}` ``。
- **风险**：低（概率小、后果=单次工具结果错乱）。

#### L-1 hidShimCache 守卫写反 ⇒ shim 源冻结
- **证据**：client.js:7051-7063：`needInject` 为真时进入拉源分支，守卫 `if (!hidShimCache.source || hidShimCache.mtime !== null)`——首次拉源后 mtime 为非 null 字符串 ⇒ 条件恒 false ⇒ **永不重拉**；注释却写"每次重注都重新拉源（mtime 可能已变）"。后果：guest 重建后注入旧源+旧 mtime，`src/webhid-shim.js` 的修改在 client 不重启时永不生效。
- **改法**：`if (!hidShimCache.source) { 拉源 }` 并在拉源后用返回 mtime 判定是否需要重注入（needInject 改为 `state.mtime !== 刚拉到的 mtime`）。
- **风险**：低（HID 是调试型能力），但属"注释与行为相反"一类易误判。

#### L-11 会话切换清理的兜底面过宽
- **证据**：client.js:7199-7201：`targets = scopedWebviews(prev)`，为空时退化为 `document.querySelectorAll('webview')` 全量 stop+clearAll。当前单 GUI 文档单 client 实例下等价于"上一会话的面板"；一旦出现"同页多实例/多会话并存"的假设变更（实例围栏允许多实例共存），会把别的会话的批注页也清掉。
- **改法**：兜底面改为 `liveAnnotPanes()`（成员 ∪ 自持标签，client.js:2303-2322 已有现成集合），去掉"全部 webview"。
- **风险**：低（前瞻性加固）。

### 2.2 错误处理 / 假成功

总评：**无"ok:true 但实际失败"的新发现**——v37（落盘失败不消费）、R-7（截图三通道分账 `out.channels/partial`，client.js:5641-5645）、U-5（凭据写失败如实回执）都已闭环；`catch {}` 密度高但关键处都有记账出口（mirrorDiag、chipAttach、syncDiag、RESULT_PROBE）。两处可再收紧：

- **B-a**：client.js:2489-2490 `runSessionLoop` 的 `.catch(() => {})`、2477 等处静默——建议统一并入 `stateRef.syncDiag.lastError` 一类已有诊断出口（一句 `say('warn')` 也行），避免"面板静默不自愈"时无第一手证据。
- **B-b**：host.impl.mjs:564-566 `takeCommandImpl` unlink 失败返回 `ok:false`，但命令内容已被读走 ⇒ 若 client 忽略失败继续执行，下一轮会**重复取到同一命令**（Windows 文件锁时）。executeCommand 无幂等保护，`click/type` 重复执行有真实副作用。改法：unlink 失败时把错误如实回传，client 收到 `ok:false` 的 take 时不执行该命令内容（当前 `r.ok === false` 时 `command = null` ✓ 已正确——保留现状即可，此条降级为"注记：不要改成 unlink 失败也返回命令"）。

### 2.3 资源生命周期（注册点 ↔ 清理点对照）

已核对并**基本健康**的清单：5 个 `trackInterval`（syncPanes 1.5s / cmdOwner 2s / watchdog 45s / agentGlow tick / tbGuard 3s）+ 2 个 MutationObserver（首测/tbObserver）+ 2 个 ResizeObserver（agentView.panel / paneFitObservers-WeakMap）+ Dock/DOCK_EVENT 监听 + tbGuardTimer —— 全部挂在 `ctx.effect`（client.js:672-685、5713、6126、6982-6984）✓；`recentShots`（12 张/24MB 双闸）、`sentChips`（≤100）、`state.shots`（≤50）、`credStore`（≤500）有界 ✓；`lastCredPlacer` 单监听（P111 修复）✓。

缺口按序：

#### M-2 `command-results.jsonl` 无界增长 + 全文件轮询（并入性能维度详述，见 2.4）
#### L-4 `hidPumpStopped/hidPumpTimer` 声明滞后于 effect 引用
- **证据**：client.js:676-677（effect 回调首行赋值 `hidPumpStopped = true`）vs 7153-7154（`let` 声明）。apply 在 7153 之前任何一处抛错（外层 catch 7382 吞掉）⇒ 声明未执行 ⇒ dispose 时 effect 回调首行 TDZ ReferenceError，可能中断后续清理项。
- **改法**：把两个 `let` 声明上移到 `trackedIntervals` 旁（client.js:662 附近）。
- **风险**：低（边角），一行级。

#### L-5 `agentView.statusTimer` 未清理
- **证据**：client.js:2975-2977 `setTimeout` 裸用；`releaseAgentView`（2779-2796）与 ctx.effect 均不清。单发自灭、节点已移除时 catch 吞——影响极小。
- **改法**：`releaseAgentView` 里加 `try { if (agentView.statusTimer) clearTimeout(agentView.statusTimer); } catch {}`。

#### M-5 annot-delivery 的 `ctx.on` 注册时机
- **证据**：annot-delivery.host.mjs:237-303 —— `registerAnnotDelivery` 同步返回，但 `ctx.on('agent/pre-step', …)` 在 **async `wire()` 内**执行（先 `await loadCreateUserMessage()`，随后才注册）⇒ 注册发生在 apply 已返回之后，cordis fiber 归属不确定：若挂到 root/宿主级而非本插件 fiber，则 (a) toggle 重载后**旧监听不回收**，每次激活多一个 pre-step 监听；(b) 每个旧监听持有自己的 `primedSessions`（空集）⇒ 老会话会被重复注入一次 BROWSER_PRIMER。
- **改法**：把 `ctx.on` 改为**同步注册**（apply 内直接调），`createUserMessage` 在回调内部惰性解析（首次用到再 `loadCreateUserMessage()`，解析失败只跳过注入并记账）——既落在 fiber 作用域（随插件卸载回收），又不阻塞激活。
- **风险**：中（未验证是否真的泄漏；修复本身低风险）。

### 2.4 性能

#### M-2 回执文件无界 + 每 250ms 全文件读
- **证据**：写端 host.impl.mjs:576-585 `commandResultImpl` 每条 appendFileSync，永不轮转；读端 browser-tools.host.mjs:50-78 `readCommandResultImpl` 每次轮询 `readFileSync` **整个文件**再 `split('\n')`，宿主侧轮询周期 250ms（browser-tools.host.mjs:112-116）。结果行含 snapshot/find/console-dump/eval 输出（可达数十 KB/条）。
- **影响**：长会话高频使用后，文件可达 MB 级 ⇒ 每 250ms 一次全量读+split，宿主 CPU 与 IO 稳定空转；`kit-status`/排障也变慢。
- **改法**：写端做**尾裁轮转**：追加后 `statSync` 超 2MB（或行数 > 5000）时重写为尾 2000 行（原子写同 command.json）。读端 `maxLines=400` 的语义保留。
- **风险**：中（性能债，随使用时长线性恶化）。

#### D-1 cdp-smoke 的 close() 无重试（测试基建）
- **证据**：全套跑挂于 `src/cdp/drive.mjs:172 rmSync`（EPERM），单跑即过。Windows 上 Chrome 子进程句柄释放有延迟。
- **改法**：`close()` 里对 `rmSync` 做 2-3 次退避重试（150/400ms）或 `rmSync(..., { maxRetries: 3, retryDelay: 200 })`（Node 原生支持）。
- **风险**：低。

#### D-2 胶囊补挂的陈旧模型空转
- **证据**：client.js:1591-1628 每 2s 对 `sentChips`（≤100）逐模型跑 `rowKeys.indexOf` 全扫；P114 现场显示 `noTarget:124368` 次空转；retracted 模型只 `continue` 不出队（1594-1596），`attachTries` 无退避。
- **改法**：① retracted 模型从队列移除（`queue.splice`）；② stale 模型加退避（`attachTries > 100` 后每 15 轮评估一次）。
- **风险**：低。

#### D-3 `captureDraftIdle` 空转往返
- **证据**：client.js:2575-2595 每 1.5s 对每个 pane 一次 executeJavaScript，即便无批注、annotator 未注入。单次往返便宜，多面板×长会话累积可观。
- **改法**：早退条件加"localStorage 草稿为空且上一轮 snap.list 为空 ⇒ 隔 N 轮再扫"。
- **风险**：低（可选优化）。

### 2.5 安全与隐私

- **✅ 凭据边界**：credLoad/credSave 只在 GUI localStorage（client.js:6379-6389）；不调 host 服务、不写文件、不进 kit-status/交付管线；`fillCredential` 结果只回布尔与 docToken（6430-6438），日志只记"含/无用户名"（6485）；保存/删除失败如实回执（6763-6821 U-5 ✓）。与 `test/credential-manager.test.mjs` 断言一致。
- **✅ 路径围栏**：`shotDataUrl`（host.impl.mjs:822-839 纯文件名 + `.png` + 4MB + startsWith）；`deleteAnnotations`（host.impl.mjs:592-631 `pathResolve` + `dir + sep` 前缀）；`annotationsLocalRaw`（browser-tools.host.mjs:334-337 剥分隔符）。注：Windows 大小写不敏感但比较是大小写敏感——两端路径同源（都出自 host 落盘），实际风险≈0。
- **✅ browser_open 策略**：拒非 http/https、拒凭据 URL、拒自身 origin（client.js:4396-4404）。
- **L-9 自持窗口导航无协议过滤**：client.js:3209-3215（地址栏补 https ✓）但工具路径 `agent-view op=navigate` → `navigateAgentView` → `el.loadURL(url)`（3614-3623）对 `file://`、带凭据 URL 不设防 ⇒ 与 `browser_open` 的策略不一致。自持窗口本是 Agent 的专用视图，但 `file:// + browser_eval` 可构成"读本地文件回传模型"的旁路。**改法**：`navigateAgentTab`/`navigateAgentView` 入口复用 `browser-open` 的同一段校验（抽成纯函数放 src，顺便满足 G-3）。**风险**：低（调用方是受控 agent + 本地单用户），但属于"同一插件两套 URL 策略"的不一致，建议补齐。
- **L-10 硬编码 `D:/DeepSeek/...`**：兜底候选（browser-tools.host.mjs:154-155、annot-delivery.host.mjs:61-62）。已有 `DBK_DSH_TOOLS`/`DBK_DSH_LLM` env 覆盖口；建议在候选前加 `process.env.DSH_RESOURCES || ''` 一类通用口，或至少在注释标注"机器特定、兜底可删"。
- **注**：`gui-eval`/`guest-eval` 任意代码执行——按设计仅经命令通道（本地文件、实施会话驱动），`gui-eval` 未暴露为 agent 工具 ✓；`browser_eval`（guest 内）是用户明确要求的产品能力，非越权。

### 2.6 契约（方法表 / defineTool / 槽位 / action 映射）

- **✅ wire↔client 方法序/参数/可选标记**：18 个 face 方法逐项一致（wire.host.mjs:33-55 ↔ client.js:74-120），W3 测试（contract test:200-218）比对 id+params+optionals 通过。
- **✅ 27 工具 action ↔ commandHandlers**：全部命中（含 `dblclick/hover/press/scroll` 复用 `input` + staticParams；`annotations` 走宿主本地路径）；`annot-consume` 等诊断命令在 client 侧齐备。
- **✅ 槽位**：6 个 safeInject 与 `kit-status.compat.expected`（client.js:4225）一致（P113 后 7→6 ✓）；`shell.bottom` 先探测 occupied 再定 priority（client.js:6128-6135，P112① ✓）。
- **M-3 W3 名为"逐字"实不比对签名串**：两端签名描述已漂移——`takeCommand`（wire:45 含 `{ok:true, command:null}` vs client:87 无）、`hidRead`（wire:50 含 `error:"timeout"` 分支 vs client:92）、`getHidShim`（wire:53 vs client:95）、`hidOpen`（wire:49 vs client:91）、`hidTrace`（wire:54 vs client:96）、`saveAnnotations`（wire:36 含"meta={url,title} 可选，入索引" vs client:79）。TYPERT.model.members 的 signature 是面向人/工具的文档 ⇒ 漂移会误导读者；W3 的"逐字"措辞名不副实。**改法**：W3 加第三段断言——从 client.js 提取的签名串与 `FACE_METHOD_TABLE[i][2]` `deepEqual`（正则已捕获第 3 组，丢弃即可改为保留比较）；或两端同源于一份数据。**风险**：中（文档性契约，非运行时）。
- **M-4 A6 全量清单漏 `annot-consume`**：contract test:222 的 keyRe 是 `/'([a-z-]+)': async function \(svc, c\) \{/`，而 client.js:4058 写作 `'annot-consume': async function () {` ⇒ 不进清单；expected（test:224）也没有它。P97 明确要求"留一条 annot-consume 式的端到端可触发入口用于验收"——恰恰是**最该有钉子**的入口没被钉。**改法**：handler 签名统一 `(svc, c)`（与其他 43 个一致，顺手消除特例），expected 数组补 `'annot-consume'`。**风险**：中（钉子覆盖缺口）。
- **F-4 `browser_wait` 契约**：工具描述承诺 60s / matched:false，通道实现 20s 截断 —— 即 H-2，见 2.1。

### 2.7 可维护性（应抽到 src/ 的清单，按收益排序）

| 序 | 候选 | 位置 | 收益 | 抽取边界与 parity 写法 |
|---|---|---|---|---|
| 1 | `resolveChipTarget` + `fuzzyFindKey` + `planChipConsume` 调用编排 | client.js:1461-1466, 1550-1590 | **最高**：M-1 的修复点；P114/P107 两轮实机打回都落在这里，纯函数化后可在测试里复现"新行未渲染/文本漂移/重渲染"全场景 | 输入 `{rows, rowKeys, model}`，输出 idx；src 新文件 `chip-target.mjs`；client 内嵌副本 + `@chip-target-canonical` 标记；parity 测试用 contract test 已有的 `sliceBetween` 手法切出内嵌副本、`new Function` 实例化后与 src 版对拍（`test/annot-mirror-anchor.test.mjs` 同款） |
| 2 | clientCap 超时预算公式 | client.js:5270-5271 | H-2 修复点；"min(20000, host−2s) 且 wait 特例"值得 6 个单测钉死（含 P116 要求的反向断言：不得出现对不存在作用域变量的引用） | `src/command-budget.mjs`：`clientCapOf(hostCap, action)`；host 侧 `browser-tools.host.mjs` 的 timeoutMs 缺省表一并入内 |
| 3 | `cmdOwnerTick` 租约状态机 | client.js:2697-2716 | 多窗口防抢是 P115③ 的核心；现在只能实机验证 | 注入 `storage` 形参（get/set/now），单测模拟"双窗口同 tick / 卡死 30s 让位 / 心跳过期抢占" |
| 4 | `agentViewResolvePreset` + `applyAgentViewLayout` 的几何段 | client.js:2815-2821, 3267-3290 | 尺寸/缩放/停靠是反复实测调参区（v12-v20 一路改），纯几何可单测 | 输入 `{innerW,innerH,ui}` 输出布局量；注意保留 `markExpandedOnly` 的 DOM 副作用在调用侧 |
| 5 | `agentViewUrlPolicy`（browser-open 校验复用） | client.js:4396-4404, 3614-3623 | L-9 修复点，两处共用一份策略 | `src/url-policy.mjs`：`assertOpenableUrl(url, { selfHost })` 返回 `{ok,error}` |

另两项非抽取类：

- **L-6 钉子风格**（contract test 全文）：`assert.match(clientSource, /const joinFloorIndex = \(maxUsed\) => \(Number\(maxUsed\) \|\| 0\)/)`（test:14）、`/mode: 'saved',\s*\r?\n\s*count:/`（test:100，连换行都钉）、`/trustedClick = async \(target, c, op\) => \{\s*focusGuest\(target\);/`（test:243）等数百条均属 P116 批判的"钉当前写法"——P116 已实机证明这类钉子会**放行坏实现**（测试全绿、实机全死）。**改法**（不必一次性改）：① 新钉子立规矩——只断言行为/契约/纯函数对拍，字面匹配必须配反向断言；② 存量分批转：优先把"状态机行为类"（chip/consume/scope）改为调 src 纯函数对拍，"存在性类"（如含某常量）保留无害。
- **L-7/L-8 小清理**：`withLimit` 死代码（browser-tools.host.mjs:306-313）；`resolveChipTarget` 内 `j2` 重复查询（client.js:1580-1584）；`findings.gui` 重复键 `annotActive`（client.js:740/743）；`panel.appendChild(addrRow)` 双写（client.js:3229-3230）；`ensureAgentView` identity 三连赋值（3011-3013 vs 3021-3023）。另 G-5：浮层文案存在 `⏸/🤖/🟢/▣` 等 emoji，与全局前端规范（禁 emoji）冲突——存量是否豁免请用户裁定。
- **G-4**：`dshLlmCandidates`/`dshToolsCandidates` 两份同构候选链（annot-delivery.host.mjs:52-64 vs browser-tools.host.mjs:144-169）可共享 `resolveDshModule(rels)`。

---

## 3. Top 12 立即行动（按 收益/风险 排序）

1. **H-2**：client.js:4690 wait handler 把页内 deadline 夹到 `min(原值, __timeoutMs−4000)`，工具 description 同步改 —— 消除 >20s 等待必假超时。
2. **H-1**：client.js:5310 轮询器改读 `globalThis.__dshKitLiveRef.stateRef`（每次 apply 与 inject 回调刷新），脱掉对单实例闭包的依赖 —— toggle 后通道不再依赖"fiber 存活"假设。
3. **M-1**：client.js:1581 模糊锚命中加"必须晚于 base 行"守卫（`f > indexOf(base.last)`），pendingAttach 且行数未增时 `return -1`；落纯函数层 + parity 钉 —— 堵住胶囊挂上一条消息的残余路径。
4. **M-2**：host.impl.mjs:576 commandResultImpl 追加后超 2MB 重写为尾 2000 行 —— 回执文件与轮询开销有界。
5. **M-4**：client.js:4058 `'annot-consume'` 签名补 `(svc, c)` + contract test:224 expected 补该键 —— P97 验收入口回到钉子保护内。
6. **M-3**：contract test:200 W3 增加签名串 `deepEqual` 断言（或把两端漂移的 6 条签名改一致）——"逐字对账"名副其实。
7. **M-5**：annot-delivery.host.mjs:252 `ctx.on` 改同步注册、createUserMessage 回调内惰性解析 —— 注册落入 fiber 作用域，杜绝热重载监听堆积/重复 primer。
8. **L-1**：client.js:7056 hidShimCache 守卫改为 `if (!hidShimCache.source)` 并按"刚拉到的 mtime"判定重注入 —— shim 改动恢复生效。
9. **L-3**：browser-tools.host.mjs:102 命令 id 掺 4 位随机段 —— 热重载后不与旧回执撞 id。
10. **L-4**：client.js:662 附近上移 `hidPumpStopped/hidPumpTimer` 声明 —— 消除 dispose 期 TDZ 边角。
11. **D-1**：src/cdp/drive.mjs:172 `rmSync` 加 `{ maxRetries: 3, retryDelay: 200 }` —— 全套测试不再被环境偶发打红。
12. **L-9**：`navigateAgentTab/navigateAgentView` 复用 browser-open 的 URL 校验（抽 `src/url-policy.mjs`）—— 自持窗口与侧栏同一套协议策略。

（第 13 条备选：L-7 删 `withLimit` 死代码 + L-8 四处小清理，一次 5 分钟的 Simplify commit。）

---

## 4. 值得保留的亮点（防止"review 只挑刺"）

- 回执必达链条（P115/P116 修复后）：`__timeoutMs` 下发 → clientCap = min(20000, host−2s) → 执行异常也强制回执 → commandResult 5s 上限 + cmdBusy 30s 自让位 + 45s 看门狗代际（cmdEpoch）——分层防卡死设计完整且有实机依据。
- 实例围栏（claimClientInstance + isLiveInstance）+ 认领制浮层（ownerBootOf/iAmNewer）+ 打开前清残留（P103）——热更新三件套齐全。
- 诊断"自报"纪律（P112②）：dockSeen/shotView/annotMirror/chipAttach/cmd 全部有 kit-status 出口，"看起来没生效"类问题有第一手判据。
- src 正典 + 内嵌副本 + parity 对拍的 A1 模式运转良好：本次抽查 6 个纯函数副本全部逐字一致。
- 安全边界（凭据可达面、路径围栏、假成功防线）与"诚实回执"文化在代码里处处可证。

## 5. 未验证项（明确标注：未验证）

1. **H-1 的触发前提**：toggle 插件时 client 侧 fiber 是否整体 dispose、`ctx.inject(['remote.*'])` 回调是否会因宿主重注册 face 而 re-fire —— 需实机验证：toggle → 立即调任一 browser_* 工具 → 看 `.data/command.json` 是否在 2.5s 内被取走；若堆积即证实。
2. **M-1 的实际发生率**：DSH 当前版本发送消息后用户行渲染时序（是否仍为"流式中不渲染"）—— 需实机：开批注 → 发送 → 立即观察上一条消息是否挂胶囊。
3. **M-5 的监听堆积**：连续 toggle 3 次后发一条消息，看会话里 BROWSER_PRIMER 是否重复出现多次。
4. **L-2 竞态概率**：真实时序中"client 读→删"与"host 写入"重叠的频率（可用 `kit-status.cmd` 的超时统计旁证）。
5. **测试基线偏差**（256/254/1fail/1skip）为环境性偶发的结论，基于 cdp-smoke 单跑 2/2 通过；连续全套跑 3 次确认稳定率未做。
6. 本 review 全部结论来自静态精读 + 测试实跑；未启动 DSH/未安装插件/未 toggle（遵守任务纪律），因此所有"运行时行为"类判断均以代码推演为准并已逐条标注。
