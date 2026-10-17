/**
 * dsh-browser-kit — cdp/drive.mjs
 *
 * 轻量 CDP 驱动（Node ≥ 22 原生 WebSocket，零 npm 依赖）：
 *   launch({chromePath?, port?, userDataDir?})  启动临时 Chrome（默认非 headless）
 *   connect(portOrWsUrl) → { send, on, close }  连接 page target 的 WebSocket
 *   inject(cdp, scriptSource)                   addScriptToEvaluateOnNewDocument + 当前文档 evaluate 兜底
 *   evalJs(cdp, expr)                           returnByValue + awaitPromise + userGesture（异常透传）
 *   consoleStream(cdp, cb)                      Runtime.consoleAPICalled 归一化
 *   screenshot(cdp, {fullPage?}) → Buffer       Page.captureScreenshot（fullPage 走 captureBeyondViewport）
 *   close()                                     清理 launch 的进程与临时 userDataDir
 *
 * 归属：dsh-browser-kit 原创实现（规格：调研文档 §5.3/§5.5、任务书 §3.5），未复制 ZCode 代码。
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_PORT = 9222;
const READY_TIMEOUT_MS = 20000;
const WS_OPEN_TIMEOUT_MS = 15000;

/** launch 登记表：close() 据此杀进程、删临时目录。 */
const launches = new Set();

// ---------------------------------------------------------------- Chrome 定位

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function findChromePath(explicit) {
  if (explicit && existsSync(explicit)) {
    return explicit;
  }
  const envCandidates = [process.env.DSH_KIT_CHROME_PATH, process.env.CHROME_PATH].filter(Boolean);
  const fromEnv = firstExisting(envCandidates);
  if (fromEnv) {
    return fromEnv;
  }
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const found = firstExisting(candidates);
  if (!found) {
    throw new Error(
      "drive.launch: 未找到 Chrome/Edge 可执行文件，请传 chromePath 或设置环境变量 DSH_KIT_CHROME_PATH",
    );
  }
  return found;
}

// ---------------------------------------------------------------- 进程编排

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(port, pathname, method = "GET") {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
  if (!response.ok) {
    throw new Error(`drive: HTTP ${response.status} on ${pathname}`);
  }
  return response.json();
}

async function waitForEndpoint(port, proc, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (proc.exitCode !== null) {
      throw new Error(`drive.launch: Chrome 进程提前退出（code=${proc.exitCode}），端口 ${port} 可能被占用`);
    }
    try {
      await fetchJson(port, "/json/version");
      return;
    } catch (_) {
      if (Date.now() > deadline) {
        throw new Error(`drive.launch: 等待 CDP 端点超时（127.0.0.1:${port}，${timeoutMs}ms）`);
      }
      await sleep(150);
    }
  }
}

/**
 * 启动临时 Chrome。userDataDir 缺省时自动创建临时目录（close() 会删除）；
 * 显式传入的 userDataDir 归调用方管理，close() 不删除。
 */
export async function launch({ chromePath, port = DEFAULT_PORT, userDataDir, headless = false, extraArgs = [] } = {}) {
  const exe = findChromePath(chromePath);
  const autoTemp = !userDataDir;
  const dir = userDataDir ?? mkdtempSync(path.join(tmpdir(), "dsh-kit-chrome-"));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(headless ? ["--headless=new"] : []),
    ...extraArgs,
    "about:blank",
  ];
  const proc = spawn(exe, args, { stdio: "ignore", windowsHide: true });
  const record = { proc, port, userDataDir: dir, autoTemp };
  launches.add(record);
  await waitForEndpoint(port, proc, READY_TIMEOUT_MS);
  return { proc, port, userDataDir: dir, chromePath: exe };
}

/** 杀掉整个 Chrome 进程树（Windows 下 proc.kill 杀不死 renderer 子进程）。 */
function killProcessTree(proc) {
  if (proc.exitCode !== null || !proc.pid) {
    return;
  }
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      proc.kill("SIGKILL");
    }
  } catch (_) {
    try {
      proc.kill();
    } catch (_) {
      /* 尽力而为 */
    }
  }
}

/** 清理所有 launch 产生的 Chrome 进程与临时目录（重复调用安全）。 */
export async function close() {
  const records = [...launches];
  launches.clear();
  let firstError = null;
  for (const record of records) {
    try {
      killProcessTree(record.proc);
    } catch (error) {
      firstError = firstError ?? error;
    }
  }
  // 等内核进程真正退出再删目录——Windows 下 renderer/crashpad 未死透时 user-data-dir 仍被锁（EPERM）
  const deadline = Date.now() + 5000;
  for (;;) {
    const allDead = records.every((record) => record.proc.exitCode !== null);
    if (allDead || Date.now() > deadline) {
      break;
    }
    await sleep(100);
  }
  await sleep(200);
  for (const record of records) {
    if (!record.autoTemp) {
      continue;
    }
    try {
      rmSync(record.userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 12,
        retryDelay: 250,
      });
    } catch (error) {
      firstError = firstError ?? error;
    }
  }
  if (firstError) {
    throw firstError;
  }
}

// ---------------------------------------------------------------- CDP 会话

