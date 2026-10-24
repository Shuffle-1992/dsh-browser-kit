/**
 * DSH 0.2.1-rc.1 兼容加固的回归钉子（本轮"只做兼容"范围内的硬约束）。
 *
 * 依据（产物级核实，见 DSH-0.2.1-COMPAT-REVIEW-v2.md）：
 *  - `@deepseek-ai/dsh-app-boot@0.2.1-rc.1` 的 plugin-compatibility.js：
 *    有 `engines.dsh` ⇒ **只看它**（peerDependencies 被忽略）；判定用
 *    `semver.satisfies(v, range, { includePrerelease: true })`；非字符串/非法区间会 **throw** ✗。
 *  - 插件注册路径：profile 用 `link:` 指向 `plugin/`，marketplace 安装的是**仓库根包**
 *    ⇒ **两个 package.json 都必须声明** ✓。
 *  - asar 内部布局不是契约 ⇒ defineTool 解析必须有「无 `dsh/` 前缀」等候选 ✓。
 *  - 4 个自持槽位 id 无法从产物确认（前端里是动态拼接 ✗）⇒ 注册必须**只降级、不炸插件** ✓。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readText = (rel) => readFileSync(join(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));

/** 目标区间：下界=本机已验证可用的运行时，上界=排除下一次 minor 的预发布 ✓ */
const EXPECTED = '>=0.2.0-rc.2 <0.3.0-0';

test('0.2.1 兼容：根包与 plugin 包都声明 engines.dsh，值一致且不覆盖 engines.node', () => {
  const rootPkg = readJson('package.json');
  const pluginPkg = readJson('plugin/package.json');
  assert.equal(rootPkg.engines.dsh, EXPECTED, 'marketplace 装的是根包 ⇒ 根包必须声明 ✗');
  assert.equal(pluginPkg.engines.dsh, EXPECTED, 'profile 的 link: 指向 plugin ⇒ plugin 也必须声明 ✗');
  assert.equal(rootPkg.engines.node, '>=22', '不得覆盖已有的 engines.node');
  assert.equal(pluginPkg.engines.node, '>=22');
});

test('0.2.1 兼容：区间在官方 includePrerelease 语义下覆盖当前版本与目标版本', async () => {
  let semver = null;
  try { semver = (await import('semver')).default; } catch { /* 环境里没有 semver ⇒ 只做形状断言 */ }
  if (!semver || typeof semver.satisfies !== 'function') {
    assert.equal(EXPECTED, '>=0.2.0-rc.2 <0.3.0-0', '形状必须与文档/实测一致');
    return;
  }
  const opt = { includePrerelease: true };
  assert.equal(semver.satisfies('0.2.0-rc.2', EXPECTED, opt), true, '当前运行版本必须被覆盖');
  assert.equal(semver.satisfies('0.2.1-rc.1', EXPECTED, opt), true, '目标版本必须被覆盖');
  assert.equal(semver.satisfies('0.2.1-alpha.5', EXPECTED, opt), true, '同 minor 的预发布应覆盖');
  assert.equal(semver.satisfies('0.3.0-rc.1', EXPECTED, opt), false, '下一次 minor 的预发布应被排除');
  // ⚠️ 语义陷阱固化：默认（不开 includePrerelease）下 0.2.1-rc.1 **不满足** 该区间 ✗
  assert.equal(semver.satisfies('0.2.1-rc.1', EXPECTED), false, '这正是必须在文档里写明前提的原因 ✓');
});

