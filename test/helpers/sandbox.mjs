/**
 * test/helpers/sandbox.mjs — Node vm 沙箱工具（注入 IIFE 源码用）
 */

import vm from "node:vm";
import { readFileSync } from "node:fs";

/**
 * 创建可注入浏览器脚本的沙箱。window / globalThis 指向沙箱全局，
 * navigator / console / setTimeout 可注入（跨 realm 鸭子类型兼容）。
 */
export function createSandbox({ navigator: navigatorObj, console: consoleImpl } = {}) {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.navigator = navigatorObj ?? {};
  sandbox.console = consoleImpl ?? console;
  sandbox.setTimeout = (fn, ms) => setTimeout(fn, ms);
  sandbox.clearTimeout = (id) => clearTimeout(id);
  // 踩坑：Node vm 上下文不继承主 realm 的 Event/EventTarget/TextEncoder 全局（浏览器里有），需显式注入
  sandbox.Event = Event;
  sandbox.EventTarget = EventTarget;
  sandbox.TextEncoder = TextEncoder;
  sandbox.TextDecoder = TextDecoder;
  vm.createContext(sandbox);
  return sandbox;
}

/** 在沙箱中执行一个源文件（自包含 IIFE）。 */
export function evalScriptFile(sandbox, filePath) {
  const source = readFileSync(filePath, "utf8");
  vm.runInContext(source, sandbox, { filename: filePath });
}

/** 在沙箱中求值表达式并返回值。 */
export function evalInSandbox(sandbox, expression) {
  return vm.runInContext(expression, sandbox, { filename: "<eval>" });
}
