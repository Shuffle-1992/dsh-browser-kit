/**
 * dsh-browser-kit — annot-delivery.host.mjs
 *
 * ★交付通道（2026-10-10 用户实测：「在另一个会话的自持浏览器批注了发送，Agent 没有收到批注内容」）
 *
 * ## 为什么需要它
 * 批注落盘一直是成功的（`annotations/<时间戳>.md`），消息行上也会挂「N 条批注 / 查看批注」胶囊 ——
 * 但**胶囊是 DOM 装饰，模型看不到** ✗；而历史上唯一能把批注送进 Agent 上下文的通道，是把
 * 「已提交 N 条元素批注：<path>」**写进用户输入框**，该通道已按用户明确要求「不要带文字」删除 ✗
 * ⇒ 结果：批注存了、界面显示了、**Agent 一无所知** ✗。
 *
 * ## 本模块做什么
 * 用 DSH 官方注入点 **`agent/pre-step`**（waterfall：可替换/追加进入该步的消息）在**轮首**追加一条
 * user 消息，内容 = 批注摘要（逐条索引/标签/可访问名/所属窗口）+ 落盘文件绝对路径 + 读取提示。
 *  · **不碰用户输入框** ✓（满足「不要带文字」）
 *  · **不改用户消息** ✓（只往 decision.messages 追加）
 *  · **一次性** ✓（投递后清除，不刷屏）
 *  · **只在 step===1 注入** ✓（非首步插入可能把 tool_use 与 tool_result 拆开 ⇒ INVALID_REQUEST；
 *    而"用户发送批注"必然开启新的一轮，其首步即 step 1）
 *
 * ## 激活安全
 * `ctx.on` 不可用 / `createUserMessage` 解析不到 ⇒ 只 warn 并记入诊断（`kit-status.annotDelivery`），
 * **绝不抛**（与 browser-tools.host.mjs 同款纪律；宿主半边任何异常都会影响插件激活）。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 注入消息的 source.kind（归属标记；便于在会话日志里辨认来源） */
export const SOURCE_KIND = 'dsh-browser-kit';

/* ─────────────── 官方 createUserMessage 解析（双策略，镜像 dsh-tools 那条链） ─────────────── */

const DSH_LLM_REL = ['dsh', 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'index.js'];
export const CREATE_MSG_PROBE = [];

/** 绝对路径候选（顺序即优先级；dsh-llm 随 DSH 出货，位于 app.asar 内）。 */
export function dshLlmCandidates() {
  const out = [];
  const env = process.env.DBK_DSH_LLM;
  if (typeof env === 'string' && env) out.push({ source: 'env:DBK_DSH_LLM', path: env });
  const res = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  if (res) {
    out.push({ source: 'resourcesPath/app.asar', path: join(res, 'app.asar', ...DSH_LLM_REL) });
    out.push({ source: 'resourcesPath/app.asar.unpacked', path: join(res, 'app.asar.unpacked', ...DSH_LLM_REL) });
  }
  out.push({ source: 'abs:D:/DeepSeek/resources/app.asar', path: join('D:/DeepSeek/resources/app.asar', ...DSH_LLM_REL) });
  out.push({ source: 'abs:D:/DeepSeek/resources/app.asar.unpacked', path: join('D:/DeepSeek/resources/app.asar.unpacked', ...DSH_LLM_REL) });
  return out;
}

const acceptCreateUserMessage = (mod) => {
  if (!mod) return null;
  if (typeof mod.createUserMessage === 'function') return mod.createUserMessage;
  if (mod.default && typeof mod.default.createUserMessage === 'function') return mod.default.createUserMessage;
  return null;
};

