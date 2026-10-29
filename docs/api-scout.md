# 官方扩展点侦察报告（api-scout · DSH 0.2.1-rc.2）

> 面向 `dsh-browser-kit` 的**可落地契约**：三件事各给「契约表 + 证据 + 可粘贴样例 + 坑/限制 + 未确认项」。
> 纪律：本轮**只读**代码库，唯一写入 = 本文件。

## 0. 结论速览

| # | 扩展点 | 能不能用 | 一句话 |
|---|---|---|---|
| 1 | `shell.bottom`（0.2.1 新增，single/root） | ✅ **能用** | 无 owner props、无 id/order/label；注册只需 `{name}`（+`priority`）。**单槽位同优先级会抛错** ⇒ 必须显式给 priority |
| 2 | `conversation.input.left` / `conversation.composer.dock`（list/session） | ✅ **能用** | `id` 必填、`order`/`label` 可选；props 里有 **`sessionId`**、`useInput`、`inputActions`、`useConversation`…；`inject.hooks` → `use<Name>` 是官方数据接入方式 |
| 3 | `dsh-client-ui-secret-mask`（0.2.1 新增） | ❌ **不可用**（对第三方插件） | 公开导出面**只有 `apply`/`inject`**，`CredentialScanner`/`createSecretRule`/`SecretText` 不可 import；且官方遮挡**只覆盖 UserText 调用方**，不覆盖插件自绘面板/未发送输入框 |

## 0.1 证据分级与本轮方法

| 级 | 来源 | 本轮是否取得 |
|---|---|---|
| **A** | npm 同版本 tarball 的 `.d.ts` / 编译产物 `lib/*.js` / `README.zh.md` / `package.json` | ✅ 全部结论基于 A |
| **A′** | 官方**内嵌 Slot 目录**：`@deepseek-ai/dsh-cordis-client-runner@0.2.1-rc.2` 的 `lib/client.js` 里带 `key/kind/scope/registerOptions/ownerProps/standardProps/occupants/declaredBy/replaceRisk/example/source`（与 inspector 同源，构建期投影） | ✅ 已取，替代实时 inspector |
| **B** | `cordis_inspect_query`（client / Slots / Theme） | ❌ **本轮不可用**（见下） |

**B 级失败记录（原样复现，别当成"没查"）**

- `Slots.listSubTree {root:"shell.bottom"}` → `Error: Slots.listSubTree: Client inspect query Slots.listSubTree timed out after 10000ms. Open or reconnect the Harness page, then retry.`（连续 2 次）
- `Theme.listTokens`（探活）→ 同样 10s 超时 ⇒ 不是单条 key 的问题，是**整条 client inspect 通道**无应答
- 尝试用自持窗口加载 GUI URL 唤醒客户端 → **被策略拒绝**（内置浏览器禁止加载 DSH 自身地址，`op=navigate` 后 URL 仍停在原页）
- ⇒ 结论：**本会话拿不到实时槽位树**；A′ 目录给出的字段比 inspector 更全（含官方样例与 `source` 行号）。**运行期真实占用仍需在启用 inspector 的 profile 里实测**（见 §4.1）

**A′ 复现（PowerShell）**

```powershell
$r = "$env:TEMP\dsh-compat"                      # 已解包目录（package/ 子目录）
# 槽位目录（registerOptions / standardProps / occupants / example）
Select-String -Path "$r\dsh-cordis-client-runner-0.2.1-rc.2\package\lib\client.js" -Pattern 'key: "shell.bottom"' -Context 0,28
# 槽位契约类型
Get-Content "$r\dsh-client-ui-layout-0.2.1-rc.2\package\lib\types\client\index.d.ts" | Select-Object -Skip 74 -First 11
# 冲突校验真源码（含抛错文案）
Get-Content "$r\dsh-client-ui-slots-0.2.1-rc.2\package\lib\index.js" | Select-Object -Skip 163 -First 28
```

---

## 1. `shell.bottom`（0.2.1 新增 · 官方 Dock 底栏）