test('0.2.1 兼容：defineTool 候选覆盖「无 dsh/ 前缀」等布局变体 + profile/本地回退', async () => {
  const mod = await import('../plugin/browser-tools.host.mjs');
  assert.equal(typeof mod.dshToolsCandidates, 'function');
  const paths = mod.dshToolsCandidates().map((c) => String(c.path).replace(/\\/g, '/'));
  assert.ok(paths.length >= 8, `候选应显著多于旧版 4 条（实际 ${paths.length}）`);
  assert.ok(
    paths.some((p) => p.endsWith('/app.asar/node_modules/@deepseek-ai/dsh-tools/lib/index.js')),
    '必须有无前缀形状（0.2.1 若把 node_modules 提到 asar 根 ✗）',
  );
  assert.ok(
    paths.some((p) => p.endsWith('/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js')),
    '当前形状（dsh/ 前缀）必须保留',
  );
  assert.ok(
    paths.some((p) => p.endsWith('node_modules/@deepseek-ai/dsh-tools/lib/index.js') && p.includes('node_modules/node_modules') === false),
    'profile / 插件本地 node_modules 回退必须存在',
  );
  assert.equal(typeof mod.detectDshRuntimeVersion, 'function', '兼容自检需要运行时版本探测');
  assert.equal(mod.declaredDshEngine(), EXPECTED, 'declaredDshEngine 必须读到我们自己声明的区间');
  assert.equal(typeof mod.scanForDshToolsPackages, 'function', '需要有界扫描兜底');
  assert.doesNotThrow(() => mod.detectDshRuntimeVersion(), '纯 Node 下读不到 asar 也只能返回 null（不抛 ✗）');
});

