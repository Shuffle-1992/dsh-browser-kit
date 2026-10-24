# 测试覆盖与回归风险审计（dsh-browser-kit）

- 审计日期：2026-10-24
- 审计方式：只读（未改任何代码/测试；本文是唯一产出文件）
- 基线实测（本次亲自跑，非沿用旧数据）：
  - `node --test --test-concurrency=1` → **tests 256 / pass 255 / fail 0 / skipped 1**（25861ms）✓
  - `node --test test/hid-fixture-smoke.test.js` 连跑 3 次 → **3/3 全过**（2.2~2.7s/次），EPERM 未复现
- 头号结论先行：**本项目 693 处 `assert.match`（源码字面断言）是主断言风格；"只有实机才跑"的客户端核心（命令轮询器三段、胶囊不跳行、safeInject、credSave、磁盘兜底）全部只有字面钉、没有行为钉** —— 正是 P116 事故（测试全绿、实机全死）的土壤未根除。

---

## 一、覆盖地图（模块 → 钉子现状）

图例：✅行为钉（真的执行被测代码）｜🟡字面钉（readFileSync + assert.match 源码文本）｜🟡*混合｜❌无钉子

### src/（可 import / 可沙箱执行，本该多钉行为）

| 模块 | 行数 | 覆盖它的测试 | 现状 |
|---|---|---|---|
| src/annotations-protocol.js | 296 | annotations-protocol.test.js | ✅ 纯行为（53 条） |
| src/annotator-sync.mjs | 89 | annotator-sync.test.mjs | ✅ 纯行为 |
| src/annotator-consume.mjs | 18 | annotator-consume.test.mjs | ✅ 纯行为 + 与 client.js 内嵌副本 parity 对拍（正典模式 ✓） |
| src/annot-mirror-anchor.mjs | 43 | annot-mirror-anchor.test.mjs | ✅ 纯行为 |
| src/annotations-summary.mjs | 35 | annotations-summary.test.mjs | ✅ 纯行为 |
| src/bridge-envelope.mjs | 20 | bridge-envelope.test.mjs | ✅ 行为 + 字面守卫 |
| src/shot-view.mjs | 109 | shot-view.test.mjs | ✅ 行为（shotNameOf / createShotStore + 副本对拍）；但 client.js 内嵌副本的磁盘兜底 useEffect 不在 canonical 区，无行为钉（见 §三-B6） |
| src/tool-presentation.mjs | 64 | shot-view.test.mjs（连带） | ✅ |
| src/console-observer.js | 863 | console-observer.test.mjs | ✅ vm 沙箱执行（131 条行为断言） |
| src/hid-observer.js | 933 | hid-observer.test.js + hid-fixture-smoke.test.js | ✅ vm 沙箱 + 真机冒烟 |
| src/virtual-hid-device.js | 198 | virtual-hid-device.test.js | ✅ 纯行为 |
| src/webhid-shim.js | 549 | webhid-shim-delivery.test.mjs | ✅ vm 沙箱 |
| src/element-annotator.js | 2057 | annotator-protocol-parity.test.js（沙箱对拍 ✓）+ annotator-smoke.test.js（真 Chrome ✓）；v22/v24/v25/v36/window-info 五个文件全是字面 | 🟡* 协议面有行为钉，UI 守卫面全字面 |
| src/cdp/drive.mjs | 406 | 三个冒烟测试真实使用 | 🟡 启动/求值路径有真机覆盖；**close() 清理路径（rmSync 重试/EPERM）无任何钉**（flaky 源头，见 §四） |
| **src/hid-bridge.mjs** | **206** | **无任何测试文件触及**（grep 仅命中被测方注释） | ❌ **完全无钉子** |
| **src/session-id.mjs** | **27** | dsh-021-compat.test.mjs:179 仅 readText 读源码文本 | 🟡 仅字面（sessionIdOfAgent 候选口径无行为钉） |

### plugin/（宿主侧可测，客户端侧"实机才跑"）

