/** test/plugin-client-contract.test.mjs — client.js 静态契约（R1-07 拆分：自 plugin-impl.test.mjs 平移，断言未改写；仅 refreshPanes 签名钉随 R4.1 实现同步） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ─────────────── 3.9 client.js 共享会话静态契约（P25/P26 回归钉） ─────────────── */

/** 读 client.js 源码（普通 script，非 ESM——静态契约为最经济的守护面）。 */
const clientSource = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8");

test("client.js 共享会话静态契约（P25 成员先入册 / P26 编号下限不双加）", async (t) => {
  await t.test("P26：joinFloorIndex 存在，且不再把 sessionMaxIndex()+1 当下限", () => {
    assert.match(clientSource, /const joinFloorIndex = \(maxUsed\) => \(Number\(maxUsed\) \|\| 0\)/);
    // 旧实现 `(await sessionMaxIndex() : 0) + 1` 直接跳号（窗口1批1 → 窗口2变3）
    assert.doesNotMatch(clientSource, /sessionMaxIndex\(\)[^;\n]*\+ 1/);
  });

  await t.test("P25：joinPane 内成员入册（push）先于 startPaneInSession", () => {
    const m = clientSource.match(/const joinPane = async \(target\) => \{([\s\S]*?)\n          \};/);
    assert.ok(m, "joinPane 函数体可定位");
    const body = m[1];
    const pushAt = body.search(/st\.panes\.push\(target\)/);
    const startAt = body.indexOf("startPaneInSession(target");
    assert.ok(pushAt >= 0, "joinPane 显式入册成员");
    assert.ok(startAt >= 0, "joinPane 调用 startPaneInSession");
    assert.ok(pushAt < startAt, "先入册再 start（start 的 Promise 到提交/取消才 settle）");
  });

  await t.test("自动加入与退出记忆：leftIds 存在且自动加入检查它；会话结束清空", () => {
    assert.match(clientSource, /leftIds: new Set\(\)/);
    assert.match(clientSource, /st\.leftIds\.has\(id\)/); // 自动加入跳过显式退出的面板
    assert.match(clientSource, /st\.leftIds\.clear\(\)/);
  });

  await t.test("面板身份按 webContentsId 比对（重渲染换节点不失配）", () => {
    assert.match(clientSource, /const paneIdOf = \(el\) =>/);
    assert.match(clientSource, /getWebContentsId/);
    assert.match(clientSource, /const refreshPanes = \(webviews\) =>/); // R4.1：webviews 可选参数（tick 内单次查询复用）
  });

  await t.test("1.6.0：版本锁同步 + 提交提示写输入框 + 清除按钮 + 同页门控（防串窗）", () => {
    assert.match(clientSource, /EXPECTED_ANNOT_VERSION = '1\.6\.0'/);
    // 提交提示：primeSessionInput（textarea/contenteditable 双兜底）+ 提交链接入
    assert.match(clientSource, /const primeSessionInput = \(text\) =>/);
    assert.match(clientSource, /announceSubmission\(r\)/);
    const annotSource = readFileSync(new URL("../src/element-annotator.js", import.meta.url), "utf8");
    assert.match(annotSource, /__dshKitAnnotatorVersion = "1\.6\.0"/);
    // 同页门控（A1 抽取后）：sync 快照带 href、判定走 planPaneSync 纯函数（annotator-sync.test.mjs
    // 全分支单测 + parity 对拍），此处只钉接线；annotator 按 pageOk 抑制徽标
    assert.match(clientSource, /href: location\.href/);
    assert.match(clientSource, /const plan = planPaneSync\(/);
    assert.match(clientSource, /st\.origins = plan\.nextOrigins/);
    assert.match(clientSource, /_originUrl/);
    assert.match(clientSource, /originUrls: \{\}/);
    assert.match(annotSource, /function samePageHref\(/);
    assert.match(annotSource, /pageOk/);
    // 清除按钮：存在于面板、append 顺序在 chevron 之前（DOM 顺序 = 图标左侧）
    assert.match(annotSource, /data-dsh-kit-panel-clear/);
    assert.match(
      annotSource,
      /header\.append\(icon, title, panelCount, clearBtn, panelChevron\)/,
      "清除按钮必须 append 在展开/收起图标左侧（悬浮 popout 的 header.append 不算）",
    );
    // clearAll 语义：写删除日志（否则共享会话下其他窗口 1.5s 后会被推回来）
    assert.match(annotSource, /function clearAllAnnots\(/);
    assert.match(annotSource, /clearAll: function \(/);
    const clearAllBody = annotSource.match(/function clearAllAnnots\(\) \{[\s\S]*?\n  \}/);
    assert.ok(clearAllBody, "clearAllAnnots 函数体可定位");
    assert.match(clearAllBody[0], /__dshKitDeletedGids/);
  });

  await t.test("P29：REMOTE_CONTRIBUTION 必须声明 saveMerged（face 装配缺口回归钉）+ gui-eval 诊断", () => {
    // 1.4.x 实测：wire.host 有 7 方法但 client 只 mount 6 个 → mergeAndSave 抛
    // 「svc.saveMerged is not a function」→ 提交静默失败、输入框提示永不触发
    assert.match(clientSource, /\['saveMerged', \['sets', 'meta'\]/);
    assert.match(clientSource, /'gui-eval': async function \(svc, c\)/);
    assert.match(clientSource, /lastPrime: stateRef\.lastPrime/);
  });

  await t.test("胶囊（ZCode 式）：输入框卡片内侧 + 会话指纹门控（P31 跨会话不泄漏）", () => {
    assert.match(clientSource, /dsh-kit-annot-chip/);
    assert.match(clientSource, /mode: 'saved',\s*\r?\n\s*count:/); // announceSubmission 挂 saved 模型（含 items/convo/bornAt）
    assert.match(clientSource, /const ensureAnnotChip = \(\) =>/);
    assert.match(clientSource, /svc\.deleteAnnotations\(m\.path\)/); // × 撤回
    assert.match(clientSource, /clearAll \? window\.__dshKitAnnotator\.clearAll\(\) : undefined/); // × 清除（会话中）
    // 会话指纹：document.title（去宿主后缀）建模时捕获、渲染前比对，切会话即隐藏
    assert.match(clientSource, /const convoTitle = \(\) => \(document\.title \|\| ''\)\.replace/);
    assert.match(clientSource, /model\.convo !== convoTitle\(\)/);
    assert.match(clientSource, /convo: convoTitle\(\)/);
    // 位置：ZCode 式独占一行——卡片内 data-inputScroll 前插 30px 占位行，胶囊悬于其上，正文不遮挡
    assert.match(clientSource, /dsh-kit-annot-spacer/);
    assert.match(clientSource, /ce\.closest\('\[data-inputScroll\]'\)/);
    assert.match(clientSource, /const removeChipSpacer = \(\) =>/);
    assert.match(clientSource, /removeChipSpacer\(\)/);
    // 双主题：胶囊只走主题令牌（T.bg/T.border/T.text/T.shadow），零字面底色；× hover 走令牌样式表
    assert.match(clientSource, /background:' \+ T\.bg \+ ';border:1px solid ' \+ T\.border/);
    assert.match(clientSource, /dsh-kit-annot-chip-style/);
    assert.match(clientSource, /--dsw-alias-interactive-bg-hover/);
    // 调试面板：默认隐藏可唤出（panel-toggle 命令 + localStorage 持久化；探测/上报等功能保留）
    assert.match(clientSource, /dsh-browser-kit:panel:hidden:v1/);
    assert.match(clientSource, /'panel-toggle': async function \(svc, c\)/);
    assert.match(clientSource, /PANEL_TOGGLE_EVENT/);
  });

  await t.test("单次消耗 + 会话内消息胶囊（2026-10-05 用户需求钉）：提交即清空（删除日志+广播）、发送检测、hover 提示", () => {
    // 1) 提交 = 单次消耗：逐面板 stop + clearAll（全量 gid 进删除日志），趁 active 跑一轮
    //    syncPanes 广播删除（旧 clear() 不写日志，清空中段会被其他窗口 union 推回）
    assert.match(clientSource, /if \(a\.stop\) a\.stop\(\); if \(a\.clearAll\) a\.clearAll\(\)/);
    assert.match(clientSource, /try \{ await syncPanes\(\); \} catch/);
    // 2) 发送检测：常规流协议块只进剪贴板、消息不含标记 → 信号用 userRow 结构（行数/末行指纹，
    //    CSS-module 哈希前缀 + 稳定后缀 `_userRow`）；基线在提交时点快照（P36：输入框写入另有修复）
    assert.match(clientSource, /const userRows = \(\) => Array\.from\(document\.querySelectorAll\('\[class\*="_userRow"\]'\)\)/);
    // 2a) 消耗判定已抽 src/annotator-consume.mjs（R3-1）：client 内嵌副本 canonical 标记 +
    //     调用点（判定规则全分支单测 + parity 对拍见 test/annotator-consume.test.mjs；
    //     断言强度由「锚实现行」升级为「锚抽取结构 + 正典单测」）
    assert.match(clientSource, /@annotator-consume-canonical-begin/);
    assert.match(clientSource, /if \(sig\.first !== base\.first\) return 'reset';/);
    assert.match(clientSource, /const action = planChipConsume\(sig, m\.base \|\| \{ n: rows\.length, first: sig\.first, last: sig\.last \}\)/);
    assert.match(clientSource, /else if \(action === 'reset'\) \{\s*m\.base = sig;/);
    assert.match(clientSource, /base: \{ n: rowsNow\.length, first: rowKey\(rowsNow\[0\] \|\| null\), last: rowKey\(rowsNow\[rowsNow\.length - 1\] \|\| null\) \}/);
    assert.match(clientSource, /stateRef\.sentChips = stateRef\.sentChips \|\| \[\]/);
    assert.match(clientSource, /queue\.push\(m\)/);
    // 2a-2) 归属行锁定：消耗瞬间记 attachedKey，补挂只认归属行（禁止「末尾 N 条」再配对——
    //       否则同一模型随新消息扩散；跨会话模型 convo 不匹配一律跳过）
    assert.match(clientSource, /m\.attachedKey = sig\.last;/);
    assert.match(clientSource, /const idx = rowKeys\.indexOf\(model\.attachedKey\);\s*const target = idx >= 0 \? rows\[idx\] : null;/);
    assert.match(clientSource, /if \(!model\.attachedKey \|\| model\.retracted \|\| model\.convo !== convo\) continue;/);
    // 2b) P36 回归钉：primeSessionInput 的可见性过滤必须是 isVisibleEl（曾误写未定义的 visible）
    assert.doesNotMatch(clientSource, /filter\(visible\)/);
    // 2c) 挂载目标 = userRow 内气泡（R1-06：选择器常量化 BUBBLE_SEL）；胶囊用块级容器包一层；插到文本上方
    assert.match(clientSource, /const BUBBLE_SEL = '\[class\*="_bubble"\]';/);
    assert.match(clientSource, /target\.querySelector\(BUBBLE_SEL\) \|\| target/);
    assert.match(clientSource, /wrap\.appendChild\(chip\)/);
    assert.match(clientSource, /else if \(holder\.firstChild\) holder\.insertBefore\(wrap, holder\.firstChild\)/);
    // 2d) P37 多实例认领制：ownerBoot 盖戳 + 新者胜旧者退让（removespy 实证多 rev 并存互删的回归钉）
    assert.match(clientSource, /dataset\.ownerBoot = String\(stateRef\.clientBootAt\)/);
    assert.match(clientSource, /const iAmNewer = \(el\) => !ownerBootOf\(el\) \|\| String\(stateRef\.clientBootAt\) >= ownerBootOf\(el\)/);
    assert.match(clientSource, /if \(existing && !iAmNewer\(existing\)\) return;/);
    // 2e) P37 工具条按钮同款接管：无戳/更旧 → 拆除重挂（批注动作路由进最新实例）
    assert.match(clientSource, /btn\.dataset\.ownerBoot = String\(stateRef\.clientBootAt\); \/\/ P37 认领戳/);
    assert.match(clientSource, /if \(owner === myBoot \|\| \(owner && owner > myBoot\)\) \{ attached \+= 1; continue; \}/);
    // 3) 会话消息胶囊：data 标记 + 幂等重挂 + P31 同款会话门控 + hover 富提示 + × 撤回占位
    assert.match(clientSource, /data-dsh-kit-ann-msg/);
    assert.match(clientSource, /const ensureConvoChips = \(\) =>/);
    assert.match(clientSource, /const ANN_TIP_ID = 'dsh-kit-ann-tip'/);
    assert.match(clientSource, /chip\.addEventListener\('mouseenter', \(\) => showAnnTip\(chip, model\)\)/);
    assert.match(clientSource, /model\.retracted = true/);
    // R2.2b：× 按钮与危险色样式单点化——共享构造器 + 单一样式标签（选择器通配两种容器）
    assert.match(clientSource, /const makeCloseButton = \(title\) =>/);
    assert.match(clientSource, /const ensureChipDangerStyle = \(\) =>/);
    assert.match(clientSource, /'#dsh-kit-annot-chip \[data-role=close\]:hover,'/);
    assert.match(clientSource, /\+ '\[data-dsh-kit-ann-msg\] \[data-role=close\]:hover\{'/);
    assert.match(clientSource, /const close = makeCloseButton\('撤回（删除已保存批注文件）'\);/);
    // 4) tick 接线 + 诊断句柄 + mergeAndSave 摘要（hover 提示数据源）
    assert.match(clientSource, /ensureConvoChips\(\); \/\/ 消息胶囊/);
    assert.match(clientSource, /ensureAnnotChip,\s*\r?\n\s*ensureConvoChips,/);
    assert.match(clientSource, /items\.sort\(\(x, y\) => x\.index - y\.index\)/);
    // 5) items 摘要 gid 去重（R3-2 抽取：canonical 标记 + 正典单测/parity 见
    //    test/annotations-summary.test.mjs；多面板同步含重复条目，悬浮提示不能出重复行）
    assert.match(clientSource, /@annotations-summary-canonical-begin/);
    assert.match(clientSource, /if \(seenGids\[gid\]\) continue;\s*seenGids\[gid\] = true;/);
    assert.match(clientSource, /const items = summarizeSets\(sets\);/);
    // 6) 悬浮可读性：text 回退 accessibleName（R3-2 后位于内嵌 summarizeSets canonical 副本）；
    //    选择器美化（截末两级 + 剔哈希类/nth 噪音，文件保持原值）
    assert.match(clientSource, /\(a && a\.element && a\.element\.accessibleName\) \|\| ''/);
    assert.match(clientSource, /const prettySel = \(sel\) =>/);
    assert.match(clientSource, /\/:nth-of-type\\\(/);
  });

  await t.test("W3：client descriptors ↔ wire FACE_METHOD_TABLE 逐字对账（P29 防复发）", async () => {
    // P29 实测：两端清单漂移 = face 调用静默失败。此测试把漂移变成红灯。
    const wire = await import("../plugin/wire.host.mjs");
    const wireMethods = wire.TYPERT.invocations.map((i) => ({ id: i.id, params: i.parameters.map((p) => ({ name: p.name, acceptsUndefined: !!p.acceptsUndefined })) }));
    // 从 client.js 源提取 REMOTE_CONTRIBUTION.descriptors 行：['method', ['a','b'], "sig（可含单引号）", ['opt']]
    const descRe = /\['([A-Za-z]+)', \[([^\]]*)\], (?:"[^"]*"|'(?:[^'\\]|\\.)*'), \[([^\]]*)\]\]/g;
    const clientMethods = [];
    let m;
    while ((m = descRe.exec(clientSource)) !== null) {
      const params = m[2].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean);
      const optionals = m[3].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean);
      clientMethods.push({
        id: `@local/dsh-browser-kit#dshBrowserKit/${m[1]}`,
        params: params.map((name) => ({ name, acceptsUndefined: optionals.includes(name) })),
      });
    }
    assert.ok(clientMethods.length >= 10, `client descriptors 至少 10 个（实际 ${clientMethods.length}）`);
    assert.deepEqual(clientMethods, wireMethods, "client descriptors 与 wire TYPERT 必须逐字一致（方法序、参数名、可选标记）");
  });

  await t.test("A6：命令处理器映射键唯一性 + 全量动作清单（C2/F2 复发钉）+ guest-eval document 参数遮蔽（P23 回归钉）", () => {
    // A6a（C2 拆表后）：commandHandlers 的每个 action 键只能出现一次，且全量清单钉死
    const keyRe = /'([a-z-]+)': async function \(svc, c\) \{/g;
    const keys = [...clientSource.matchAll(keyRe)].map((m) => m[1]);
    const expected = ['inject-annotator', 'start-annotator', 'toggle-pane', 'stop-annotator', 'annotator-status', 'guest-eval', 'page-open', 'kit-status', 'report-now', 'gui-eval', 'panel-toggle', 'toolbar-probe', 'panes-probe', 'page-close', 'dom-scan', 'snapshot', 'click', 'type', 'page-inject', 'reload', 'navigate', 'screenshot', 'submit-annotations'];
    const dup = keys.filter((v, i) => keys.indexOf(v) !== i);
    assert.deepEqual(dup, [], `commandHandlers 重复键：${dup.join(",")}`);
    assert.deepEqual(keys, expected, "commandHandlers 动作全量清单必须逐字一致");
    // A6b：guest-eval 的 document 必须经函数参数传入（P23：var 遮蔽会让函数体内 document=undefined）；
    // docExpr 按 frame 分支解析成表达式（cmd-99/101 回归）
    assert.match(clientSource, /return \(function \(document\) \{\\n\$\{code\}\\n\}\)\(\$\{docExpr\}\)/);
    assert.match(clientSource, /docExpr/);
  });

  await t.test("发送前防呆横条（待实施会话实机验收；规格 .local/feature-send-guard.md）", () => {
    // T1：ensureAwayBanner —— saved 模型在场且不在归属会话时渲染被动横条（与胶囊天然互斥）
    assert.match(clientSource, /dsh-kit-annot-away/);
    assert.match(clientSource, /const ensureAwayBanner = \(\) =>/);
    // 渲染条件（规格钉死）：saved 模型 + 当前不在归属会话（无需新状态，直接读现有模型）
    assert.match(clientSource, /m\.mode === 'saved' && m\.convo !== convoTitle\(\)/);
    // 文案模板串（规格原文）：归属会话名 + 条数（count 容错取数）
    assert.match(clientSource, /⏸ 会话「\$\{stateRef\.chip\.convo\}」有 \$\{Number\(stateRef\.chip\.count\) \|\| 0\} 条批注待发送/);
    // 锚定复用：ensureChipSpacer + spacer rect（与胶囊同位不同时）；挂 body fixed
    assert.match(clientSource, /const spacer = ensureChipSpacer\(ce\);\r?\n\s*let banner = existing;/);
    assert.match(clientSource, /banner\.style\.left = `\$\{Math\.max\(8, sr\.left \+ 12\)\}px`;/);
    // P37 认领戳必盖 + 退让分支（更新实例的横条在场：本实例不挂不改不删）
    assert.match(clientSource, /banner\.dataset\.ownerBoot = String\(stateRef\.clientBootAt\)/);
    assert.match(clientSource, /if \(existing && !iAmNewer\(existing\)\) return; \/\/ 更新实例的横条在场：本实例退让/);
    // 双主题：只走 T 令牌（零字面底色），与胶囊同款纪律
    assert.match(clientSource, /background:' \+ T\.bg \+ ';border:1px solid ' \+ T\.border/);
    // tick 接线：ensureAnnotChip/ensureConvoChips 之后
    assert.match(clientSource, /ensureAwayBanner\(\); \/\/ 发送前防呆/);
  });
});

