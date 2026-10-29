/**
 * 清单元数据一致性 —— **行为钉**（审查报告 F07 / F13 反例 ✓）。
 *
 * F13 四个反例：①根描述称"零 npm 依赖"（子包实际有 node-hid）；②根 Apache-2.0 vs 子包 MIT；
 * ③锁文件 0.1.0 vs 清单 0.2.0；④文档说串行、`scripts.test` 却是默认并发。
 * F07 反例：`files` 用裸 `plugin/` ⇒ `npm pack` 会把本机 `plugin/.data` 运行数据打进去（实测 202 个文件）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const rootPkg = readJson("package.json");
const subPkg = readJson("plugin/package.json");
const lock = readJson("plugin/package-lock.json");
const readme = readFileSync(join(root, "README.md"), "utf8");

test("F13①：描述不得宣称绝对「零 npm 依赖」而不提 node-hid（子包确实依赖它 ✗）", () => {
  const desc = String(rootPkg.description || "");
  assert.doesNotMatch(desc, /。\s*零 npm 依赖。/, "不得再写无条件的『零 npm 依赖』✗");
  assert.match(desc, /node-hid/, "必须点明唯一第三方依赖 node-hid ✓");
  assert.ok(subPkg.dependencies && subPkg.dependencies["node-hid"], "子包必须如实声明 node-hid ✓");
  /* ★2026-10-27（F06）：根清单也要声明运行依赖 —— 否则"从仓库根安装"拿不到 node-hid ✗ */
  assert.ok(rootPkg.dependencies && rootPkg.dependencies["node-hid"], "根清单必须声明 node-hid ✓（F06 ✗）");
  // README 的说法必须与清单一致 ✓（只钉**语义**：点明 node-hid 且不宣称绝对零依赖 ✗）
  assert.match(readme, /node-hid/, "README 要点明唯一第三方依赖 node-hid ✓");
  assert.doesNotMatch(readme, /零 npm 依赖/, "README 不得再宣称「零 npm 依赖」✗");
  assert.match(readme, /依赖最小化|按需加载/, "README 应说明依赖最小化 / 按需加载 ✓");
});

test("F13②：根 / 子包 / NOTICE 的许可声明必须一致（不许根 Apache 子包 MIT ✗）", () => {
  assert.equal(rootPkg.license, "Apache-2.0");
  assert.equal(subPkg.license, rootPkg.license, "子包许可必须与根一致 ✗");
  const notice = readFileSync(join(root, "NOTICE.md"), "utf8");
  assert.match(notice, /Apache-2\.0/, "NOTICE 必须声明 Apache-2.0 ✓");
});

test("F13③：锁文件版本必须与清单版本一致（0.1.0 vs 0.2.0 ✗）", () => {
  assert.equal(lock.version, subPkg.version, "锁文件顶层版本必须与子包一致 ✗");
  assert.equal(lock.packages?.[""]?.version, subPkg.version, "lock packages[\"\"] 版本也必须一致 ✗");
});

test("F13④：`scripts.test` 必须与文档声称的串行口径一致（并发争用会打红夹具 ✗）", () => {
  assert.match(String(rootPkg.scripts?.test || ""), /--test-concurrency=1/, "scripts.test 必须显式串行 ✓");
  assert.match(readme, /--test-concurrency=1/, "README 必须写明串行口径 ✓");
});

test("F06：根包必须是可解析的分发入口（main/exports 指向 plugin/ ✓）", () => {
  /* 反例（报告 §5 F06）：根清单只有 dsh.bundle.patch，没有 main/exports/deps ⇒
   * 干净 profile 里按 Node 解析规则 MODULE_NOT_FOUND ✗（本机被 junction 与 plugin/node_modules 掩盖 ✗）。 */
  assert.equal(rootPkg.main, "plugin/entry.mjs", "根必须声明 main ✓");
  const ex = rootPkg.exports || {};
  assert.equal(ex["."], "./plugin/entry.mjs", "根 exports['.'] 必须指向运行入口 ✓");
  assert.equal(ex["./client"], "./plugin/client.js", "必须导出 client 半边 ✓");
  assert.equal(ex["./typert"], "./plugin/wire.host.mjs", "必须导出 typert 描述符 ✓");
  assert.equal(ex["./package.json"], "./package.json", "必须导出 package.json ✓");
  // 入口文件真实存在 ✓
  for (const rel of ["plugin/entry.mjs", "plugin/client.js", "plugin/wire.host.mjs"]) {
    assert.ok(existsSync(join(root, rel)), `${rel} 必须存在 ✓`);
  }
});

test("F07：`files` 必须白名单化（裸 `plugin/` 会把 .data 打进制品 ✗）", () => {
  const files = rootPkg.files || [];
  assert.ok(!files.includes("plugin/"), "不得再用裸 `plugin/`（会包含 plugin/.data ✗）");
  assert.ok(files.some((f) => f.startsWith("plugin/*.")), "必须用文件级 glob 白名单 ✓");
  // 运行必需文件都要被覆盖 ✓
  for (const need of [
    "plugin/entry.mjs",
    "plugin/client.js",
    "plugin/host.impl.mjs",
    "plugin/wire.host.mjs",
    "plugin/browser-tools.host.mjs",
    "plugin/annot-delivery.host.mjs",
    "plugin/plugin-config.schema.mjs",
    "plugin/cordis.patch.yml",
    "plugin/package.json",
    "plugin/icon.svg",
  ]) {
    const base = need.slice("plugin/".length);
    const matched = files.some((pat) => {
      if (pat === need) return true;
      if (!pat.startsWith("plugin/*")) return false;
      const suffix = pat.slice("plugin/*".length);
      return base.endsWith(suffix);
    });
    assert.ok(matched, `files 白名单必须覆盖 ${need} ✓`);
  }
  // 运行期数据目录绝不能被任何 pattern 命中 ✓
  const hitsData = files.some((pat) => pat.includes(".data"));
  assert.equal(hitsData, false, "files 不得包含 .data ✓");
});

test("F07/F13：这些约束在真实 npm pack 里成立（可执行验收，跳过条件：无 npm）", async (t) => {
  const { execFileSync } = await import("node:child_process");
  let out;
  try {
    out = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
      cwd: root,
      encoding: "utf8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    t.skip(`npm pack 不可用（${e && e.code ? e.code : "unknown"}）—— 环境限制，不算失败`);
    return;
  }
  const parsed = JSON.parse(out);
  const list = (parsed[0].files || []).map((f) => f.path);
  assert.ok(list.length > 0, "pack 清单不应为空 ✓");
  assert.equal(list.filter((p) => p.includes(".data")).length, 0, "制品中不得出现 plugin/.data ✗");
  assert.equal(list.filter((p) => /command-results|command\.json|probe-report/.test(p)).length, 0, "不得包含回执/命令/探测数据 ✗");
  assert.ok(list.includes("plugin/entry.mjs"), "必须包含运行入口 plugin/entry.mjs ✓");
  assert.ok(list.includes("README.md") && list.includes("LICENSE"), "必须包含 README 与 LICENSE ✓");
});