| 模块 | 行数 | 覆盖它的测试 | 现状 |
|---|---|---|---|
| plugin/host.impl.mjs | 919 | plugin-impl.test.mjs（`_internals` 直接调用，136 条行为断言） | ✅ 宿主逻辑行为覆盖良好（含 takeCommandImpl 取走即删/BOM/坏 JSON） |
| plugin/browser-tools.host.mjs | 877 | browser-tools-host.test.mjs | ✅ 行为覆盖良好（runBrowserCommand 全链路、串行队列、超时结构化错误） |
| plugin/wire.host.mjs | 193 | plugin-impl / plugin-client-contract:202-217（descriptor deepEqual 对账） | ✅ |
| plugin/annot-delivery.host.mjs | 305 | annot-delivery.test.mjs（renderAnnotDelivery/summarize 有行为调用）+ 59 条字面 | 🟡* |
| plugin/plugin-config.schema.mjs | 106 | dsh-021-compat.test.mjs | 🟡 以字面为主 |
| **plugin/client.js** | **7391** | 10 个纯字面测试 + 2 个对拍（faceUnwrap、planChipConsume）共 693 条 assert.match 的主力靶子 | ❌ **核心运行时零行为钉**：命令轮询器（pollCommands/cmdOwnerTick/executeCommand/回执 5s 竞速，client.js:5243-5349）、resolveChipTarget（1559-1590）、safeInject（5751-5767）、credSave（6402-6404）与三处 U-5 回执（6780/6824/6835）、ShotToolView 磁盘兜底（6045-6065）——**全部从未被任何测试执行过** |
| plugin/entry.mjs | 66 | 无直接测试（经 wire 面 descriptor 间接对账） | 🟡 |

**覆盖面总评**：宿主侧（host.impl / browser-tools.host / wire）行为覆盖是本项目最扎实的部分；src/ 纯函数基本全行为钉；**风险全部集中在 plugin/client.js 这 7391 行"只有实机才跑"的代码上——它恰是 P115/P116 两次实机事故的发生地。**

---

## 二、字面钉子清查（P116 类，按风险排序）

693 处 `assert.match` 分布：plugin-client-contract.test.mjs 330 条、credential-manager 63、dsh-021-compat 57、annot-delivery 59、annotator-v36-v37 39、annotation-window-info 21、annotator-v24 21……（29 个文件里 10 个纯字面、4 个混合、15 个行为）。

字面断言本身不必消灭——**钉"契约语义"（如 return -1 不跳行、失败文案必须存在）是合理的结构性钉**；危险的是钉"实现写法"（变量名、数值、注释、文案全文），以及**正向字面钉挡不住"实现本身就错"**（P116 原事故）。按风险排序：

### 🔴 R1 · P116 事故区域的字面钉仍是无行为钉的唯一防线
- `test/dsh-021-compat.test.mjs:210-215`：钉 `__timeoutMs: timeoutMs`、`const hostCap = Number\(command && command\.__timeoutMs\r\n? \|\| 25000;`、`Math.max(2000, Math.min(80000, hostCap - 2000))` —— **全是对公式的 regex 匹配，无数值行为断言**。公式被改错（如 `hostCap + 2000`）时测试照样红吗？会红（字面变了），但**公式"看起来对、逻辑错"时测试全绿**（如把 Math.max 下限改丢、或 hostCap 缺失兜底路径坏掉——regex 仍匹配其余部分）。
- `test/dsh-021-compat.test.mjs:220-226`（P116 的反向钉，方向正确但实现脆弱）：
  ```js
  const body = client.slice(client.indexOf('const pollCommands = async () => {'), …8000);
  assert.equal(/Number\(c && c\.__timeoutMs\)/.test(body), false);  // ✓ 反向断言
  assert.match(body, /命令执行异常/);  // ✗ 这是"执行异常也回执"的唯一钉子——纯字面
  ```
  **隐患 A**：`indexOf` 返回 -1 时不报错，`slice(-1, …)` 取错区域 ⇒ 断言对象根本不是轮询器（假绿风险）。**隐患 B**：`/命令执行异常/` 只证明这 5 个字存在于源码，不证明 catch 分支真的会调 `commandResult`。
