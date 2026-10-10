/**
 * src/hid-bridge.mjs — HID 系统层直连桥（R-HID，host 侧专用）v2：
 * 绕开 Chromium `select-hid-device` 宿主缺口（P35）：WebHID 授权/选择器必须由 DSH 主进程
 * 实现，插件两个进程位都够不到 `session`——但宿主是 RUN_AS_NODE 纯 Node，可以走
 * node-hid **系统层直连**，不经 Chromium 权限体系。
 *
 * **模型定论（2026-10-09 实测）**：必须用 **sync `HID` 类 + `on('data')` 事件**——
 * node-hid 原生为 sync 类起独立读线程，`write()` 在主线程**完全独立不被阻塞**。
 * `HIDAsync` 类在挂起 read 期间 write 永久阻塞（hidapi 单线程 I/O），任何轮询/
 * race/队列方案都救不了（turn 118/124 两次实测卡死宿主，P41 家族）。
 *
 * 线格式（Chrome collections 实证）：outputReports id=75/84，载荷 63 字节 →
 * **写包 = [reportId‖0] + data 补齐 64 字节**（shim sendReport 已做）；
 * 读包首字节 = reportId（Chrome 的 `ev.data` 不含——shim 侧处理，桥原样透传）。
 *
 * 「授权」语义由调用方代行（shim 选择器 UI / 预填 Chrome 授权清单）。
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// 插件根 = src/ 的上一级 **下的 plugin/**；node-hid 装在 plugin/node_modules。
// 基点必须是 plugin/ 内真实存在的文件（createRequire 从该文件位置向上解析 node_modules）。
const pluginRequire = createRequire(path.join(here, '..', 'plugin', 'noop.js'));

let hidModule = null;
let hidLoadError = null;

function hid() {
  if (hidModule) return hidModule;
  try {
    hidModule = pluginRequire('node-hid');
    return hidModule;
  } catch (e) {
    hidLoadError = (e && e.message) || String(e);
    throw e;
  }
}

/* R-IMPL：handles/seq **挂 globalThis 单例**——impl 热换（?ts= 重载）会重建本模块
 *  作用域，但**已打开的 HID 实例与其原生读线程活在进程里**：表重建 = 句柄丢失 =
 *  旧读线程抢走 input report（页面收不到数据——实锤于 HID 联调）。单例守护让
 *  impl 重载后仍能管理既有句柄（close/super-sede 正常工作）。 */
const HID_GLOBAL = (function () {
  try {
    if (!globalThis.__dshKitHidBridgeState) {
      globalThis.__dshKitHidBridgeState = { handles: new Map(), seq: 0 };
    }
    return globalThis.__dshKitHidBridgeState;
  } catch (_) {
    return { handles: new Map(), seq: 0 };
  }
})();
const handles = HID_GLOBAL.handles; // 单例 Map（跨 impl 重载存活）
function nextHandleSeq() { HID_GLOBAL.seq += 1; return HID_GLOBAL.seq; }

/** 通讯 trace（环形 200 条，hidTraceImpl 读）。
 *  R-FMT：hex 必须走 Array.from 再 map——**Buffer.map 会把回调返回的字符串强转回数值**
 *  （TypedArray.map 语义）：'4b'→NaN→0，于是写包 trace 全部显示 0x00，与真机线格式
 *  完全不符（本轮排查被这层假象带偏一次：真机写包其实是 4b 80 0c…）。 */
const TRACE = (function(){ try { if (!globalThis.__dshKitHidTrace) globalThis.__dshKitHidTrace = []; return globalThis.__dshKitHidTrace; } catch (_) { return []; } })();
function tracePush(dir, handleId, bytes) {
  const arr = Array.isArray(bytes) ? bytes : Array.from(bytes || []);
  TRACE.push({ at: new Date().toISOString(), dir, handleId, hex: arr.map((b) => (b < 16 ? '0' : '') + Number(b).toString(16)).join(' ') });
  if (TRACE.length > 200) TRACE.splice(0, TRACE.length - 200);
}

/** 枚举系统全部 HID 设备（node-hid devices 同步调用）。 */
export async function hidListImpl() {
  try {
    const devices = hid().devices();
    return {
      ok: true,
      devices: devices.map((d) => ({
        path: d.path || null,
        vendorId: d.vendorId,
        productId: d.productId,
        serialNumber: d.serialNumber || null,
        product: d.product || null,
        manufacturer: d.manufacturer || null,
        usagePage: d.usagePage,
        usage: d.usage,
      })),
    };
  } catch (e) {
    return { ok: false, error: `node-hid 加载/枚举失败：${hidLoadError || (e && e.message) || String(e)}` };
  }
}

