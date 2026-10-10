/**
 * src/annotator-consume.mjs — 消息胶囊消耗判定（R3-1 解耦，A1 先例模式）：
 * 纯函数；sig/base 均为视图签名 { n: 行数, first: 顶行键, last: 末行键 }。
 *
 * 判定规则（client.js 内嵌副本 parity 锁定，改一处必须同步另一处）：
 *  - 顶行键变化 = 切会话/虚拟化重组 → 'reset'（调用侧重置基线，胶囊保留待命）；
 *  - 同视图行数增长，或同视图末行变化且行数不减 → 'consume'（调用侧消耗胶囊并锁定归属行）；
 *  - 其余（含 sig/base 缺形）→ 'idle'。
 *
 * 历史教训（判定固化的原因）：跨会话误耗（末行键跨视图比对）与「末尾 N 条」扩散——
 * 两条都踩过，此处单测钉死防回归。
 */
export function planChipConsume(sig, base) {
  if (!sig || !base) return 'idle';
  if (sig.first !== base.first) return 'reset';
  if (sig.n > base.n || (sig.last !== base.last && sig.n >= base.n)) return 'consume';
  return 'idle';
}
