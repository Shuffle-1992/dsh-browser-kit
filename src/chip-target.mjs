/**
 * dsh-browser-kit —— **批注卡片落位决策**（正典，纯函数，零平台依赖）。
 *
 * 本插件在"卡片挂哪一行"上被实机打回三次：
 *   ① 2026-10-20："下一条信息没有批注，发出去后却带着『5 条批注』" —— 已挂过的模型不得改挂到别的行；
 *   ② 2026-10-24 review M-1：未挂过的模型可经模糊锚命中 `base.last` 自身（= 上一条消息）；
 *   ③ 2026-10-28（本次）：**发送即消费**时 `base` 取自"**已含新行**"的签名 ⇒ `base.last` 就是刚发出的
 *      那条消息自己 ⇒ 相对锚 `j + 1` 恒等于"**再下一条**" ⇒ 卡片挂到下一条用户消息上。
 *      用户原话："我重新发起一条不带批注的信息，下面带有上一次的批注信息。"
 *
 * 修正：引入 **`floorIdx`** = 消费时点**应当承载卡片的那一行的下标**（唯一权威锚）：
 *   · 有行键（发送当下新行已渲染）⇒ `floorIdx = 新行下标`；
 *   · 无行键（待挂态）⇒ `floorIdx = 当时行数`（= 新行将出现的下标）。
 *   `floorIdx` **存在**时：落位只允许 `=== floorIdx`（或 ≥ 它的模糊兜底）；
 *   `floorIdx` **不存在**时（旧模型/其它路径）：保持原相对锚语义（`j + 1`，且严格晚于 base）。
 *
 * 铁律：**宁可不显示，也绝不挂错消息** —— 少显示只是装饰缺失（可容忍），
 * 挂错是信息错位（用户与 Agent 都会误判哪条消息带了批注）。
 */

/** 模糊锚：行键是文本指纹，重渲染/流式定稿会让它变 ⇒ 用前 40 字前缀双向匹配兜住。 */
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
 * 解析某个卡片模型应挂到哪一行。
 * @param {object} p
 * @param {object} p.model 卡片模型（`attachedKey`/`base`/`attachIdx`/`pendingAttach`/`floorIdx`）
 * @param {string[]} p.rowKeys 当前用户行键数组（按 DOM 顺序）
 * @param {number} p.rowCount 行数（= rowKeys.length；显式传入便于纯化测试）
 * @returns {number} 目标行下标；-1 = 不挂（刻意）
 */
export function resolveChipTargetOf({ model, rowKeys, rowCount }) {
  const n = Number(rowCount) || 0;
  const base = model && model.base ? model.base : null;
  /* floorIdx 存在 ⇒ 启用"权威锚"严格模式；否则保持旧语义（兼容旧模型与其它调用路径） */
  const hasFloor = Number.isInteger(model && model.floorIdx) && model.floorIdx >= 0;
  const floor = hasFloor ? model.floorIdx : 0;
  const okIdx = (idx) => {
    if (idx < 0 || idx >= n) return -1;
    return hasFloor && idx < floor ? -1 : idx;
  };
  /** 相对锚是否命中：严格模式要求 === floorIdx；旧模式要求 j+1 有效（严格晚于 base） */
  const relHit = (j) => {
    if (j < 0 || j + 1 >= n) return -1;
    if (hasFloor) return j + 1 === floor ? j + 1 : -1;
    return j + 1; // 旧语义：base 的下一行（base 自身绝不会被命中 ✓）
  };

  if (model && model.attachedKey) {
    /* ① 同一条消息（最安全）：精确键命中 */
    const i = rowKeys.indexOf(model.attachedKey);
    if (i >= 0) return okIdx(i);
    /* ② 相对锚 + 单调守卫 */
    if (base && base.last) {
      const j = rowKeys.indexOf(base.last);
      const rel = relHit(j);
      if (rel >= 0) {
        /* 单调守卫：目标不得比上次挂载位置更早（回退 = 挂到旧消息上 ✗）。
         * 守卫拒绝时**直接不挂**，不得再走模糊锚 —— 否则会经 base 自身回退到更早的行 ✗。 */
        if (typeof model.attachIdx !== "number" || rel >= model.attachIdx - 1) return okIdx(rel);
        return -1;
      }
      /* ③ 模糊锚（文本指纹漂移兜底）：严格模式下必须 ≥ floor */
      const f = fuzzyFindKeyOf(rowKeys, base.last);
      if (f >= 0 && (!hasFloor || f >= floor)) return okIdx(f);
    }
    return -1; // ④ 不跳行：宁可不显示，也不挂错消息
  }

  if (base && base.last) {
    const j = rowKeys.indexOf(base.last);
    const rel = relHit(j);
    if (rel >= 0) return okIdx(rel);
    if (j >= 0) {
      /* base 是最后一行 ⇒ 它的下一行还没出现 ⇒ 不挂（挂到 base 自身就是上一条消息 ✗） */
      if (!(model && model.pendingAttach)) return -1;
    } else {
      const f = fuzzyFindKeyOf(rowKeys, base.last);
      if (f >= 0 && (!hasFloor || f >= floor)) return okIdx(f);
    }
  }
  if (base && !base.last && n === 1) return okIdx(0); // 会话里第一条消息
  if (typeof model.attachIdx === "number" && model.attachIdx < n && (!hasFloor || model.attachIdx >= floor)) return model.attachIdx;
  /* 待挂态末行兜底：★必须严格等于 floorIdx —— 否则"用户又发了一条不带批注的消息"时，
   * n-1 会指向那条新消息，正是本次实机 bug 的同一路径 ✗ */
  if (model.pendingAttach && n > Math.max((base && base.n) || 0, floor)) {
    const last = n - 1;
    if (hasFloor && last !== floor) return -1;
    return last;
  }
  return -1;
}