### 1.1 契约表

| 项 | 值 | 证据（包@版本 文件:行） |
|---|---|---|
| kind / scope | `single` / `root` | `dsh-client-ui-layout@0.2.1-rc.2` `lib/types/client/index.d.ts:81-84` |
| owner props | **无**（`ownerProps: []`，`OwnerOf<'shell.bottom'>` ⇒ `object`） | 同上 `:81-84`；A′ 目录 `ownerProps: []` |
| 注册选项 | **只有 `name`**（kind=single ⇒ `KindOptions` 仅 `priority?`，**没有 id/order/label**） | `dsh-client-ui-slots@0.2.1-rc.2` `lib/types/index.d.ts:564-587`（single 分支 = `{ priority?: number }`） |
| 标准 props（全局座位） | `usePanelInfo`（layout）、`useSessions`、`useSessionStatus`、`useSessionRetainInfo`、`useSessionAccess`、`useWorkspaces`、`useRemoteAccess`、`useResource`、`useWorkspaceAccess` + `renderFactorySlot` | A′ 目录 `standardProps`；`dsh-client-ui-layout` `index.d.ts:29-32`；`dsh-client-ui-session` `lib/types/client/index.d.ts:72-79`；`dsh-client-ui-conversation` `contract/slots.d.ts:413-416`；`dsh-client-ui-renderer` `lib/types/client/registry.d.ts`（`PropsRenderFactories`，slots `index.d.ts:406-408`） |
| 无 session 绑定 | 拿不到 `sessionId`（`ScopeStandardProps<'root'>` 不含 Session 座位） | `dsh-client-ui-slots` `index.d.ts:221` |
| 挂载语义 | 三列**下方整行**；占用方自管高度与显隐；**空内容不占位**；切主面板**不卸载** | `dsh-client-ui-layout` `index.d.ts:75-80`；A′ 目录 `doc` |
| 谁声明它 | layout 的 `AppFrame`（root 槽条目）渲染 `renderSlot('shell.bottom', {})` | `dsh-client-ui-layout` `lib/client.js:347`（渲染点）、`:639`（children 声明表）；`lib/types/client/AppFrame.d.ts:4` |
| 默认占用者 | **未占用的默认组合**，但 A′ 目录记有 `occupants: ["experimental-inspector InspectorPage"]`，`replaceRisk: "shadows-shipped-ui"` | A′ 目录 `shell.bottom` 条目（runner `lib/client.js:5375-5403`）；`README.zh.md:34`「默认组合不占用此 slot」 |

### 1.2 可直接粘贴的注册样例

> 沿用本插件 `plugin/client.js` 现有形态（`window.__ModuleLoader__.load` + `require('react')` + `safeInject`）。**关键改动只有两处**：槽位名，以及**显式 priority**。

```js
/* ── shell.bottom：single/root，无 owner props；注册只需 name(+priority) ── */
const DOCK_SLOT = 'shell.bottom';

/** Dock 视图：props 里只有全局标准件（usePanelInfo 等），无 sessionId。 */
function BrowserDock({ usePanelInfo }) {
  const [open, setOpen] = React.useState(true);
  if (!open) return null;                       // ★折叠 = 渲染 null：空内容不占高度、不预留空间
  return h('div', {
    style: {
      height: 320,                              // ★高度由占用方自己决定（三列按这个高度缩短）
      display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
      background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, transparent))',
      borderTop: '1px solid var(--dsw-alias-border-l2, transparent)',
      color: 'var(--dsw-alias-label-primary, currentColor)',
      font: 'var(--ds-font-family-code, inherit)',
    },
  },
    h('span', null, '浏览器 Dock（自持窗口）'),
    h('button', { type: 'button', onClick: () => setOpen(false) }, '收起'),
  );
}

/* ★单槽位防抛错：同优先级第二次注册会抛错（真源码见 §1.3 坑①）⇒ 先探测再定 priority */
safeInject(DOCK_SLOT, () => {
  let occupied = false;
  try { occupied = ctx.slots.entriesOfSlot(DOCK_SLOT).length > 0; } catch { /* 探测失败按空处理 */ }
  return ctx.slots.register(
    { name: DOCK_SLOT, priority: occupied ? -1 : 0 },   // -1 = 抢渲染权（lowest renders）；0 = 无人时用默认位
    BrowserDock,
  );
});
```

