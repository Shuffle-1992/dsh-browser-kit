/**
 * 凭据管理（「钥匙」图标）安全回归钉子。
 *
 * 用户要求（硬约束）：「保存的密码和信息**不给 Agent 所读，不进入上下文**」。
 *
 * 本测试把这条约束变成**可检查的断言**：
 *  ① 凭据只存在 GUI 的 localStorage（`dsh-kit-credentials`）——**不落工作区 / 不落 .data**；
 *  ② 凭据模块**不调用任何 host 服务**（无 svc.* / getRemote / saveMerged 等）⇒ 进不了任何落盘产物；
 *  ③ 凭据**不进 kit-status**（"命令通道可读"的面板诊断里不得出现凭据字段）；
 *  ④ 凭据**不进批注/交付管线**（annot-delivery / 批注 markdown 侧不得引用凭据键）；
 *  ⑤ 工具栏图标存在且位于批注**右侧**（用户指定位置）；
 *  ⑥ 填充只走"用户点击"（无自动提交/自动抓取页面密码）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clientSrc = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const deliverySrc = readFileSync(new URL("../plugin/annot-delivery.host.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const hostSrc = readFileSync(new URL("../plugin/host.impl.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const toolsSrc = readFileSync(new URL("../plugin/browser-tools.host.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 取出凭据模块的源码区间（从存储键声明到 ensureToolbarButtons 之前），用于可达面断言。 */
const credBlock = () => {
  const a = clientSrc.indexOf("const CRED_STORE_KEY = 'dsh-kit-credentials';");
  assert.ok(a > 0, "找不到凭据模块");
  const b = clientSrc.indexOf("const ensureToolbarButtons", a);
  assert.ok(b > a, "凭据模块区间可定位");
  return clientSrc.slice(a, b);
};