- **改法**（正典化对拍，照 annotator-consume 模式）：把 `clientCapOf(hostCap)` 抽成 canonical 纯函数 + client.js 内嵌副本 `new Function` 对拍；轮询器 body 先断言 `idx >= 0` 再切片（伪码见 §三-T1/T2）。

### 🔴 R2 · 钉注释文本（改注释措辞即红，且给人"钉子很全"的错觉）
- `test/plugin-client-contract.test.mjs:342`：`/\/\/ 与截图\/批注同款\*\*方框\*\*…/`、`:393` `/\/\/ 顺序（用户 2026-10-10 指定）…/` —— **断言源码注释**。
- `test/annot-delivery.test.mjs:90`：`/catch \(e\) \{\s*diag\.lastError = …\/\* 绝不因为注入失败影响主流程/` —— 把注释和代码捆在一起钉。
- `test/annot-chip-cleared-after-send.test.mjs:21`：`/stateRef\.chip = null; \/\/ 不留在输入框（发送已完成）/` —— 行尾注释入钉。
- **改法**：删掉注释部分，只留代码语义断言；注释的正确性用行为钉替代（例：`diag.lastError` 在注入失败被赋值——可沙箱执行 pre-step handler 验证）。

### 🟠 R3 · 钉死数值/文案全文（实现微调即红，噪音大）
- `plugin-client-contract:130` 钉死 `setInterval(…, 1500)` 整表达式；`:315` 钉死 16 档 ZOOM_STEPS 数组全文；`:433` 钉死 `10 * 60 * 1000`。
- `credential-manager.test.mjs:64` 钉死整句中文标题；`:134/:152` 钉死模板字符串文案全文（`已保存 ${list.length} 条…`）——改一个标点即红。
- `tool-usage-rules.test.mjs:45` 钉死含 emoji 的违规提示全文。
- `annotator-v24-keep-annotations.test.mjs:47` 钉死色值 `var SUBMITTED_COLOR = "#16a34a";`。
- `dsh-021-compat:76-77` `client.split('safeInject(').length - 1 === 6` —— 新增第 7 个槽位即红（防绕过有好的一面，但应改为"≥6 且裸 `ctx.slots.inject(` 为 0"两个独立断言）。
- **改法**：数值钉改为"下界/契约"断言（如 `interval >= 1000 && interval <= 5000` 或干脆抽常量对账）；文案钉只钉**关键词**（`/未写入本机存储/`）不钉全文。

### 🟠 R4 · 钉整对象字面/数组全文（新增字段即红）
- `annotator-v23-mirror-tick.test.mjs:44`：钉死 `mirrorDiag: { calls:0, injected:0, …, lastAt: null }` **整个对象初始化**——新增一个诊断计数字段即红。同文件 :52-58 已自书教训（"锚点应选语义稳定的位置"），但 :44 本身没改。
- `plugin-client-contract:315` ZOOM_STEPS 同类。
- **改法**：改断言"对象**含** calls/injected 键"而非"等于全量字面"。

### 🟡 R5 · 跨行/格式脆弱钉
- `annotator-v25-scope-and-tip:23`、`device-fit-resize:36`、`annotator-v24:76` 依赖 `\n\s+` 跨行匹配与 CRLF 归一化（文件头已自述此坑）。
- `credential-manager:102` `assert.doesNotMatch(block, /credAutofill[\s\S]{0,80}(password|username)/)` —— 80 字符窗口的模糊否定，代码重排即误红/漏检。
- **改法**：这类"不得同时出现"改为行为级（沙箱执行后观察副作用），或把窗口从 80 放宽到函数体切片。

### ✅ 正面样板（值得推广的两处）
- `dsh-021-compat:225` 的**反向断言**（P116 教训产物）：`assert.equal(/Number\(c && c\.__timeoutMs\)/.test(body), false)`。
- `annotator-consume.test.mjs:52-63` 的**正典对拍**：src 正典与 client.js 内嵌副本用 `new Function` 双实例化、同输入比对输出 —— 这是让"实机才跑"代码获得行为钉的成熟模式，应复制到轮询器/resolveChipTarget/safeInject。

