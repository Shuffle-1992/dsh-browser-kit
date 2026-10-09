/**
 * src/hid-bridge.mjs — HID 系统层直连桥（R-HID，host 侧专用）：
 * 绕开 Chromium `select-hid-device` 宿主缺口（P35）：WebHID 授权/选择器必须由 DSH 主进程
 * 实现，插件两个进程位都够不到 `session`——但宿主是 RUN_AS_NODE 纯 Node，可以走
 * node-hid **系统层直连**，不经 Chromium 权限体系，也没有选择器概念。
 *
 * 「授权」语义由调用方代行：host 枚举 + 调用方（插件选择器 UI 或预填 Chrome 授权清单）
 * 决定打开哪个 path。独占语义：Windows HID 顶层集合一次只允许一个消费者——Chrome 与
 * 本桥不能同时占用同一设备。
 *
 * 设计：
 *  - node-hid **懒加载**（首次调用才 require——未安装 node-hid 时其余功能不受影响）；
 *  - 句柄表 `handles: Map<handleId, HIDAsync>`，handleId 为自增字符串；
 *  - 优先 `HIDAsync`（v3 异步 API，不阻塞事件循环）；`hidRead` 用 `Promise.race` 超时语义。
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

const handles = new Map();
let handleSeq = 0;

/** 枚举系统全部 HID 设备（node-hid devicesAsync）。 */
export async function hidListImpl() {
  try {
    const h = hid();
    const devices = await h.devicesAsync();
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

/** 独占打开设备（path 来自 hidList），返回句柄 id。 */
export async function hidOpenImpl(path) {
  try {
    if (!path || typeof path !== 'string') return { ok: false, error: 'path 必填（hidList 返回的设备路径）' };
    const h = hid();
    const device = await h.HIDAsync.open(path);
    handleSeq += 1;
    const handleId = `hid-${handleSeq}`;
    handles.set(handleId, device);
    return { ok: true, handleId };
  } catch (e) {
    return { ok: false, error: `打开失败（独占占用？驱动占用？）：${(e && e.message) || String(e)}` };
  }
}

/** 读一次上报（阻塞至有数据或超时；timeoutMs 缺省 500）。 */
export async function hidReadImpl(handleId, timeoutMs) {
  const device = handles.get(handleId);
  if (!device) return { ok: false, error: `句柄不存在：${handleId}` };
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 500;
  try {
    const data = await Promise.race([
      device.read(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
    ]);
    return { ok: true, data: Array.from(data) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** 写入（字节数组；reportId 规则同 WebHID——若设备使用 report id，首字节为 0 填充）。 */
export async function hidWriteImpl(handleId, data) {
  const device = handles.get(handleId);
  if (!device) return { ok: false, error: `句柄不存在：${handleId}` };
  try {
    if (!Array.isArray(data) || data.length === 0) return { ok: false, error: 'data 必须为非空字节数组' };
    const buf = Buffer.from(data.map((v) => Number(v) & 0xff));
    const written = await device.write(buf);
    return { ok: true, written };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** 关闭句柄。 */
export async function hidCloseImpl(handleId) {
  const device = handles.get(handleId);
  if (!device) return { ok: false, error: `句柄不存在：${handleId}` };
  handles.delete(handleId);
  try {
    await device.close();
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