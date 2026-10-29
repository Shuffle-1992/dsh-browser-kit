/**
 * 批注卡片必须走 **conversation.chat.turnTail 插槽**（React 托管），不得回退到 DOM 注入。
 *
 * 2026-10-28 用户指路：dsh-cost-meter 的「本轮费用」用该插槽稳定显示在消息底部；
 * 我们的 DOM 注入方案（塞气泡内 / 挂行后）反复"容易丢失显示"。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientSrc = () => readFileSync(join(root, "plugin/client.js"), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("turnTail 插槽**已按用户要求停用**（卡片只在消息上方显示）", () => {
  const code = stripComments(clientSrc());
  // 2026-10-30 用户："本轮费用下面的这个，可以删除了"
  // 该卡片在 assistant 回合末尾（"本轮费用"下），语义不对 —— 批注是用户发出的，应贴用户消息上方。
  assert.ok(!/safeInject\('conversation\.chat\.turnTail'/.test(code), "不得再注册 turnTail 插槽");
  assert.ok(!/name: 'conversation\.chat\.turnTail'/.test(code), "不得再出现该插槽注册参数");
  // 组件与数据层保留（便于将来恢复），但不再注册 ⇒ 不会渲染
  assert.ok(code.includes("AnnotTurnCard"), "组件定义保留（未注册即不渲染）");
});

test("组件按 dsh-cost-meter 源码的真实 props 取值（turn.start.seq / turn.end.seq / sessionId）", () => {
  const code = stripComments(clientSrc());
  // 依据: src/client/02-validators-helpers-sidebar.js 里 TurnCost:
  //   const start = props.turn?.start?.seq, end = props.turn?.end?.seq
  //   const sessionId = props.sessionId
  assert.ok(code.includes("turn.start.seq"), "必须读 turn.start.seq（cost-meter 源码写法）");
  assert.ok(code.includes("turn.end.seq"), "必须读 turn.end.seq");
  assert.ok(code.includes("props.sessionId"), "必须读 props.sessionId");
});
test("用原生 details/summary 折叠（与「本轮费用」一致的交互）", () => {
  const code = stripComments(clientSrc());
  assert.match(code, /h\('details',/, "必须用 details 元素");
  assert.match(code, /h\('summary',/, "必须用 summary 作可点击标题");
  assert.match(code, /'批注 ' \+ n \+ ' 条'/, "标题文案：批注 N 条");
});

test("渲染绝不把宿主拖下水（异常返回 null）", () => {
  const code = stripComments(clientSrc());
  const i = code.indexOf('const AnnotTurnCard = (props) => {');
  assert.ok(i > 0, "组件可定位");
  const seg = code.slice(i, i + 9000);
  assert.match(seg, /catch \{ return null; \}/, "组件体必须捕获异常并返回 null");
});

test("登记记录：读→追加→写（localStorage 单一数据源，无内存副本）", () => {
  const code = stripComments(clientSrc());
  assert.ok(code.includes("const readTurnCards = (sid) =>"), "必须有 readTurnCards");
  assert.ok(code.includes("const writeTurnCards = (sid, list) =>"), "必须有 writeTurnCards");
  assert.ok(code.includes("const list = readTurnCards(sidNow)"), "登记时从存储读（不读内存副本）");
  assert.ok(code.includes("writeTurnCards(sidNow, list)"), "登记后落盘");
  assert.ok(code.includes("while (list.length > TURN_CARDS_PER_SESSION) list.shift()"), "每会话有界（永久保留，上限 200）");
  // 用户质疑后的关键约束：不得再有内存副本
  assert.ok(!code.includes("stateRef.annotTurnCards"), "不得再有内存副本 annotTurnCards");
});
test("匹配：seq 上界取最近 + 会话过滤（无跨会话兜底）", () => {
  const code = stripComments(clientSrc());
  assert.ok(code.includes("x.seq <= end"), "记录 seq 按上界匹配（快照必然 <= 本轮 end）");
  assert.ok(code.includes("const sessOk = (x) =>"), "必须有会话过滤");
  assert.ok(code.includes("x.__turnKey == null"), "优先选未归属记录");
  assert.ok(code.includes("const TURN_CARDS_TTL_MS = Number.POSITIVE_INFINITY"), "记录永久保留（不受时间过期）");
  assert.ok(!code.includes("Date.now() - x.at < 10 * 60 * 1000"), "不得再有 10 分钟渲染窗口（否则盘上有记录也不显示）");
  assert.ok(code.includes("Date.now() - x.at < TURN_CARDS_TTL_MS"), "渲染窗口与持久化口径一致");
});
test("DOM 卡片幂等自愈：运行时 Map 记 DOM 引用（挂载状态不入持久层）", () => {
  const code = stripComments(clientSrc());
  assert.ok(code.includes("domEls.get(x.id)"), "按记录 id 查 DOM 引用");
  assert.ok(code.includes(".isConnected"), "按是否在 DOM 判断是否需要重挂");
  assert.ok(code.includes("domEls.set(rec.id, el)"), "挂载后记入 Map");
  assert.ok(code.includes("domEls.delete(rec.id)"), "挂不上就清引用");
});
test("归属锁定用运行时 Map（记录每次从存储新解析，不能挂在对象上）", () => {
  const code = stripComments(clientSrc());
  assert.ok(code.includes("const shownTurns = "), "必须有 shownTurns 运行时 Map");
  assert.ok(code.includes("shownTurns.get(hit.id)"), "按 id 查归属");
  assert.ok(code.includes("shownTurns.set(hit.id, turnKey)"), "首次归属即锁定");
  assert.ok(code.includes("else if (prevTurn !== turnKey) return null"), "另一个 turn 拒绝");
});
test("卡片正文按真实字段渲染（text/window/selector），不是 tag/name/note", () => {
  const code = stripComments(clientSrc());
  // 2026-10-29 用户反馈"展开看不到详细内容"：items 来自 summarizeSets = { index, gid, selector, text, url, window }
  // 只检查**卡片函数体**（批注镜像面板另有 tag 字段，属正常）
  const iCard = code.indexOf("const cardLineOf = (it) => {");
  assert.ok(iCard > 0, "卡片行渲染函数可定位");
  const seg = code.slice(iCard, iCard + 1200);
  assert.ok(seg.includes("it.text"), "卡片必须读 it.text");
  assert.ok(seg.includes("it.window"), "卡片必须读 it.window");
  assert.ok(seg.includes("it.selector"), "卡片必须读 it.selector");
  assert.ok(!seg.includes("it.tag"), "卡片不得读 it.tag（items 无该字段）");
  assert.ok(!seg.includes("it.code"), "卡片不得读 it.code（items 无该字段）");
});
test("卡片插在用户行最前（显示在消息气泡上方）", () => {
  const code = stripComments(clientSrc());
  assert.ok(code.includes("row.insertBefore(card, first)"), "必须插到行最前");
  assert.ok(code.includes("const first = row.firstElementChild"), "取行内首个子节点");
});

test("跨会话绝不错显：候选必须过会话过滤", () => {
  const code = stripComments(clientSrc());
  // 2026-10-29 用户实测："那边别的窗口的批注，不是发给你的"
  assert.ok(code.includes("const sessOk = (x) =>"), "必须有会话过滤函数");
  assert.ok(code.includes("if (sid && x.sessionId) return String(x.sessionId) === sid"), "有 sid 时必须严格相等");
  // 旧的"无会话即放行一切"必须不存在
  assert.ok(!code.includes("if (!x.sessionId) return true"), "不得放行无会话记录做通配");
});
test("会话隔离靠按会话 key 存储 + 读取", () => {
  const code = stripComments(clientSrc());
  assert.ok(code.includes("TURN_CARDS_KEY_PREFIX"), "按会话的存储 key 前缀");
  assert.ok(code.includes("const turnCardsKeyOf = (sid) =>"), "key 由 sessionId 生成（白名单清洗）");
  assert.ok(code.includes("readTurnCards(curSid)"), "DOM 路径按当前会话读");
  assert.ok(code.includes("sid ? readTurnCards(sid) : []"), "turnTail 按会话读（无会话不读）");
  assert.ok(!code.includes("x.sessionId && String(x.sessionId) === curSid"), "不需要逐条会话过滤");
});
test("目标行只认登记时的锚点，绝不退回最后一行（否则会挂到后一条消息上）", () => {
  const code = stripComments(clientSrc());
  // 2026-10-30 用户实测："本来是显示在测试上面的，我发送继续后，切了会话回来，变成在继续上面显示了" ✗
  assert.ok(code.includes("__targetIdx"), "登记时必须锁定目标行索引");
  assert.ok(code.includes("__prevRowKey"), "必须记录发送前最后一行，用于防偏");
  assert.ok(code.includes("k !== rec.__prevRowKey"), "目标行不得等于发送前最后一行");
  // 旧的"退回最后一行"兜底必须不存在
  assert.ok(!code.includes("if (!row && !hasAnchor) row = rows[rows.length - 1]"), "不得退回最后一行挂载");
});

test("行锚点取发送意图瞬间的行数（新行渲染前），不取挂载时刻", () => {
  const code = stripComments(clientSrc());
  // 2026-10-30 用户实测："下面的有，上面的没挂上"、"有挂到下面这条了" ✗
  // 根因：recordTurnCard 时刻新行可能已渲染 ⇒ 锚点偏后一行 ⇒ 挂到下一条消息
  assert.ok(code.includes("stateRef.sendRowCountAtIntent = userRows().length"), "发送意图时必须记录行数");
  assert.ok(code.includes("const n0 = Number(stateRef.sendRowCountAtIntent)"), "登记时必须优先用意图行数");
  assert.ok(code.includes("stateRef.sendRowCountAtIntent = null"), "用后必须清空（只对本次生效）");
});

test("以发送时的输入框文本为**硬锚点**（不修改消息内容）", () => {
const code = stripComments(clientSrc());
// 2026-10-30 用户实测"没批注的消息显示了批注、有批注的没显示" ⇒ 文本必须是硬条件
assert.ok(code.includes("stateRef.sendTextAtIntent"), "发送意图时必须记录输入框文本");
assert.ok(code.includes("__msgText"), "记录必须保存消息文本锚点");
assert.ok(code.includes("const normK = (v) =>"), "文本比较要归一化空白（容忍渲染差异）");
assert.ok(code.includes("k.startsWith(w0)"), "按归一化前缀匹配");
assert.ok(code.includes("if (cands.length === 1)"), "单候选直接命中");
assert.ok(code.includes("else if (cands.length > 1)"), "多候选才进入排序 ⇒ 0 候选必然不挂（硬锚点）");
assert.ok(code.includes("stateRef.sendTextAtIntent = null"), "用后必须清空（防串到下次发送）");
});

test("时间戳**只在文本候选内部排序**，不得单独作为锚点", () => {
const code = stripComments(clientSrc());
// 2026-10-30 用户建议用时间戳消歧，但"时间戳单独 +5 分就能挂"会导致文本不符也挂 ✗
assert.ok(code.includes("__atHHMM"), "记录保存发送时刻 HH:MM");
assert.ok(code.includes("getHours()") && code.includes("getMinutes()"), "用本地时间（与消息行一致）");
assert.ok(code.includes("const hhmmOf ="), "时间戳解析集中到一处");
// 关键：时间戳不得单独构成锚点
assert.ok(!code.includes("sc += 5"), "不得再有评分制（时间戳单独加分）");
assert.ok(!code.includes("bestScore >= 2"), "不得再用低门槛评分");
assert.ok(code.includes("tsM.length ? tsM : cands"), "时间戳只用于在文本候选内筛选");
});
