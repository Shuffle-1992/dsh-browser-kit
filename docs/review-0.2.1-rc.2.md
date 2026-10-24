# dsh-browser-kit · DSH 0.2.1-rc.2 独立评审报告

> 评审人：`reviewer`（独立评审员，只读代码）｜评审时间：2026-10-17 18:20–18:45（Asia/Shanghai）
> 目标：给出**可直接照着改**的清单（每条 = 证据 `文件:行号` + 风险等级 + 具体改法）。
> 交付：本文件是本次评审**唯一的仓库写入**（另在 gitignore 的 `.local/` 放了 4 个只读复现脚本，见 §6，可随时删）。

---

## 0. 基线与读法（**行号会漂：先看这节**）

评审期间 `plugin/client.js` 正被 Lead 持续改动（18:24→18:37 从 7096 行涨到 7200 行）。因此**行号只对下表这一份修订有效**；若行号对不上，请用每条给出的**锚点串**（反引号里的代码片段）grep 定位。

| 文件 | 行数 | sha256(前 12) | mtime |
|---|---|---|---|
| `plugin/client.js` | 7200 | `cdc93f6a0ded` | 2026-10-17 18:37:18 |
| `plugin/host.impl.mjs` | 887 | `ac31452beb20` | 2026-10-17 17:50:27 |
| `plugin/browser-tools.host.mjs` | 850 | `b3f484893921` | 2026-10-17 18:31:26 |
| `plugin/wire.host.mjs` | 189 | `998a96578cf4` | 2026-10-10 20:48:59 |
| `plugin/annot-delivery.host.mjs` | 302 | `1e4c2b7767f6` | 2026-10-11 01:47:35 |
| `plugin/plugin-config.schema.mjs` | 107 | `b21e6c1d1134` | 2026-10-10 20:48:59 |
| `src/shot-view.mjs`（新增） | 104 | `e7c2895b80fb` | 2026-10-17 18:30:42 |
| `src/tool-presentation.mjs`（新增） | 61 | `7905f38875cf` | 2026-10-17 18:30:55 |

**测试基线（我实测，非引用）**
- 18:24：`tests 241 / pass 240 / fail 0 / skipped 1` ✓（与任务书一致）
- 18:41（Lead 改动中，新增 9 项测试后）：`tests 250 / pass 248 / **fail 1** / skipped 1`
  - 唯一失败：`test/hid-fixture-smoke.test.js` → `Error: EPERM, Permission denied` 删 `%TEMP%\dsh-kit-chrome-*`（环境/清理型，不是逻辑回归；改法见 H-9）
  - 另：18:41 前的一次运行曾出现 `strictEqual actual=6 expected=5`，随后那次**未复现**（Lead 正在改，判定为改动中间态）。

**已核实可用的运行时事实**（第一手，来自 `plugin/.data/probe-report.json` 与 asar）
- `dshRuntimeVersion: "0.2.1-rc.2"`（来源 `app.asar/dsh/node_modules/@deepseek-ai/dsh-app-boot/package.json`）✓
- `declaredEnginesDsh: ">=0.2.0-rc.2 <0.3.0-0"` ✓（官方判定只认它，`includePrerelease` 语义）
- 工具注册：`registered: 27`、`defineToolSource: resourcesPath/app.asar|import`、`errors: []` ✓
- 本机这一轮 `electronLoad.ok = false`、`webContents = null`、`guestProbe = []`（`ELECTRON_RUN_AS_NODE=1`）⇒ host 侧 Electron 探测在本部署**恒失败**（见 D-5）。

---

## 1. 结论速览

| # | 项 | 结论 | 最高风险 |
|---|---|---|---|
| 1 | 契约正确性 | `output` 契约 ✓、槽位注册参数 ✓、face 方法名/参数/可选标记 ✓；**签名串 6/17 漂移**；`presentCall/presentResult` 的作用被误述（**不进 Client**）；新增静态 import 丢 `?ts=` | **高** |
| 2 | 资源与生命周期 | 11 个 `setInterval` **全部有主**（trackInterval/effect/组件卸载）✓；**HID 快泵自续链无围栏无清理** ✗；resize 监听泄漏 ✗；host/client 三处无界 Map/Set ✗ | **中高** |
| 3 | 错误处理 | `wire.host.mjs #guard` 统一 `{ok:false}` ✓；**`host.impl.mjs` 三处引用未定义标识符 → catch 自身抛**（可复现）✗；`ok:true` 掩盖落盘失败 ✗；null 哨兵假超时 ✗ | **高** |
| 4 | 性能 | 2s/2.5s/1s tick 与有界缓存 ✓；**2s tick 无可重入闸**（单轮可 >10s）✗；tick 内重复全量 DOM 查询 ✗ | 中高 |
| 5 | 安全 | 路径围栏三处 ✓、URL 策略 ✓、凭据只在 GUI localStorage ✓；**用户名进 console** ✗；`gui-eval` 可读凭据（边界需声明）✗；face 无 policy ⇒ 远程默认拒绝（安全默认 ✓） | 中 |
| 6 | 解剖/解耦 | A1 范式已在用（`src/*` 正典 + 内嵌副本 + parity）✓；仍有 basename×6、会话作用域查询×7、可见性判定×3、URL 策略内联 | 中 |
| 7 | simplify | 5 个 config 键**全部无人读取**（详情页假开关）✗；`plugin/index.js` 死文件；`resolveSchemasterySync` 死函数；重复对象键 ×2 | 中 |
| 8 | 测试缺口 | 29 个测试里关键失败路径（catch 降级）、签名串、定时器对称性、诊断语义、config 使用均无钉子 | 中高 |

---

## 2. 逐项清单

### 2.1 契约正确性（必查 1）

#### C-1 ✓→✗ face 方法表：方法名/参数/可选标记 ✓，签名串 6/17 不一致
**证据**（我用脚本对拍两端数组，可复现）：
- `plugin/wire.host.mjs:33` `const FACE_METHOD_TABLE = [`（33–52，17 条）
- `plugin/client.js:74` `REMOTE_CONTRIBUTION = { descriptors: [`（74–118，17 条）
- 脚本输出：`paramDiffs=0 optDiffs=0 signatureStringDiffs=6 / 17`，差异集中在 `saveAnnotations / takeCommand / hidOpen / hidRead / getHidShim / hidTrace`（例：wire 的 `takeCommand` 签名含 `{ok:true, command:null}` 与"取走即删"，client 写的是 `command=null 表示无命令`）。
- `plugin/wire.host.mjs:4` 注释自称「与 client.js REMOTE_CONTRIBUTION.descriptors **逐字**对账」——**与实际不符**。
- 而 `test/plugin-client-contract.test.mjs:200`（"W3：client descriptors ↔ wire FACE_METHOD_TABLE 逐字对账"）的正则 `:205` 只抽取 `['method', [params], "sig", [optionals]]` 的 **method/params/optionals**（`:217` 只 deepEqual 这三样）⇒ 签名串漂移**永远不会红**。

**风险**：中（签名串只喂 `TYPERT.model.services[].members[].signature`，即给模型看的文案；但它同时是"契约文档"，漂移会误导后续改动）。**改法**（二选一）：
1. 抽 `src/face-methods.mjs` 作单一正典（`[[method, params, sig, optionals], ...]`），`wire.host.mjs` 直接 import（宿主支持相对 import），`client.js` 内嵌副本 + parity 对拍（A1 模式，与 `src/annotations-summary.mjs` 同款）；或
2. 最小改：把 `client.js` 6 处签名串改成与 wire 逐字一致，并把 `test/plugin-client-contract.test.mjs:205-217` 的抽取改成**含签名串**的四元组 deepEqual。