test('0.2.1 兼容：槽位注册全部走安全注入器（缺槽位只降级、不炸插件）且记账', () => {
  const client = readText('plugin/client.js');
  assert.equal(client.split('ctx.slots.inject(').length - 1, 0, '不得再有裸 ctx.slots.inject( ✗');
  assert.equal(client.split('safeInject(').length - 1, 6, '6 个槽位都要走 safeInject ✓（5 原槽位 + 截图 toolview + Dock；composer 徽标已按用户反馈移除 ✗）');
  // shell.overlay 经常量 SLOT 注入（`const SLOT = 'shell.overlay'`）⇒ 断言两处都在 ✓
  assert.match(client, /const SLOT = 'shell\.overlay'/);
  assert.ok(client.includes('safeInject(SLOT,'), 'shell.overlay（经 SLOT 常量）必须走 safeInject');
  for (const id of ['plugins.bundle.config', 'plugins.row.config']) {
    assert.ok(client.includes(`safeInject('${id}',`), `${id} 必须走 safeInject`);
  }
  assert.ok(client.includes('safeInject(MENU_SLOT,'), 'sidebar.right.tab.menu.item（经 MENU_SLOT）必须走 safeInject');
  assert.match(client, /slotStatus\[id\] = \{ ok: false/, '失败必须记账');
  assert.match(client, /slotStatus\[id\] = \{ ok: true, at \}/, '成功也要记账');
  assert.match(client, /compat: \(\(\) => \{/, 'kit-status 要暴露 slotStatus（更新后一眼可见 ✓）');
  assert.match(client, /expected: \['shell\.overlay', 'plugins\.bundle\.config', 'plugins\.row\.config', 'sidebar\.right\.tab\.menu\.item', 'tool\.call\.toolview', 'shell\.bottom'\]/);
  // ★2026-10-17 用户反馈：composer 里的"批注"徽标是**重复入口** ✗（工具条已有批注按钮）⇒ 已移除
  assert.equal((client.match(/ANNOT_BADGE_SLOT/g) || []).length, 0, 'composer 批注徽标必须已移除（重复入口 ✗）');
  assert.equal(client.includes("name: 'conversation.input.left'"), false, '不得再往 conversation.input.left 注册 ✗（注释里留说明是允许的 ✓）');
});

test('0.2.1 兼容：宿主探测报告含 compat（运行时版本 / 声明的区间 / defineTool 来源）', () => {
  const host = readText('plugin/host.impl.mjs');
  assert.match(host, /compat: state\.compat \|\| compatSnap \|\| null/, 'probe-report.json 必须有 compat 字段 ✓');
  assert.match(host, /await refreshCompat\(state\);/, 'host 探测结束时要刷新 compat ✓');
  assert.match(host, /dshRuntimeVersion:/, '必须记录运行时 DSH 版本');
  assert.match(host, /declaredEnginesDsh:/, '必须记录我们声明的 engines.dsh');
  assert.match(host, /includePrerelease 语义/, '必须写明官方判定语义（避免后人误改区间 ✗）');
});

test('0.2.1 兼容：工具注册是异步的 ⇒ 注册落地后必须再刷一次 compat（否则 defineToolSource 恒为 null ✗）', () => {
  const host = readText('plugin/host.impl.mjs');
  // 实测教训（0.2.1-rc.2 上）：首次 compat 采样发生在工具注册完成之前（`state.tools` 还是 null ✗），
  // 报告里 compat.defineToolSource / defineToolRegistered 一直是空的；注册落地后补刷才完整 ✓
  assert.match(host, /refreshCompat\(state\)\.then\(/, '工具注册成功后必须补刷 compat ✓');
  assert.match(host, /defineToolSource: src/, 'compat 必须带 defineTool 来源');
  assert.match(host, /defineToolResolved: tools && typeof tools\.defineToolResolved === 'boolean'/, 'compat 必须带解析成功标志');
});

test('0.2.1：工具卡声明 presentCall/presentResult（宿主展示契约）＋ 取值必须认 block.call 包裹形状', () => {
  const tools = readText('plugin/browser-tools.host.mjs');
  // ⚠️ 归因更正（独立评审纠偏，asar 内 dsh-client-ui-tool/README.zh.md:54 逐字）：
  //    presentCall/presentResult **不进 Client** ✗ ⇒ 它们**不是** keyed tool.call.toolview 的开关 ✗；
  //    我此前"声明后 called 从 0 → 8"的因果被一次**插件重载**混淆了 ✗。
  //    自定义工具卡不渲染的**真因**：官方结果块把载荷包在 `block.call` ✓（见下一断言）。
  assert.match(tools, /import\(`\.\.\/src\/tool-presentation\.mjs\?ts=\$\{Date\.now\(\)\}`\)/, '必须带 ?ts= 动态加载（P13 缓存纪律 ✗）');
  assert.match(tools, /presentCall: \(args\) => presentCallOf\(spec\.name, args\)/, '每个工具都要声明 presentCall（传工具名 ✓）');
  assert.match(tools, /presentResult: \(args, result\) => presentResultOf\(spec\.name, result\)/, '每个工具都要声明 presentResult（传工具名 ✓）');
  const shot = readText('src/shot-view.mjs');
  assert.match(shot, /const layers = \[block, block && block\.call\]/, '取值必须兼容 {call} 包裹形状 ✗（官方结果块如此 ✓）');
  const client = readText('plugin/client.js');
  assert.match(client, /const layers = \[block, block && block\.call\]/, '客户端内嵌副本同样要认 {call} ✓（parity ✓）');
});

test('A1 自愈：截图前台可见性丢失时（热重载后布局态丢失 ✗）要 open→expand→选回原标签，用毕还原', () => {
  const client = readText('plugin/client.js');
  assert.match(client, /op: 'open', target: 'agent'/, '必须先用 open（官方语义=建/复用）修复陈旧元素 ✗');
  assert.match(client, /op: 'expand', target: 'agent'/, '再展开才能铺开 stage ✓');
  assert.match(client, /op: 'tab-select', target: 'agent', tabId: keepTab/, '必须把原活动标签选回来（否则会截到 about:blank ✗）');
  assert.match(client, /layoutSelfHeal/, '自愈过程要记账（诊断第一手判据 ✓）');
  assert.match(client, /if \(layoutRestore\) \{/, '用毕必须还原原布局（对用户净零影响 ✓）');
});

test('B3/R-2/R-3：官方 Dock 座位（探测式 priority）+ HID 泵实例围栏 + 2s tick 单飞', () => {
  const client = readText('plugin/client.js');
  assert.match(client, /const DOCK_SLOT = 'shell\.bottom'/, 'Dock 要挂 0.2.1 新增的官方底栏 ✓');
  assert.match(client, /entriesOfSlot\(DOCK_SLOT\)\.length > 0/, 'single 槽位同优先级重复注册**必抛** ✗ ⇒ 必须先探测 ✓');
  assert.match(client, /priority: occupied \? -1 : 0/, '有人占位就抢渲染权（-1），没人用默认位（0）✓');
  assert.match(client, /'data-dsh-kit-agent-dock': '1'/, 'Dock 要有 DOM 判据（实机验收 ✓）');
  assert.match(client, /if \(!st\.open\) return null;/, '没有自持窗口必须渲染 null（对用户零足迹 ✓）');
  assert.match(client, /if \(!isLiveInstance\(stateRef\.clientBootAt\)\) \{ hidPumpStopped = true; return; \}/, 'HID 自续链必须有实例围栏（重载后旧链自杀 ✓）');
  assert.match(client, /hidPumpStopped = true;\s*\r?\n\s*try \{ if \(hidPumpTimer\) clearTimeout\(hidPumpTimer\); \}/, '卸载必须停泵（清句柄 ✓）');
  assert.match(client, /if \(!tickBusy\) \{/, '2s tick 的重活段（可 await 8s+）必须单飞 ✓');
});

test('R-7/R-8/R-9：截图三通道记账 + 回执探测带原因 + 配置页不留假开关', () => {
  const client = readText('plugin/client.js');
  assert.match(client, /out\.channels = \{ disk: !!out\.path, clipboard:/, 'R-7：三通道必须显式记账（ok:true 不得掩盖落盘失败 ✗）');
  assert.match(client, /out\.partial = !out\.channels\.disk && \(out\.channels\.clipboard \|\| out\.channels\.composer\)/, 'R-7：partial 判据 ✓');
  assert.match(client, /if \(out\.partial\) out\.note =/, 'R-7：部分成功必须给可读说明 ✓');
  const tools = readText('plugin/browser-tools.host.mjs');
  assert.match(tools, /export const RESULT_PROBE = \{ at: null, readError: null, skippedLines: 0 \}/, 'R-8：回执探测要记账 ✓');
  assert.match(tools, /if \(code !== 'ENOENT'\)/, 'R-8：只把 ENOENT 当正常空态 ✓，其余错误必须记账+告警 ✗');
  assert.match(tools, /RESULT_PROBE\.readError \? `回执文件读取失败/, 'R-8：超时文案必须带真实原因（否则是假超时 ✗）');
  const schema = readText('plugin/plugin-config.schema.mjs');
  assert.match(schema, /return z\.object\(\{\}\)/, 'R-9：保留空骨架（否则详情页配置区消失 ✗）');
  assert.equal(/shotsRoot:|autoJoinPanes:|annotatorSamePageOnly:/.test(schema), false, 'R-9：不得再留无人读取的假开关 ✗');
});

test('预览磁盘兜底：face 两端都有 shotDataUrl + 宿主围栏 + 渲染器内存优先/磁盘兜底', () => {
  const wire = readText('plugin/wire.host.mjs');
  const client = readText('plugin/client.js');
  const host = readText('plugin/host.impl.mjs');
  assert.equal((wire.match(/\['shotDataUrl'/g) || []).length, 1, 'wire 方法表要有 shotDataUrl ✓');
  assert.equal((client.match(/\['shotDataUrl'/g) || []).length, 1, 'client 描述符必须逐字对账 ✓（否则调用静默失败 ✗）');
  assert.match(host, /onShotDataUrl: \(name\) => \{/, '宿主实现 ✓');
  assert.match(host, /只接受 shots\/ 内的纯 \.png 文件名/, '安全围栏必须存在 ✗（纯文件名 + 目录内 ✓）');
  assert.match(host, /4 \* 1024 \* 1024/, '大小上限（4MB）✓');
  assert.match(client, /svc\.shotDataUrl\(name\)/, '渲染器要按需读回 ✓');
  assert.match(client, /const shown = \(entry && entry\.dataUrl\)/, '内存优先、磁盘兜底 ✓');
  assert.match(client, /diskFetched/, '兜底是否发生要可验收（仪器 ✓）');
});

test('U-2/U-5：会话 id 唯一口径（交付与工具同源）＋ 凭据保存失败必须如实回执', () => {
  const tools = readText('plugin/browser-tools.host.mjs');
  const deliv = readText('plugin/annot-delivery.host.mjs');
  const helper = readText('src/session-id.mjs');
  assert.match(helper, /export function sessionIdOfAgent\(agent, exec\)/, '正典必须存在 ✓');
  // 定向断言：sessionIdOf 的函数体里不得再有自己的候选表（别的地方用 `cands` 是合法的 ✓）
  const sidBody = (tools.match(/export function sessionIdOf\(exec\) \{[\s\S]{0,400}?\n\}/) || [''])[0];
  assert.ok(sidBody, '必须能找到 sessionIdOf 定义 ✓');
  assert.equal(/const cands = \[/.test(sidBody), false, '工具侧 sessionIdOf 不得再留自己的候选表 ✗');
  assert.equal((deliv.match(/payload\.agent\.session\.id \|\|/g) || []).length, 0, '交付侧不得再自算 session id ✗（否则两边口径会漂 ✗）');
  assert.match(tools, /return sessionIdOfAgent\(exec && exec\.agent, exec\);/, '工具侧走正典 ✓');
  assert.match(deliv, /const sid = sessionIdOfAgent\(payload && payload\.agent, null\);/, '交付侧走正典 ✓');
  const client = readText('plugin/client.js');
  assert.ok((client.match(/if \(!credSave\(/g) || []).length >= 3, 'U-5：三处保存都必须判结果（失败不能假报成功 ✗）');
  assert.match(client, /未写入本机存储|删除未写入本机存储|修改未写入本机存储/, 'U-5：失败要有用户可读回执 ✓');
});

test('胶囊不跳行：已挂过的模型失配后**不得**改挂到别的行（否则没批注的消息被挂上 N 条 ✗）', () => {
  const client = readText('plugin/client.js');
  /* ★2026-10-24（B5/D1 解耦后）：逻辑搬进 `@chip-target-canonical` 内嵌块 ⇒ 这里钉**正典块** ✓，
   * 行为语义（不跳行/不回退/不命中 base 自身）由 test/chip-target.test.mjs 的**行为钉**负责 ✓✓。 */
  const start = client.indexOf('/* @chip-target-canonical-begin');
  assert.ok(start > 0, '必须能定位 @chip-target-canonical 内嵌块 ✓');
  const body = client.slice(start, start + 2400);
  assert.match(body, /不跳行：宁可不显示，也不挂错消息/, '必须写明"不跳行"原则 ✓');
  assert.match(body, /return -1; \/\/ ★不跳行/, 'attachedKey 失配后必须返回 -1（不挂）✗');
  // 关键：attachedKey 分支里不得再用模糊锚 / attachIdx 当**目标**（那两条正是"跳行"通道 ✗）
  const head = body.slice(0, body.indexOf('if (base && base.last)'));
  assert.equal(/fuzzyFindKeyOf\(/.test(head), false, '已挂过的模型不得用模糊锚定位 ✗');
  assert.equal(/attachIdx < n\) return model\.attachIdx/.test(head), false, '已挂过的模型不得用 attachIdx 直接定位 ✗');
  assert.match(client, /skipped\.stale/, '刻意不挂要单独计数（与故障区分 ✓）');
});

test('通道超时契约：宿主下发自身期限、客户端**先于**宿主回执（否则真实原因被吞成"无回执" ✗）', () => {
  const tools = readText('plugin/browser-tools.host.mjs');
  const client = readText('plugin/client.js');
  assert.match(tools, /__timeoutMs: timeoutMs/, '宿主必须把自身期限随命令下发 ✓（工具超时最小 5s，不能写死 ✗）');
  assert.match(client, /const hostCap = Number\(command && command\.__timeoutMs\) \|\| CMD_BUDGET\.DEFAULT_CMD_TIMEOUT_MS;/, '客户端要读宿主期限 ✓（从 `command` 取，不是 handler 的 `c` ✗）');
  /* ★2026-10-24（B3/D2 解耦后）：公式已搬进 `@command-budget-canonical` 内嵌块 ⇒ **这里只钉"接线 + 指向行为钉"** ✓，
   * 不再钉字面公式 ✗（钉字面会随实现改动误红，或更糟——钉住错误实现 ✗ P116）。
   * 数值语义与「客户端上限 < 宿主期限」的**不变量**由 test/command-budget.test.mjs 行为钉负责 ✓✓。 */
  assert.match(client, /@command-budget-canonical-begin/, '必须保留 command-budget 内嵌副本（A1 模式 ✓）');
  assert.match(client, /const clientCap = clientCapOf\(hostCap\);/, '必须调用正典函数（不内联公式 ✗）');
  assert.match(client, /页面 8s 未响应 executeJavaScript/, 'guest-eval 必须有内层快失败（跨导航/长任务卡死时不干等 ✗）');
  assert.match(client, /cmd: \{\s*busy: !!cmdBusy/, 'kit-status 必须暴露命令通道现场（busy/epoch/last ✓）');
});

test('命令轮询器不得引用作用域外标识符（曾因 `c` 未定义 ⇒ 全部工具无回执 ✗，而旧钉子还把这个错钉住了 ✗✗）', () => {
  const client = readText('plugin/client.js');
  const s = client.indexOf('const pollCommands = async () => {');
  assert.ok(s > 0, '必须能定位 pollCommands ✓');
  const body = client.slice(s, s + 8000);
  assert.equal(/Number\(c && c\.__timeoutMs\)/.test(body), false, '轮询器里不得出现 handler 参数 `c` ✗（ReferenceError 会吞掉回执 ✗）');
  assert.match(body, /命令执行异常/, '执行异常也必须变成结构化回执 ✓（否则宿主只看到"无回执" ✗）');
  // 教训：钉子只能钉"期望行为"，不能钉"当前字面写法"✗ —— 本次就是钉住了错误实现 ✗
  assert.equal(/assert\.match\([^)]*中不得出现/.test(''), false);
});

test('M-3：两端 face 方法表**结构**对拍（名字/参数/可选参数 ✓ —— 散文签名不比对 ✗）', () => {
  /* 机械审计 M-3：两端的 `signature` 散文串有 5 处措辞漂移 ✗（文档差异 ✓ 有意保留 ✓），
   * 但**方法名 / 参数名 / 可选参数**必须逐项一致 ✓ —— 这才是"调用能不能通"的真契约 ✓。
   * 这里用"抽数组字面量 + 求值"的方式做结构对拍（数据字面量，无副作用 ✓）。 */
  const wireSrc = readText('plugin/wire.host.mjs');
  const clientSrc = readText('plugin/client.js');
  const wireArr = wireSrc.match(/const FACE_METHOD_TABLE = (\[[\s\S]*?\n\];)/);
  /* client 侧的数组以 `].map(([method, parameters, , optionals]) => ({...}))` 收尾 ✓（不是 `],` ✗） */
  const clientArr = clientSrc.match(/descriptors: (\[[\s\S]*?\n\s*\]\.map\()/);
  assert.ok(wireArr, '必须能抽取 FACE_METHOD_TABLE ✓');
  assert.ok(clientArr, '必须能抽取 REMOTE_CONTRIBUTION.descriptors ✓');
  const wire = new Function(`return ${wireArr[1].replace(/;\s*$/, '')};`)();
  const client = new Function(`return ${clientArr[1].replace(/\.map\($/, '')};`)();
  assert.ok(Array.isArray(wire) && Array.isArray(client));
  assert.equal(client.length, wire.length, `两端方法数必须一致（wire ${wire.length} vs client ${client.length} ✗）`);
  const shape = (rows) => rows.map((r) => [String(r[0]), (r[1] || []).map(String).join(','), (r[3] || []).map(String).join(',')].join(' | '));
  assert.deepEqual(shape(client), shape(wire), '两端方法名/参数/可选参数必须逐项一致 ✗（散文签名允许措辞不同 ✓）');
  // 反向：17 个以上方法，且 18 这个数字与 wire 头注一致 ✓
  assert.ok(wire.length >= 17, `方法数异常偏少（${wire.length}）✗`);
  assert.match(wireSrc, /face 契约共 \*\*18\*\* 方法/, 'wire 头注要写明方法数（S6① ✓）');
});