---

## 三、缺失钉子 Top 10（含断言伪码）

统一采用本仓库已有的两种成熟模式：**正典抽取 + `new Function` 对拍**（annotator-consume/shot-view/bridge-envelope 模式）与 **vm/假 svc 注入**（hid-observer/console-observer 模式）。

**T1 · 命令通道·执行异常强制回执（P116 主场景，最优先）**
现状：client.js:5289-5291 catch 分支零覆盖，唯一钉子是字面 `/命令执行异常/`（compat:226）。
```js
// 从 client.js 切出 pollCommands body（先断言锚点命中！），注入假 svc：
const idx = client.indexOf('const pollCommands = async () => {');
assert.ok(idx >= 0, '轮询器锚点必须存在');               // ← 现在缺这句，indexOf=-1 会假绿
const poll = new Function('svc','sleep','cmdOwnerTick','commandHandlers','msgOf', …body…);
let receipt = null;
const fakeSvc = { takeCommand: async () => ({ id:'t1', action:'no-such-action', __timeoutMs: 8000 }),
                  commandResult: async (id, r) => { receipt = { id, r }; } };
await poll(fakeSvc, (ms)=>new Promise(r=>setTimeout(r,ms)), ()=>true, {}, (e)=>String(e));
assert.ok(receipt, '执行异常也必须发出回执 ✓');          // 行为断言
assert.equal(receipt.r.ok, false);                        // 结构化错误，不是 undefined
assert.ok(receipt.r.error.length > 0);
```

**T2 · `__timeoutMs` 大小关系（数值断言，非 regex）**
现状：compat:214 只匹配公式文本；`|| 25000` 兜底、`Math.max(2000,…)` 下限、边界值全无数值断言。
```js
// 抽 canonical clientCapOf(hostCap)（zcode-review-deep.md §159 本就建议抽 command-budget.mjs）
assert.equal(clientCapOf(25000), 23000);      // 宿主−2s
assert.equal(clientCapOf(80000), 78000);      // H-2 新上限
assert.equal(clientCapOf(1500),  2000);       // Math.max 下限
assert.equal(clientCapOfUndefined), 23000);  // __timeoutMs 缺失 → || 25000 兜底
assert.ok(clientCapOf(h) < h, '客户端期限必须严格小于宿主期限');  // 对一组 h ∈ {2500, 8000, 70000, 99999}
// 反向断言（P116 纪律）：不得引用不存在的作用域变量
assert.equal(/\(c && c\.__timeoutMs\)/.test(pollBody), false);
```

**T3 · 胶囊不跳行 P114（行为级）**
现状：resolveChipTarget（client.js:1559-1590）零行为执行；v36-v37:76-90、compat:193-205 全字面。
```js
// 把 resolveChipTarget + fuzzyFindKey 切出为正典片段，new Function 实例化：
const resolve = makeResolveChipTarget({ rowKeys: ['r1','r2','r3'], rows: [..3行..] });
assert.equal(resolve({ attachedKey:'gone', base:null }), -1);                    // 键消失 → 不挂
assert.equal(resolve({ attachedKey:'gone', base:{last:'r1'}, attachIdx:1 }), 2); // 相对锚 → 前一行的下一行
assert.equal(resolve({ attachedKey:'gone', base:{last:'r0'}, attachIdx:5 }), -1);// 单调守卫 → 不回退
assert.equal(resolve({ attachedKey:'r2' }), 1);                                  // 精确键 → 原行重挂
// 字面守卫保留：attachedKey 分支内不得出现 fuzzyFindKey(/attachIdx 直接定位（compat:202-203 已有，保留）
```

