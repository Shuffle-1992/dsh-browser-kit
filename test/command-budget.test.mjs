/**
 * 命令通道超时预算 —— **行为钉**（不是字面钉 ✗）。
 *
 * 背景（P116 事故区 ✗）：这段公式曾两次出错（20000 截断 browser_wait ✗；把 handler 参数 `c` 抄进轮询器
 * ⇒ ReferenceError ⇒ 回执永不写 ✗），而当时的测试只 `assert.match` 源码字面 ⇒ **测试全绿、实机全死** ✗✗。
 * 本文件用**行为**断言锁死三条不变量（见 src/command-budget.mjs 头注 ✓），并做 client 内嵌副本的 parity 对拍 ✓。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clientCapOf,
  DEFAULT_CMD_TIMEOUT_MS,
  CLIENT_CAP_MIN_MS,
  CLIENT_CAP_MAX_MS,
  CLIENT_CAP_MARGIN_MS,
} from "../src/command-budget.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (p) => readFileSync(join(root, p), "utf8");

test("行为：客户端上限 = clamp(宿主期限 − 余量, 2000, 80000)", () => {
  assert.equal(clientCapOf(25000), 23000);
  assert.equal(clientCapOf(80000), 78000);
  assert.equal(clientCapOf(70000), 68000); // browser_wait 的宿主超时 ✓
  assert.equal(clientCapOf(5000), 3000); // 最小工具超时 ✓
  assert.equal(clientCapOf(1500), 2000); // 触下界 ✓
  assert.equal(clientCapOf(999999), CLIENT_CAP_MAX_MS); // 触上界 ✓
});

test("行为：非法/缺失输入退回默认期限（绝不抛 ✗）", () => {
  for (const bad of [undefined, null, 0, -1, NaN, "abc", {}, []]) {
    assert.equal(clientCapOf(bad), DEFAULT_CMD_TIMEOUT_MS - CLIENT_CAP_MARGIN_MS, `输入 ${String(bad)} 应退回默认 ✓`);
  }
  assert.equal(clientCapOf("25000"), 23000, "数字字符串按数值处理 ✓");
});

test("不变量：全部 27 个工具的宿主超时都满足「客户端上限 < 宿主期限」（否则真实原因被吞 ✗）", () => {
  const tools = readText("plugin/browser-tools.host.mjs");
  const caps = [...tools.matchAll(/timeoutMs:\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(caps.length >= 20, `应能读到多个工具超时（实际 ${caps.length}）`);
  for (const t of caps) {
    const c = clientCapOf(t);
    assert.ok(c < t, `工具超时 ${t}ms：客户端上限 ${c}ms 必须更小（保证先回执 ✓）`);
    assert.ok(c >= CLIENT_CAP_MIN_MS, `工具超时 ${t}ms：客户端上限不低于 ${CLIENT_CAP_MIN_MS}ms ✓`);
    assert.ok(c <= CLIENT_CAP_MAX_MS, `工具超时 ${t}ms：客户端上限不高于 ${CLIENT_CAP_MAX_MS}ms ✓`);
  }
  // 长等待（browser_wait 70s）绝不能被截断成假超时 ✗
  const maxToolTimeout = Math.max(...caps);
  assert.ok(clientCapOf(maxToolTimeout) >= 60000, `最大工具超时 ${maxToolTimeout}ms 的客户端上限必须 ≥60s ✓`);
});

test("parity：client.js 内嵌副本与正典逐例同结果（A1 模式 ✓）", () => {
  const client = readText("plugin/client.js");
  const m = client.match(/\/\* @command-budget-canonical-begin[\s\S]*?\/\* @command-budget-canonical-end \*\//);
  assert.ok(m, "client.js 必须保留 @command-budget-canonical-begin/end 内嵌块 ✓");
  const embedded = new Function(
    `${m[0]
      // 去掉开头那整段注释（一直到第一个 */ 为止）—— 只留真正的代码 ✓
      .replace(/^[\s\S]*?\*\//, "")
      .replace(/\/\* @command-budget-canonical-end \*\//, "")}; return clientCapOf;`,
  )();
  assert.equal(typeof embedded, "function", "内嵌副本必须导出函数 ✓");
  for (const x of [undefined, null, 0, 1500, 25000, 5000, 70000, 80000, 999999, "25000"]) {
    assert.equal(embedded(x), clientCapOf(x), `输入 ${String(x)} 的内嵌/正典结果必须一致 ✓`);
  }
});

test("常量自洽（改一处就够 ✓，防止两处硬编码漂移 ✗）", () => {
  assert.equal(DEFAULT_CMD_TIMEOUT_MS, 25000);
  assert.equal(CLIENT_CAP_MIN_MS, 2000);
  assert.equal(CLIENT_CAP_MAX_MS, 80000);
  assert.equal(CLIENT_CAP_MARGIN_MS, 2000);
  // host 侧形参缺省必须与常量一致 ✓
  const tools = readText("plugin/browser-tools.host.mjs");
  assert.match(tools, /timeoutMs = DEFAULT_CMD_TIMEOUT_MS/, "宿主形参缺省应引用常量（不再写死 25000 ✗）");
});