#### C-2 ✓ `output` 契约正确（0.2.1 官方最小合法形态）
**证据**：`plugin/browser-tools.host.mjs:333` `const OUT = { schema: { type: 'json' }, render: (args, value) => [{ type: 'text', text: ... }] }`（注释在 `:11`）；官方实现 `app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js:842-849` 无条件读 `options.output.render` / `.schema`（缺即 TypeError），`:786-795` 明确 "The author-only `json` node becomes an annotation-only schema" ⇒ `{type:'json'}` 正是官方给"任意 JSON 根"的写法 ✓；注册期断言 `:2977-2978`、结果期 `:3637-3648`（结果先 `snapshotToolValue` 再按 `output.schema` 校验，违规抛 `ToolOutputError`）。
**风险**：低。**改法**：保持现状，并在 `OUT` 处补一句注释指向 `dsh-tools/lib/index.js:786-795`（防后来者按 JSON Schema 语义去改 `{type:'json'}`）。⚠ 附带纪律：render 必须返回**无损 JSON**（`undefined` 字段/类实例会被 `snapshotJsonValue` 丢掉或判失败）——见 U-3。

#### C-3 ✗ `presentCall/presentResult` 的作用被误述：**它们不进 Client**
**证据**（官方包自带文档，逐字）：
- `app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-tool/README.zh.md:54`：「结构化卡片直接从第一方原始 event 字段派生；**Host `presentCall` 与 `presentResult` 值不会进入 Client**。」
- 同 README `:12`：客户端通过 **keyed slot `tool.call.toolview`** 按工具名分发，未注册的用通用卡片；`:36-44` 给出注册示例 `{ name:'tool.call.toolview', key:'<wire tool name>' }`。
- `dsh-tools/lib/index.js:833` 自己的头注也写明 presenters 是 **"Replay-only"**。
- 而本仓库 `src/tool-presentation.mjs:9-10` 与 `plugin/browser-tools.host.mjs:277-280` 写着：「⚠️ 缺声明 ⇒ 宿主不把这张卡交给 keyed `tool.call.toolview` 分派 ✗（实机：槽位注册 ok 但渲染器从未被调用 —— 这正是一次真实踩坑 ✓）」。
**风险**：中（**错误归因**会把排查引到死路；且已产出两个新文件的正典注释都带着这个错误前提）。**改法**：
1. 改写上述两处注释：presentCall/Result 仅用于 replay/日志回放，**不影响** Client 渲染；保留它们无害但别再当作卡片生效的前提。
2. 真正的卡片不渲染原因见 C-4。

#### C-4 ✗ 已注册 toolview 取不到文件名（截图卡不渲染的**真因**）
**证据**（官方结果块形状）：
- `app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-tool/lib/client.js:311`：`const argsRaw = done ? block.call?.argsRaw ?? "" : ...`，其中 `:310` `const done = "kind" in block;`
- 同文件 `:346`：`const call = "kind" in block ? block.call : block;`
⇒ **结果阶段（result）的载荷包在 `block.call` 里**；`preparing/start` 阶段才是 `block` 本体。（官方 README.zh.md:46/50 同样说明 owner 载荷 = `ToolCallOwnerProps{phase, block}`，`block` 暴露 `name` 与懒 `args`，result 用 `call` 字段。）
而本仓库：`src/shot-view.mjs:29` `const meta = block && block.meta;`、`:34` `const content = (block && block.content) || [];`；`plugin/client.js:5810`（内嵌副本 `shotNameOf`，同样 `:5812` 读 `block.meta`）→ 取不到 ⇒ `plugin/client.js:5905` `if (!name) return null;` ⇒ **卡片渲染成空**。
（附：本报告的 `kit-status` 自诊断 `shotView` 计数会显示 `called>0 / named=0`，可直接验证此判断。）
**风险**：中高（功能长期不生效；`stateRef.shotView` 诊断会显示 `called>0, named=0`，正好能验证本判断）。**改法**（3 行，正典 + 内嵌 + parity 三处同步）：
```js
export function shotNameOf(block) {
  const b = block && typeof block.call === 'object' && block.call ? block.call : block; // 结果块：载荷在 .call
  const meta = b && b.meta;           // 其余逻辑改用 b
  const content = (b && b.content) || [];
  ...
}
```
并补 parity 断言：喂两种形状（`{kind:'result', call:{content:[...]}}` 与 `{phase:'start', name, argsRaw}`）都要能取到 `.png`。

#### C-5 ✓ 槽位注册参数与官方示例同形
**证据**：`plugin/client.js:5977`（`safeInject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'browser_screenshot' }, ...))`）vs 官方示例 `dsh-client-ui-tool/README.md:39-43`；真实实现 `dsh-client-ui-cordis/lib/client.js:1446-1451`（`ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({name, key, locale, inject}, Row))`）✓。`shell.overlay` / `plugins.bundle.config` / `plugins.row.config` / `sidebar.right.tab.menu.item` 四个槽位实测 `ok:true` ✓（`probe-report` → `kit-status.compat.slots`）。

#### C-6 ⚠ `slotStatus` 会把失败记成成功（诊断不实）
**证据**：`plugin/client.js:5617` `const safeInject = (id, cb) => { ... try { const r = slotsApi.inject(id, cb); slotStatus[id] = { ok: true, at }; ...`——`ok:true` 记在 `inject()` 返回之后，而真正的 `ctx.slots.register(...)` 在**回调内**执行（`slots.inject` 是否同步调用回调是实现细节）。若回调执行期抛错（例如 `plugins.bundle.config` 的 register 失败），诊断仍报 `ok:true` ⇒ 与"一眼看出哪个槽位没挂上"（`:5621-5625` 注释的承诺）矛盾。
**风险**：中（诊断失真，正是 0.2.1 升级时最需要的那块信号）。**改法**：把 `slotStatus[id] = {ok:true}` 移进回调、放在 `ctx.slots.register(...)` 之后；回调内包 try/catch 记 `{ok:false,error}`；`safeInject` 外层 catch 保留（防 `inject` 本身抛）。

#### C-7 ✗ 新增静态 import 丢掉 `?ts=`（P13 家族复发）
**证据**：`plugin/browser-tools.host.mjs:26` `import { presentCallOf, presentResultOf } from '../src/tool-presentation.mjs';`——`browser-tools.host.mjs` 本体由 `host.impl.mjs` 以 `?ts=${wireCacheBust}` **动态** import（`host.impl.mjs:46`），但它的**静态相对导入不带查询参数** ⇒ `src/tool-presentation.mjs` 被进程级 ESM 缓存，改了它**不重启不生效**。这与 `host.impl.mjs:11-13` 的明文纪律（"相对导入会丢查询参数，必须显式带上"）以及 `hid-bridge`/`wire`/`annot-delivery` 三处的 `?ts=` 做法直接冲突。
**风险**：中（"改了没生效"最难查的一类）。**改法**：
```js
let presMod = null;
const loadPresentation = async () => (presMod ||= await import(`../src/tool-presentation.mjs?ts=${wireCacheBust}`));
```
（或按 C-1 的建议把纯函数合并进单一正典，由 `wire.host.mjs` 那条已带 `?ts=` 的链一起加载。）
**同类**（长期存在，同风险，建议一并评估）：`plugin/host.impl.mjs:19` `import { buildAnnotationsMarkdown } from '../src/annotations-protocol.js';`——批注协议改了也需重启。

#### C-8 `dsh.client.inject` 是否够用 → 够（但两套 inject 需注释说明）
**证据**：manifest 侧 `plugin/package.json:18-26` `dsh.client = { platform:'web', immediately:true, inject:[dsh-client-ui-conversation, dsh-client-ui-slots, dsh-client-ui-settings-plugins] }`；工厂侧 `plugin/client.js:603` `inject: ['slots','remote','typert']`。实测 4/4 槽位 ok、面板与卡片注册成功 ⇒ **够用** ✓。
**风险**：低。**改法**：加一行注释说明二者语义（manifest inject = 客户端包依赖/加载序；工厂 inject = cordis 服务），避免后来者把 `remote`/`typert` 从工厂 inject 里删掉（`$mount` 硬依赖 `remote`，`client.js:603` 注释已提到）。

