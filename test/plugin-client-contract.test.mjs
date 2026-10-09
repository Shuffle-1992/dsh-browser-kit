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

  await t.test("1.6.2：版本锁同步 + 提交提示写输入框 + 清除按钮 + 同页门控（防串窗）+ 评审采纳回归钉", () => {
    assert.match(clientSource, /EXPECTED_ANNOT_VERSION = '1\.6\.5'/);
    // 提交提示：primeSessionInput（textarea/contenteditable 双兜底）+ 提交链接入
    assert.match(clientSource, /const primeSessionInput = \(text\) =>/);
    assert.match(clientSource, /announceSubmission\(r\)/);
    const annotSource = readFileSync(new URL("../src/element-annotator.js", import.meta.url), "utf8");
    assert.match(annotSource, /__dshKitAnnotatorVersion = "1\.6\.5"/);
    // B5 增强（1.6.1）：rAF 合帧——mousemove 每帧最多一次 updateOverlay
    assert.match(annotSource, /hoverRaf = requestAnimationFrame\(function \(\) \{/);
    assert.match(annotSource, /cancelAnimationFrame\(hoverRaf\)/);
    // R-01（评审采纳）：意见框 Enter/Esc 交互合并进 capture 监听按 target 分流——
    // 原先 field 上的独立 keydown 监听是死代码（capture stopPropagation 后事件不进 target 阶段）
    assert.match(annotSource, /if \(event\.target === field\) \{/);
    assert.match(annotSource, /event\.key === "Enter" && !event\.shiftKey/);
    assert.match(annotSource, /closeNoteInput\(true\);/);
    assert.doesNotMatch(annotSource, /field\.addEventListener\("keydown"/); // 死监听不得复活
    // R-05：删除日志 push 前 gid 去重（集合语义；防长会话日志单调增长 + 每 1.5s 全量序列化）
    assert.match(annotSource, /if \(window\.__dshKitDeletedGids\.indexOf\(record\.gid\) < 0\) \{/);
    // R-06：resize rAF 合帧（拖拽窗口每帧最多一次 repositionAllBadges）
    assert.match(annotSource, /resizeRaf = requestAnimationFrame\(function \(\) \{/);
    assert.match(annotSource, /cancelAnimationFrame\(resizeRaf\)/);
    // R-07：popover 尺寸缓存（同目标悬停不再每帧读 offsetWidth/offsetHeight）
    assert.match(annotSource, /var popoverSize = null;/);
    assert.match(annotSource, /\(popoverSize && popoverSize\.w\) \|\| popover\.offsetWidth \|\| 240/);
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
    assert.match(clientSource, /if \(owner === myBoot \|\| \(owner && owner > myBoot\)\) continue;/);
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
    const expected = ['inject-annotator', 'start-annotator', 'toggle-pane', 'stop-annotator', 'annotator-status', 'guest-eval', 'page-open', 'kit-status', 'report-now', 'gui-eval', 'panel-toggle', 'toolbar-probe', 'panes-probe', 'browser-tabs', 'browser-open', 'browser-close', 'browser-panel', 'console-observer', 'agent-glow', 'page-close', 'dom-scan', 'snapshot', 'state', 'history', 'wait', 'select', 'element', 'check', 'agent-view', 'storage', 'upload', 'find', 'input', 'click', 'type', 'page-inject', 'reload', 'navigate', 'screenshot', 'submit-annotations', 'hid-enumerate', 'hid-open', 'hid-trace'];
    const dup = keys.filter((v, i) => keys.indexOf(v) !== i);
    assert.deepEqual(dup, [], `commandHandlers 重复键：${dup.join(",")}`);
    assert.deepEqual(keys, expected, "commandHandlers 动作全量清单必须逐字一致");
    // A6b：guest-eval 的 document 必须经函数参数传入（P23：var 遮蔽会让函数体内 document=undefined）；
    // docExpr 按 frame 分支解析成表达式（cmd-99/101 回归）
    assert.match(clientSource, /return \(function \(document\) \{\\n\$\{code\}\\n\}\)\(\$\{docExpr\}\)/);
    assert.match(clientSource, /docExpr/);
  });

  await t.test("R-INPUT：可信输入层（sendInputEvent）四要素不被回退（2026-10-10 实测解锁）", () => {
    // ①走 Chromium 级真事件（而非 DOM 合成）
    assert.match(clientSource, /const sendMouse = \(el, type, x, y, extra\) => el\.sendInputEvent\(\{ type, x, y, \.\.\.\(extra \|\| \{\}\) \}\)/);
    assert.match(clientSource, /sendMouse\(target, 'mouseDown'/);
    assert.match(clientSource, /target\.sendInputEvent\(\{ type: 'char', keyCode: ch \}\)/);
    // ②键盘路径必须先把焦点交给 guest（否则 Tab 等纯键盘事件无效），并在操作后**归还焦点**（R-SCOPE：不打断用户）
    assert.match(clientSource, /const focusGuest = \(el\) => \{/);
    assert.match(clientSource, /try \{ prev = document\.activeElement \|\| null; \} catch \{ prev = null; \}/);
    assert.match(clientSource, /if \(document\.contains\(prev\) && typeof prev\.focus === 'function'\) prev\.focus\(\);/);
    assert.match(clientSource, /const trustedClick = async \(target, c, op\) => \{\s*focusGuest\(target\);/);
    assert.match(clientSource, /const trustedType = async \(target, c\) => \{\s*focusGuest\(target\);/);
    // ③滚轮 delta 符号翻正（Windows 上 Electron 与网页相反）
    assert.match(clientSource, /deltaX: -dx, deltaY: -dy, canScroll: true/);
    // ④点击前遮挡检测 + force 逃逸口
    assert.match(clientSource, /document\.elementFromPoint\(cx, cy\)/);
    assert.match(clientSource, /if \(box\.occluded && c\.force !== true\)/);
    assert.match(clientSource, /目标中心被遮挡/);
    // ⑤click/type 保留 DOM 回退语义（mode 缺省不变），trusted 才走新路径
    assert.match(clientSource, /if \(String\(\(c && c\.mode\) \|\| ''\) === 'trusted'\) \{/);
  });

  await t.test("R-OWN v2：分辨率预设 / 右下角小窗 / 登录态复用 / 截图（2026-10-10 用户需求）", () => {
    // ①分辨率预设（参考 Chrome DevTools）；**默认 1920×1080**（用户 2026-10-10 指定）
    assert.match(clientSource, /const AGENT_VIEW_PRESETS = \{/);
    assert.match(clientSource, /'1080p': \{ w: 1920, h: 1080, dpr: 1, label: 'Desktop · 1920×1080' \},\s*'2K': \{ w: 2560, h: 1440, dpr: 1, label: '2K · 2560×1440' \},/);
    assert.match(clientSource, /return \{ key: '1080p', \.\.\.AGENT_VIEW_PRESETS\['1080p'\] \};/);
    assert.match(clientSource, /preset: \(opts && opts\.resolution\) \? String\(opts\.resolution\) : '1080p',/);
    assert.match(clientSource, /'iPhone 15 Pro': \{ w: 393, h: 852, dpr: 3/);
    assert.match(clientSource, /const agentViewResolvePreset = \(spec\) => \{/);
    assert.match(clientSource, /\^\(\\d\{2,5\}\)\\s\*\[x×\]\\s\*\(\\d\{2,5\}\)\$/); // 自定义 WxH
    // ②guest 视口=目标分辨率；**默认 100% 显示不缩放**（用户 2026-10-10 要求），仅 fit:true 才缩放
    assert.match(clientSource, /frame\.style\.width = `\$\{res\.w\}px`;/);
    assert.match(clientSource, /const k = \(expanded && fit\) \? Math\.min\(1, maxW \/ res\.w, maxH \/ res\.h\) : 1;/);
    assert.match(clientSource, /agentView\.stage\.style\.overflow = 'auto'; \/\/ 100% 显示时装不下就滚动看/);
    assert.match(clientSource, /if \(op === 'fit'\) \{/);
    // ③默认右下角小窗（收起），点顶部条/按钮展开
    assert.match(clientSource, /state: \(opts && opts\.state === 'expanded'\) \? 'expanded' : 'collapsed',/);
    assert.match(clientSource, /panel\.style\.height = expanded \? `\$\{panelH\}px` : `\$\{barH \+ 12\}px`;/);
    assert.match(clientSource, /title\.addEventListener\('click', \(\) => \{/);
    // ⑨R-OWN v4 UI（用户 2026-10-10）：无尺寸/缩放角标、无「收起」按钮；「−」最小化在 ✕ 左侧；
    //   截图=文字按钮；分辨率选择框**后面**紧跟缩放选择框（预设 + 自定义）；展开时贴标题栏下方并置顶
    assert.doesNotMatch(clientSource, /kitAgentViewBadge|data-kit-agent-view-badge/);
    assert.doesNotMatch(clientSource, /data-kit-agent-view-toggle/);
    assert.match(clientSource, /const minBtn = mkBtn\('▣', '最小化为右下角小窗 \/ 展开'/);
    assert.match(clientSource, /minBtn\.setAttribute\('data-dsh-kit-agent-view-min', ''\);/);
    assert.match(clientSource, /if \(minBtn\) minBtn\.textContent = expanded \? '−' : '▣';/);
    assert.match(clientSource, /const shootBtn = mkBtn\('', '截图当前窗口并直接插入输入框（同时落盘供 Agent 分析）'/);
    assert.match(clientSource, /shootBtn\.innerHTML = SHOT_ICON_SVG;/);
    // ⑬R-OWN v7：截图**直接输入到输入框**（只插图片、绝不加文字）；尺寸弹层**向下展开**
    assert.match(clientSource, /const insertImageToComposer = async \(dataUrl, fileName\) => \{/);
    assert.match(clientSource, /new ClipboardEvent\('paste', \{ bubbles: true, cancelable: true, clipboardData: dt \}\)/);
    assert.match(clientSource, /new DragEvent\('drop', \{ bubbles: true, cancelable: true, dataTransfer: dt2 \}\)/); // 路径②
    assert.match(clientSource, /const waitForImage = async \(\) => \{/); // 轮询校验（450ms 回读会误判）
    // ★用户实测 bug：一次点击插入 2 张 —— 根因是「检测器把 DSH 自带 svg 图标算成附件」+「按异步计数补发 drop」
    assert.match(clientSource, /if \(!src \|\| \/\^data:image\\\/svg\/i\.test\(src\)\) continue;/); // 排除 DSH 自带图标
    assert.match(clientSource, /handled = target\.dispatchEvent\(ev\) === false;/); // false=编辑器接管
    assert.match(clientSource, /if \(!handled\) \{/); // 只在**未被接管**时才发 drop（绝不补发）
    assert.match(clientSource, /if \(Date\.now\(\) - composerInsertAt < 1500\) \{/); // 防连点
    assert.match(clientSource, /out\.verified = await waitForImage\(\); \/\/ 仅观测/);
    assert.doesNotMatch(clientSource, /截图已保存/); // ★用户要求：不加任何文字进输入框
    assert.match(clientSource, /if \(ctxCmd && ctxCmd\.insertToComposer\) \{/);
    assert.match(clientSource, /const r = await captureShot\(\{ el: pane, insertToComposer: true \}\);/);
    assert.match(clientSource, /const openUp = below < Math\.min\(mh, 120\);/);
    assert.match(clientSource, /menu\.style\.top = openUp/);
    assert.match(clientSource, /const r = await captureShot\(\{ target: 'agent', insertToComposer: true \}\);/);
    // ⑪R-OWN v6：截图可同时复制到系统剪贴板（实测：canvas.toBlob→ClipboardItem 可用、execCommand 兜底）
    assert.match(clientSource, /const copyPngToClipboard = async \(dataUrl\) => \{/);
    assert.match(clientSource, /await navigator\.clipboard\.write\(\[new ClipboardItem\(\{ 'image\/png': blob \}\)\]\);/);
    assert.match(clientSource, /const ok = document\.execCommand\('copy'\);/);
    assert.match(clientSource, /if \(ctxCmd && ctxCmd\.clipboard\) \{/);
    assert.match(clientSource, /if \(ctxCmd && ctxCmd\.el\) cands = \[ctxCmd\.el\];/);
    // ⑫DSH 侧栏浏览器窗口也加两个图标（尺寸 / 截图到剪贴板），与批注图标同处工具条
    assert.match(clientSource, /const SIZE_ICON_SVG = /);
    assert.match(clientSource, /const SHOT_ICON_SVG = /);
    assert.match(clientSource, /const applyPaneDeviceSize = \(pane, presetKey\) => \{/);
    assert.match(clientSource, /const k = Math\.min\(1, availW \/ res\.w, availH \/ res\.h\);/);
    assert.match(clientSource, /const openPaneDeviceMenu = \(btn, pane\) => \{/);
    assert.match(clientSource, /\{ id: 'dsh-kit-toolbar-size-btn', title: '设备尺寸（选择分辨率；缩放按当前板块尺寸计算）', svg: SIZE_ICON_SVG, first: true \},/);
    assert.match(clientSource, /\{ id: 'dsh-kit-toolbar-shot-btn', title: '截图当前浏览器并直接插入输入框', svg: SHOT_ICON_SVG, first: false \},/);
    assert.match(clientSource, /const r = await captureShot\(\{ el: pane, insertToComposer: true \}\);/);
    assert.match(clientSource, /const zoomSel = mkSelect\(\s*ZOOM_STEPS/);
    assert.match(clientSource, /const ZOOM_STEPS = \[0\.25, 0\.5, 0\.67, 0\.75, 0\.8, 0\.9, 1, 1\.1, 1\.25, 1\.5, 1\.75, 2, 2\.5, 3, 4, 5\];/);
    // ⑮R-OWN v9：布局对齐 DSH 浏览器（行1=标签条 / 行2=←→↻ + 加宽地址栏 + 尺寸/缩放/截图/批注图标）
    assert.match(clientSource, /const tabStrip = head; \/\/ 标签 chip 直接落在这行里（DSH 同款：标签在上，地址栏在下）/);
    assert.match(clientSource, /const navBack = mkNav\('‹', '后退'/);
    assert.match(clientSource, /const navFwd = mkNav\('›', '前进'/);
    assert.match(clientSource, /const navReload = mkNav\('↻', '刷新'/);
    assert.match(clientSource, /addr\.style\.cssText = 'flex:1 1 auto;min-width:120px;/); // 地址栏加宽（唯一弹性项）
    assert.doesNotMatch(clientSource, /addrGo|'前往'/); // 删除「前往」
    assert.match(clientSource, /addrRow\.appendChild\(presetSel\);\s*addrRow\.appendChild\(zoomSel\);\s*addrRow\.appendChild\(zoomInput\);/);
    // v16：截图/批注图标放进**常显的标题行**（小窗状态下也可见可点）
    assert.match(clientSource, /head\.insertBefore\(annotBtn, minBtn\);/);
    assert.match(clientSource, /head\.insertBefore\(shootBtn, annotBtn\);/);
    // v16：小窗状态下也能截图（先临时展开→截图→收回小窗）
    assert.match(clientSource, /let restoreCollapsed = false;/);
    assert.match(clientSource, /out\.restoredCollapsed = true;/);
    assert.match(clientSource, /annotBtn\.innerHTML = ANNOT_ICON_SVG; \/\/ 与 DSH 批注图标同款/);
    assert.match(clientSource, /minBtn\.style\.marginLeft = 'auto';/);
    assert.match(clientSource, /const barH = expanded \? 60 : 32;/);
    // ★实测坑：`el.style.display = ''` 会清掉 cssText 里的 display:flex ⇒ 地址栏容器退回 block、
    //   内部 flex:1 1 auto 失效（地址栏只有 163px）。必须记住原 display 再恢复。
    assert.match(clientSource, /const markExpandedOnly = \(el\) => \{/);
    assert.match(clientSource, /el\.setAttribute\('data-kit-own-display', d\);/);
    assert.match(clientSource, /const want = expanded \? \(el\.getAttribute\('data-kit-own-display'\) \|\| ''\) : 'none';/);
    // ⑯R-OWN v10：标签旁不再显示网址（地址栏已有）·←→↻/截图/批注统一方框且图标居中
    assert.match(clientSource, /urlText\.textContent = ''; \/\/ 只作临时状态提示；网址由地址栏显示（用户要求）/);
    assert.doesNotMatch(clientSource, /agentView\.urlText\.textContent = u;/);
    assert.match(clientSource, /const agentStatus = \(msg\) => \{/); // 临时提示 6s 自动清空
    assert.match(clientSource, /\/\/ 与截图\/批注同款\*\*方框\*\*：固定 26×22 \+ flex 居中（图标\/字形都居中）/);
    assert.match(clientSource, /width:26px;height:22px;box-sizing:border-box;padding:0;line-height:1;/);
    assert.match(clientSource, /\/\/ 统一的「方框图标按钮」：固定尺寸 \+ flex 居中（截图\/批注\/最小化\/关闭共用）/);
    assert.match(clientSource, /align-items:center;justify-content:center;'\s*\+ 'width:26px;height:22px/);
    assert.match(clientSource, /addrRow\.style\.cssText = `flex:none;display:flex;align-items:center;gap:6px;padding:3px 8px;font:\$\{T\.font\};`/);
    assert.doesNotMatch(clientSource, /head\.appendChild\(presetSel\)/);
    // ⑭R-OWN v8：多窗口（标签）+ 地址栏 + 批注按钮 + 侧栏「↘ 同登录态开进自持」
    assert.match(clientSource, /const activeAgentTab = \(\) => \(agentView\.tabs \|\| \[\]\)\.find/);
    assert.match(clientSource, /const setActiveAgentTab = \(id\) => \{/);
    assert.match(clientSource, /const newAgentTab = async \(opts = \{\}\) => \{/);
    assert.match(clientSource, /const closeAgentTab = \(id\) => \{/);
    assert.match(clientSource, /const tabStrip = head; \/\/ 标签 chip 直接落在这行里/);
    assert.match(clientSource, /data-dsh-kit-agent-tabstrip/);
    assert.match(clientSource, /const addr = document\.createElement\('input'\);/);
    assert.match(clientSource, /if \(ev\.key === 'Enter'\) \{ ev\.preventDefault\(\); goAddr\(\); \}/);
    assert.match(clientSource, /const annotBtn = mkBtn\('', '批注总开关（当前窗口\/全部窗口同步，与会话浏览器共用同一批注）'/);
    assert.match(clientSource, /const r = await togglePaneAnnot\(el2\);/);
    assert.match(clientSource, /if \(op === 'tab-new'\) \{/);
    assert.match(clientSource, /if \(op === 'tab-close'\) \{/);
    assert.match(clientSource, /if \(op === 'tab-select'\) \{/);
    assert.match(clientSource, /const paneOwnerLabel = \(pane\) => \{/);
    assert.match(clientSource, /if \(op === 'annotate'\) \{/);
    // ⑰R-OWN v11：批注=会话级总开关（图标不再闪）+ 窗口归属标注
    assert.match(clientSource, /if \(st && st.active\) return endAnnotSession\(target\);/);
    assert.match(clientSource, /const endAnnotSession = async \(target\) => \{/);
    assert.match(clientSource, /const sessionOn = !!\(stateRef\.annot && stateRef\.annot\.active\);/);
    assert.match(clientSource, /\/\/ R-OWN v11：立即拉齐其余窗口（不等 2s tick）/);
    assert.match(clientSource, /if \(stateRef\.annot && stateRef\.annot\.active\) await joinPane\(frame\);/);
    assert.match(clientSource, /kind: 'owned',/);
    assert.match(clientSource, /label: `自持浏览器 \$\{tab\.id\}/);
    assert.match(clientSource, /label: `DSH 浏览器窗口 \$\{idx \|\| 1\}（会话 \$\{String\(sid\)\.slice\(-6\)\}）`/);
    assert.match(clientSource, /annotations: lst\.map\(\(a\) => Object\.assign\(\{\}, a, \{ window: owner\.label, windowKind: owner\.kind \}\)\)/);
    assert.match(clientSource, /window: String\(\(a && a\.window\) \|\| \(s && s\.owner\) \|\| ''\),/);
    // ⑱R-OWN v11b：实例围栏 + 属性驱动点亮（修"图标一闪一闪"：僵尸实例抢写内联样式）
    assert.match(clientSource, /const claimClientInstance = \(bootAt\) => \{/);
    assert.match(clientSource, /const isLiveInstance = \(bootAt\) => \{/);
    assert.match(clientSource, /if \(!isLiveInstance\(stateRef\.clientBootAt\)\) return; \/\/ 实例围栏（旧实例停止一切 DOM 操作）/);
    assert.match(clientSource, /if \(!isLiveInstance\(stateRef\.clientBootAt\)\) return;$/m);
    assert.match(clientSource, /const ANNOT_ON_STYLE_ID = 'dsh-kit-annot-on-style';/);
    assert.match(clientSource, /const applyAnnotBtnState = \(stateRef2\) => \{/);
    assert.match(clientSource, /b\.setAttribute\('data-kit-annot-on', '1'\)/);
    // v13：不再有蓝色背景（改为蓝色激活图标）；规则只把背景钉成透明
    assert.match(clientSource, /\{background:transparent !important;box-shadow:none !important;\}/);
    // ⑲R-OWN v11b：归属识别用 closest（P61：手写层数不够会静默失配）
    assert.match(clientSource, /host = pane\.closest \? pane\.closest\('\[data-sidebar-right-session\]'\) : null;/);
    // ⑳R-OWN v12：批注面板"可见带"定位（缩放/裁剪下不被挤出右边界）+ 页面 CSS 隔离 + 图标顺序
    assert.match(clientSource, /const paneVisibleWidth = \(pane\) => \{/);
    assert.match(clientSource, /return Math\.max\(0, Math\.round\(Math\.min\(hostW, rectW\) \/ \(k > 0 \? k : 1\)\)\);/);
    assert.match(clientSource, /visibleWidth: \$\{Number\(vw\) \|\| 0\}/);
    assert.match(clientSource, /setPaneMetrics\(\{ visibleWidth: \$\{band\}, visibleHeight: \$\{bandH\}, uiScale: \$\{s\}, bottomExtra: \$\{lift\} \}\)/);
    assert.match(clientSource, /\/\/ 顺序（用户 2026-10-10 指定）：尺寸 → 截图 → 批注；首个取 margin-left:auto 右对齐/);
    assert.match(clientSource, /const OWN_ICON_SVG = /);
    assert.match(clientSource, /\{ id: 'dsh-kit-toolbar-own-btn', title: '在 Agent 自持浏览器中打开（同登录态）', svg: OWN_ICON_SVG, first: false, afterSystemBrowser: true \},/);
    assert.match(clientSource, /const openUrlInAgentView = async \(url, opts = \{\}\) => \{/);
    assert.match(clientSource, /const sessionIdOfForm = \(form\) => \{/);
    assert.match(clientSource, /host\.insertAdjacentElement\('afterend', btn\)/);
    assert.match(clientSource, /const topOffset = 46;/);
    assert.match(clientSource, /panel\.style\.top = expanded \? `\$\{topOffset\}px` : 'auto';/);
    assert.match(clientSource, /panel\.style\.zIndex = '2147483647'; \/\/ 置顶/);
    assert.match(clientSource, /frame\.setZoomFactor\(zoom \* dpr\)/);
    assert.match(clientSource, /if \(op === 'zoom'\) \{/);
    // ⑩R-OWN v5 主题适配（用户 2026-10-10）：按面板实际背景判明暗 → color-scheme + 选项显式上色（修下拉弹层）
    assert.match(clientSource, /const colorLuminance = \(color\) => \{/);
    assert.match(clientSource, /const detectUiDark = \(\) => \{/);
    assert.match(clientSource, /const agentViewApplyTheme = \(force\) => \{/);
    assert.match(clientSource, /panel\.style\.colorScheme = dark \? 'dark' : 'light';/);
    assert.match(clientSource, /el\.style\.colorScheme = dark \? 'dark' : 'light';/);
    assert.match(clientSource, /opt\.style\.background = optBg;/);
    assert.match(clientSource, /opt\.style\.color = optFg;/);
    assert.match(clientSource, /if \(panelBg === null\) panel\.style\.background = dark \? 'rgba\(30, 32, 38, 0\.98\)' : 'rgba\(250, 250, 252, 0\.98\)';/);
    assert.match(clientSource, /try \{ agentViewApplyTheme\(\); \} catch \{ \/\* 主题自检失败不影响空闲逻辑 \*\/ \}/);
    assert.match(clientSource, /uiDark: agentView\.theme \? agentView\.theme\.dark : detectUiDark\(\),/);
    // ④登录态复用：官方身份公式 cwd:<workspace.path> + 用 partition 比对验证
    assert.match(clientSource, /const discoverStorageIdentity = async \(sessionId, workspacePath\) => \{/);
    assert.match(clientSource, /if \(workspacePath\) cands\.push\(`cwd:\$\{workspacePath\}`\);/);
    assert.match(clientSource, /if \(targets\.indexOf\(part\) >= 0\) \{/);
    assert.match(clientSource, /const AGENT_VIEW_IDENTITY_KEY = 'dsh-browser-kit:agent-view-identity:v1';/);
    assert.match(clientSource, /data-sidebar-browser-frame="webview"/);
    // ⑤身份变了要重建（否则切不到共享登录态）
    assert.match(clientSource, /if \(existing && opts\.recreate !== true && agentView\.identity === identity\) \{/);
    // ⑥自持窗口截图（供视觉分析）
    assert.match(clientSource, /if \(op === 'screenshot'\) \{/);
    assert.match(clientSource, /const r = await captureShot\(\{ target: 'agent', clipboard: c && c\.clipboard === true, insertToComposer: c && c\.insertToComposer === true \}\);/);
    // ⑦默认作用目标翻转为「自持窗口优先」+ 命中即续期「操作中」
    assert.match(clientSource, /if \(av\) \{ touchAgentView\(\); return av; \}/);
    // ⑧空闲即「让给用户」：边框回中性色 + 可配空闲自动释放（默认 10 分钟）
    assert.match(clientSource, /border:2px solid \$\{T\.border\};box-shadow/);
    assert.match(clientSource, /const agentViewSetBorder = \(active\) => \{/);
    assert.match(clientSource, /const want = active \? '2px solid #38bdf8' : `2px solid \$\{T\.border\}`;/);
    assert.match(clientSource, /if \(idle > AGENT_VIEW_IDLE_MS\) agentViewSetBorder\(false\); \/\/ 空闲：撤掉青色边框/);
    assert.match(clientSource, /agentView\.idleReleaseMs = opts && opts\.idleReleaseMs != null \? Math\.max\(0, Number\(opts\.idleReleaseMs\)\) : 10 \* 60 \* 1000;/);
    assert.match(clientSource, /agentView\.releasedForIdle = new Date\(\)\.toISOString\(\);/);
    assert.match(clientSource, /if \(op === 'idle'\) \{/);
  });

  await t.test("R-OWN v12/v13：批注面板可见带 + 固定尺寸 + 页面 CSS 隔离（1.6.4）", () => {
    const annotSource2 = readFileSync(new URL("../src/element-annotator.js", import.meta.url), "utf8");
    assert.match(annotSource2, /visibleWidth = Math\.max\(0, Number\(opts\.visibleWidth\) \|\| 0\)/);
    assert.match(annotSource2, /setVisibleWidth: function \(w\) \{/);
    assert.match(annotSource2, /all: "initial", \/\/ R-OWN v12：隔离宿主页面 CSS/);
    assert.match(annotSource2, /function positionPanel\(\) \{/);
    assert.match(annotSource2, /left: Math\.round\(visibleBand\(\) \/ 2\) \+ "px"/);
    assert.match(annotSource2, /positionPanel\(\); \/\/ R-OWN v12：按可见带锚定/);
    // R-OWN v13：固定尺寸（1/uiScale 反向缩放）+ 右下角 + 蓝色激活图标（不用背景色）
    assert.match(annotSource2, /var uiScale = 1; \/\/ R-OWN v13/);
    assert.match(annotSource2, /function applyPanelScale\(el, origin\) \{/);
    assert.match(annotSource2, /panel\.style\.bottom = bottomGap \+ "px";/);
    assert.match(annotSource2, /setPaneMetrics: function \(m\) \{/);
    assert.match(clientSource, /const ANNOT_ICON_ACTIVE_SVG = /);
    // v14：激活图标 = 原图标**描边**变蓝（fill:none，不是蓝块）；批注激活时自持小窗换到左下角
    assert.match(clientSource, /fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"/);
    assert.match(clientSource, /const annotBottomExtra = \(pane\) => \{/);
    assert.match(clientSource, /bottomExtra: \$\{lift\} \}\) : 0`, true\)/);
    assert.match(annotSource2, /var bottomExtra = 0; \/\/ R-OWN v15/);
    assert.match(annotSource2, /\(bottomExtra > 0 \? Math\.round\(bottomExtra\) : 0\)/);
    // v15：注入图标与 DSH 自带图标同色（两种主题一致）+ 小窗始终右下角
    assert.match(clientSource, /const sysBrowserBtnOf = \(form\) => \{/);
    assert.match(clientSource, /const syncToolbarIconColor = \(\) => \{/);
    assert.match(clientSource, /if \(b && b\.style\.color !== c\) b\.style\.color = c;/);
    assert.match(clientSource, /panel\.style\.right = expanded \? '12px' : '16px';/);
    assert.match(clientSource, /if \(b\.innerHTML !== want\) b\.innerHTML = want;/);
    assert.match(clientSource, /const syncAnnotMetrics = \(pane\) => \{/);
    assert.match(clientSource, /const paneUiScale = \(pane\) => \{/);
    assert.match(clientSource, /uiScale: \$\{us\}/);
  });

  await t.test("R-SCOPE：自动化只作用于本会话窗口（用户需求 2026-10-10）", () => {
    // ①会话作用域的 webview 选择（面板容器带 data-sidebar-right-session）
    assert.match(clientSource, /const scopedWebviews = \(sessionId\) => \{/);
    assert.match(clientSource, /\[data-sidebar-right-session="\$\{String\(sessionId\)\}"\] webview/);
    assert.match(clientSource, /const inputTargetOf = \(c\) => \{\s*\/\/ R-SCOPE/);
    // ②面板类命令比对「当前前台会话」，页面类命令要求本会话有已挂载面板
    assert.match(clientSource, /const scopeCheck = \(action, c\) => \{/);
    assert.match(clientSource, /const PANEL_ACTIONS = new Set\(\['browser-open', 'browser-close', 'browser-panel'\]\)/);
    assert.match(clientSource, /const READONLY_ACTIONS = new Set\(\['browser-tabs'\]\)/);
    assert.match(clientSource, /const PAGE_ACTIONS = new Set\(\['snapshot', 'state', 'history', 'wait', 'select', 'element', 'check', 'input', 'click', 'type', 'page-inject', 'reload', 'navigate', 'screenshot', 'console-observer', 'storage', 'upload', 'find'\]\)/);
    assert.match(clientSource, /const INTERACTIVE_ACTIONS = new Set\(\['input', 'click', 'type', 'select', 'check'\]\)/);
    assert.match(clientSource, /const denied = scopeCheck\(action, c\);/);
    // ③用户正在输入时拒绝（force 逃逸）+ 焦点归还
    assert.match(clientSource, /const typingGuard = \(c\) => \{/);
    assert.match(clientSource, /guard: 'user-typing'/);
    // ④光效也只在本次会话的面板里找目标（别把光画到别人的窗口上）
    assert.match(clientSource, /const sid = stateRef\.agentGlow \? stateRef\.agentGlow\.sessionId : null;\s*const all = scopedWebviews\(sid\);/);
    // ⑤截图同样按会话收敛（R-OWN 后：候选=自持窗口优先+本会话面板，target 可强制）
    assert.match(clientSource, /const sessionEls = scopedWebviews\(ctxCmd && ctxCmd\.sessionId\);/);
    assert.match(clientSource, /const wantShot = ctxCmd && ctxCmd\.target \? String\(ctxCmd\.target\) : null;/);
  });

  await t.test("R-GLOW：Agent 操作光效——打点集合 + 分发器统一打点 + 可控命令（用户需求 2026-10-09）", () => {
    // 打点集合必须覆盖会动页面的浏览器命令；纯盘点类不得入集（免得屏幕常闪）
    assert.match(clientSource, /const AGENT_GLOW_ACTIONS = new Set\(\['navigate', 'reload', 'click', 'type', 'page-inject', 'screenshot', 'snapshot', 'browser-open', 'browser-close', 'browser-panel', 'input', 'history', 'select', 'check', 'storage', 'upload', 'find'\]\)/);
    assert.doesNotMatch(clientSource, /AGENT_GLOW_ACTIONS = new Set\(\[[^\]]*'browser-tabs'/);
    // 分发器统一打点（新增命令无需逐个改 handler）+ R-SCOPE：打点时钉住本次会话 id
    assert.match(clientSource, /if \(AGENT_GLOW_ACTIONS\.has\(action\)\) \{ stateRef\.agentGlow\.sessionId = c && c\.sessionId \? String\(c\.sessionId\) : null; pulseAgentActivity\(action\); \}/);
    // 浮层：四边描边 + 外发光 + 呼吸动画；纯提示不挡交互
    assert.match(clientSource, /const AGENT_GLOW_ID = 'dsh-kit-agent-glow'/);
    assert.match(clientSource, /pointer-events:none;z-index:2147483645/);
    assert.match(clientSource, /dshKitAgentGlowPulse/);
    assert.match(clientSource, /box-shadow:0 0 0 1px rgba\(8,20,32,\.55\),0 0 12px 2px rgba\(56,189,248,\.75\),0 0 34px 8px rgba\(56,189,248,\.35\)/);
    // 自动淡出 + 手动控制
    assert.match(clientSource, /const stopAgentGlow = \(\) => \{/);
    assert.match(clientSource, /trackInterval\(setInterval\(renderAgentGlow, AGENT_GLOW_TICK\)\)/);
    assert.match(clientSource, /'agent-glow': async function \(svc, c\) \{/);
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