test("凭据只存 GUI localStorage：不落工作区、不写文件", () => {
  const block = credBlock();
  assert.match(block, /localStorage\.setItem\(CRED_STORE_KEY/, "必须存 localStorage");
  // 不得出现任何文件/工作区写入
  assert.doesNotMatch(block, /writeFileSync|appendFileSync|mkdirSync|readFileSync|node:fs/, "凭据模块不得触碰文件系统");
  assert.doesNotMatch(block, /workspacePath|projectDir|\.data[/\\]/, "凭据模块不得涉及工作区/插件数据目录");
});

test("凭据不调用任何 host 服务 ⇒ 无法进入落盘产物", () => {
  const block = credBlock();
  assert.doesNotMatch(block, /\bsvc\b|getRemote|saveMerged|saveAnnotations|reportClient|commandTarget/, "凭据模块不得调用 host 服务");
  assert.doesNotMatch(block, /executeJavaScript\([^)]*save/, "不得把凭据交给宿主保存");
});

test("凭据不进 kit-status（命令通道可读的诊断不得包含凭据）", () => {
  const a = clientSrc.indexOf("'kit-status'");
  assert.ok(a > 0, "kit-status 可定位");
  const statusBlock = clientSrc.slice(a, a + 6000);
  assert.doesNotMatch(statusBlock, /credLoad|CRED_STORE_KEY|credential|password/i, "kit-status 不得读取/暴露凭据");
});

test("凭据不进批注与交付管线（markdown / 注入消息都不含凭据）", () => {
  assert.doesNotMatch(deliverySrc, /credential|password|CRED_STORE_KEY/i, "交付模块不得引用凭据");
  assert.doesNotMatch(hostSrc, /CRED_STORE_KEY/, "宿主不得引用凭据存储键");
  assert.doesNotMatch(toolsSrc, /CRED_STORE_KEY|credLoad/, "工具层不得引用凭据存储");
});

test("工具栏「钥匙」图标在批注右侧，且标题写明不进 Agent 上下文", () => {
  const keyIdx = clientSrc.indexOf("id: 'dsh-kit-toolbar-key-btn'");
  const annotIdx = clientSrc.indexOf("id: 'dsh-kit-toolbar-btn'");
  assert.ok(keyIdx > 0 && annotIdx > 0, "两个图标都要在规格表里");
  assert.ok(keyIdx > annotIdx, "「钥匙」必须排在批注**右侧**（用户指定位置）");
  assert.match(clientSrc, /title: '账号与密码（仅本机保存；不写入文件、不进入 Agent 上下文）'/, "标题要写明安全边界");
  assert.match(clientSrc, /const KEY_ICON_SVG = /, "钥匙图标 SVG 必须存在");
  assert.match(clientSrc, /spec\.id === 'dsh-kit-toolbar-key-btn'/, "必须有点击处理");
  assert.match(clientSrc, /openCredMenu\(btn, pane\)/, "点击应打开凭据面板");
});

test("填充只由用户点击触发（无自动抓取页面密码 / 自动提交）", () => {
  const block = credBlock();
  assert.match(block, /const fillCredential = async \(pane, entry, opts\) =>/, "必须有显式填充函数（带 onlyIfEmpty 选项）");
  assert.match(block, /mkBtn\('填充'/, "填充是面板按钮（用户点击）");
  assert.doesNotMatch(block, /addEventListener\('submit'|\.submit\(\)/, "不得自动提交表单");
  assert.doesNotMatch(block, /input\[type="password"\]'\)\.value\s*[,;]/, "不得静默读取页面密码值");
  assert.match(block, /点击密码可显示|点击显示 \/ 隐藏/, "密码默认掩码，点击才显示");
});

test("居中定位 + 同源自动填充的安全边界（本轮新增）", () => {
  const block = credBlock();
  // ①居中：按 pane 的实际 rect 居中（取不到则退回窗口居中），append 后量高再定位
  assert.match(block, /const placeCentered = \(\) => \{/, "必须有居中式定位");
  assert.match(block, /curPane && curPane\.getBoundingClientRect/, "以浏览器板块 rect 为容器");
  assert.match(block, /placeCentered\(\); \/\/ ★居中（append 后才能量到真实高度）/, "append 后立即居中");
  assert.doesNotMatch(block, /rb\.left - 250/, "不得再锚在图标左下方（会跑到左上角 ✗）");
  // ②自动填充：仅同源、仅空字段、不自动提交、可开关、不回显明文
  assert.match(block, /const tryAutofillPanes = async \(\) => \{/, "必须有自动填充驱动");
  assert.match(block, /const entry = credMatch\(list, url\);/, "必须先按域名匹配（同源）");
  assert.match(block, /fillCredential\(p, entry, \{ onlyIfEmpty: true, withToken: true \}\)/, "自动填充必须 onlyIfEmpty（不覆盖用户输入）+ 回传文档 token");
  // ★2026-10-10 修：**刷新页面后必须重填** —— 旧实现按 `面板|URL` 记忆"已尝试" ⇒ URL 不变就永久跳过 ✗
  assert.match(block, /const credAutofillState = new Map\(\);/, "必须按面板记自动填充状态");
  assert.match(block, /if \(r\.docToken && st\.token !== r\.docToken\) \{ st\.token = r\.docToken; st\.done = false; st\.tries = 0; \}/, "文档代际变化（刷新/导航）必须重置为可填");
  assert.match(block, /window\.__dshKitAfDocToken/, "页面内要有文档代际 token");
  assert.match(block, /const withToken = !!\(opts && opts\.withToken\)/, "填充需支持回传文档 token");
  assert.match(block, /filled: o, docToken: o\.docToken \|\| null/, "成功时要回传文档 token");
  assert.match(block, /if \(r\.filled && r\.filled\.pass\) \{/, "只有填充成功才置完成");
  assert.match(block, /const AF_MAX_TRIES = 8;/, "表单晚渲染要按次数重试");
  assert.doesNotMatch(block, /credAutofillTried/, "旧的 `面板|URL` 记忆必须删除 ✗");
  assert.match(block, /if \(!pw \|\| String\(pw\.value \|\| ''\)\.length > 0\) return JSON\.stringify\(\{ skipped: 'not-empty', hasPassField: !!pw \}\);/, "空字段判定必须在页面内做");
  assert.doesNotMatch(block, /\.submit\(\)|requestSubmit/, "绝不自动提交");
  assert.match(block, /stateRef\.credAutofill\.count \+= 1;/, "诊断只记次数");
  assert.doesNotMatch(block, /credAutofill[\s\S]{0,80}(password|username)/, "诊断不得含用户名/密码");
  assert.match(block, /'识别到相同域名时自动填充（仅空字段，不自动提交）'/, "面板要有开关与说明");
  assert.match(clientSrc, /tryAutofillPanes\(\)\.catch\(\(\) => \{\}\); \/\/ ★同源自动填充/, "tick 必须驱动自动填充");
});
test("可管理已保存账号：编辑（就地更新，保留 id）与删除（二次确认防误触）", () => {
  const block = credBlock();
  // 编辑：按 id 就地更新；表单是重建的 ⇒ 必须回填
  assert.match(block, /mkBtn\('编辑', \(\) => \{/, "每行要有「编辑」");
  assert.match(block, /let editingId = null;/, "必须有跨 render 保持的编辑态");
  assert.match(block, /const syncFormForEditing = \(\) => \{/, "重渲染后必须回填编辑中的条目");
  assert.match(block, /const hitIdx = all\.findIndex\(\(x\) => x\.id === editingId\);/, "编辑必须按 id 就地更新（不是新增一条）");
  assert.match(block, /all\[hitIdx\] = Object\.assign\(\{\}, all\[hitIdx\], \{ origin: siteV, username: userV, password: passV/, "更新字段齐全");
  assert.match(block, /editing \? '保存修改' : '保存到本机'/, "保存键在编辑态变「保存修改」");
  assert.match(block, /mkBtn\('取消编辑', \(\) => \{ editingId = null; render\(\); \}\)/, "要有「取消编辑」");
  // 删除：两段式确认 + 删掉正在编辑的条目时退出编辑态
  assert.match(block, /delBtn\.dataset\.armed !== '1'/, "删除必须二次确认");
  assert.match(block, /delBtn\.textContent = '确认删除';/, "首次点击变为确认文案");
  assert.match(block, /credSave\(credLoad\(\)\.filter\(\(x\) => x\.id !== e\.id\)\);/, "确认后按 id 删除");
  assert.match(block, /if \(editingId === e\.id\) editingId = null;/, "删除正在编辑的条目要退出编辑态");
  // 边界不变：仍然不落盘 / 不调 host / 不自动提交
  assert.doesNotMatch(block, /writeFileSync|\bsvc\b|getRemote|saveMerged/);
  assert.doesNotMatch(block, /\.submit\(\)|requestSubmit/);
});
test("面板是全量管理器：列出**所有**已保存条目（不止当前站点）+ 计数 + 搜索 + 本页仅标记", () => {
  const block = credBlock();
  // 全部条目都要渲染（不得按当前站点过滤 ✗）
  assert.match(block, /const groups = new Map\(\);/, "列表视图必须按 host 聚合（Chrome 式）");
  assert.match(block, /const shown = kw\s*\n?\s*\?\s*list\.filter/, "搜索只影响显示，不影响数据");
  assert.match(block, /const list = credLoad\(\);/, "列表来源是全部已保存条目");
  assert.doesNotMatch(block, /for \(const e of list\) \{[\s\S]{0,200}credMatch\(\[e\], origin\) \? continue/, "不得把非当前站点的条目跳过 ✗");
  // 计数 + 搜索框 + 空结果提示
  assert.match(block, /cnt\.textContent = `已保存 \$\{list\.length\} 条 · \$\{groupsAll\.size\} 个站点`;/, "要有总条数与站点数（Chrome 式列表视角）");
  assert.match(block, /filter\.placeholder = '搜索站点 \/ 用户名';/, "要有搜索框");
  assert.match(block, /filter\.setAttribute\('data-dsh-kit-cred-filter', ''\);/, "搜索框要有稳定属性（供重渲染后恢复焦点）");
  assert.match(block, /let credFilter = '';/, "搜索词要跨 render 保持");
  assert.match(block, /没有匹配「\$\{credFilter\.trim\(\)\}」的站点（共 \$\{list\.length\} 条）/, "无匹配要有明确提示（列表视图按站点提示）");
  // 站点名不截断
  assert.doesNotMatch(block, /replace\(\/\^https\?:\\\/\\\/\/, ''\)\.slice\(0, 30\)/, "全量视图不得截断站点名 ✗");
  // 「本页」只是标记
  assert.match(block, /tag\.textContent = '本页';/, "当前站点的行要有「本页」标记");
});
test("Chrome 式两级视图：站点列表 → 点进详情（查看/编辑/保存/删除）", () => {
  const block = credBlock();
  // 两级视图与状态
  assert.match(block, /let credView = \{ level: 'list', host: null \};/, "必须有列表/详情两级视图状态");
  assert.match(block, /if \(credView\.level === 'detail'\) \{ renderDetail\(list, curHost\); return; \}/, "详情分支要先于列表");
  assert.match(block, /const renderList = \(list, curHost\) => \{/, "缺少列表视图");
  assert.match(block, /const renderDetail = \(list, curHost\) => \{/, "缺少详情视图");
  // 列表：按 host 聚合、显示"N 个账号"、行尾 ›、点击进入、本页标记
  assert.match(block, /name\.textContent = `\$\{host\}\$\{items\.length > 1 \? `  \$\{items\.length\} 个账号` : ''\}`;/, "同站多账号要折叠并标数量");
  assert.match(block, /chev\.textContent = '›';/, "行尾要有箭头（可点进）");
  assert.match(block, /credView = \{ level: 'detail', host \};/, "点行进入详情");
  assert.match(block, /tag\.textContent = '本页';/, "当前站点要有「本页」标记");
  assert.match(block, /row\.setAttribute\('data-dsh-kit-cred-site', host\);/, "站点行要有稳定属性");
  // 详情：返回、逐账号操作、空态、编辑态
  assert.match(block, /mkBtn\('‹ 返回列表'/, "详情要有返回");
  assert.match(block, /mkBtn\('填充'/, "详情要能填充");
  assert.match(block, /mkBtn\('编辑'/, "详情要能编辑");
  assert.match(block, /delBtn\.dataset\.armed !== '1'/, "删除仍需二次确认");
  assert.match(block, /该站点还没有账号，可在下面新增。/, "详情空态提示");
  assert.match(block, /const hitIdx = all\.findIndex\(\(x\) => x\.id === editingId\);/, "编辑就地更新");
  assert.match(block, /editing \? '保存修改' : '保存到本机'/, "编辑态保存键文案");
  // 列表页的「添加账号」进入详情新增
  assert.match(block, /mkBtn\('添加账号', \(\) => \{/, "列表要有「添加账号」");
  // 安全边界不变
  assert.doesNotMatch(block, /writeFileSync|\bsvc\b|getRemote|saveMerged/, "不得落盘/调 host");
  assert.doesNotMatch(block, /\.submit\(\)|requestSubmit/, "不得自动提交");
});