---

### 2.2 资源与生命周期（必查 2）：注册点 → 清理点

**定时器全量审计**（脚本逐行扫描 `plugin/client.js`，共 11 个 `setInterval` 站点 + 1 个页面内脚本串）：

| 行 | 站点 | 清理 |
|---|---|---|
| 412 | `const t = setInterval(() => force(...), 1500)` | ✓ React `useEffect` 返回 `clearInterval(t)`（:413） |
| 1321 / 4493 | `agentGlow` 光效 | ✓ `st.timer = trackInterval(...)` |
| 2658 | `syncPanes()` 1.5s | ✓ `trackInterval` |
| 3386 | `agentView.idleTimer` 1s | ✓ `trackInterval` + `releaseAgentView` 内 `clearInterval` |
| 3588 | 面板就绪轮询 `iv` | ✓ 稍后 `trackInterval(iv)` + 自清理 |
| 4638 | 注入给 guest 的脚本串（页内） | n/a（随页面销毁） |
| 5200 | 命令轮询 2.5s | ✓ `trackInterval` |
| 5208 | 命令看门狗 45s | ✓ `trackInterval` |
| ~5920 | 徽标组件内 1.2s | ✓ 组件卸载 `clearInterval(timer)` |
| 6811 | `tbGuardTimer` 3s | ✓ 紧随 `trackInterval(tbGuardTimer)` |
| 7099 | **主 2s tick** | ✓ `trackInterval` |

⇒ **`setInterval` 全部有主 ✓**（历史 P20 那批已修好）。统一清理口：`plugin/client.js:672-695`（`ctx.effect` 内 `for (const id of trackedIntervals.splice(0)) clearInterval(id)` + `releaseAgentView()`）。
- `plugin/client.js:5577`（自动补测）与 `:6804`（工具条 observer，清理由 `ctx.effect(() => () => tbObserver.disconnect())` 保证）✓。**ResizeObserver**：agentView 的 `resizeObserver` 在 `releaseAgentView` 断开 ✓；`paneFitObservers` 是 WeakMap + 显式 `disconnect`（`:6056`）✓。

#### R-1 ✗ HID 快泵：自续 `setTimeout` 链，**无实例围栏、无卸载清理**
**证据**：`plugin/client.js:6976` `const startHidPump = () => { const loop = async () => { let did = false; try { did = await pumpHidOnce(); } catch {} setTimeout(loop, did ? 40 : 400); }; setTimeout(loop, 400); };`
（`:6980` = `setTimeout(loop, did ? 40 : 400)`）——① `trackInterval` 只登记 `setInterval` **id**，这条链**不在任何清理路径里**；② 链内**没有** `isLiveInstance(...)` 守卫（全文件 `isLiveInstance` 只出现在 194/669/3341/7101，主 tick 的守卫在 7101）。
**后果**：插件卸载/热重载后旧实例的泵仍以 400ms 永久自续，并继续对 webview 调 `executeJavaScript`（与新实例的泵双写）——正是本仓库已经打过一轮的"新旧实例互刷"类 bug（见 `plugin/client.js:178-200` 实例围栏的来历注释）。
**风险**：中高。**改法**：
```js
let hidPumpStopped = false;
const loop = async () => {
  if (hidPumpStopped || !isLiveInstance(stateRef.clientBootAt)) return;   // ★围栏
  let did = false;
  try { did = await pumpHidOnce(); } catch {}
  if (!hidPumpStopped) setTimeout(loop, did ? 40 : 400);
};
```
并在 `ctx.effect`（:672-695）里追加 `hidPumpStopped = true;`。

#### R-2 ✗ 凭据菜单的 `window` resize 监听不解除
**证据**：`plugin/client.js:6679` `try { window.addEventListener('resize', placeCentered); } catch {}`；全文件 `removeEventListener` 只有两处（`:409` 面板事件、`:6103` mousedown），**没有** `removeEventListener('resize', ...)`（grep 命中 0）。
**后果**：每次打开"钥匙"菜单泄漏一个监听器 + 闭包持有的 `menu`/`curPane`/`btn`（已从 DOM 移除但被引用 ⇒ detached DOM 不回收）。用户反复开菜单会线性增长。
**风险**：中。**改法**：给菜单做一个统一收口 `const disposeCredMenu = () => { try { window.removeEventListener('resize', placeCentered); } catch {} try { menu.remove(); } catch {} credMenu = null; };`，所有关闭路径（`:6103` 的 `onDown`、`:6603/:6631` 的"关闭"按钮、`:6246` 的重复打开分支）改调它。

#### R-3 ⚠ `withTimeout` 悬空定时器
**证据**：`plugin/client.js:6820` `const withTimeout = (p, ms, tag) => Promise.race([Promise.resolve(p), new Promise((_, rej) => setTimeout(() => rej(new Error(`${tag} 超时(${ms}ms)`)), ms))]);`——先落地的一侧不会 `clearTimeout`。tick 内多处调用（hid-bridge 8s、annot-probe 4s、reinject/auto-join 8s…）⇒ 每轮 tick 平均留下数个最长 8s 的 pending timer（不构成 unhandled rejection，但白占定时器与闭包）。
**风险**：低。**改法**：`const t = setTimeout(...); return Promise.race([...]).finally(() => clearTimeout(t));`。同类还有 `plugin/client.js:5488` 附近的 `capturePage` 8s 竞速（超时后 `captureCooldownUntil += 10000` 已有兜底，可一并收口）。

#### R-4 ⚠ 卸载时未清的零散定时器
**证据**：`stateRef.autoProbeTimer`（`:5585-5586`，MutationObserver 防抖 `setTimeout`）只在自身路径 `clearTimeout`，插件卸载不取消（低危，一次性 800ms）。全文件 `setTimeout(` 26 处 vs `clearTimeout(` 2 处——不全是问题（fire-and-forget 居多），但应作为纪律提示。

#### R-5 ✗ 三处无界容器（长会话只增不减）
| 位置 | 容器 | 说明 |
|---|---|---|
| `plugin/annot-delivery.host.mjs:216` | `primedSessions = new Set()` | 每会话一条；若 sid 不稳定则**每步一条**（见 U-1）。无上限 |
| `plugin/annot-delivery.host.mjs:215` | `pending = new Map()` | 未被消费的投递永久驻留（会话不再发消息 = 永不清理） |
| `plugin/client.js:6292` | `credAutofillState = new Map()` | key = paneId，面板关闭后不删 |
| `plugin/host.impl.mjs:566` | `.data/command-results.jsonl` | 只 append 不轮转（对照：`state.shots` ≤50 ✓、`sentChips` ≤100 ✓、`recentShots` ≤12/24MB ✓） |

**风险**：中（都是 KB 级，但"长会话变卡/变慢"的累积项）。**改法**：`primedSessions` 加 LRU 上限（如 200，超出删最旧）；`pending` 加 TTL（记 `at`，`pre-step` 时丢弃 >10 分钟的）；`credAutofillState` 在 tick 里按现存 pane 集合清理；`command-results.jsonl` 在 `apply` 时 >2MB 就截断/改名轮转。

---

### 2.3 错误处理（必查 3）