/** 解析官方 createUserMessage；全失败返回 null（调用方降级 warn，不抛）。 */
export async function loadCreateUserMessage() {
  try {
    const fn = acceptCreateUserMessage(await import('@deepseek-ai/dsh-llm'));
    if (fn) { CREATE_MSG_PROBE.push({ source: 'bare', strategy: 'import', ok: true }); return { createUserMessage: fn, source: 'bare|import' }; }
    CREATE_MSG_PROBE.push({ source: 'bare', strategy: 'import', ok: false, error: '导入成功但无 createUserMessage 导出' });
  } catch (e) {
    CREATE_MSG_PROBE.push({ source: 'bare', strategy: 'import', ok: false, error: String((e && e.message) || e) });
  }
  const require = createRequire(import.meta.url);
  for (const cand of dshLlmCandidates()) {
    try {
      const fn = acceptCreateUserMessage(await import(pathToFileURL(cand.path).href));
      if (fn) { CREATE_MSG_PROBE.push({ source: cand.source, strategy: 'import', ok: true, path: cand.path }); return { createUserMessage: fn, source: `${cand.source}|import` }; }
    } catch (e) {
      CREATE_MSG_PROBE.push({ source: cand.source, strategy: 'import', ok: false, path: cand.path, error: String((e && e.message) || e) });
    }
    try {
      const fn = acceptCreateUserMessage(require(cand.path));
      if (fn) { CREATE_MSG_PROBE.push({ source: cand.source, strategy: 'require', ok: true, path: cand.path }); return { createUserMessage: fn, source: `${cand.source}|require` }; }
    } catch (e) {
      CREATE_MSG_PROBE.push({ source: cand.source, strategy: 'require', ok: false, path: cand.path, error: String((e && e.message) || e) });
    }
  }
  return { createUserMessage: null, source: null };
}

/* ─────────────── 摘要文本 ─────────────── */

const clip = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/**
 * 生成注入文本：**逐条摘要 + 所属窗口 + 落盘路径 + 读取提示**。
 * @param {{count:number, path:string, windows?:Array, items?:Array}} d
 */
export function renderAnnotDelivery(d) {
  const count = Number(d && d.count) || 0;
  const path = String((d && d.path) || '');
  const windows = Array.isArray(d && d.windows) ? d.windows : [];
  const items = Array.isArray(d && d.items) ? d.items : [];
  const lines = [];
  lines.push(`[dsh-browser-kit] 用户刚在浏览器里**发送了 ${count} 条元素批注**（已落盘，供你定位元素代码）。`);
  if (path) lines.push(`批注文件：${path}`);
  if (windows.length) {
    lines.push(`涉及窗口：${windows.map((w) => `${w.code ? `窗口 ${w.code}` : '窗口'}（${w.count || 0} 条${w.label ? ` · ${clip(w.label, 60)}` : ''}）`).join('；')}`);
  }
  if (items.length) {
    const brief = items.slice(0, 12).map((it) => {
      const idx = it && it.index != null ? `#${it.index}` : '#?';
      const tag = clip((it && it.tag) || '', 20);
      const name = clip((it && it.name) || (it && it.note) || '', 40);
      const win = it && it.code ? `（窗口 ${it.code}）` : '';
      return `${idx} ${tag}${name ? `「${name}」` : ''}${win}`;
    });
    lines.push(`条目：${brief.join(' · ')}${items.length > 12 ? ` …共 ${items.length} 条` : ''}`);
  }
  lines.push('细节（选择器 / XPath / HTML 片段 / 坐标）都在上面的文件里；需要就读取它，不必让用户重发。');
  return lines.join('\n');
}

/* ─────────────── 投递登记 + pre-step 注入 ─────────────── */

/** 从 saveMerged 的 sets 里抽摘要（sets: [{url,title,owner,annotations:[…]}, …]）。 */
export function summarizeSetsForDelivery(sets) {
  const items = [];
  const byWin = new Map();
  for (const s of Array.isArray(sets) ? sets : []) {
    for (const a of (s && s.annotations) || []) {
      if (!a || a.dirty === false) continue; // 只报"这次新提交的"
      const code = String((a.windowCode || '') || '');
      const label = String((a.window || (s && s.owner)) || '');
      items.push({
        index: Number(a.index) || 0,
        tag: (a.element && (a.element.tagName || '')) || '',
        name: (a.element && (a.element.accessibleName || a.element.text || '')) || '',
        note: a.note || '',
        code,
        window: label,
      });
      const key = code || label || '?';
      const prev = byWin.get(key) || { code, label, count: 0 };
      prev.count += 1;
      byWin.set(key, prev);
    }
  }
  return { items, windows: Array.from(byWin.values()) };
}