**T4 · 槽位 safeInject 失败降级**
现状：client.js:5751-5767 两个容错分支（slotsApi 缺失 / inject 抛错）零行为覆盖；compat:76-92 全字面。
```js
const slotsApi = null;
const st = safeInject('X', cb);                    // 用切出的 safeInject + 假 say/slotStatus
assert.equal(st, null);
assert.equal(slotStatus.X.ok, false);              // 记账而非抛出
const slotsApi = { inject: () => { throw new Error('boom'); } };
assert.equal(safeInject('Y', cb), null);           // 不向上抛
assert.match(slotStatus.Y.error, /boom/);
```

**T5 · 账号保存失败回执（U-5）**
现状：credSave（client.js:6402-6404）与三处 `if (!credSave(…))`（6780/6824/6835）零行为覆盖；credential-manager:120、compat:189-190 全字面。
```js
// vm 沙箱：localStorage.setItem 永远抛错（隐私模式/配额满）
sandbox.localStorage = { setItem: () => { throw new Error('QuotaExceeded'); }, getItem: () => null };
const credBlock = evalCredSection(clientSrc);      // 切出 credSave/credLoad + 三处回调
assert.equal(credSave(list), false);               // 失败返回 false
const warned = sandbox.__dshKitSayLog.filter(x => x.level==='warn' && /未写入本机存储/.test(x.line));
assert.ok(warned.length >= 1, '失败必须有用户可读回执');   // 行为断言替代文案字面钉
```

**T6 · 截图磁盘兜底 diskFetched**
现状：ShotToolView 兜底 effect（client.js:6045-6065）零行为覆盖；shot-view.test 只测 canonical 存储函数；compat:162-174 全字面。**顺带发现真 bug 证据**：`diskFailed` 只在 6060 的默认对象里声明，全仓库无自增点——若有行为钉，这个死计数器当场现形。
```js
// 把兜底 effect 主体抽成 fetchShotFromDisk(name, deps)：
const deps = { svc:{ shotDataUrl: async (n)=>({ dataUrl:'data:image/png;base64,x', bytes:3 }) },
               rememberShot: spy, setFetched: spy2 };
await fetchShotFromDisk('s1', deps);
assert.equal(spy.calls[0][0], 's1');               // 写回缓存（自愈）
assert.equal(stateRef.recentShots.get('s1').fetchedAt > 0, true);
assert.equal(diskFetched, 1);                      // 仪器 +1
// 失败分支：shotDataUrl 抛错 → 不 remember、渲染层保持"截图已落盘…可用 read_image 查看"路径提示
```

**T7 · 客户端回执段 5s 竞速 / 取走段 10s 竞速**
现状：client.js:5296-5308（commandResult 5s 上限）与 :5259-5263（takeCommand 10s 保底）零覆盖。
```js
const fakeSvc = { takeCommand: () => new Promise(()=>{}),   // 永不返回
                  commandResult: () => new Promise(()=>{}) };
await withFakeTimers(async () => {
  await pollOne(fakeSvc);                            // 单步执行一轮
  assert.equal(said('warn').some(/commandResult 超时/), true);   // 5s 后必须放弃且告警，不挂死
});
assert.ok(elapsed < 6000, '回执竞速必须在大约 5s 退出');
```

**T8 · 轮询者租约 cmdOwnerTick**
现状：client.js:2706-2722（6s 心跳抢占、busy 30s 自让、localStorage 退化）零覆盖。P115 事故（"租约没人抢 ⇒ 全部无回执"）的判定逻辑无测试。
```js
const store = fakeLocalStorage();  t1 = mkTick(store);
assert.equal(t1('A', busy=false), true);                    // 无主 → A 抢到
store.setItem(CMD_OWNER_KEY, JSON.stringify({ owner:'B', at: Date.now() }));   // B 刚心跳
assert.equal(t1('A'), false);                               // B 在任期内 → A 不抢
storeOwner.at -= 7000;                                      // 心跳过期 6s
assert.equal(t1('A'), true);                                // 过期 → 可抢占
// busy 超 30s：assert.equal(tick('B', busySince=Date.now()-31000), false) —— B 自让位
```