#### E-1 ✗✗（最高）`host.impl.mjs` 三处引用**未定义标识符** `errOf`；`saveMergedImpl` 的 catch 还引用了不在作用域的 `log` ⇒ **catch 自身抛异常**
**证据**：
- `plugin/host.impl.mjs:513-519`（锚点 `latestPath = join(dir, 'latest.md')` 在 `:514`）：
  ```js
  try { latestPath = join(dir, 'latest.md'); writeFileSync(latestPath, content, 'utf8'); }
  catch (e) { log('warn', `annotations/latest.md 写入失败（不影响本次落盘）：${errOf(e)}`); latestPath = null; }
  ```
  `log` 是 `apply` 内的 `const log = makeLogger(ctx)`（`:679`），`saveMergedImpl` 是**模块级函数**（`:461`）⇒ 无闭包可达；`errOf` **全文件未定义**（只有 `msg`，`:50`；`errOf` 定义在 `plugin/browser-tools.host.mjs:27`）。
- `plugin/host.impl.mjs:700`（annot-delivery 注册异常的 catch）与 `:778`（投递登记失败的 catch）同样写 `errOf(e)`。
- **实测复现**（脚本：把 `annotations/latest.md` 造成目录 → `writeFileSync` 必抛 EISDIR）：
  ```
  THREW: ReferenceError | log is not defined
  ```
  即：本该"降级为 `{ok:true, latestPath:null}`"的路径变成**抛异常**。
**后果分级**：
- `:517`：`saveMergedImpl` 抛出 → 被 `wire.host.mjs:78-84` 的 `#guard` 兜住 → 本次提交返回 `{ok:false, error:"log is not defined"}`（用户看到"批注提交失败"，且 `latest.md` 未写）。
- `:700`：**最危险**——`apply` 里 annot-delivery 注册一旦抛错，catch 自身再抛 ⇒ **整个 `apply` 中断**（其后的探测、face 注册、27 个工具注册**全部跳过**），最终只由 `plugin/entry.mjs:58-64` 打一行"impl 加载失败"。用户体感 = "插件整体静默失效"。
- `:778`：`onSaveMerged` 内层 catch 再抛 → `#guard` → 该次投递登记失败被记成 `{ok:false}`。
**为什么没人发现**：正常路径不触发，而 `test/plugin-impl.test.mjs:273-307` 只测 happy path / 去重，`test/annot-delivery.test.mjs:126` 只做**源码正则**断言（`assert.match(hostSrc, /latestPath = join\(dir, 'latest\.md'\)/)`）⇒ 241 项全绿。
**风险**：**高**。**改法**（3 行级）：
1. `plugin/host.impl.mjs` 顶部加与 tools 同形的：`const errOf = (e) => (e && e.code ? `${e.code}: ${e.message}` : String((e && e.message) || e));`
2. `saveMergedImpl` 里去掉对 `log` 的依赖：`catch (e) { latestPath = null; }`（或用模块级 `let reportLog = () => {}`，由 `apply` 赋值为 `log`）；
3. 给 `:700`/`:778` 的 catch 加二道保险（catch 内绝不再引用可能未定义的标识符），并在 `:700` 的 catch 里**继续执行后续初始化**（把 annot-delivery 的注册挪到 `apply` 末尾，或把 try 体缩到最小）。
4. 回归钉见 H-1。

#### E-2 ✗ 读回执失败 = "还没回执"（超时消息误导）
**证据**：`plugin/browser-tools.host.mjs:45-51`
```js
export function readCommandResultImpl(pluginDir, id, maxLines = 400) {
  let text = '';
  try { text = readFileSync(join(pluginDir, '.data', 'command-results.jsonl'), 'utf8'); }
  catch { return null; }            // ← :49-51：ENOENT 与 EACCES/EMFILE/句柄占用 不可区分
```
调用侧 `:96` `if (r !== null) return r;` ⇒ 权限/句柄类失败被当成"client 未回执"，工具白等满 `timeoutMs`（默认 25s）后报 **"面板可能未打开或 client 未加载"**（`:97`）——排障方向被带偏。
**风险**：中。**改法**：`catch (e) { if (e && e.code === 'ENOENT') return null; throw e; }`，`runBrowserCommand` 内 catch 成 `{ ok:false, error: '读回执失败：' + errOf(e) }`。

#### E-3 ✗ `null` 哨兵导致"结果就是 null"时假超时
**证据**：`plugin/browser-tools.host.mjs:52` `if (obj && obj.id === id) return obj.result === undefined ? null : obj.result;` 与 `:96` `if (r !== null) return r;`——同一个 `null` 既表示"没找到"也表示"结果为空"。而 client 侧 `plugin/client.js:5198-5203` 的 `Promise.race` 若让 `result` 落到 `undefined`，`host.impl.mjs:568` 写的是 `result === undefined ? null : result`，且 `JSON.stringify` 会直接丢掉 `result` 键 ⇒ 宿主读回 `obj.result === undefined` ⇒ **永远等满超时**。
**风险**：中低（需要"client 返回空结果"才触发，但一旦触发是 25s 静默卡顿 + 假错误）。**改法**：把哨兵换成结构体：命中返回 `{ found: true, value }`，"没找到"返回 `null`；`runBrowserCommand` 判 `r && r.found`。（注意 `test/browser-tools-host.test.mjs:119-126` 固化了旧语义，需同步改。）

#### E-4 ✗ 用 `ok:true` 掩盖落盘失败
**证据**：`plugin/client.js:5519` `if (!out.ok && out.clipboard && out.clipboard.ok) out.ok = true; // 落盘失败但剪贴板成功也算部分成功`；同款 `:5525`（`insertToComposer`）。此时返回给模型的是 `{ ok:true, path:null, bytes:null, error:"<落盘失败原因>" }` ⇒ 模型据 `ok:true` 认为截图成功，下一步 `read_image(null)` 失败；而 `error` 非空又与 `ok:true` 自相矛盾（本条正是 `plugin/client.js:630-633` 注释里描述过的坑的另一面）。
**风险**：中。**改法**：保持 `out.ok = !!(r && r.ok)`（磁盘为准），另加 `out.partial = true` / `out.clipboard = {...}` / `out.composer = {...}`；或在 `out.ok=false` 时把 `error` 写成"A 失败但 B 成功"的合并文案。

#### E-5 ⚠ client `apply` 兜底只打 console
**证据**：`plugin/client.js:7192` 附近 `catch (e) { try { console.warn(`${LOG_PREFIX} apply 降级（不阻塞启动）:`, e && e.message); } catch {} }`——client 半边整体失效时，面板/工具条/胶囊全无，而**没有任何可读回执**（`kit-status` 也读不到，因为它没注册）。
**风险**：中（排障成本）。**改法**：catch 内 `globalThis.__dshKitClientDiag = { activationError: msgOf(e), at: ... }`（gui-eval 可读），或在 `reportToHost` 可用时上报 `activationError` 进 `probe-report.json`。

#### E-6 ⚠ 其它吞错（有诊断则不算问题，逐条列出供判断）
- `plugin/client.js:6274`（`tryAutofillPanes` 的 `catch {}`，锚点"自动填充失败绝不影响主流程"）：错误连消息都不记（注释"不记录任何值"正确，但**错误码**可记）；配合"自动填充静默不生效"类反馈会无从定位。
- `plugin/host.impl.mjs:616`（`deleteAnnotationsImpl` 清索引的 `catch {}`）、`:408`（`writeArtifact` 索引行）、`:661`（`clearArtifactsImpl` 单文件失败）——都属于"主交付成功、旁路失败"，可接受 ✓（且前两者已在注释中声明）。
- `plugin/host.impl.mjs:329-332`（写报告失败只 console.warn）✓ 合理。
- ✓ **用户可见失败有回执**：所有 face 方法经 `wire.host.mjs:78-84 #guard` 统一转 `{ok:false,error}`；27 个工具的结果都带 `ok/error`。

---

### 2.4 性能（必查 4）