/**
 * 注册交付通道。返回诊断对象（供 kit-status 暴露）。
 * @param {object} ctx DSH 插件上下文
 * @param {object} state 宿主共享状态（我们会挂 `annotDeliveries`）
 * @param {(msg:string)=>void} log
 */
export function registerAnnotDelivery(ctx, state, log, onChange) {
  const diag = (state.annotDelivery = {
    registered: false,
    reason: null,
    createUserMessageSource: null,
    pending: 0,
    injected: 0,
    lastInjectedAt: null,
    lastSessionId: null,
    lastRecordedAt: null,
    lastError: null,
    skipped: {},
  });
  const pending = new Map(); // sessionId → delivery
  state.annotDeliveries = pending;
  const touch = () => { try { if (typeof onChange === 'function') onChange(); } catch { /* 诊断写失败不影响投递 */ } };

  /** saveMerged 成功后登记一次待投递（由 host.impl 调用）。 */
  state.recordAnnotDelivery = (sessionId, info) => {
    try {
      const sid = String(sessionId || '');
      if (!sid) { diag.skipped.noSession = (diag.skipped.noSession || 0) + 1; touch(); return false; }
      pending.set(sid, { at: new Date().toISOString(), ...info });
      diag.pending = pending.size;
      diag.lastRecordedAt = new Date().toISOString();
      touch(); // 立即落报告 ⇒ 诊断可查（否则报告停留在上一次写入的旧值 ✗，实测踩过）
      return true;
    } catch (e) { diag.lastError = String((e && e.message) || e); return false; }
  };

  let createUserMessage = null;
  const wire = async () => {
    const found = await loadCreateUserMessage();
    createUserMessage = found.createUserMessage;
    diag.createUserMessageSource = found.source;
    if (!createUserMessage) {
      diag.reason = 'createUserMessage 解析失败：批注交付退化为"仅落盘"（工具结果/kit-status 仍可见）';
      log('warn', `[annot-delivery] ${diag.reason}`);
      return;
    }
    if (typeof (ctx && ctx.on) !== 'function') {
      diag.reason = 'ctx.on 不可用：无法注入 agent/pre-step';
      log('warn', `[annot-delivery] ${diag.reason}`);
      return;
    }
    try {
      ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next();
        try {
          if (!decision || decision.kind === 'reject') return decision;
          // 只在**轮首**注入：非首步插入 user 消息可能把 tool_use 与 tool_result 拆开
          if (Number(payload && payload.step) !== 1) { diag.skipped.notFirstStep = (diag.skipped.notFirstStep || 0) + 1; return decision; }
          const sid = (payload && payload.agent && payload.agent.session && (payload.agent.session.id || payload.agent.session.sessionId)) || null;
          if (!sid || !pending.has(String(sid))) return decision;
          const d = pending.get(String(sid));
          pending.delete(String(sid));
          diag.pending = pending.size;
          const text = renderAnnotDelivery(d);
          const message = createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: SOURCE_KIND, form: 'snapshot', sections: [{ name: SOURCE_KIND, text }] },
          });
          diag.injected += 1;
          diag.lastInjectedAt = new Date().toISOString();
          diag.lastSessionId = String(sid);
          log('info', `[annot-delivery] 已把 ${d.count} 条批注摘要注入会话 ${String(sid).slice(-6)}（step 1）`);
          return { ...decision, messages: [...((decision && decision.messages) || []), message] };
        } catch (e) {
          diag.lastError = String((e && e.message) || e); // 绝不因为注入失败影响主流程
          return decision;
        }
      }, { prepend: false });
      diag.registered = true;
      log('info', `[annot-delivery] 已注册 agent/pre-step 注入（createUserMessage 来源 ${found.source}）`);
    } catch (e) {
      diag.reason = `ctx.on 注册失败：${String((e && e.message) || e)}`;
      log('warn', `[annot-delivery] ${diag.reason}`);
    }
  };
  wire().catch((e) => { diag.reason = String((e && e.message) || e); });
  return diag;
}