function onceEvent(emitter, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`drive.connect: 等待 WebSocket ${type} 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("drive.connect: WebSocket 连接失败"));
    };
    function cleanup() {
      clearTimeout(timer);
      emitter.removeEventListener("open", onOpen);
      emitter.removeEventListener("error", onError);
    }
    emitter.addEventListener("open", onOpen);
    emitter.addEventListener("error", onError);
  });
}

/** 连接指定端口（或完整 ws:// URL）的 page target。返回 { send, on, close }。 */
export async function connect(portOrWsUrl) {
  let wsUrl = null;
  if (typeof portOrWsUrl === "string" && /^wss?:\/\//i.test(portOrWsUrl)) {
    wsUrl = portOrWsUrl;
  } else {
    const port = Number(portOrWsUrl);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error("drive.connect: 需要 CDP 端口号或 ws:// URL");
    }
    const targets = await fetchJson(port, "/json/list");
    let target = targets.find((t) => t.type === "page");
    if (!target) {
      // 新版 Chrome 要求 PUT；老版本只认 GET，两种都试
      try {
        target = await fetchJson(port, `/json/new?about:blank`, "PUT");
      } catch (_) {
        target = await fetchJson(port, `/json/new?about:blank`);
      }
    }
    if (!target || !target.webSocketDebuggerUrl) {
      throw new Error("drive.connect: 未找到可用的 page target");
    }
    wsUrl = target.webSocketDebuggerUrl;
  }

  const ws = new WebSocket(wsUrl);
  await onceEvent(ws, "open", WS_OPEN_TIMEOUT_MS);

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  let closed = false;

  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch (_) {
      return;
    }
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        const detail = message.error.data ? `: ${message.error.data}` : "";
        entry.reject(new Error(`CDP ${message.error.message || "error"}${detail} [${entry.method}]`));
      } else {
        entry.resolve(message.result ?? {});
      }
      return;
    }
    if (message.method) {
      const callbacks = listeners.get(message.method);
      if (callbacks) {
        for (const callback of [...callbacks]) {
          try {
            callback(message.params ?? {}, message);
          } catch (_) {
            /* 事件回调异常不影响协议处理 */
          }
        }
      }
    }
  });

  ws.addEventListener("close", () => {
    closed = true;
    for (const entry of pending.values()) {
      entry.reject(new Error(`drive: WebSocket 已关闭 [${entry.method}]`));
    }
    pending.clear();
  });

  const cdp = {
    /** 发送命令；返回 result。 */
    send(method, params) {
      if (closed || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error(`drive: 连接已关闭，无法发送 ${method}`));
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject });
        try {
          ws.send(JSON.stringify({ id, method, params: params ?? {} }));
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    /** 订阅事件；返回退订函数。 */
    on(eventName, callback) {
      if (!listeners.has(eventName)) {
        listeners.set(eventName, new Set());
      }
      listeners.get(eventName).add(callback);
      return () => listeners.get(eventName)?.delete(callback);
    },
    /** 关闭本会话 WebSocket（浏览器进程与临时目录由 drive.close() 清理）。 */
    close() {
      if (closed) {
        return;
      }
      closed = true;
      try {
        ws.close();
      } catch (_) {
        /* 忽略 */
      }
    },
    get isOpen() {
      return !closed && ws.readyState === WebSocket.OPEN;
    },
  };
  return cdp;
}

// ---------------------------------------------------------------- 高层操作

const pageEnabled = new WeakSet();

/** 注入脚本：对新文档（document_start 语义）与当前文档双保险。返回 addScriptToEvaluateOnNewDocument 标识。 */
export async function inject(cdp, scriptSource) {
  if (!pageEnabled.has(cdp)) {
    await cdp.send("Page.enable");
    pageEnabled.add(cdp);
  }
  const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: scriptSource });
  // 当前文档兜底：addScriptToEvaluateOnNewDocument 只对之后的导航生效
  await cdp.send("Runtime.evaluate", { expression: scriptSource, silent: true });
  return identifier;
}

/** 页面内求值：returnByValue + awaitPromise + userGesture=true（与 Electron executeJavaScript(script, true) 同约定）。异常透传。 */
export async function evalJs(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const exception = result.exceptionDetails;
    const text = exception.exception?.description || exception.text || "unknown error";
    throw new Error(`drive.evalJs: ${text}`);
  }
  return result.result?.value;
}

/** 订阅页面 console 流（Runtime.consoleAPICalled 归一化为 { type, timestamp, args }）。返回退订函数。 */
export async function consoleStream(cdp, callback) {
  await cdp.send("Runtime.enable");
  return cdp.on("Runtime.consoleAPICalled", (params) => {
    callback({
      type: params.type,
      timestamp: params.timestamp,
      args: (params.args ?? []).map((arg) => {
        if (arg.value !== undefined) {
          return arg.value;
        }
        if (arg.description !== undefined) {
          return arg.description;
        }
        return arg.preview?.description ?? null;
      }),
    });
  });
}

/** 截图。fullPage=true 时按布局尺寸 captureBeyondViewport。返回 PNG Buffer。 */
export async function screenshot(cdp, { fullPage = false } = {}) {
  if (!pageEnabled.has(cdp)) {
    await cdp.send("Page.enable");
    pageEnabled.add(cdp);
  }
  let params = { format: "png" };
  if (fullPage) {
    const metrics = await cdp.send("Page.getLayoutMetrics");
    const size = metrics.cssContentSize ?? metrics.contentSize;
    if (size) {
      params = {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
      };
    }
  }
  const { data } = await cdp.send("Page.captureScreenshot", params);
  return Buffer.from(data, "base64");
}