**T9 · 宿主期限 vs 工具描述（端到端大小关系）**
现状：browser-tools.host:98-121 的 `timeoutMs` 表与 client 上限的关系无跨端断言（H-2 修复正是这条链）。
```js
// 对每个 BROWSER_TOOL_SPECS：host timeoutMs 必须 > clientCapOf(timeoutMs)，且差值 ≥ 2000−ε
for (const spec of SPECS) assert.ok(clientCapOf(spec.timeoutMs) <= spec.timeoutMs - 1900,
  `${spec.action}: 客户端必须先于宿主回执`);
// 特别钉 browser_wait：页内 deadline(60s) ≤ 宿主(70s−2s) ≤ 客户端(68s) 的全链不等式
```

**T10 · commandResultImpl 2MB 轮转**
现状：plugin-impl.test.mjs:258-267 只测"追加"形态；超 2MB 重写为尾部 2000 行（host.impl.mjs:575-600）无覆盖。
```js
const dir = mkdtempSync(join(tmpdir,'dbk-t10-')); t.after(() => rmSync(dir,{recursive:true,force:true}));
for (let i = 0; i < N; i++) commandResultImpl(dir, 'id'+i, { i });   // 写到 > 2MB
const lines = readJsonl(join(dir,'command-results.jsonl'));
assert.ok(lines.length <= 2000, '轮转后保留尾部 2000 行');
assert.ok(lines.at(-1).id === 'id'+(N-1), '最新回执必须存活');
```

---

## 四、flaky 根治：hid-fixture-smoke EPERM

**根因链**（取证确认）：测试本身无清理逻辑；EPERM 出在 `src/cdp/drive.mjs close()`：
1. `taskkill /T /F`（drive.mjs:131）后等退 5s + 200ms（:158-166）——**等待不是硬保证**；
2. `rmSync(userDataDir, { maxRetries:12, retryDelay:250 })`（:172-177，累计约 3s）——Windows renderer/crashpad 句柄未释放完时仍 EPERM；
3. close() 收集 firstError 后**统一 re-throw**（:182-184）⇒ 沿测试 finally 传播 ⇒ **断言全过、测试仍红**。

**推荐改法（三选一，按侵入度排序）**：
- **A（首选，改 drive.mjs close()）**：清理失败不 re-throw，改为返回/记录：
  ```js
  const cleanupErrors = [];
  for (const rec of records) { try { rmSync(…) } catch (e) { cleanupErrors.push(rec.userDataDir + ' ' + e.code); } }
  // 不再 throw；由调用方决定是否在意（临时目录 %TEMP% 会由系统回收）
  ```
  理由：清理失败≠被测行为失败；test/ 目录临时目录本来就该容忍残留。cdp-smoke.test.js:62 还**依赖 close() 删掉目录**这个副作用做断言——A 改法下把该断言改为读 close() 返回值。
- **B（只改测试，零侵入）**：测试 finally 里容忍清理错：
  ```js
  finally { try { await drive.close(); } catch (e) { if (e && e.code !== 'EPERM') throw e; } }
  ```
  缺点：每个冒烟测试都要抄一遍。
- **C（不改代码）**：mark 为已知 flaky，验收时单跑——不推荐，问题会持续骚扰全套跑。

**如何证明不再 flaky**：
- 改法落地后：`node --test test/hid-fixture-smoke.test.js` 连跑 3 次 + 全套 `node --test --test-concurrency=1` 连跑 3 次，9 次全绿即算根治；
- 本次审计实测基线：单跑 3/3 ✓（2.2~2.7s）、全套 1 次 256/255/1 ✓ —— 与"偶发、并发更易触发"的记录一致，未复现不代表已修复。

---

## 五、测试卫生

