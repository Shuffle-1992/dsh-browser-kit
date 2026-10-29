/**
 * dsh-browser-kit —— 截图卡片纯逻辑（**正典**；client.js 内嵌同名 canonical 副本，parity 对拍见
 * test/shot-view.test.mjs）。
 *
 * 为什么抽出来：这些逻辑**不碰 DOM、不碰 React、不碰 fs** ⇒ 可单测、可复用，也避免 client.js 继续膨胀 ✓
 * （client 侧不支持相对 import ⇒ 只能内嵌副本 + 对拍，这是本仓库既有的 A1 模式 ✓）。
 */

/** 取路径最后一个分隔段（Windows / POSIX 都认；空值安全 ✓）。 */
export function baseName(p) {
  try {
    const s = String(p == null ? '' : p).replace(/[\\/]+$/, '');
    const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    return i >= 0 ? s.slice(i + 1) : s;
  } catch {
    return '';
  }
}

/**
 * 从工具结果块里取截图文件名。取值优先级（双重兜底，实测官方工具卡的 meta 未必带 path ✓）：
 *  ① `block.meta.path|file|shot`（结构化最可靠 ✓）
 *  ② `block.content[].text` 里的 `*.png` 路径（我们的工具结果是 JSON 文本 ✓）
 *  ③ 该文本按 JSON 解析后的 `path|file`
 * 取不到返回 null（调用方据此退化为"路径提示" ✓，绝不抛 ✗）。
 */
export function shotNameOf(block) {
  try {
    // ★评审 R-4：宿主分派的块可能是**包裹形状**（`{ call: {...}, meta, content }`）或裸形状 ⇒ 逐层取 ✓
    const layers = [block, block && block.call].filter((x) => x && typeof x === 'object');
    for (const b of layers) {
      const meta = b.meta;
      if (meta && typeof meta === 'object') {
        const p1 = meta.path || meta.file || meta.shot;
        if (p1) return baseName(p1) || null;
      }
    }
    for (const b of layers) {
      const content = (b && b.content) || [];
      for (const c of content) {
        if (!c || c.type !== 'text' || typeof c.text !== 'string') continue;
        const hit = c.text.match(/[^\s"']+\.png/i);
        if (hit) return baseName(hit[0]) || null;
        try {
          const o = JSON.parse(c.text);
          const p2 = o && (o.path || o.file);
          if (p2) return baseName(p2) || null;
        } catch { /* 非 JSON 文本，忽略 */ }
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** 人读尺寸（给卡片副标题用 ✓）。 */
export function humanBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 有界截图预览表（**内存**，先到先出 ✓）：
 *  - 条数上限 `maxCount`（缺省 12）+ 总字节上限 `maxBytes`（缺省 24MB）双闸 ✓；
 *  - key 一律用 `baseName` 归一化，避免同一个文件因路径写法不同存两份 ✓；
 *  - 纯内存、无副作用 ⇒ 可单测；client 侧内嵌同一份逻辑 ✓。
 */
export function createShotStore(opts = {}) {
  const maxCount = Number(opts.maxCount) > 0 ? Number(opts.maxCount) : 12;
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : 24 * 1024 * 1024;
  const map = new Map();
  const totalBytes = () => {
    let t = 0;
    for (const v of map.values()) t += v && v.dataUrl ? v.dataUrl.length : 0;
    return t;
  };
  return {
    /** 存一张：path 取 baseName 作 key；dataUrl 空则忽略 ✓。返回是否存入。 */
    remember(path, dataUrl, bytes) {
      try {
        if (!path || !dataUrl) return false;
        const name = baseName(path);
        if (!name) return false;
        map.set(name, { dataUrl, bytes: Number(bytes) || null, at: Date.now() });
        while (map.size > maxCount || totalBytes() > maxBytes) {
          const k = map.keys().next().value;
          if (k === undefined) break;
          map.delete(k);
        }
        return true;
      } catch {
        return false;
      }
    },
    /** 按路径或文件名查（内部按 baseName 归一化 ✓）。 */
    get(pathOrName) {
      try {
        const name = baseName(pathOrName);
        return name ? map.get(name) || null : null;
      } catch {
        return null;
      }
    },
    get size() { return map.size; },
    keys() { return Array.from(map.keys()); },
  };
}
