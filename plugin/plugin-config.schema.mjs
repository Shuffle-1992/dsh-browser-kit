/**
 * plugin-config.schema.mjs —— bundle config schema（DSH 插件详情页「配置区」的存在条件）。
 *
 * 为什么需要：Cordis Inspect 取证（2026-10-05）——DSH 插件详情页只在 bundle
 * **声明了 config schema** 时才渲染配置区，而配置区正是 `plugins.bundle.config` 卡片
 * （与详情页说明）的宿主。无 schema 时 Config provider 报 status="absent"，
 * 卡片虽注册成功（active:true）但页面上没有落点。
 * 实测对照：dsh-connect-trae / dsh-connect-zcode 均 status="schema" → 卡片可见。
 *
 * ⚠️ schema 必须是 **schemastery 实例**（`z.object({...})`）：
 *   JSON Schema 对象字面量会被判 status="unsupported" 并让插件条目 fiberPhase="failed"
 *   （2026-10-05 实测：卡片出现但组件状态「异常」、host 半边整体不加载、命令通道停摆）。
 *
 * 解析策略（schemastery 不在本包依赖里，四种来源按序尝试，任一成功即用）：
 *   1) 裸 import `@deepseek-ai/schemastery`——宿主 loader 带 asar 补丁时可解析
 *      （dsh-connect-trae 入口即静态 import 该包且工作正常）；
 *   2) 候选 node_modules 根（process.resourcesPath 推导，仿 zcode lib/host-modules.js）；
 *   3) env `DSH_BROWSER_KIT_MODULES_ROOT` / `DSH_BROWSER_KIT_DSH_RESOURCES` 显式逃生口；
 *   4) 本机开发位 `F:\My Code\zcode-dispatch\node_modules`（该插件已验证可用，纯兜底）。
 * 全部失败 → 返回 undefined → 入口不导出 Config → 退回 absent 旧行为（插件照常工作）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** schemastery 包内候选入口（ESM 优先，CJS 兜底）。 */
const CANDIDATE_FILES = ['lib/index.mjs', 'lib/index.js', 'dist/index.js', 'index.js', 'lib/index.cjs'];

/** 候选 node_modules 根（顺序即优先级）。 */
function moduleRootCandidates() {
  const out = [];
  for (const k of ['DSH_BROWSER_KIT_MODULES_ROOT', 'DSH_BROWSER_KIT_DSH_RESOURCES']) {
    const v = process.env[k];
    if (typeof v === 'string' && v) out.push(v);
  }
  const res = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  if (res) {
    for (const base of [join(res, 'app.asar'), join(res, 'app.asar.unpacked')]) {
      out.push(join(base, 'dsh', 'node_modules'));
      out.push(join(base, 'node_modules'));
    }
  }
  // 本机开发位兜底（zcode-dispatch 是已验证可用的宿主侧插件，随身带 schemastery）
  out.push('F:\\My Code\\zcode-dispatch\\node_modules');
  return [...new Set(out.filter(Boolean))];
}

/** 取出 z 本体（ESM default / CJS exports / 嵌套 default 三种包装都要兼容）。 */
const unwrapZ = (mod) => {
  for (const c of [mod, mod && mod.default, mod && mod['module.exports']]) {
    if (c && typeof c.object === 'function') return c;
  }
  return null;
};

/* ★2026-10-24（机械审计 S2 ✗）：这里原有 `export function resolveSchemasterySync()`（恒返回 null），
 * 全仓引用计数 = 1（仅定义行 ✗，test/ 零引用）⇒ 已删。真正入口是下面的 TLA 异步 `resolveSchemastery()` ✓。 */

/**
 * 异步解析 schemastery：裸 import → 候选根 × 候选文件。
 * @returns {Promise<unknown|null>} z 本体或 null
 */
export async function resolveSchemastery() {
  // 1) 裸说明符
  try {
    const z = unwrapZ(await import('@deepseek-ai/schemastery'));
    if (z) return z;
  } catch { /* 继续 */ }
  // 2) 候选根
  for (const root of moduleRootCandidates()) {
    for (const rel of CANDIDATE_FILES) {
      const file = join(root, '@deepseek-ai', 'schemastery', rel);
      if (!existsSync(file)) continue;
      try {
        const z = unwrapZ(await import(pathToFileURL(file).href));
        if (z) return z;
      } catch { /* 试下一个 */ }
    }
  }
  return null;
}

/** 用 z 构建我们的 schema（字段变更只影响详情页表单，不影响运行时行为）。
 *
 * ★评审 R-9（已修）：原先这里有 5 个字段（debugPanelDefaultHidden / autoJoinPanes /
 * annotatorSamePageOnly / shotsRoot / annotationsRoot），但**全仓无人读取** ✗ ⇒ 它们是"假开关" ✗：
 * 用户在插件详情页拨了也不生效，比没有更糟。
 * 现状：**保留 `z.object({})` 空骨架** ✓（否则 Plugins→详情页的配置区会整个消失 ✗），
 * 可选配置项等真正实现后再加回来 ✓（实现时要同时改运行时读取点，否则又会变成假开关 ✗）。 */
function buildWith(z) {
  try {
    return z.object({});
  } catch {
    return undefined;
  }
}

/**
 * 入口用：顶层 await 解析并构建（模块加载期完成，满足 entry.mjs 的**静态导出**要求）。
 * 解析失败返回 undefined → 入口 `export const Config = undefined`，DSH 视为无 schema（absent）。
 */
const z = await resolveSchemastery();
export const DSH_BROWSER_KIT_CONFIG_SCHEMA = z ? buildWith(z) : undefined;
/* ★2026-10-24（机械审计 S2 ✗）：这里原有 `DSH_BROWSER_KIT_SCHEMA_SOURCE`，全仓引用计数 = 1（无读者 ✗）
 * ⇒ 已删。需要判断 schema 是否生效，看 `DSH_BROWSER_KIT_CONFIG_SCHEMA` 是否为 undefined 即可 ✓。 */