#### P-1 ✗ 2s tick 没有可重入闸（单轮可跑 10s+，`setInterval` 会叠轮）
**证据**：tick 注册在 `plugin/client.js:7099`（`trackInterval(setInterval(async () => { ... }, 2000))`），体内 `:7138` `await withTimeout(tickHidBridge(hidSvc, webviews), 8000, 'hid-bridge-tick')`，之后 `await tickSelfHealAndAutoJoin(...)`，其内部对每个面板 `withTimeout(..., 4000/8000)`（`:7081/7083/7093`：`annot-reinject`/`annot-restart`/`auto-join`）。全文件 grep `tickBusy` = **0 命中**（只有 `hydrateBusy`/`autoJoinBusy`/镜像单飞这些**子**闸）。
**后果**：一次慢 tick（HID 桥 8s + 自愈 8s×N）期间 `setInterval` 会再起 4–5 轮，多个 tick 并发跑同一批 DOM 写入/注入逻辑（子闸只挡住了部分段落，"前半同步段"仍会叠）。
**风险**：中高。**改法**：入口加单飞
```js
let tickBusy = false;
if (tickBusy || !isLiveInstance(stateRef.clientBootAt)) return;
tickBusy = true;
try { ... } finally { tickBusy = false; }
```
（或改成"自续 `setTimeout` + `await`"模式，天然不叠轮——也是 R-1 修好后的统一形态。）

#### P-2 ✗ 每轮 tick 的重复全量 DOM 查询
**证据**：tick 已经算好 `webviews`（`:7130` `const webviews = Array.from(document.querySelectorAll('webview')); // R4.1：tick 内单次查询复用`），但同轮内仍有：
- `plugin/client.js:7035` 调用 `tryAutofillPanes()`，其内部再查 `document.querySelectorAll('[data-sidebar-right-session="${sid}"] webview')`（`:6304`）；
- `tickChipLifecycle` 内的 paneFit 自愈循环又全量查一次 `document.querySelectorAll('webview')`；
- 另有 `#dsh-kit-toolbar-btn`、`CE_SEL` 等查询（后者属必要）。
全文件 `querySelectorAll('webview')` 共 **19 处**；会话作用域版（`[data-sidebar-right-session="${sid}"] webview`）共 **7 处**（`:2148/2185/2238/2295/3839/4131/6304`），其中 `:3839` 已有 `scopedWebviews(sessionId)`（声明 `:3836`）却只有部分调用点用它。
**风险**：中低（2s 一次全量 DOM 扫描 ×3，页面大时可见）。**改法**：把 `webviews` 作为参数传进 `tickChipLifecycle`/`tryAutofillPanes`；把 7 处手写选择器统一改调 `scopedWebviews(sid)`（顺带完成 §2.6 的第 3 项抽取）。

#### P-3 ⚠ 回执文件每 250ms 全量读
**证据**：`plugin/browser-tools.host.mjs:46-51`（整读 + `split('\n')`，虽只扫尾部 400 行）+ `:95` `await sleep(250)` 轮询 ⇒ 单条命令 25s 内可读 **100 次**整文件；而 `command-results.jsonl` 无轮转（R-5）⇒ 长会话后文件越大越慢。
**风险**：中低。**改法**：只读文件尾部固定字节（`openSync`+`readSync(offset = size - 64KB)`），或 apply 时按大小轮转。

#### P-4 ✓ 已有界/已有节流的（无需动）
`recentShots`（条数 12 + 总字节 24MB，正典 `src/shot-view.mjs:64`）；`state.shots` ≤50（`host.impl.mjs:755`）；`sentChips` ≤100（`client.js:1477-1478`）；`commandQueue` 串行 + `waitChannelFree` 最长 3s；HID 泵自适应 40ms/400ms；探测自动补测 `MAX_AUTO_REPROBE=12` + 10 分钟自动截图节流；`getStatsImpl` 目录遍历 O(n) 仅面板需要时调用。

#### P-5 ⚠ host 探测（约 200 行）在当前部署恒失败
**证据**：`host.impl.mjs:59-168`（`shapeOf`/`extractApi`/`processIdentity`/`requireRoots`/`loadElectron`）+ `:173-260`（`runHostProbe`，含 4 次 `require('electron')` 尝试与 guest 三轮能力实测）；实测结果 `probe-report.host.electronLoad.ok=false`、`webContents=null`、`guestProbe=[]`（`ELECTRON_RUN_AS_NODE=1`，`process.type=null`）。
**风险**：低（诊断价值真实存在，但每次激活都跑一轮注定失败的 import/require）。**改法**：`import('electron')` 失败即跳到 `webContents:null` 并提前返回（现在也差不多），或把整块探针用 `DBK_PROBE=1` 门控；若确认永久不可达，可在报告里降级为 `{skipped:true, reason:'RUN_AS_NODE'}`，省掉 4 次 require 与三段异常字符串。

---

### 2.5 安全（必查 5）

#### S-1 ✓ 凭据存储位置正确（不进工作区/工具结果/诊断）
**证据**：`plugin/client.js:6217` `const CRED_STORE_KEY = 'dsh-kit-credentials';`（`:6110-6120` 附近有一段"安全边界"注释）；`credLoad/credSave`（`:6218-6231`）只碰 `localStorage`；自动填充的**诊断只记次数**（`stateRef.credAutofill = {count, lastAt}`，`:6323` 起；设计说明在 `:6286`）；`kit-status`（`:4080`）不含凭据字段 ✓；不吃批注/交付管线（`test/credential-manager.test.mjs` 已钉）✓。

#### S-2 ✗ 用户名进了 console 日志（违反本项目自己立的规则）
**证据**：`plugin/client.js:6323` `say('info', `已按域名自动填充账号：${entry.username || '(无用户名)'}（仅同源、仅空字段、不自动提交）`)`；而同一段注释（`:6183-6192` 附近）自称："**不回显明文**：本函数不写任何日志/诊断的值 ✓"、"诊断只记次数，绝不含用户名/密码 ✓"。用户名是半个凭据，且 `console` 可被 devtools/gui-eval/屏幕共享带出。
**风险**：中（**硬性规则"只允许读字段长度、绝不读值"**）。**改法**：`...自动填充账号：${entry.username ? '(含用户名)' : '(无用户名)'}...`，或只记 `String(entry.username||'').length`。

#### S-3 ✗ `gui-eval` 命令通道可读凭据 ⇒ "不进 Agent 上下文"是**约定级**保证
**证据**：`plugin/client.js:4225` `'gui-eval': async function (svc, c) { ... }`（诊断命令，在 GUI 文档内执行任意表达式）；`plugin/host.impl.mjs:540-560` 的 `takeCommandImpl` 从 `.data/command.json` 取命令 ⇒ **任何能写该文件的进程/Agent** 都能执行 `localStorage.getItem('dsh-kit-credentials')`，把明文带回 `.data/command-results.jsonl`。
**风险**：中（不是新漏洞——命令通道本就等于"任意 GUI JS 执行"，但它与"凭据绝不进 Agent 上下文"的宣称矛盾，必须在文档里如实限定）。**改法**（按成本排序）：
1. **文档**：在 `client.js` 凭据头注与 README 补一句边界声明："仅保证凭据不被任何插件自身的通道/工具/诊断回传；不防主动执行 `gui-eval` 或读取 GUI localStorage 的进程"。
2. **门控**：`gui-eval` 加环境变量开关（如 `DBK_ALLOW_GUI_EVAL=1` 才注册该 action）——命令通道本就为实施会话诊断用。
3. （弱）在 `gui-eval` 里拒绝含 `dsh-kit-credentials` 字样的表达式（只提高成本，别当防护）。

