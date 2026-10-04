/**
 * @local/dsh-browser-kit —— Host 入口薄壳（业务逻辑全在 host.impl.mjs，勿在此放逻辑）。
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
 */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const IMPL_PATH = join(PLUGIN_DIR, 'host.impl.mjs');
/** 探测报告文件（实施会话直接读这个文件拿结论）。 */
const REPORT_PATH = join(PLUGIN_DIR, '.data', 'probe-report.json');

export const name = 'dsh-browser-kit';

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
