/**
 * v36/v37 回归钉子（2026-10-15 用户三问）：
 *  ① 开启批注时，**左键**必须正常点击页面元素（采集走右键）；
 *  ② 有批注内容后**关闭批注**，输入框仍有批注信息 ⇒ **发送时必须被消费/交付**；
 *  ③ 右键批注面板新增**快捷检查项**（可多选、未激活灰、激活主题色、可与手写意见共存）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const annotSrc = readFileSync(new URL("../src/element-annotator.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const clientSrc = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("① 左键放行：只有右键才拦截采集，left-click 不再被拦", () => {
  const a = annotSrc.indexOf("function handlePickClick(event) {");
  const body = annotSrc.slice(a, annotSrc.indexOf("function handleContextMenu", a));
  // 顺序：先判 button，后 preventDefault（否则左键仍被吞 ✗）
  const idxButton = body.indexOf("if (event.button !== 2) {");
  const idxPrevent = body.indexOf("event.preventDefault();");
  assert.ok(idxButton > 0 && idxPrevent > idxButton, "必须**先判非右键直接 return**，再 preventDefault（左键放行）");
  assert.match(body, /return; \/\/ ★v36：非右键\*\*不拦截\*\*/, "非右键必须直接放行");
  // click 拦截器已删除
  assert.doesNotMatch(annotSrc, /function handleBlockClick/, "handleBlockClick 应已删除（左键放行）✗");
  assert.doesNotMatch(annotSrc, /addSessionListener\(document, "click", handleBlockClick/, "不得再注册 click 拦截");
  assert.match(annotSrc, /addSessionListener\(document, "mousedown", handlePickClick, true\)/, "选择仍挂 mousedown");
  assert.match(annotSrc, /addSessionListener\(document, "contextmenu", handleContextMenu, true\)/, "右键菜单仍要屏蔽");
});