/** 独占打开设备：sync HID + on('data')（原生读线程）——write 主线程独立不被阻塞。
 *  R-DUP：**同 path 只允许一个活句柄**——新 open 自动关旧句柄（双句柄会竞争
 *  input report 广播：响应被旧句柄截胡 → 页面"连接后读不到"，用户实测复现）。 */
export async function hidOpenImpl(path) {
  try {
    if (!path || typeof path !== 'string') return { ok: false, error: 'path 必填（hidList 返回的设备路径）' };
    const h = hid();
    for (const [hidOld, entryOld] of handles) {
      if (entryOld.path === path) {
        handles.delete(hidOld);
        entryOld.open = false;
        for (const w of entryOld.waiters.splice(0)) {
          clearTimeout(w.timer);
          w.resolve({ ok: false, error: 'superseded' });
        }
        try { entryOld.dev.close(); } catch (_) { /* 尽力而为 */ }
      }
    }
    const dev = new h.HID(path);
    const seq = nextHandleSeq();
    const handleId = `hid-${seq}`;
    const entry = { dev, open: true, queue: [], waiters: [], path };
    handles.set(handleId, entry);
    dev.on('data', (data) => {
      if (!entry.open) return;
      const arr = Array.from(data);
      tracePush('R', handleId, arr);
      const w = entry.waiters.shift();
      if (w) {
        clearTimeout(w.timer);
        w.resolve({ ok: true, data: arr });
      } else {
        entry.queue.push(arr);
        if (entry.queue.length > 512) entry.queue.splice(0, entry.queue.length - 512);
      }
    });
    dev.on('error', () => { /* 读线程错误：不算桥失败（设备拔出等） */ });
    return { ok: true, handleId };
  } catch (e) {
    return { ok: false, error: `打开失败（独占占用？驱动占用？）：${(e && e.message) || String(e)}` };
  }
}

/** 读一次上报：队列有数据立即返回；无则挂 waiters 等原生读线程交付（timeoutMs 超时返回 timeout）。 */
export async function hidReadImpl(handleId, timeoutMs) {
  const entry = handles.get(handleId);
  if (!entry) return { ok: false, error: `句柄不存在：${handleId}` };
  if (!entry.open) return { ok: false, error: `句柄已关闭：${handleId}` };
  if (entry.queue.length > 0) return { ok: true, data: entry.queue.shift() };
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 500;
  const w = { resolve: null, timer: null };
  const p = new Promise((resolve) => {
    w.resolve = resolve;
    w.timer = setTimeout(() => {
      const idx = entry.waiters.indexOf(w);
      if (idx >= 0) entry.waiters.splice(idx, 1);
      resolve({ ok: false, error: 'timeout' });
    }, timeout);
  });
  entry.waiters.push(w);
  return p;
}

/** 写入（sync HID.write 主线程同步执行——**原生读线程独立，永不阻塞**）。
 *  调用方需自行补齐 report 长度（shim sendReport 已做：[reportId‖0]+data 补 64）。 */
export async function hidWriteImpl(handleId, data) {
  const entry = handles.get(handleId);
  if (!entry) return { ok: false, error: `句柄不存在：${handleId}` };
  try {
    if (!Array.isArray(data) || data.length === 0) return { ok: false, error: 'data 必须为非空字节数组' };
    const buf = Buffer.from(data.map((v) => Number(v) & 0xff));
    tracePush('W', handleId, buf);
    const written = entry.dev.write(buf);
    return { ok: true, written };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** 关闭句柄（原生读线程随 close 终止 + 拒绝挂起 waiters）。 */
export async function hidCloseImpl(handleId) {
  const entry = handles.get(handleId);
  if (!entry) return { ok: false, error: `句柄不存在：${handleId}` };
  handles.delete(handleId);
  entry.open = false;
  for (const w of entry.waiters.splice(0)) {
    clearTimeout(w.timer);
    w.resolve({ ok: false, error: '句柄已关闭' });
  }
  try {
    entry.dev.close();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** 会话清理：关闭全部句柄（host impl 卸载/热换时调用；尽力而为）。 */
export async function hidCloseAllImpl() {
  const ids = [...handles.keys()];
  for (const id of ids) {
    try {
      await hidCloseImpl(id);
    } catch (_) { /* 尽力而为 */ }
  }
  return { ok: true, closed: ids.length };
}

/** 通讯 trace（桥收发十六进制记录，环形 200 条）+ 当前句柄表（调试双输出）。 */
export function hidTraceImpl() {
  return {
    ok: true,
    trace: TRACE.slice(),
    handles: [...handles.entries()].map(([id, e]) => ({ id, path: e.path || null, open: e.open, queued: e.queue.length, waiters: e.waiters.length })),
  };
}