**A′ 官方样例（逐字，最保守版本）**

```js
return {
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('shell.bottom', () => ctx.slots.register(
      { name: 'shell.bottom' },
      () => React.createElement('div', null, 'hello'),
    ))
  },
}
```
> 出处：runner `lib/client.js:5400`（`source: packages/client/ui-layout/src/client/index.ts:94`）。

### 1.3 坑 / 限制

1. **★单槽位同优先级必抛错**。真源码 `dsh-client-ui-slots` `lib/index.js:167-173`（抛错在 `:172`）：
   ```js
   const priority = options.priority ?? 0;
   case "single": {
     const occupant = rec.entries.find((e) => (e.options.priority ?? 0) === priority);
     if (occupant) throw new Error(`single slot "${options.name}" already has a registration ... register at a different priority to shadow it (lowest renders)`);
   }
   ```
   ⇒ 若 `experimental-inspector` 启用了（它占 `shell.bottom`，见 A′ 目录），**默认 priority 0 的注册会直接抛**。必须显式 priority（本文样例用"先探测再定 -1/0"）。**priority 越小越渲染**；给成正数会被别人的低优先级压住 ⇒ 注册成功但永远不显示。
2. **会顶掉官方 Inspector 底栏**：抢占语义 = 同 cell 只渲染最低优先级那一个，不是叠加。A′ 目录把它标为 `replaceRisk: "shadows-shipped-ui"`。若产品上要"浏览器 Dock 与 Inspector 并存"，`shell.bottom` 做不到——需要配置项二选一或让用户手动切。
3. **必须已声明才能注册**，否则 `register` 抛 `slot "shell.bottom" is not declared (a parent entry's children table must declare it)`（`lib/index.js:165`）。它由 layout 的 `AppFrame` 声明 ⇒ **layout 未加载/未挂载时注册会失败**（现有 `safeInject` 已能兜住并记账）。
4. **`id`/`order`/`label` 传了也没用**（single 分支不读）。TS 下会报类型错；JS 下静默被存进 `options` 但渲染忽略。
5. **没有 `sessionId`**：不要指望在 Dock 里拿到会话身份（root 作用域）。要按会话区分内容，请自己用 `useSessions`/`useSessionAccess` 或走 `conversation.*` 槽位。
6. **`ctx.slots.inject(key, cb)` 是"每次声明生命周期各跑一次"**（`registry.d.ts:96-111`）：声明消失会 dispose 回调产物，重新声明会**再跑一次** ⇒ 注册写在这里天然幂等，不要在外面只跑一次。
7. 与现有 `shell.overlay` 的关系：`shell.overlay` 是 `list/root` 且**click-through**（`layout` `index.d.ts:85-98`），是浮窗；`shell.bottom` 是**参与布局**的常驻底栏。两者可并存，不互斥。

---

## 2. `conversation.input.left` + `conversation.composer.dock`（list/session）

### 2.1 契约表（两槽位对照）

| 项 | `conversation.input.left` | `conversation.composer.dock` |
|---|---|---|
| kind / scope | `list` / `session` | `list` / `session` |
| 位置语义 | composer 工具行**左侧**的紧凑控件 | composer 卡片**下方的环境条目**（整宽） | 
| owner props | **无**（`ownerProps: []`） | **无**（`ownerProps: []`） |
| 注册选项 | `id` **必填**；`order?`（升序，默认 0）；`label?` (`string｜(()=>string)`，owner 投影处才用) | **同左** |
| 冲突规则 | 同 `id` + 同 `priority` ⇒ 抛错；换新 id 即并列 | **同左** |
| 渲染条件 | `input !== undefined && sessionId !== undefined` 才渲染 | 追加 `variant === 'composer'`（**空白会话 Hero 不渲染**） |
| 声明者 | `conversation.composer.bar`（ui-conversation） | **同左** |
| 官方占用者 | **无**（空位） | `client-ui-chat ActivityPill id:'activity' order:0`、`UsagePill id:'usage' order:1` |
| replaceRisk | `none` | `none` |