#### S-4 ✓ 路径围栏三处齐备
- 撤回：`plugin/host.impl.mjs:579-596`（`const dir = pathResolve(join(projectDirOf(paths), 'annotations'))`；`if (target !== dir && !target.startsWith(dir + sep)) return {ok:false, error:'路径越界...'}`）✓
- 本地读：`plugin/browser-tools.host.mjs:311` `const safeName = (name) => { const base = String(name||'').replace(/[\\/]/g,'').trim(); return base && base.endsWith('.md') ? base : null; }` ✓（剔分隔符 + 强制 `.md`；`..` 形态无法通过 `.md` 后缀）
- 清空：`plugin/host.impl.mjs:644-670`（kind 白名单 + 仅 `isFile()`）✓
- 文件名注入：`slugify`（`host.impl.mjs:360-369`，剔 `\\/:*?"<>|`）✓
**风险**：低。

#### S-5 ⚠ 落盘根目录不吃 config ⇒ 将来实现 `shotsRoot` 时必须同步改围栏
**证据**：`plugin/plugin-config.schema.mjs:92-93` 声明 `shotsRoot`/`annotationsRoot` 覆盖目录；实现侧 `host.impl.mjs:355-357 projectDirOf(paths)` 固定 `join(paths.pluginDir,'..')`，`saveShotImpl`/`saveAnnotationsImpl`/`saveMergedImpl`/`deleteAnnotationsImpl`/`clearArtifactsImpl`/`getStatsImpl` 全用它（`:423/439/498/583/645/622`）。
**风险**：中（当前是"配置无效"，若实现时只改写入不改围栏 ⇒ **目录穿越/漏删**）。**改法**：见 F-2；实现时把"artifact 根"收敛成单一函数 `artifactRoot(paths, kind)`，写/读/删/统计五处共用。

#### S-6 ✓ face 授权面：无 policy ⇒ **远程默认拒绝**（安全默认，不是漏洞），但功能面需知悉
**证据**：
- 官方规则：`app.asar/dsh/node_modules/@deepseek-ai/dsh-api-remote-access/README.zh.md:27`「owner（`{kind:'owner'}`）**从不受检查**」；`:40`「**不指明任何资源的调用只访问 `global` 资源，因此只有 `global` 级 role 能放行**」。
- 本插件：全仓 grep `remoteAccess|registerPolicy|principalOf` = **0 命中**；`plugin/wire.host.mjs:33-52` 的手写方法表只有 `invocation:{kind:'direct'}`、**没有 `resources` 声明**；注册方式是 `ctx.provide(FACE_NAME, face)`（`host.impl.mjs:810`）+ `exports["./typert"]`。
⇒ **本机 owner 会话不受影响**（实测工具/face 全通 ✓）；**非 owner peer（`--host`/liveshare 等）调 `dshBrowserKit/*` 会被 `remote-access/denied`（`no-allow`）拒绝** —— 这是"安全的默认"，不是越权漏洞。
**风险**：中（功能面：若将来要支持远程/liveshare 视图，能力会静默不可用；且**切勿**为了放行而注册一个 `global` role 覆盖全部 action——那会把 `hidWrite`/`clearArtifacts`/`deleteAnnotations` 一起放给远程）。**改法**：① 短期在 `wire.host.mjs` face 头注与 delta 文档里明确"无 policy ⇒ 非 owner 拒绝"；② 真要放行时按方法拆 role（只读类 `getStats/getInjectScript/hidList` 给一个 role，写入/HID 类单独授权），并记录 `principalOf` 做审计；③ 保留 U-4 的实测项。

#### S-7 ✓ URL 策略（`browser-open`）
**证据**：`plugin/client.js:4321-4335`：仅 `http/https`（`:4327`）、拒绝带凭据 URL（`:4331` `if (parsed.username || parsed.password) return {ok:false, error:'拒绝带凭据的 URL'}`）、拒绝 DSH 自身 origin（`:4332`）。与工具 description（`browser-tools.host.mjs:386` 的 `browser_open`）一致 ✓。**建议**：抽 `src/url-policy.mjs`（见 §2.6 第 5 项）以便单测。

---

### 2.6 解剖/解耦（必查 6）：**按收益排序的抽取清单**

A1 范式（`src` 正典 + `client` 内嵌 canonical 副本 + parity 对拍）已经在用 ✓：`src/annotations-summary.mjs`、`src/annot-mirror-anchor.mjs`、`src/annotations-protocol.js`（`test/annotator-protocol-parity.test.js:78`）、以及 Lead 刚加的 `src/tool-presentation.mjs`、`src/shot-view.mjs`。

| 排序 | 抽取目标 | 现状证据（重复点） | 建议形态 |
|---|---|---|---|
| 1 | **文件名解析 `baseName`** | `client.js:5523`（`String(out.path).split('\\').pop()` **只认反斜杠 ⇒ POSIX 下失效**）、`:5810-5832`（内嵌 `shotNameOf` 三段 `.split(/[\\/]/)`）、`host.impl.mjs:404/604`、`src/shot-view.mjs:10` 已有正典 `baseName` | client 内嵌副本改用 `baseName`（A1），**同时修 `:5523` 的分隔符 bug** |
| 2 | **face 方法表单一正典** | `wire.host.mjs:33` 与 `client.js:74` 两处手抄（签名串已漂移 6 处，见 C-1） | `src/face-methods.mjs`：wire 直接 import；client 内嵌 + parity（含签名串） |
| 3 | **会话作用域 webview 查询** | 同一选择器 7 处：`client.js:2154/2191/2244/2301/3836/4137/6249` 附近；`:3836` 已有 `scopedWebviews(sessionId)` 却只被部分调用点使用 | 抽 `src/session-scope.mjs`（`sessionWebviewSelector(sid)` + `pickCurrentSession()`），7 处统一调用；顺带解 P-2 |
| 4 | **可见性判定** | `client.js:847 isVisibleEl`（`checkVisibility`/`getClientRects`）、`:5244 captureVisible`（面积 ≥80²+视口相交）、`pickProbeTarget`（函数，client 探测段，锚点 `function pickProbeTarget`） | 抽纯函数 `isVisible(rect, {minW,minH,inViewport})` + 常量；阈值可测 |
| 5 | **URL 策略** | `client.js:4321-4335` 内联（安全相关、纯逻辑） | `src/url-policy.mjs` + 单测（协议白名单/凭据/自身 origin 三条） |
| 6 | **窗口代号/窗口图例** | `annotWindowTag`/`paneOwnerLabel`/`annotWindows`（`client.js:4137`）与交付摘要 `summarizeSetsForDelivery`（`annot-delivery.host.mjs:163`）各自实现"窗口分组" | 抽 `src/window-tag.mjs`（code/ordinal/key 归一化），两端共用 |
| 7 | **批注条数解析** | `host.impl.mjs:442/501`（`/# Web page annotations:\s*(\d+)/`）、`browser-tools.host.mjs:358` 附近 list 分支 | 抽 `src/annot-count.mjs`（或复用 `annotations-protocol.js` 的解析器） |
| 8 | **错误消息格式化** | `host.impl.mjs:50 msg`、`browser-tools.host.mjs:22 errOf`、`client.js msgOf`、`annot-delivery.host.mjs` 内联 `String((e&&e.message)||e)` ×5、`wire.host.mjs:82` | 统一 `src/err-text.mjs` 的 `errOf`（顺带修 E-1——host.impl 正好没有 `errOf`） |
| 9 | （低收益）host 的 `slugify/tsStamp/dedupeFile` | 已可测（`_internals` + `test/plugin-impl.test.mjs`）✓ | 如需与 A1 对齐可迁 `src/artifact-naming.mjs`；不改也无害 |

其它同功能重复（可直接进"可并"批次）：`.png` 路径正则提取 ×3（`src/tool-presentation.mjs:47`、`client.js:5822/5827`、`src/shot-view.mjs:37`）；`split(/\r?\n/,1)` 取首行 ×4。

---

### 2.7 simplify（必查 7）：可删 / 可并清单

