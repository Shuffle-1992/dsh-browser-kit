/**
 * 回执文件上限 —— **行为钉**（审查报告 F11 反例 ✓）。
 *
 * 反例：写入一条 3MiB 结果后，旧实现"保留最后 2000 行"仍留下 **3,145,821 字节** ✗（上限没兑现）。
 * 现在两道闸都是字节口径：单条 ≤512KiB（超了只留说明）、文件 ≤2MiB 触发轮转且保留 ≤1MiB；
 * 读取端只读尾部 256KiB ✓。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _internals } from "../plugin/host.impl.mjs";
import { readCommandResultImpl } from "../plugin/browser-tools.host.mjs";

const { commandResultImpl } = _internals;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "dbk-cmdres-"));
  const pluginDir = join(dir, "plugin");
  mkdirSync(join(pluginDir, ".data"), { recursive: true });
  const paths = { pluginDir };
  return {
    paths,
    file: join(pluginDir, ".data", "command-results.jsonl"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("F11 反例：单条超大结果不得让文件超过上限（正文丢弃 + 说明 ✓）", () => {
  const sb = sandbox();
  try {
    const huge = "x".repeat(1024 * 1024); // 1MiB
    commandResultImpl(sb.paths, "id-huge", { ok: true, value: huge });
    const size = statSync(sb.file).size;
    assert.ok(size < 4096, `单条 1MiB 结果写完后文件应保持很小 ✓（实际 ${size} 字节 ✗）`);
    const line = readFileSync(sb.file, "utf8").trim();
    const obj = JSON.parse(line);
    assert.equal(obj.truncated, true, "必须标记 truncated ✓");
    assert.ok(obj.bytes > 1024 * 1024, "必须记录原字节数 ✓");
    assert.ok(String(obj.note || "").length > 0, "必须给出说明 ✓");
  } finally { sb.cleanup(); }
});

test("F11：连续大结果下文件按**字节**有界（稳态 ≤ 2MiB + 单条 ✓）", () => {
  const sb = sandbox();
  try {
    const chunk = "y".repeat(200 * 1024); // 每条 200KiB（低于单条上限 ✓）
    const total = 40 * (200 * 1024);
    for (let i = 0; i < 40; i += 1) commandResultImpl(sb.paths, `id-${i}`, { ok: true, value: chunk });
    const size = statSync(sb.file).size;
    // 语义：写满 2MiB 才轮转、轮转后保留 ≤1MiB ⇒ 稳态上界 = 2MiB + 一条 ✓（不是 1MiB ✗）
    assert.ok(size <= 2 * 1024 * 1024 + 512 * 1024, `文件必须有字节上界 ✓（实际 ${size} ✗）`);
    assert.ok(size < total / 2, `轮转必须真的发生（写入 ${total} 字节，现存 ${size} ✗）`);
    // 最新的 id 仍可读回 ✓（回执不能丢在尾部之外）
    const last = readCommandResultImpl(sb.paths.pluginDir, "id-39");
    assert.ok(last && last.ok === true, "最新回执必须仍可读 ✓");
  } finally { sb.cleanup(); }
});

test("F11：读取端只吃尾部（超长前缀不影响命中最新 id ✓）", () => {
  const sb = sandbox();
  try {
    // 先塞 2MiB 历史行（每条 4KiB），再写一条目标回执 ✓
    const filler = JSON.stringify({ at: new Date().toISOString(), id: "old", result: { pad: "z".repeat(4096) } });
    for (let i = 0; i < 500; i += 1) appendFileSync(sb.file, `${filler}\n`, "utf8");
    commandResultImpl(sb.paths, "id-target", { ok: true, value: 42 });
    const got = readCommandResultImpl(sb.paths.pluginDir, "id-target");
    assert.deepEqual(got, { ok: true, value: 42 }, "尾部读取必须能命中最新回执 ✓");
    // 极旧 id 已不在尾部窗口内 ⇒ 返回 null（明确"没读到"，不猜 ✗）
    assert.equal(readCommandResultImpl(sb.paths.pluginDir, "id-0000000-not-exist"), null);
  } finally { sb.cleanup(); }
});

test("F11：缺失回执文件返回 null 且不抛（ENOENT = 正常空态 ✓）", () => {
  const sb = sandbox();
  try {
    assert.equal(readCommandResultImpl(sb.paths.pluginDir, "whatever"), null);
  } finally { sb.cleanup(); }
});

test("F11：读取端不再整文件读（源码级确认 + 尾部字节常量 ✓）", () => {
  const src = readFileSync(new URL("../plugin/browser-tools.host.mjs", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function readCommandResultImpl"), src.indexOf("/** 等旧命令被 client 取走"));
  assert.match(body, /RESULT_TAIL_BYTES/, "必须使用尾部字节上限 ✓");
  assert.match(body, /readSync|openSync/, "必须用 fd 局部读 ✓");
  assert.doesNotMatch(body, /readFileSync\(/, "读取端不得再整文件读 ✗");
});