**证据**：
- 类型：`dsh-client-ui-conversation@0.2.1-rc.2` `lib/types/client/contract/slots.d.ts:310-314`（input.left）、`:305-309`（composer.dock）、`:294-299`（input.dock，对照）
- 声明与渲染真源码：同包 `lib/client.js:19896`（input.left 声明）、`:19916`（composer.dock 声明）、`:19072`（input.left 渲染点）、`:19164`（composer.dock 渲染点，`data-composer-dock: true` 容器内、**排在 ContextMeter 之前**）
- 注册选项/占用者/样例：A′ 目录 runner `lib/client.js:3401-3460`、`:2959-3021`
- 官方占用者代码：`dsh-client-ui-chat@0.2.1-rc.2` `lib/client.js:13312-13327`

### 2.2 渲染函数能拿到什么（★重点）

**`props` = 空 owner 份额 + Session 标准座位 + 全局座位 + `renderFactorySlot`**（组合公式：`dsh-client-ui-slots` `index.d.ts:226` `PropsRuntime` / `:221` `ScopeStandardProps` / `:478` `ComposedProps`）。

| 想要的 | 拿法 | 证据 |
|---|---|---|
| **当前 sessionId** | **直接 prop `sessionId`**（`SessionId`，branded；`session-maybe` 槽位才是 `SessionId \| undefined`） | `dsh-client-ui-session` `lib/types/client/index.d.ts:80-89`；A′ 目录 `standardProps` 含 `sessionId: SessionId` |
| 会话状态/投影 | `useSession(selector)`、`useProjection(...)`、`useAccess(action)` | 同上 `:82-88` |
| 输入机 | `useInput(selector)`、`inputActions`（**稳定写入口**）、`useConversation(selector)` | `dsh-client-ui-conversation` `contract/slots.d.ts:417-424` |
| 主题令牌 | **不是 prop**：用 body 上的 CSS 变量（`--dsw-*`）；要快照用 apply 闭包里的 `ctx.theme.getTheme()` / `ctx.theme.exportInspectTokens()` | `dsh-client-ui-theme` `lib/types/client/index.d.ts:87-90`、`:137`、`:142` |
| **hooks 能用吗** | ✅ 能。注册时 `inject: () => ({ hooks: { foo: source } })` ⇒ 组件收到 **`useFoo(selector, equal?)`**（`ObservableSnapshot` = `getSnapshot()` + `subscribe(fn)`） | `dsh-client-ui-slots` `index.d.ts:443-457`（`PropsHooks`）、`:487`（`InjectParams`：session 槽位注入工厂收 `sessionId`）；`dsh-client-store` `lib/types/contract.d.ts:3-18`；**官方实例** chat `lib/client.js:13312-13327` + `:7565`（`ActivityPill({ useChat, useProjection, usePerformanceUsage, t })`） |

> 「能渲染一个入口按钮」所需的最小 props 用法 = **`{ sessionId }` 一个就够定位会话**；要数量徽标再叠一个自建 hook（下例）。

### 2.3 可直接粘贴的样例：「批注：N 条」小按钮

