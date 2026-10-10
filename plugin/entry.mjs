/**
 * dsh-browser-kit —— Host 入口薄壳（业务逻辑全在 host.impl.mjs，勿在此放逻辑）。
 *
 * 双层缓存规避（实测 2026-10-04）：
 *  1. cordis loader 经 Node ESM 缓存加载入口——插件 disable/enable 重跑 apply() 但模块实例不换新，
 *     改代码必须重启 DSH。故入口**永久保持此薄壳形态不变**（改它 = 又要重启）；
 *  2. 业务实现放 host.impl.mjs：每次 apply 按「impl 文件 mtime + 激活序号」构造带查询参数的
 *     import URL——参数变 ⇒ Node 视为新模块 ⇒ 免重启热换新代码（ESM 按完整 URL 缓存，规格行为）。
 *
 * 历史：本包最初入口是 index.js（含探测逻辑），其缓存实例无法热更新，才引入本文件作为新入口。
 * package.json exports["."] 已指向本文件；index.js 仅存档不再被加载。
 *
 * 代价：每次激活产生一个新模块记录（旧记录留在模块缓存，开发期可忽略）。
 *
 * ⚠️ Config 静态导出（2026-10-05 追加：本薄壳唯一一次允许改动的例外，改动需重启 DSH 一次）：
 *   DSH 插件详情页只在 bundle **声明了 config schema** 时才渲染「配置区」，而配置区正是
 *   `plugins.bundle.config` 卡片（与详情页说明）的宿主——无 schema 的 bundle 在 Config
 *   provider 里 status="absent"，卡片虽注册成功（active:true）但页面上无内容。
 *   实测对照：dsh-connect-trae / dsh-connect-zcode 均 status="schema" 且卡片可见。
 *   cordis loader 读的是**入口模块的静态导出** Config（动态 import 的 impl 导出不被识别），
 *   故此处静态 re-export schema；schema 本体住 plugin-config.schema.mjs——它必须是
 *   schemastery 实例（JSON 字面量会被判 status="unsupported" 并使 fiberPhase=failed，
 *   实测：卡片出现但组件「异常」、host 半边不加载、命令通道停摆）。
 *   解析不到 schemastery 时该导出为 undefined → 入口不导出 Config → 退回 absent 旧行为。
 */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DSH_BROWSER_KIT_CONFIG_SCHEMA } from './plugin-config.schema.mjs';

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const IMPL_PATH = join(PLUGIN_DIR, 'host.impl.mjs');
/** 探测报告文件（实施会话直接读这个文件拿结论）。 */
const REPORT_PATH = join(PLUGIN_DIR, '.data', 'probe-report.json');

export const name = 'dsh-browser-kit';

/** bundle config schema：详情页配置区的存在条件（schemastery 不可达时为 undefined → DSH 视为无 schema）。 */
export const Config = DSH_BROWSER_KIT_CONFIG_SCHEMA;

let activationSeq = 0;

/**
 * Host 入口。同步返回 { reportPath }；实际接线在 impl 里异步完成（探测/face 注册都不阻塞激活）。
 * @param {object} ctx cordis Context
 * @param {object} config 插件 config（本插件暂无字段）
 */
export function apply(ctx, config = {}) {
  const seq = ++activationSeq;
  let mtime = 0;
  try {
    mtime = statSync(IMPL_PATH).mtimeMs;
  } catch { /* impl 缺失时 URL 仍可构造，import 会报出可读错误 */ }
  const url = `./host.impl.mjs?ts=${mtime}-${seq}`;
  import(url)
    .then((impl) => impl.apply(ctx, config, { pluginDir: PLUGIN_DIR, reportPath: REPORT_PATH }))
    .catch((e) => {
      try {
        const m = e && e.message ? e.message : String(e);
        if (ctx && ctx.logger && ctx.logger.error) ctx.logger.error(`[dsh-browser-kit] impl 加载失败：${m}`);
        else console.error('[dsh-browser-kit] impl 加载失败：', m);
      } catch { /* 静默 */ }
    });
  return { reportPath: REPORT_PATH };
}