| # | 位置 | 结论 | 依据/改法 |
|---|---|---|---|
| 1 | `plugin/index.js`（47 行，整文件） | **死文件，可删** | `plugin/package.json:8` `exports["."] = "./entry.mjs"`；`entry.mjs:11` 注释自称"index.js 仅存档不再被加载"；全仓无其他引用。留着只会让每次评审都要重新确认一遍。建议删除或移到 `docs/archive/` |
| 2 | `plugin-config.schema.mjs:89-93` 五个键 | **全部无人读取（假开关）** | grep 全仓（含 src/test）：`shotsRoot`/`annotationsRoot`/`autoJoinPanes`/`annotatorSamePageOnly`/`debugPanelDefaultHidden` **只在该文件命中**；`host.impl.mjs:678 apply(ctx, _config)` 忽略 config；client 根本拿不到 config ⇒ 插件详情页展示 5 个不生效的开关（用户设 `autoJoinPanes=false` 仍会自动拉入）。**改法**：要么实现（`autoJoinPanes` 经 face 下发 / `shotsRoot` 在 `projectDirOf` 生效，见 S-5），要么**删字段**——但**保留 `z.object({...})` 骨架**（`entry.mjs:15-24` 说明：无 schema ⇒ 详情页配置区 `absent`，卡片没落点） |
| 3 | `plugin-config.schema.mjs:57-59 resolveSchemasterySync()` | **死函数，可删** | 恒 `return null`，无任何调用方（含测试） |
| 4 | `client.js:7052 tickToolbarStyles(activeIds)` | 死参数 + 死变量 | `:7056 const sessionOn = ...;` 紧跟 `:7063 void sessionOn;`（`:7070` 附近），形参 `activeIds` 全函数未用（tick 调用点仍传 `:7113` 附近）⇒ 删这两处 |
| 5 | `client.js` 中 `enforceAnnotConvoScope = enforceAnnotSessionScope` | 兼容别名，可并 | "兼容旧命名（标题判据已被 id 取代）"；把唯一调用点改成 `enforceAnnotSessionScope` 后删别名 |
| 6 | 重复对象键 `annotActive` | 可删重复 | `client.js:735` 与 `:738` 在同一对象字面量里写两次（值相同，后者覆盖前者）；`kit-status` 又有一份 `:4105`（与既有字段重复）⇒ 各留一处 |
| 7 | `wire.host.mjs:4` "逐字对账"注释 | 与实现不符 | 按 C-1 改成"方法名/参数名/可选标记逐字；签名串为描述性文案"或统一（二选一） |
| 8 | `src/tool-presentation.mjs:9-10` + `browser-tools.host.mjs:277-280` | 与 0.2.1 官方文档矛盾 | 按 C-3 改写注释 |
| 9 | 大量"源码正则断言"测试 | 可并/可换代 | 例：`test/annot-delivery.test.mjs:75/99/117/126/149-150` 用 `assert.match(src, /…/)` 钉实现形状——改实现即红但它**不验证行为**。建议：保留少量作为"纪律钉子"，关键路径补行为测试（见 H） |
| 10 | 过时兼容分支复核 | 建议逐个判死 | `client.js` 里 "兼容旧参数 width/height"（工具参数，保留）、`h.key, h.uid` 会话 id 候选（`browser-tools.host.mjs:347` 的 `cands` 数组，保留=廉价）、`resolveSchemasterySync`（删）、`plugin/index.js`（删）、`mod['module.exports']` jiti 互操作（保留） |

---

### 2.8 测试缺口（必查 8）：最容易回归但**没有钉子**的点

| # | 缺口 | 现状 | 建议钉子 |
|---|---|---|---|
| H-1 | **E-1 的三条 catch 降级路径**（零覆盖） | `test/plugin-impl.test.mjs:273-307` 只测 happy path；`test/annot-delivery.test.mjs:126` 只做源码正则 | 加单测：临时目录 + 把 `annotations/latest.md` 造成**目录** ⇒ 断言 `saveMergedImpl` 返回 `{ok:true, latestPath:null}`（现在会 ReferenceError，见 §5 复现） |
| H-2 | **face 两端签名串** | `test/plugin-client-contract.test.mjs:200-217` 只比 id/params/acceptsUndefined | 抽取改为四元组（含签名串）deepEqual（现在 6 处漂移不会红） |
| H-3 | **`null` 哨兵语义** | `test/browser-tools-host.test.mjs:119-126` 正好固化旧语义 | 若采纳 E-3，改成 `{found:true,value}` 并补 `result:null` 用例 |
| H-4 | **定时器登记对称性** | 无任何测试 | 源码扫描断言：`setInterval(` 站点数 == `trackInterval(setInterval(` + 白名单（useEffect/组件/页内串）；并断言 `startHidPump` 内含 `isLiveInstance` 与停止标志（R-1 回归钉） |
| H-5 | **实例围栏只有正则钉子** | `test/plugin-client-contract.test.mjs:378-380` 只断言主 tick 那两行 | 把 HID 泵/toolbar observer 一并纳入断言；更好的是把"围栏判定"抽成可测纯函数 |
| H-6 | **槽位诊断语义** | 无 | 断言"回调内 `register` 抛错 ⇒ `slotStatus[id].ok === false`"（C-6） |
| H-7 | **config 键被使用** | 无 | 守卫型测试：schema 里每个键都必须能在 `plugin/` 或 `src/` 找到读取处（可直接抓出 F-2 这类假开关） |
| H-8 | **凭据值不进任何日志/诊断** | `test/credential-manager.test.mjs` 只钉"不进批注/交付管线" | 加断言：`client.js` 中不得把 `entry.username`/`entry.password` 拼进 `say(`/字符串模板（可钉住 S-2） |
| H-9 | **测试套件自身的环境健壮性** | 实测 `test/hid-fixture-smoke.test.js` 因 `EPERM` 删 `%TEMP%\dsh-kit-chrome-*` 失败（`src/cdp/drive.mjs:108` 创建、`:172-176` 清理已带 `maxRetries:12` 仍抛） | 清理包 try/catch，EPERM/EBUSY 只 warn 不 fail；否则本地/CI 常亮红灯，会掩盖真回归 |
| H-10 | 清理对称性（R-2） | 无 | 断言 `addEventListener('resize'` 与 `removeEventListener('resize'` 成对，或断言菜单有统一 `dispose` |

---

## 3. Top 10 立即行动（每条：`[风险] 位置 → 改法`）