```js
/* ── 槽位：conversation.input.left（list/session；id 必填、order 可选） ── */
const ANNOT_SLOT  = 'conversation.input.left';
const ANNOT_EVENT = 'dsh-kit-annot-changed';   // 插件已有的广播事件（无则自己 dispatch）

/** 最小 ObservableSnapshot：getSnapshot + subscribe（供 inject.hooks 用）。 */
const annotCountSource = {
  getSnapshot: () => {
    try { return (stateRef.annot && stateRef.annot.items) ? stateRef.annot.items.length : 0; }
    catch { return 0; }
  },
  subscribe(fn) {
    const on = () => { try { fn(); } catch {} };
    window.addEventListener(ANNOT_EVENT, on);
    return () => window.removeEventListener(ANNOT_EVENT, on);
  },
};

/** props：sessionId(SessionId) + useAnnotCount(inject.hooks 生成) + 其余标准件。 */
function AnnotChip({ sessionId, useAnnotCount }) {
  const n = useAnnotCount((v) => v);            // 选择器 hook：只订阅"条数"
  const onClick = () => {
    try {
      window.dispatchEvent(new CustomEvent('dsh-kit-open-annot', { detail: { sessionId } }));
    } catch {}
  };
  return h('button', {
    type: 'button',
    title: '元素批注（当前会话 ' + n + ' 条）',
    'data-dsh-kit': 'annot-chip',
    'data-session': String(sessionId),
    onClick,
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 4,
      height: 24, padding: '0 8px', borderRadius: 999,
      border: '1px solid var(--dsw-alias-border-l2, transparent)',
      background: 'transparent', cursor: 'pointer',
      color: n > 0
        ? 'var(--dsw-alias-brand-primary, currentColor)'
        : 'var(--dsw-alias-label-tertiary, currentColor)',
      fontSize: 12, lineHeight: '20px', whiteSpace: 'nowrap',
    },
  }, '批注：' + n + ' 条');
}

safeInject(ANNOT_SLOT, () => ctx.slots.register(
  {
    name: ANNOT_SLOT,
    id: 'dsh-browser-kit.annot',        // ★自己的 cell，勿复用官方 id
    order: 20,                          // 空位槽位：order 只决定与自己其它条目的先后
    inject: () => ({ hooks: { annotCount: annotCountSource } }),   // → props.useAnnotCount
  },
  AnnotChip,
));

/* ── 变体：放到 composer 卡片下方（环境条目，整宽；Hero 空白会话不出现） ── */
safeInject('conversation.composer.dock', () => ctx.slots.register(
  { name: 'conversation.composer.dock', id: 'dsh-browser-kit.annot', order: 100 },  // order ≥2 才排在官方 activity(0)/usage(1) 之后
  AnnotChip,
));
```

**A′ 官方样例（逐字，最保守版本）**

```js
return {
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
      { name: 'conversation.input.left', id: 'my-entry', order: 100, label: 'My entry' },
      () => React.createElement('div', null, 'hello'),
    ))
  },
}
```
> 出处：runner `lib/client.js:3454`（`source: packages/client/ui-conversation/src/client/contract/slots.ts:276`）；`composer.dock` 同形见 `:3012`。

### 2.4 坑 / 限制

