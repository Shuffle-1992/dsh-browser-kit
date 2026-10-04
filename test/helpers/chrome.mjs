/**
 * test/helpers/chrome.mjs — Chrome 冒烟测试公共工具
 */

import net from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as drive from "../../src/cdp/drive.mjs";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..", "..");

export function fixtureUrl(relativePath) {
  return pathToFileURL(path.join(projectRoot, "test", "fixtures", relativePath)).href;
}

export function readSource(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 找一个空闲 TCP 端口（避免与其他 Chrome 实例的 9222 冲突）。 */
export function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/** 等待页面 readyState=complete（导航期间 Runtime 上下文可能暂不可用，忽略重试）。 */
export async function waitReady(cdp, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const state = await drive.evalJs(cdp, "document.readyState");
      if (state === "complete") {
        return;
      }
    } catch (_) {
      // 导航中上下文销毁：重试
    }
    if (Date.now() > deadline) {
      throw new Error("waitReady: 超时");
    }
    await sleep(120);
  }
}

/** 轮询等待异步条件成立（Chrome 后台窗口下定时器可能被节流，固定 sleep 不可靠）。 */
export async function waitFor(predicate, timeoutMs = 5000, intervalMs = 120) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let result = false;
    try {
      result = await predicate();
    } catch (_) {
      // 条件求值瞬时失败按未满足处理
    }
    if (result) {
      return true;
    }
    if (Date.now() > deadline) {
      return false;
    }
    await sleep(intervalMs);
  }
}

/** 在视口坐标中心发起一次真实鼠标点击（Input 域，非 JS 合成）。 */
export async function clickAt(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