1. **`--test-concurrency=1` 确系被迫**：src/cdp/drive.mjs:26 模块级 `const launches = new Set()`，任一测试的 `drive.close()`（:146-185）会杀掉集合里**全部** Chrome 并删其临时目录 ⇒ 三个冒烟（cdp-smoke / annotator-smoke / hid-fixture-smoke）并发必互杀。根治选项：close() 只杀自己 launch 的实例（按 port/userDataDir 过滤），此后可恢复默认并发。属低优先（全套仅 26s）。
2. **临时目录泄漏**：test/browser-tools-host.test.mjs 的 `tmpPlugin()`（:30）清理是子用例体末尾的**内联 rmSync**（:117/:127/:145/:152/:176/:238），不在 `t.after` —— 中途断言失败即泄漏 `dbk-tools-*`。对照规范样板：plugin-impl.test.mjs:40-41 用了 `t.after(rmSync)`。
3. **超时**：仅 3 个冒烟测试自设 120s 超时；其余 26 个文件依赖 node:test 默认（**无 per-test 超时**）——沙箱里若有轮询没停会吊死整个 run（webhid-shim-delivery.test.mjs:118 等 4 处 `__dshKitStopPoll` 自救注释即是前科）。建议给非冒烟测试统一挂 `t.timeout(10_000)` 或跑脚本加 `--test-timeout`。
4. **环境变量**：测试不写 process.env ✓ 无泄露；但冒烟依赖宿主机 Chrome（drive.mjs:43-53 找 `DSH_KIT_CHROME_PATH`/`CHROME_PATH`/`LOCALAPPDATA`），无 Chrome 的环境会 skip（基线的 1 skipped 即此）。
5. **顺序耦合（同文件内）**：cdp-smoke.test.js:62 断言"上一用例的临时目录已被 close() 删除"——依赖前用例副作用，若按 §四-A 改 close() 需同步改此断言。

---

## 六、验收脚本（改动后必跑清单）

```powershell
# 0. 环境（PowerShell 注意："$var:" 会被当盘符 ⇒ 一律 ${var}；别用 node -e "…" 嵌套引号，写 .cjs 再跑）
cd "F:\My Code\dsh-browser-kit"

# 1. 全量基线（必须 concurrency=1，见 §五-1）
node --test --test-concurrency=1
# 期望：tests 256 / pass 255 / fail 0 / skipped 1（本次实测 25.9s）
# 任何 fail：先看是不是冒烟（cdp-smoke/annotator-smoke/hid-fixture-smoke）——它们依赖本机 Chrome

# 2. flaky 复验（改了 drive.mjs / 冒烟相关后必做）
node --test test/hid-fixture-smoke.test.js   # ×3，期望 3/3 pass，无 EPERM
node --test test/cdp-smoke.test.js           # 期望 pass；:62 的目录删除断言若改过 close() 会红

# 3. 钉子敏感文件快速反馈（改了 client.js / host 后先单跑这三个再跑全量）
node --test test/dsh-021-compat.test.mjs test/plugin-client-contract.test.mjs test/credential-manager.test.mjs
```

**失败时先看什么（按症状）**：
1. `EPERM` 且涉及 `%TEMP%\dsh-kit-chrome-*` → 是 drive.close() 清理（§四），不是断言错；先单跑该文件确认。
2. **字面钉红**（assert.match 失败）→ 先过 P116 自查三问：①钉的是行为还是写法？②源码变更是"改进"还是"破坏契约"？③这个钉子有没有对应的行为钉可以替代？——多数情况应改钉子而非回滚代码。
3. **行为钉红**（assert.equal 对运行结果失败）→ 真回归，最高优先。
4. "全套一起红" → 按 P116③：先看单体一环（取走/执行/回执分手判定），不要怀疑协议。
5. skipped 从 1 变多 → 本机 Chrome 路径检测失败，检查 `DSH_KIT_CHROME_PATH`。

---

## 附：本次审计的证据命令留档

- `grep -rn "assert.match(" test | wc -l` → 693
- `node --test --test-concurrency=1` → 256/255/1（25861ms，exit 0）
- `node --test test/hid-fixture-smoke.test.js` ×3 → 全过（2251/2739/2289ms）
- 关键源码定位（抽查核验过原文）：client.js:5280-5281（hostCap/clientCap）、1559-1590（resolveChipTarget）、5751-5767（safeInject）、6402-6404（credSave）、6045-6065（磁盘兜底）、5243-5349（轮询器三段+看门狗）、host.impl.mjs:552-600、browser-tools.host.mjs:98-121
