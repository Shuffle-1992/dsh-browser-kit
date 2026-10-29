/**
 * 批注按会话分目录 —— 行为钉。
 *
 * 2026-10-29 用户要求："现在所有会话的批注 md 都放在同一个文件夹，能不加一层会话 id 的文件夹，
 * 即每个会话的批注文件存放自己的文件夹，避免跨会话问题？"
 *
 * 装配：annotations/<sessionId>/<时间戳>.md + latest.md + index.jsonl
 *      · 会话之间**存储层隔离** ⇒ 不可能读到对方文件；
 *      · 拿不到 sessionId ⇒ 退回 annotations/ 根目录（兼容旧数据）；
 *      · sessionId 做白名单清洗（防目录穿越）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _internals } from "../plugin/host.impl.mjs";

const { saveMergedImpl } = _internals;
import { annotationsLocal } from "../plugin/browser-tools.host.mjs";

const mkPaths = () => {
  const base = mkdtempSync(join(tmpdir(), "dbk-annot-"));
  const pluginDir = join(base, "plugin");
  mkdirSync(pluginDir, { recursive: true });
  return { paths: { pluginDir }, base, projectDir: base };
};

const mkSets = (n, url) => [
  {
    url: url || "https://example.test/page",
    title: "T",
    annotations: Array.from({ length: n }, (_, i) => ({
      gid: `g${i + 1}`,
      index: i + 1,
      note: `意见${i + 1}`,
      window: "A",
      element: { tagName: "button", text: `按钮${i + 1}`, capturedAt: 1000 + i },
    })),
  },
];

test("写入：有 sessionId ⇒ 落到 annotations/<sessionId>/，会话之间互不干扰", () => {
  const { paths, projectDir } = mkPaths();
  const a = saveMergedImpl(paths, mkSets(2), { sessionId: "session-AAA" });
  const b = saveMergedImpl(paths, mkSets(1), { sessionId: "session-BBB" });
  assert.equal(a.ok, true, "A 会话落盘成功");
  assert.equal(b.ok, true, "B 会话落盘成功");

  const dirA = join(projectDir, "annotations", "session-AAA");
  const dirB = join(projectDir, "annotations", "session-BBB");
  assert.ok(existsSync(dirA), "A 会话目录必须存在");
  assert.ok(existsSync(dirB), "B 会话目录必须存在");
  assert.ok(a.path.startsWith(dirA), "A 的文件在 A 目录");
  assert.ok(b.path.startsWith(dirB), "B 的文件在 B 目录");

  // latest.md 各自一份，不互相覆盖
  assert.ok(existsSync(join(dirA, "latest.md")), "A 有 latest.md");
  assert.ok(existsSync(join(dirB, "latest.md")), "B 有 latest.md");
  assert.match(readFileSync(join(dirA, "latest.md"), "utf8"), /annotations: 2/, "A 的 latest 是 2 条");
  assert.match(readFileSync(join(dirB, "latest.md"), "utf8"), /annotations: 1/, "B 的 latest 是 1 条");

  // 根目录不再堆文件（隔离生效）
  const rootFiles = readdirSync(join(projectDir, "annotations")).filter((f) => f.endsWith(".md"));
  assert.deepEqual(rootFiles, [], "根目录不应再有散落的 .md");
});

test("写入：无 sessionId ⇒ 退回根目录（兼容旧数据/裸通道）", () => {
  const { paths, projectDir } = mkPaths();
  const r = saveMergedImpl(paths, mkSets(1), {});
  assert.equal(r.ok, true);
  assert.ok(r.path.startsWith(join(projectDir, "annotations")), "落到根目录");
  assert.ok(!r.path.includes("session-"), "不得凭空造会话目录");
  assert.ok(existsSync(join(projectDir, "annotations", "latest.md")), "根 latest.md 存在");
});

test("读取：给了 sessionId ⇒ 读该会话目录（不会串到别的会话）", () => {
  const { paths } = mkPaths();
  saveMergedImpl(paths, mkSets(3), { sessionId: "session-AAA" });
  saveMergedImpl(paths, mkSets(1), { sessionId: "session-BBB" });

  const ra = annotationsLocal({ op: "latest", sessionId: "session-AAA" }, { paths });
  const rb = annotationsLocal({ op: "latest", sessionId: "session-BBB" }, { paths });
  assert.equal(ra.ok, true);
  assert.equal(rb.ok, true);
  assert.equal(ra.sessionId, "session-AAA", "返回会话标识");
  assert.equal(rb.sessionId, "session-BBB");
  assert.match(ra.markdown, /annotations: 3/, "A 读到自己的 3 条");
  assert.match(rb.markdown, /annotations: 1/, "B 读到自己的 1 条");
});

test("读取：未给 sessionId 且根目录无 latest ⇒ 取最近的会话目录", () => {
  const { paths } = mkPaths();
  saveMergedImpl(paths, mkSets(2), { sessionId: "session-AAA" });
  const r = annotationsLocal({ op: "latest" }, { paths });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "newest-session", "按最新会话目录读取");
  assert.equal(r.sessionId, "session-AAA");
  assert.match(r.markdown, /annotations: 2/);
});

test("安全：sessionId 白名单清洗，防目录穿越", () => {
  const { paths, projectDir } = mkPaths();
  const r = saveMergedImpl(paths, mkSets(1), { sessionId: "../../evil/session-XXX" });
  assert.equal(r.ok, true);
  const norm = r.path.replace(/\\/g, "/");
  assert.ok(!norm.includes(".."), "路径不得含 ..");
  assert.ok(norm.includes("/annotations/sessionXXX/") || norm.includes("/annotations/evilsession-XXX/"), "只保留白名单字符");
  // 清洗后仍落在 annotations 之下
  assert.ok(norm.startsWith(join(projectDir, "annotations").replace(/\\/g, "/")), "仍在 annotations 根之下");
});

test("读取：list 也按会话（只列该会话的文件）", () => {
  const { paths } = mkPaths();
  saveMergedImpl(paths, mkSets(1), { sessionId: "session-AAA" });
  saveMergedImpl(paths, mkSets(2), { sessionId: "session-AAA" });
  saveMergedImpl(paths, mkSets(1), { sessionId: "session-BBB" });
  const ra = annotationsLocal({ op: "list", sessionId: "session-AAA" }, { paths });
  assert.equal(ra.ok, true);
  assert.equal(ra.files.length, 2, "A 会话有 2 个文件");
  const rb = annotationsLocal({ op: "list", sessionId: "session-BBB" }, { paths });
  assert.equal(rb.files.length, 1, "B 会话有 1 个文件");
});

test("兼容：根目录有旧 latest 时，无 sessionId 读取取最新（会话目录优先于旧数据）", () => {
  const { paths, projectDir } = mkPaths();
  // 先造一份"旧布局"数据（根目录）
  const rootDir = join(projectDir, "annotations");
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(join(rootDir, "latest.md"), "# Web page annotations: 9\n\n旧数据\n", "utf8");
  // 再造一份"新布局"数据（会话目录）—— 必然更新
  saveMergedImpl(paths, mkSets(2), { sessionId: "session-NEW" });
  // 关键：旧实现会先命中根 latest.md ⇒ 读到 9 条旧数据 ✗
  const r = annotationsLocal({ op: "latest" }, { paths });
  assert.equal(r.ok, true);
  assert.equal(r.sessionId, "session-NEW", "必须取最新的会话目录，而不是根目录旧数据");
  assert.match(r.markdown, /annotations: 2/, "读到的是新数据（2 条）");
});
