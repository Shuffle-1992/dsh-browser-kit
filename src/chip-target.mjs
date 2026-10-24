/**
 * dsh-browser-kit —— **批注胶囊落位决策**（正典，纯函数，零平台依赖 ✓）。
 *
 * 这是本插件被**实机打回两次**的地方 ✗✗：
 *   ①2026-10-20："下一条信息没有批注，发出去后却带着『5 条批注』✗"
 *     ⇒ 已挂过的模型不能改挂到别的行 ✗（陈旧模型"跳行"抢占了新行 ✗）；
 *   ②2026-10-24 深度 review M-1：未挂过的模型可经**模糊锚**命中 `base.last` **自身**（= 上一条消息 ✗）。
 *
 * 两条教训固化为这里的铁律：
 *   · **已挂过的模型**（`model.attachedKey` 非空）只允许"回到同一条消息" ✓ ——
 *     精确键命中 ✓，或相对锚（消费时刻"前一行"的下一行 ✓）且目标**不回退**（单调守卫 ✓）；
 *     都不满足 ⇒ **返回 -1（刻意不挂）** ✓，由调用方计入 `skipped.stale` ✓。
 *   · **未挂过的模型**的模糊锚必须**严格晚于** base 行 ✓（禁止命中 base 自身 ✗）。
 *
 * 取舍（明示 ✓）：**宁可不显示，也绝不挂错消息** ✗ —— 少显示只是装饰缺失（可容忍 ✓），
 * 挂错是信息错位（会让用户/Agent 误判哪条消息带了批注 ✗✗）。
 */

/** 模糊锚：行键是文本指纹，重渲染/流式定稿会让它变 ⇒ 用前 40 字前缀双向匹配兜住 ✓。 */
export function fuzzyFindKeyOf(rowKeys, key) {
  if (!key) return -1;
  const probe = String(key).slice(0, 40);
  for (let i = rowKeys.length - 1; i >= 0; i -= 1) {
    const k = rowKeys[i] || "";
    if (k && (k.startsWith(probe) || probe.startsWith(k.slice(0, 40)))) return i;
  }
  return -1;
}

/**
 * 解析某个胶囊模型应挂到哪一行。
 * @param {object} p
 * @param {object} p.model 胶囊模型（`attachedKey`/`base`/`attachIdx`/`pendingAttach` ✓）
 * @param {string[]} p.rowKeys 当前用户行键数组（按 DOM 顺序 ✓）
 * @param {number} p.rowCount 行数（= rowKeys.length；显式传入便于纯化测试 ✓）
 * @returns {number} 目标行下标；-1 = 不挂（刻意 ✓）
 */
export function resolveChipTargetOf({ model, rowKeys, rowCount }) {
  const n = Number(rowCount) || 0;
  const base = model && model.base ? model.base : null;

  if (model && model.attachedKey) {
    const i = rowKeys.indexOf(model.attachedKey);
    if (i >= 0) return i; // ① 同一条消息（最安全 ✓）
    // ② 相对锚：消费时刻的"前一行"的下一行 ✓ + 单调守卫（不许回退到更早的行 ✗）
    if (base && base.last) {
      const j = rowKeys.indexOf(base.last);
      if (j >= 0 && j + 1 < n && (typeof model.attachIdx !== "number" || j + 1 >= model.attachIdx - 1)) return j + 1;
    }
    return -1; // ③ ★不跳行：宁可不显示，也不挂错消息 ✗
  }

  if (base && base.last) {
    const j = rowKeys.indexOf(base.last);
    if (j >= 0 && j + 1 < n) return j + 1; // 相对锚 ✓
    if (j >= 0) {
      /* ★M-1 残余路径 ✗：base 是**最后一行** ⇒ 它的"下一行"还没出现。
       * 旧实现 `return j2` 会把胶囊挂到 **base 自身 = 上一条消息** ✗（正是用户被打回的现象 ✗）。
       * 现在：**不挂** ✓，继续走下面的兜底（`pendingAttach` 会等新行出现 ✓）。 */
      if (!(model && model.pendingAttach)) return -1;
    } else {
      // 模糊锚：base 不在视野内 ⇒ 前缀相似行可作为兜底 ✓（不会命中 base 自身 ✓）
      const f = fuzzyFindKeyOf(rowKeys, base.last);
      if (f >= 0) return f;
    }
  }
  if (base && !base.last && n === 1) return 0; // 会话里第一条消息 ✓
  if (typeof model.attachIdx === "number" && model.attachIdx < n) return model.attachIdx;
  if (model.pendingAttach && n > ((base && base.n) || 0)) return n - 1;
  return -1;
}