1. **只在"有会话且有 input 状态"时渲染**：`conversation.input.left` 的渲染点是 `input === void 0 || sessionId === void 0 ? null : renderSlot(...)`（conversation `lib/client.js:19072`）⇒ 空白会话/输入机未就绪时**看不到按钮**，这是预期行为不是注册失败。`composer.dock` 额外要求 `variant === 'composer'`（`:19164`），**Hero（新会话首屏）不渲染**。
2. **必须已声明**：两级声明链 = layout → `root` → … → `conversation.composer.bar`（ui-conversation）→ `conversation.input.left`。声明未提交时 `register` 抛 `is not declared`；`ctx.slots.inject` 会等声明出现再跑（`registry.d.ts:96-111`），所以**一律用 inject 包一层**，不要直接 `register`。
3. **`id` 是 cell key**：复用官方 id（如 `activity`/`usage`）且 priority 相同 ⇒ `list slot "..." already has an entry with id "..."` 抛错（`ui-slots` `lib/index.js:183-184`）。要并列必须换新 id；同 id + 不同 priority 才是"遮挡/替换"。
4. **`label` 在这两个槽位不会被显示**：owner 是 `renderSlot('conversation.input.left', {})` 这种无参调用，不投影 label（label 的用途是 nav 行/标签页，见 A′ 目录 `registerOptions` 文案）。要文案请画进组件。
5. **主题令牌不可从 props 取**：仅有 CSS 变量。0.2.1 前端 CSS 中实测存在：`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1/2`、`--dsw-alias-label-primary/-secondary/-tertiary`、`--dsw-alias-label-primary-foreground`、`--dsw-alias-border-l1/l2`、`--dsw-alias-brand-primary`、`--dsw-alias-button-primary-fill`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-state-success/-warn/-error-primary`、`--dsw-shadow-lv3`、`--ds-font-family-code`（证据：`dsh-web-frontend@0.2.1-rc.2` `dist/assets/index-BxpfOGf3.css`；与本插件 `plugin/client.js:122-133` 的 `T` 一致）。**始终在 `var()` 里给兜底值**。
6. **`conversation.input.left` 是紧凑工具行**：官方在它右侧紧跟模型选择器等控件，按钮必须"紧凑"（≤24px 高、`white-space:nowrap`），否则会挤压工具行。要整宽内容请用 `conversation.composer.dock` 或 `conversation.input.dock`。
7. **不要用 DOM 猜 sessionId**：`props.sessionId` 是权威（branded `SessionId`）；本插件现有"2s tick + `document.querySelector`"是待退役路径。
8. **数据更新要自己桥成 `ObservableSnapshot`**：`stateRef` 是普通对象，`inject.hooks` 需要 `getSnapshot/subscribe`；样例已给最小实现（也可直接把 `subscribe` 接到插件既有事件上，`dsh-kit-panel-toggle` 同款模式见 `plugin/client.js:44`）。

---

## 3. `dsh-client-ui-secret-mask`（0.2.1 新增）—— 结论：**不可用**

### 3.1 判定表

| 本插件的诉求（`plugin/client.js` 的凭据管理器：localStorage 存凭据 + 面板编辑） | 官方是否支持 | 证据 |
|---|---|---|
| import `CredentialScanner` / `createSecretRule` / `SecretText` / `CREDENTIAL_FORMATS` | ❌ **不可用** | 见 §3.2 三重墙 |
| 遮挡**插件自绘面板**里展示的凭据 | ❌ **不可用** | `README.zh.md:88`「**只有 UserText 调用方会遮挡**——会话标题、轮次预览、搜索摘要、目标栏、**工具卡片**、助手回复以及**未发送的输入框**都按原样显示凭据」 |
| 遮挡凭据**编辑输入框**（未发送文本） | ❌ **不可用** | 同上（"未发送的输入框"明确列出） |
| 遮挡 `password=…` / `API_KEY=…` 这类具名赋值 | ❌ **本来也不遮** | `README.zh.md:45`「`password=…`、`API_KEY=…` 这类带名字的赋值 … 保持原样」——而凭据管理器存的正是这种自定义键值 |
| 遮挡"已发送用户文本"里的公开格式凭据（`sk-`/`ghp_`/`AKIA`/JWT/私钥块/URL 密码，保留前 8 字符） | ✅ 官方自带，**无需本插件做任何事** | `README.zh.md:28`（Web 应用 bundle 默认挂载）、`:35-43`（格式表）、`:30`（交互文本带"眼睛"控件） |

**结论**：本插件的凭据面板**接不上**它——不是"签名不匹配"，而是①**公开导出面没有可调 API**，②**作用域只到 UserText 渲染链**、不覆盖插件自绘 UI 与未发送输入。**建议明确放弃接入**，继续用现有"数据只留本机 localStorage、不进 Agent 上下文"的隔离策略（`plugin/client.js:61-63` 既有注释）。

### 3.2 三重墙（"不可用"的硬证据）

1. **运行时只有两个文件**：`package/lib/` 下只有 `lib/index.js`（host 半边）与 `lib/client.js`（浏览器半边，单文件编译产物）。**没有** `credential-scanner.js` / `secret-rule.js` / `SecretText.js` 这些子模块文件 ⇒ 深路径 import 运行时**无文件可加载**。证据：包内文件清单（`files` 白名单 = `locale/*.json`、`lib/index.js`、`lib/client.js`、`lib/types/**/*.d.ts`）。
2. **exports 映射不放行**：`package.json` 的 `exports` 仅 `"."`、`"./client"`、`"./src/*"`、`"./package.json"`、`"./locale/*.json"`；`"./src/*"` 指向 `src/*`，而 `files` 不含 `src` ⇒ **未随包发布**。
3. **公开类型面只有 apply/inject**：
   - `lib/types/client/index.d.ts` 全文只声明 `export declare const inject: string[]` 与 `export declare function apply(ctx: ClientContext): void`（末尾 `export type {} from './secret-rule.ts'` 是**类型擦除**，不导出任何值）
   - 编译产物 `lib/client.js` 末尾：`exports.apply = apply; exports.inject = inject;` ——**再无其它导出**

> 即：`CredentialScanner`(`credential-scanner.d.ts:17`) 等类/函数**在同一包内存在**（供官方自己用），但对第三方**不是可导入面**。

### 3.3 它到底做了什么（仅供"抄格式表"参考，不是接入路径）

官方 `apply`（`lib/client.js`，逐字语义）：

```js
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-secret-mask: dictionaries");
  ctx.uiConversation.userText.register(createSecretRule());          // UserText 匹配器
  ctx.slots.inject("conversation.user.text.node", () => ctx.slots.register({
    name: "conversation.user.text.node", key: "secret", priority: 100, locale: NS,
  }, SecretText));                                                   // keyed 渲染器
}
```

- 遮挡**只改绘制文本**：消息原文、复制操作、模型输入都保留原字符（`README.zh.md:12`、`:57`）。
- 节点 payload 只带遮挡后的显示文本；renderer 逐段画 `*`（保留字符供复制/辅助技术读取，`README.zh.md:57`）。
- 若 Lead 仍想要"保留前 8 字符"的显示规则作用于**本项目自己的面板**，唯一可行路径是**自实现**：把 `README.zh.md:35-43` 的格式表抄成本地正则（本插件已在 `plugin/client.js` 里维护 `T`/常量，风格一致）。**不要**试图 import 官方模块。

---

## 4. 未确认项（✗ 明确标注）

1. **`shell.bottom` 的运行期真实占用**：A′ 目录记 `experimental-inspector InspectorPage`，但那是**构建期投影**，不等于当前 profile 的运行期实际；本机 `~\.dsh\profiles\desktop\cordis.yml` / `cordis.patch.yml` 中 grep 不到 `inspector`（0 命中），而 `@deepseek-ai/dsh-experimental-inspector-profile` 在 `dsh-app-boot@0.2.1-rc.2` 的 `OPTIONAL_BUNDLES`（`lib/index.js:589`，**按需安装、默认关**）⇒ 倾向"当前未占用"，**未实测**。落地方案见 §1.2（先探测再定 priority）可自适应两种情况。
2. **实时 inspector 字段未取到**（§0.1 已记原始报错）⇒ 本文件**没有** inspector 返回的 `catalog/selected.occupants` 路径证据；A′ 目录的 `source` 字段（如 `packages/client/ui-layout/src/client/index.ts:94`）是等价的官方出处。
3. **第三方 client bundle 能否 `require('@deepseek-ai/dsh-client-ui-*')`**：未验证宿主 client 模块解析白名单（本插件 client 现在只有 `require('react')`）。**注意**：这对 secret-mask 的结论**无影响**（§3.2 第 3 条已证其公开面没有可用 API），但会影响"S4 是否可直接复用 `dsh-client-ui-primitives` 组件"。
4. **未实测真机渲染**：两个新槽位的视觉/布局（Dock 高度挤压三列、紧凑按钮在工具行的挤压）需 Lead 实现后回归。
5. **`props.sessionId` 具体品牌类型**（`SessionId` 的运行时形态）未取：`dsh-client-ui-session` 只给 branded 类型；样例里 `String(sessionId)` 打印，**不要**对它做算术/拼接假设。
