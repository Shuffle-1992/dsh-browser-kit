/**
 * @local/dsh-browser-kit —— Host 半边入口（薄壳，勿放业务逻辑）。
 *
 * 为什么要薄壳 + impl 分离：cordis loader 经 Node ESM 缓存加载本文件——插件 disable/enable
 * 会重跑 apply() 但**模块实例不换新**（实测 2026-10-04：toggle 后报告时间戳更新但代码仍旧版），
 * 改代码必须重启 DSH 才生效。规避法：业务逻辑全部放 host.impl.mjs，本壳在每次 apply 时按
 * 「impl 文件 mtime + 激活序号」生成带查询参数的 import URL——参数变 ⇒ Node 视为新模块 ⇒
 * 免重启热换新代码（ESM 按完整 URL 缓存，这是规格行为不是 hack）。
 *
 * 代价：每次激活产生一个新模块记录（旧记录留在模块缓存里，开发期可忽略）。
 * exports["./typert"] 仍由 wire.host.mjs 静态承载（进程内缓存无妨，face 契约稳定后才改它）。
 */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const IMPL_PATH = join(PLUGIN_DIR, 'host.impl.mjs');

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
    .then((impl) => impl.apply(ctx, config, { pluginDir: PLUGIN_DIR, reportPath: join(PLUGIN_DIR, '.data', 'probe-report.json') }))
    .catch((e) => {
      try {
        const m = e && e.message ? e.message : String(e);
        if (ctx && ctx.logger && ctx.logger.error) ctx.logger.error(`[dsh-browser-kit] impl 加载失败：${m}`);
        else console.error('[dsh-browser-kit] impl 加载失败：', m);
      } catch { /* 静默 */ }
    });
  return { reportPath: join(PLUGIN_DIR, '.data', 'probe-report.json') };
}