1. **[高]** `plugin/host.impl.mjs:517/700/778`（`errOf(e)`；`:514` 的 catch 还用了作用域外的 `log`）→ 文件顶部加 `const errOf = ...`（与 `browser-tools.host.mjs:22` 同形）+ `saveMergedImpl` 的 catch 去掉 `log`/改用模块级 logger；**实测可复现 `ReferenceError: log is not defined`**，`:700` 那处会让整个 `apply` 断链（工具全消失）。
2. **[中高]** `plugin/client.js:6976-6981`（`startHidPump` 自续链）→ 链内加 `if (hidPumpStopped || !isLiveInstance(stateRef.clientBootAt)) return;` + `ctx.effect`（`:672-695`）里置 `hidPumpStopped = true`。
3. **[中高]** `plugin/client.js:7099`（2s tick，体内 `:7138` 可 await 8s+）→ 加 `tickBusy` 单飞（或改自续 `setTimeout`+`await` 形态）。
4. **[中高]** `src/shot-view.mjs:27-47` 与 `plugin/client.js:5810-5832`（内嵌副本）→ `shotNameOf` 先取 `const b = block.call ?? block;` 再读 `b.meta`/`b.content`（官方结果块形状：`dsh-client-ui-tool/lib/client.js:311/346`），三处（正典/内嵌/parity）同步。
5. **[中]** `src/tool-presentation.mjs:9-10` + `plugin/browser-tools.host.mjs:277-280` → 改写注释：`presentCall/presentResult` **不进 Client**（`dsh-client-ui-tool/README.zh.md:54`），别再把它当卡片渲染的前提。
6. **[中]** `plugin/browser-tools.host.mjs:26`（静态 import 丢 `?ts=`）→ 改 `await import(\`../src/tool-presentation.mjs?ts=${wireCacheBust}\`)`；同风险复核 `plugin/host.impl.mjs:19`。
7. **[中]** `plugin/client.js:5519`/`:5525`（`out.ok = true` 掩盖落盘失败）→ 保持 `ok:false`，改记 `partial/clipboard/composer` 字段。
8. **[中]** `plugin/browser-tools.host.mjs:49-51`（`catch { return null; }`）与 `:52`+`:96`（`null` 哨兵）→ ENOENT 返回 null、其它错误抛出；命中返回 `{found:true,value}`（同步改 `test/browser-tools-host.test.mjs:119-126`）。
9. **[中]** `plugin/plugin-config.schema.mjs:89-93`（5 个键全部无人读取）→ 实现或删字段（**保留 `z.object({})` 骨架**，否则详情页配置区消失，见 `entry.mjs:15-24`）。
10. **[中]** `plugin/client.js:6679`（resize 监听不解除）+ `:6323`（打印用户名）→ 菜单加 `disposeCredMenu()` 统一收口并 `removeEventListener('resize', …)`；自动填充日志改成只记"有无用户名"。

**次批（做完上面再动，纯收益无风险）**：`plugin/index.js` 删除（死文件）；`resolveSchemasterySync` 删除；`tickToolbarStyles` 死参数/`void sessionOn` 删除；`annotActive` 重复键删除；`enforceAnnotConvoScope` 别名合并；`client.js:5523` 的 `split('\\')` 改 `baseName`；7 处会话作用域查询收敛到 `scopedWebviews`。

---

## 4. 未确认项（**不敢写死，需 Lead 实测**）

- **U-1 annot-delivery 是否每步重复注入 primer？** 我这条会话在**多处**都看到同一段 `[dsh-browser-kit] 浏览器能力（一句话）…`（≥5 次），而 `plugin/.data/probe-report.json` 显示 `annotDelivery { injected: 8, primedSessions: 8, lastSessionId: "b6b4127a-…", pending: 0 }`，且 18:28 之后不再增长。两种解释：①该 DSH 实例确有 8 个会话各注入一次（正常）；②`sid` 每步变化或 `ctx.on('agent/pre-step')` 被多次注册（=**每步多烧 token + `primedSessions` 无界**）。
  **验证法**：隔两步重读 `probe-report.json` 的 `injected/primedSessions`——若随步数增长即 ②；并在 `annot-delivery.host.mjs:258` 附近临时打印 `payload.agent.session` 的 key 形状对比。**注意** `:216 primedSessions` 无上限，若为 ② 需按 R-5 加 LRU。
- **U-2 会话 id 口径不一致**：交付侧用 `payload.agent.session.id || .sessionId`（`annot-delivery.host.mjs:258`），工具侧用 `session.header.id || h.sessionId || session.id …`（`browser-tools.host.mjs:347` 的 `cands`），client 侧用 DOM `[data-sidebar-right-session]`（`client.js:3839`）。三处口径不同，未确认哪个是权威。建议统一到 `header.id` 并加断言。
- **U-3 `snapshotJsonValue` 对"对象里含 `undefined` 字段"是丢弃还是报错**：我读了 `snapshotToolValue`/`snapshotProjection`（`dsh-tools/lib/index.js:2661-2681`，行为是"非无损 JSON 就抛 `ToolOutputError`"），但**没读** `snapshotJsonValue` 本体 ⇒ 无法断言"工具结果里出现 `undefined` 字段"会不会让该次调用直接失败。建议 Lead 用一条返回 `{a: undefined}` 的测试工具实测一次（若会抛，则所有动态拼字段的工具都有风险）。
- **U-4 非 owner peer 实测**：本机只有 owner，`--host`/liveshare 下 face 是否真被 `no-allow` 拒绝**未实测**（delta 文档同样标注未实测 ✓）。判定依据是官方规则（`dsh-api-remote-access/README.zh.md:27/40`），非第一手。
- **U-5 `credSave` 失败（localStorage 满/隐私模式）是否有 UI 回执**：`credSave` 返回 `false`，但我未逐行确认调用方是否提示用户（只看到 `credLoad` 返回 `[]` 的静默降级）。
- **U-6 我看到的"多次 primer"是否真的进入了我的上下文**（还是 harness 的展示重复）：只有 Lead 侧对照 `probe-report.json` + 会话记录才能定论。

---

## 5. 复现与证据（可照着跑）

```powershell
# ① face 两端对拍（输出 paramDiffs/optDiffs/signatureStringDiffs）
node .local\review-parity.cjs

# ② 复现 E-1：saveMergedImpl 的错误降级路径（把 annotations/latest.md 造成目录）
node .local\review-errpath.mjs        # → THREW: ReferenceError | log is not defined

# ③ 一次性重解全部报告锚点 + 打印基线 hash（client.js 变动后用它复核行号）
node .local\review-final.cjs

# ④ 定时器登记审计（列出每个 setInterval 站点与 trackInterval 情况）
node .local\review-timers.cjs

# ⑤ asar 内官方证据（只读，不落盘）
node .local\asar-read.cjs read "dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js" 786 812
node .local\asar-read.cjs read "dsh/node_modules/@deepseek-ai/dsh-client-ui-tool/lib/client.js" 305 315
node .local\asar-read.cjs read "dsh/node_modules/@deepseek-ai/dsh-client-ui-tool/README.zh.md" 50 56
node .local\asar-read.cjs read "dsh/node_modules/@deepseek-ai/dsh-api-remote-access/README.zh.md" 25 42
```

**关键第一手证据落点**（供 Lead 复核，全部只读）：
- `plugin/.data/probe-report.json` → `compat`（0.2.1-rc.2 / engines / defineTool 来源 / 27 工具）、`host`（electronLoad.ok=false）、`annotDelivery`（injected/primedSessions）。
- asar：`dsh-tools/lib/index.js:786-795`（`json` 值 schema 语义）、`:842-849`（output 必填）、`:2977-2978`（注册断言）、`:3637-3648`（结果校验）；
  `dsh-client-ui-tool/README.zh.md:54`（presentCall 不进 Client）、`lib/client.js:310-311/346`（`block.call` 形状）；
  `dsh-api-remote-access/README.zh.md:27/40`（owner 不检查 / 未指明资源只访问 global）；
  `dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:16`（waterfall 必须 `{...decision, messages}` + 不拥有决策要 `next()`）——本插件 `annot-delivery.host.mjs:249-286` 写法与此**一致** ✓。

---

## 6. 关于本次写入与纪律

- 本报告是本次评审**唯一的仓库写入**：`docs/review-0.2.1-rc.2.md`。
- 另在 **已被 `.gitignore` 的 `.local/`** 放了 4 个只读脚本（`review-parity.cjs` / `review-errpath.mjs` / `review-final.cjs` / `review-timers.cjs` / `asar-read.cjs`）——为让 §5 的复现可执行而保留；`.local/` 属"本机文档（不进库）"，如不需要请直接删除。
- 未修改 `plugin/**`、`src/**`、`test/**`、`package.json`、`pitfalls.md`、`docs/ver-delta-0.2.1-rc.2.md`、`docs/market-index.md`、`market/**`；未 `git add/commit/push`，未装插件，未启服务器。
- `review-errpath.mjs` 的复现会在 `%TEMP%` 建一个临时目录并在结束时 `rmSync` 删除（不碰仓库）。asar 读取全程只读、不落盘。