test("② 关闭批注后发送仍能消费：面板集合不依赖会话活跃 + 落盘失败不消费", () => {
  // 面板集合：成员 ∪ 会话作用域 webview ∪ 自持标签（去重）
  assert.match(clientSrc, /const liveAnnotPanes = \(\) => \{/, "必须有『不依赖会话活跃』的面板集合");
  const lb = clientSrc.slice(clientSrc.indexOf("const liveAnnotPanes = () => {"));
  const body = lb.slice(0, lb.indexOf("const mergeAndSave"));
  assert.match(body, /stateRef\.annot && stateRef\.annot\.panes/, "仍要含会话成员");
  assert.match(body, /data-sidebar-right-session=/, "会话关闭后要退回扫描本会话 webview");
  assert.match(body, /agentView && agentView\.tabs/, "自持窗口标签也要纳入");
  assert.match(body, /const seen = new Set\(\)/, "要按面板去重（避免重复落盘）");
  // mergeAndSave / consumeDraft 都用它
  assert.match(clientSrc, /for \(const p of liveAnnotPanes\(\)\) \{/, "mergeAndSave 必须用 liveAnnotPanes");
  // 落盘失败 ⇒ 保留草稿与页面批注（不丢数据）
  assert.match(clientSrc, /if \(!r \|\| r\.ok !== true\) \{/, "消费前必须检查落盘结果");
  assert.match(clientSrc, /批注未能交付（\$\{reason\}）：草稿与页面批注已保留/, "失败要明确告知且保留数据");
  // 发送钩子：按元素 WeakSet 补绑（输入框会被重建 ⇒ 旧布尔量只绑一次 ✗）
  assert.match(clientSrc, /const sendHookBoundEls = new WeakSet\(\);/, "发送钩子必须按元素去重（可补绑）");
  assert.doesNotMatch(clientSrc, /let sendHookBound = false;/, "旧的『只绑一次』布尔量必须删除 ✗");
  assert.match(clientSrc, /if \(!sendHookBoundEls\.has\(ce\)\) \{/, "每轮 tick 尝试补绑新输入框");
});

test("③ 快捷检查项：多选、灰/主题色、可与手写意见共存并合成进 Note", () => {
  // 快捷项集合（覆盖评审常见问题面）
  const m = /var QUICK_TAGS = \[([\s\S]*?)\];/.exec(annotSrc);
  assert.ok(m, "缺少 QUICK_TAGS 常量");
  const tags = m[1].match(/"([^"]+)"/g).map((s) => s.replace(/"/g, ""));
  for (const need of ["检查样式", "检查布局", "检查间隙"]) {
    assert.ok(tags.includes(need), `用户点名的检查项必须存在：${need}`);
  }
  assert.ok(tags.length >= 9, `检查项应覆盖常见问题面（当前 ${tags.length} 项）`);
  // 多选 + 颜色状态
  assert.match(annotSrc, /data-dsh-kit-tag-row/, "要有快捷项容器（便于回归定位）");
  assert.match(annotSrc, /btn\.setAttribute\("data-dsh-kit-tag", tag\);/, "每个快捷项要有稳定属性");
  assert.match(annotSrc, /record\.tags \|\| \(record\.tags = \[\]\)/, "标签存在 record 上（可多选）");
  assert.match(annotSrc, /var idx = list\.indexOf\(tag\);/, "点击即切换（可同时激活多个）");
  assert.match(annotSrc, /background: on \? ACCENT : "rgba\(255,255,255,0\.06\)"/, "未激活灰、激活主题色");
  assert.match(annotSrc, /btn\.setAttribute\("data-on", nowOn \? "1" : "0"\);/, "激活态可回归检查");
  // 与手写意见共存：合成进 Note（协议只有 Note 一行 ⇒ 标签必须进 Note 才能被 Agent 读到）
  assert.match(annotSrc, /function composeNote\(record\) \{/, "必须有合成函数");
  assert.match(annotSrc, /if \(tagPart && text\) return tagPart \+ "；" \+ text;/, "标签 + 手写意见合并");
  assert.match(annotSrc, /out\.note = noteText; \/\/ ★v36：标签 \+ 手写意见合并下发/, "publicAnnotation 下发合成后的 Note");
  assert.match(annotSrc, /noteNode\.textContent = composeNote\(record\)/, "面板行也显示合成结果");
  // 编辑时输入框只回显手写部分（标签用按钮点亮）
  assert.match(annotSrc, /field\.value = record\.note \|\| "";/, "输入框只回显手写内容");
  assert.match(annotSrc, /record\.note = record\.note\.slice\(joined\.length \+ 1\);/, "同步来的合成 Note 要剥掉标签前缀（避免重复叠加）");
  assert.match(annotSrc, /tags: Array\.isArray\(item\.tags\) \? item\.tags\.slice\(0\) : \[\],/, "跨窗口同步要带上 tags");
});

test("v38：发出去的消息行必须挂上批注胶囊（无行键 ⇒ 待挂态等新行，不再永久跳过）", () => {
  // 消费时：无论有没有行键都进队列 + 记待挂态与基线
  assert.match(clientSrc, /pendingAttach: !sentRowKey,/, "无行键时必须进待挂态");
  assert.match(clientSrc, /stateRef\.sentChips = stateRef\.sentChips \|\| \[\]\)\.push\(sentModel\); \/\/ ★v38/, "无论有没有行键都要入队（否则永不补挂 ✗）");
  /* 2026-10-28：挂载改走 turnTail 插槽，DOM 挂载点仅作回退 ⇒ 该断言改为"记录登记" */
  assert.match(clientSrc, /const writeTurnCards = \(sid, list\)/, "必须登记卡片记录（按会话落盘）");
  // 补挂循环：先处理待挂态（观察"是否出现新行"），再走原来的 attachedKey 路径
  assert.match(clientSrc, /const resolveChipTarget = \(model\) => \{/, "必须有统一的目标解析（自愈）");
  /* 2026-10-28：待挂兜底必须与 floorIdx 协同（原实现只比 base.n，会挂到下一条消息上 ✗） */
  assert.match(clientSrc, /model\.pendingAttach && n > Math\.max\(/, "待挂判定必须参与 floorIdx 计算");
  assert.match(clientSrc, /base && base\.n\) \|\| 0, floor\)/, "待挂兜底必须把 floorIdx 纳入上限");
  /* 2026-10-28：补挂循环已停用（卡片走 turnTail 插槽）⇒ 改为断言"停用 + 插槽在位" */
  assert.match(clientSrc, /目标行解析\/补挂循环已停用/, "补挂循环必须已停用（避免与插槽双渲染）");
  /* 2026-10-30：turnTail 已停用，DOM 为唯一路径 */
  assert.doesNotMatch(clientSrc, /safeInject\(\'conversation\\\\.chat\\\\.turnTail\'/, "turnTail 不得再注册");
  assert.match(clientSrc, /data-dsh-kit-ann-card/, "DOM 注入路径必须在位（唯一渲染入口）");
  assert.doesNotMatch(clientSrc, /if \(!model\.attachedKey\) \{\s*\n\s*if \(!model\.pendingAttach\) continue;/, "旧的『无行键且非待挂即跳过』必须删除 ✗");
  // 诊断可查
  assert.match(clientSrc, /chipAttach: \(\(\) => \{/, "kit-status 要暴露胶囊挂载现场");
  assert.match(clientSrc, /pending: q\.filter\(\(x\) => x && x\.pendingAttach\)\.length,/, "诊断含待挂数");
});
test("v38：三处身份/作用域缺口（自持窗口批注不进草稿也不挂胶囊）都已修", () => {
  // ① 身份一致：ensureConvoChips 里必须是 annotScopeId()（与模型写入端一致）
  assert.match(clientSrc, /const convo = annotScopeId\(\);/, "闸门必须与模型写入端同一身份（原 convoTitle() ⇒ 恒不相等 ⇒ 全部跳过 ✗）");
  assert.match(clientSrc, /readTurnCards/, "记录表必须可读（供 turnTail 按会话读取）");
  // ② 作用域：自持窗口不在侧栏作用域内，必须显式纳入
  assert.match(clientSrc, /inScope = paneOwnerLabel\(s2\.pane\)\.kind === 'owned';/, "自持窗口要视为 in-scope（否则批注不进草稿/不同步 ✗）");
  // ③ 草稿采集：空闲路径也要用同一套面板集合
  assert.match(clientSrc, /panes = liveAnnotPanes\(\); \} catch \{ panes = \[\]; \}/, "captureDraftIdle 必须含自持窗口");
});