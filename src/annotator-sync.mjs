/**
 * annotator-sync.mjs —— 共享批注会话的跨面板同步判定（纯函数，零 I/O）。
 *
 * 为什么抽出（A1，review 最大盲区）：这段判定逻辑原先是 client.js syncPanes 的内联代码，
 * 只能靠真机回归——origins 登记、删除双来源判定（删除日志 ∪ 来源缺失）、gid 去重、
 * 同页门控的 _originUrl 附着，全部没有单测。抽成纯函数后 node --test 可全分支覆盖。
 *
 * 身份约定：states[].id = paneIdOf(webview)（webContentsId 数字），与 origins 的值同域——
 * 元素引用会随宿主重渲染失效（P27/C4），跨轮传递的身份必须是稳定 id。
 *
 * @param {Array<{id: number|object, url: string, list: Array<{gid: string}>, deleted: string[], dead: boolean}>} states
 *   各成员面板的快照（list 为 annotator.list() 输出；dead = 本轮 executeJavaScript 失败）。
 * @param {Record<string, number|object>} origins gid → 来源面板 id（上轮累计）。
 * @param {Record<string, string>} originUrls gid → 来源页 URL（同页门控用）。
 * @returns {{
 *   union: Array<{item: object, origin: number|object|null}>,
 *   removedGids: Record<string, boolean>,
 *   pushes: Array<{id: number|object, items: Array<object>}>,
 *   removals: Array<{gid: string, targets: Array<number|object>}>,
 *   nextOrigins: Record<string, number|object>,
 *   nextOriginUrls: Record<string, string>,
 * }}
 */
export function planPaneSync(states, origins = {}, originUrls = {}) {
  const nextOrigins = { ...origins };
  const nextOriginUrls = { ...originUrls };

  // 1) 登记新 gid 的来源面板与来源页 URL（首次出现处）
  for (const s of states) {
    for (const a of s.list || []) {
      if (a.gid && !(a.gid in nextOrigins)) {
        nextOrigins[a.gid] = s.id;
        nextOriginUrls[a.gid] = s.url || '';
      }
    }
  }

  // 2) 删除判定：gid 出现在任意删除日志，或来源面板已无此 gid（dead 面板不参与判定）
  const removedGids = {};
  for (const s of states) {
    for (const g of s.deleted || []) removedGids[g] = true;
  }
  for (const gid of Object.keys(nextOrigins)) {
    const origin = nextOrigins[gid];
    const originState = states.find((s) => s.id === origin);
    if (originState && !originState.dead && !(originState.list || []).some((a) => a.gid === gid)) {
      removedGids[gid] = true;
    }
  }

  // 3) 合并视图（未被删除的 gid；先到先得去重——顺序即 states 顺序）
  const union = [];
  const seen = {};
  for (const s of states) {
    for (const a of s.list || []) {
      if (a.gid && !seen[a.gid] && !removedGids[a.gid]) {
        seen[a.gid] = true;
        union.push({ item: a, origin: nextOrigins[a.gid] || null });
      }
    }
  }

  // 4) 推送计划：每个面板缺的、且来源不是它自己的项（附 _originUrl 供同页门控）
  const pushes = [];
  for (const s of states) {
    if (s.dead) continue;
    const mine = {};
    for (const a of s.list || []) if (a.gid) mine[a.gid] = true;
    const items = union
      .filter((u) => u.origin !== s.id && !mine[u.item.gid])
      .map((u) => ({ ...u.item, _originUrl: nextOriginUrls[u.item.gid] || null }));
    if (items.length > 0) pushes.push({ id: s.id, items });
  }

  // 5) 删除广播计划 + 来源表清理（originUrls 一并清——旧实现漏删，属泄漏）
  const removals = [];
  for (const gid of Object.keys(removedGids)) {
    const targets = [];
    for (const s of states) {
      if (s.dead) continue;
      if ((s.list || []).some((a) => a.gid === gid)) targets.push(s.id);
    }
    if (targets.length > 0) removals.push({ gid, targets });
    delete nextOrigins[gid];
    delete nextOriginUrls[gid];
  }

  return { union, removedGids, pushes, removals, nextOrigins, nextOriginUrls };
}
