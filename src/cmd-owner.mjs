/**
 * dsh-browser-kit —— **唯一轮询者租约**（正典，纯逻辑 + 注入式存储，零平台依赖 ✓）。
 *
 * 为什么必须存在（P115 事故 ✗）：同一 DSH 页面可能有多个 client 实例（多窗口/热重载残留 ✗），
 * 而命令通道是**单槽位文件**（`.data/command.json`）✗ ⇒ 一个陈旧/卡死的实例取走命令却不回执 ✗
 * ⇒ 其它实例与宿主全都干等，表现为"**所有浏览器工具一起无回执**" ✗。
 * 对策：用同源共享存储（localStorage）做租约，**只有持有者才轮询** ✓。
 *
 * 三条语义（均有行为钉 test/cmd-owner.test.mjs ✓）：
 *   ①无租约 / 租约过期（> leaseMs）⇒ 任何实例可**抢占** ✓；
 *   ②租约是自己的 ⇒ **续租** ✓（保持唯一持有者 ✓）；
 *   ③自己是持有者但**已卡在 busy 超时** ⇒ **主动让位**（不续租，让别人接管 ✓✓）——这是"卡死自愈"的关键 ✓。
 *
 * 平台无关：`now`/`store.get`/`store.set` 全部由调用方注入 ⇒ Node 里可用内存 map 直接测 ✓。
 */

/** 存储键（同源跨窗口共享 ✓）。 */
export const CMD_OWNER_KEY = 'dsh-kit-cmd-owner';

/** 租约过期时间（毫秒）：持有者心跳超过它未刷新 ⇒ 视为失联，可被抢占 ✓。 */
export const CMD_LEASE_MS = 6000;

/** 自己 busy 超过它 ⇒ 主动让出租约（自救 ✓）。 */
export const CMD_BUSY_GIVEUP_MS = 30000;

/**
 * 计算并（必要时）更新租约。
 * @param {object} p
 * @param {{get:()=>string|null, set:(v:string)=>void}} p.store 共享存储（localStorage 语义 ✓）
 * @param {number} p.now 当前时间戳（毫秒 ✓）
 * @param {string} p.bootAt 本实例唯一标识（页面级 boot 时间戳 ✓）
 * @param {boolean} [p.busy] 是否正占用命令槽位
 * @param {number} [p.busySince] 占用起始时间
 * @returns {{mine:boolean, wrote:boolean, reason:string}} mine=本实例是否可以轮询 ✓
 */
export function cmdOwnerTick({ store, now, bootAt, busy, busySince }) {
  const t = Number(now) || 0;
  const me = String(bootAt || '');
  let raw = null;
  try {
    raw = store.get();
  } catch {
    return { mine: true, wrote: false, reason: 'store-unavailable' }; // 存储不可用 ⇒ 退回"都能轮询"（旧行为 ✓）
  }
  let o = null;
  try {
    o = raw ? JSON.parse(raw) : null;
  } catch {
    o = null; // 坏值按"无租约"处理 ✓
  }
  const stale = !o || !o.bootAt || t - Number(o.at || 0) > CMD_LEASE_MS;
  const isMine = !!o && String(o.bootAt || '') === me;
  // ③ 自己卡死：主动让位（不续租，等自然过期 ✓）
  if (isMine && busy && busySince && t - Number(busySince) > CMD_BUSY_GIVEUP_MS) {
    return { mine: false, wrote: false, reason: 'self-busy-giveup' };
  }
  // ① 抢占 / ② 续租
  if (stale || isMine) {
    try {
      store.set(JSON.stringify({ bootAt: me, at: t }));
    } catch {
      return { mine: true, wrote: false, reason: 'store-write-failed' };
    }
    return { mine: true, wrote: true, reason: stale ? 'stale-claim' : 'renew' };
  }
  return { mine: false, wrote: false, reason: 'other-owner' };
}
