/**
 * test/plugin-impl.test.mjs — 任务02：plugin/host.impl.mjs 内部助手单元测试
 *
 * 被测面：host.impl.mjs 末尾 `_internals` 汇总导出（仅引用既有函数，运行时零改动）；
 * 另测 plugin/wire.host.mjs 的 TYPERT 清单形状（不触网）。
 * 纪律：时间断言只用固定 Date/形状正则（P7，不比较当前时刻）；
 * BOM 剥除是 takeCommand 的回归点（P18）；1×1 假成功防线回归（P17）。
 * 临时目录：mkdtempSync(os.tmpdir()) 每子测独立，t.after 清理。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { basename, dirname as pathDirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { _internals } from "../plugin/host.impl.mjs";
import { FACE_NAME, TYPERT } from "../plugin/wire.host.mjs";

const {
  slugify,
  tsStamp,
  dedupeFile,
  writeArtifact,
  saveShotImpl,
  saveAnnotationsImpl,
  saveMergedImpl,
  deleteAnnotationsImpl,
  getStatsImpl,
  clearArtifactsImpl,
  takeCommandImpl,
  commandResultImpl,
  shapeOf,
  extractApi,
} = _internals;

/** 每子测独立临时根：pluginDir = <root>/plugin（impl 的 projectDirOf = pluginDir/.. = root）。 */
function makePaths(t) {
  const root = mkdtempSync(join(tmpdir(), "dshbk-impl-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { pluginDir: join(root, "plugin") };
}

/** data:image/png;base64 dataURL，解码后恰 n 字节（impl 只验前缀与长度，不验 PNG 魔数）。 */
const pngDataUrl = (n) => `data:image/png;base64,${randomBytes(n).toString("base64")}`;

/** 读 JSONL 文件为对象数组。 */
const jsonl = (file) =>
  readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));

/* ─────────────── 3.1 slugify ─────────────── */

test("slugify：Windows 非法字符 / 空白折叠 / 中文保留 / 修剪截断 / 空回退", async (t) => {
  await t.test("非法字符 \\ / : * ? \" < > | 被替换剔除（连续非法段折叠为一个 -）", () => {
    assert.equal(slugify("a/b\\c:d*e?f\"g<h>i|j"), "a-b-c-d-e-f-g-h-i-j");
    assert.equal(slugify("a<>|b"), "a-b");
  });

  await t.test("换行/制表与空白折叠为 -", () => {
    assert.equal(slugify("x\r\n\ty"), "x-y");
    assert.equal(slugify("  hello   world  "), "hello-world");
  });

  await t.test("中文保留", () => {
    assert.equal(slugify("结算卡"), "结算卡");
    assert.equal(slugify("结算卡 支付页"), "结算卡-支付页");
  });

  await t.test("首尾 -. 修剪", () => {
    assert.equal(slugify("..--标题--.."), "标题");
  });

  await t.test("截断 40 字", () => {
    assert.equal(slugify("x".repeat(50)), "x".repeat(40));
    assert.equal(slugify("字".repeat(50)).length, 40);
  });

  await t.test("空/纯非法输入回退 page", () => {
    assert.equal(slugify(""), "page");
    assert.equal(slugify(null), "page");
    assert.equal(slugify(undefined), "page");
    assert.equal(slugify("///"), "page");
  });
});

/* ─────────────── 3.2 tsStamp ─────────────── */

test("tsStamp：固定 Date 断言 YYYYMMDD-HHmmss（P7：不比较当前时刻）", async (t) => {
  await t.test("固定本地时间", () => {
    assert.equal(tsStamp(new Date(2026, 9, 5, 7, 8, 9)), "20261005-070809");
    assert.equal(tsStamp(new Date(2026, 11, 31, 23, 59, 58)), "20261231-235958");
  });

  await t.test("个位补零", () => {
    assert.equal(tsStamp(new Date(2026, 0, 2, 3, 4, 5)), "20260102-030405");
  });

  await t.test("缺省入参：形状为 8 位数字-6 位数字", () => {
    assert.match(tsStamp(), /^\d{8}-\d{6}$/);
  });
});

/* ─────────────── 3.3 saveShotImpl ─────────────── */

test("saveShotImpl：PNG 落盘 + index.jsonl / 边界与防线", async (t) => {
  await t.test("合法 dataURL（600B）→ 文件 + 索引行，返回 {ok,path,bytes}", (t) => {
    const paths = makePaths(t);
    const buf = randomBytes(600);
    const r = saveShotImpl(paths, { url: "https://example.com/a", title: "测试页" }, `data:image/png;base64,${buf.toString("base64")}`);
    assert.equal(r.ok, true);
    assert.equal(r.bytes, 600);
    const shotsDir = join(paths.pluginDir, "..", "shots");
    assert.equal(pathDirname(r.path), shotsDir);
    assert.match(basename(r.path), /^\d{8}-\d{6}-测试页\.png$/);
    assert.ok(readFileSync(r.path).equals(buf));
    const [line] = jsonl(join(shotsDir, "index.jsonl"));
    assert.equal(line.file, basename(r.path));
    assert.equal(line.url, "https://example.com/a");
    assert.equal(line.title, "测试页");
    assert.equal(line.bytes, 600);
    assert.equal(typeof line.at, "string");
  });

  await t.test("恰好 500 字节（边界）→ 成功", (t) => {
    const paths = makePaths(t);
    const r = saveShotImpl(paths, { title: "edge500" }, pngDataUrl(500));
    assert.equal(r.ok, true);
    assert.equal(r.bytes, 500);
  });

  await t.test("PNG < 500 字节 → 拒绝且不落盘（1×1 假成功防线，P17）", (t) => {
    const paths = makePaths(t);
    const r = saveShotImpl(paths, { title: "tiny" }, pngDataUrl(499));
    assert.equal(r.ok, false);
    assert.match(r.error, /假成功/);
    assert.equal(r.bytes, 499);
    assert.equal(existsSync(join(paths.pluginDir, "..", "shots")), false);
  });

  await t.test("非 image/png 的 dataURL → 拒绝", (t) => {
    const paths = makePaths(t);
    const r = saveShotImpl(paths, {}, `data:image/jpeg;base64,${randomBytes(600).toString("base64")}`);
    assert.equal(r.ok, false);
    assert.match(r.error, /dataURL/);
  });

  await t.test("base64 解码为空 → 拒绝", (t) => {
    const paths = makePaths(t);
    const r = saveShotImpl(paths, {}, "data:image/png;base64,");
    assert.equal(r.ok, false);
    assert.match(r.error, /解码为空/);
  });

  await t.test("meta 缺失/非对象不抛：文件名回退 slug=page，索引 url/title 为 null", (t) => {
    const paths = makePaths(t);
    const r1 = saveShotImpl(paths, undefined, pngDataUrl(600));
    const r2 = saveShotImpl(paths, 42, pngDataUrl(601));
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.match(basename(r1.path), /-page\.png$/);
    const lines = jsonl(join(paths.pluginDir, "..", "shots", "index.jsonl"));
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.equal(line.url, null);
      assert.equal(line.title, null);
    }
  });
});

/* ─────────────── 3.4 saveAnnotationsImpl ─────────────── */

test("saveAnnotationsImpl：批注落盘 + 索引 count 解析 / 空输入拒绝", async (t) => {
  await t.test("正常 markdown（meta 缺席）→ 文件 + 索引行（count=3，url/title null）", (t) => {
    const paths = makePaths(t);
    const md = "# Web page annotations: 3\n- [a] 文本\n- [b] 选择器\n- [c] 备注";
    const r = saveAnnotationsImpl(paths, md);
    assert.equal(r.ok, true);
    assert.equal(r.bytes, Buffer.byteLength(md, "utf8"));
    assert.match(basename(r.path), /^\d{8}-\d{6}\.md$/);
    assert.equal(readFileSync(r.path, "utf8"), `${md}\n`);
    const [line] = jsonl(join(paths.pluginDir, "..", "annotations", "index.jsonl"));
    assert.equal(line.file, basename(r.path));
    assert.equal(line.count, 3);
    assert.equal(line.url, null);
    assert.equal(line.title, null);
  });

  await t.test("meta 携带 url/title → 进索引；count 取首行 N", (t) => {
    const paths = makePaths(t);
    saveAnnotationsImpl(paths, "# Web page annotations: 12\n正文", { url: "https://e.com/p", title: "页面" });
    const [line] = jsonl(join(paths.pluginDir, "..", "annotations", "index.jsonl"));
    assert.equal(line.count, 12);
    assert.equal(line.url, "https://e.com/p");
    assert.equal(line.title, "页面");
  });

  await t.test("markdown 自带结尾换行时不追加第二个换行", (t) => {
    const paths = makePaths(t);
    const r = saveAnnotationsImpl(paths, "body\n");
    assert.equal(r.ok, true);
    assert.equal(readFileSync(r.path, "utf8"), "body\n");
  });

  await t.test("空串/纯空白/非字符串 → ok:false", (t) => {
    const paths = makePaths(t);
    assert.equal(saveAnnotationsImpl(paths, "").ok, false);
    assert.equal(saveAnnotationsImpl(paths, "   \n\t").ok, false);
    assert.equal(saveAnnotationsImpl(paths, 123).ok, false);
  });
});

/* ─────────────── 3.5 takeCommandImpl ─────────────── */

test("takeCommandImpl：取走即删 / BOM 剥除（P18 回归）/ 非法 JSON", async (t) => {
  const cmdFile = (paths) => join(paths.pluginDir, ".data", "command.json");
  const seed = (paths, content) => {
    mkdirSync(join(paths.pluginDir, ".data"), { recursive: true });
    writeFileSync(cmdFile(paths), content, "utf8");
  };

  await t.test("文件不存在 → {ok:true, command:null}", (t) => {
    const paths = makePaths(t);
    assert.deepEqual(takeCommandImpl(paths), { ok: true, command: null });
  });

  await t.test("合法 JSON → 返回对象且文件已被删除", (t) => {
    const paths = makePaths(t);
    seed(paths, JSON.stringify({ type: "screenshot", id: "cmd-1" }));
    const r = takeCommandImpl(paths);
    assert.deepEqual(r, { ok: true, command: { type: "screenshot", id: "cmd-1" } });
    assert.equal(existsSync(cmdFile(paths)), false);
  });

  await t.test("带 BOM 的合法 JSON → 正常解析（P18 回归）", (t) => {
    const paths = makePaths(t);
    seed(paths, "\uFEFF{\"n\":1}");
    const r = takeCommandImpl(paths);
    assert.deepEqual(r, { ok: true, command: { n: 1 } });
    assert.equal(existsSync(cmdFile(paths)), false);
  });

  await t.test("非法 JSON → {ok:false, error 含「解析失败」} 且文件已删", (t) => {
    const paths = makePaths(t);
    seed(paths, "{bad json");
    const r = takeCommandImpl(paths);
    assert.equal(r.ok, false);
    assert.match(r.error, /解析失败/);
    assert.equal(existsSync(cmdFile(paths)), false);
  });
});

/* ─────────────── 3.6 commandResultImpl ─────────────── */

test("commandResultImpl：追加 JSONL（at/id/result），undefined 落 null", (t) => {
  const paths = makePaths(t);
  assert.deepEqual(commandResultImpl(paths, "cmd-1", { png: "a.png" }), { ok: true });
  assert.deepEqual(commandResultImpl(paths, "cmd-2", undefined), { ok: true });
  const lines = jsonl(join(paths.pluginDir, ".data", "command-results.jsonl"));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].id, "cmd-1");
  assert.deepEqual(lines[0].result, { png: "a.png" });
  assert.equal(lines[1].id, "cmd-2");
  assert.equal(lines[1].result, null);
  for (const line of lines) assert.equal(typeof line.at, "string");
});

/* ─────────────── 3.6b saveMergedImpl（多面板合并：capturedAt 排序 + 权威重编号） ─────────────── */

test("saveMergedImpl：跨组合并 + 按创建时间重编号 + 索引 merged 计数", (t) => {
  const paths = makePaths(t);
  const ann = (idx, capturedAt, sel, note) => ({
    index: idx,
    note: note || null,
    gid: "g-" + sel.replace("#", "") + "-" + capturedAt,
    element: { selector: sel, capturedAt },
  });
  const sets = [
    { url: "https://a.example/", title: "A", annotations: [ann(1, 1000, "#a1", "窗口1第一条"), ann(2, 2000, "#a2")] },
    { url: "https://b.example/", title: "B", annotations: [ann(1, 3000, "#b1", "窗口2第一条")] },
  ];
  const r = saveMergedImpl(paths, sets, { title: "合并页" });
  assert.equal(r.ok, true);
  assert.equal(r.count, 3);
  const md = readFileSync(r.path, "utf8");
  assert.match(md, /^# Web page annotations: 3\r?\n/);
  // 权威重编号：按 capturedAt 升序 → 1/2/3（原窗口2的本地 1 号变全局 3 号）
  const order = [...md.matchAll(/^## Annotation (\d+)$/gm)].map((m) => Number(m[1]));
  assert.deepEqual(order, [1, 2, 3]);
  const selectors = [...md.matchAll(/^Selector: (.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(selectors, ["#a1", "#a2", "#b1"]);
  const [line] = jsonl(join(paths.pluginDir, "..", "annotations", "index.jsonl"));
  assert.equal(line.count, 3);
  assert.equal(line.merged, 2);
  assert.equal(line.url, "https://a.example/");
  // 空组 / sets 缺失 → 拒绝
  assert.equal(saveMergedImpl(paths, [{ url: "x", annotations: [] }]).ok, false);
  assert.equal(saveMergedImpl(paths, null).ok, false);
  // 同步场景：两面板持相同 gid → 按 gid 去重（不产生重复条目）
  const dupSets = [
    { url: "https://a.example/", title: "A", annotations: [ann(1, 1000, "#dup1"), ann(2, 2000, "#dup2")] },
    { url: "https://a.example/", title: "A", annotations: [ann(1, 1000, "#dup1"), ann(2, 2000, "#dup2")] },
  ];
  const rd = saveMergedImpl(paths, dupSets, { title: "A" });
  assert.equal(rd.ok, true);
  assert.equal(rd.count, 2);
  const dupLines = jsonl(join(paths.pluginDir, "..", "annotations", "index.jsonl"));
  assert.equal(dupLines[dupLines.length - 1].count, 2);
});

/* ─────────────── 3.7 shapeOf / extractApi ─────────────── */

test("shapeOf/extractApi：jiti 互操作形状与候选链", async (t) => {
  await t.test('jiti 互操作形 {default:{}, "module.exports":{webContents}} → 命中 module.exports', () => {
    const mod = { default: {}, "module.exports": { webContents: {} } };
    assert.equal(extractApi(mod), mod["module.exports"]);
    const s = shapeOf(mod);
    assert.deepEqual(s.keys, ["default", "module.exports"]);
    assert.equal(s.hasDefault, true);
    assert.equal(s.defaultTypeof, "object");
    assert.deepEqual(s.defaultKeys, []);
    assert.equal(s.moduleExportsTypeof, "object");
    assert.deepEqual(s.moduleExportsKeys, ["webContents"]);
  });

  await t.test("{default:{app:{}}} → 命中 default", () => {
    const mod = { default: { app: {} } };
    assert.equal(extractApi(mod), mod.default);
  });

  await t.test("双层 default 嵌套 → 命中 default.default", () => {
    const mod = { default: { default: { webContents: {} } } };
    assert.equal(extractApi(mod), mod.default.default);
  });

  await t.test("全空形状 → null；shapeOf 记录 keys/defaultKeys/moduleExportsKeys", () => {
    assert.equal(extractApi({}), null);
    assert.equal(extractApi({ default: {} }), null);
    const s = shapeOf({});
    assert.deepEqual(s.keys, []);
    assert.equal(s.hasDefault, false);
    assert.equal(s.defaultKeys, "undefined"); // keys() 对 undefined 的形状化：String(typeof m)（实现如实的诊断行为）
    assert.equal(s.moduleExportsKeys, "undefined");
  });
});

/* ─────────────── 3.7b dedupeFile ─────────────── */

test("dedupeFile：无冲突原样返回；冲突追加 -2/-3 序号；保留扩展名", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dshbk-dedupe-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = dedupeFile(dir, "20260101-010101-页.png");
  assert.equal(first, join(dir, "20260101-010101-页.png"));
  writeFileSync(first, "x");
  const second = dedupeFile(dir, "20260101-010101-页.png");
  assert.equal(second, join(dir, "20260101-010101-页-2.png"));
  writeFileSync(second, "x");
  const third = dedupeFile(dir, "20260101-010101-页.png");
  assert.equal(third, join(dir, "20260101-010101-页-3.png"));
  // 无扩展名文件同样适用
  const a = dedupeFile(dir, "notes");
  writeFileSync(a, "x");
  assert.equal(dedupeFile(dir, "notes"), join(dir, "notes-2"));
});

/* ─────────────── 3.7 wire.host.mjs TYPERT ─────────────── */

test("wire TYPERT 清单形状（不触网）", async (t) => {
  await t.test("package/service 固定，invocations 恰 10 个且 id 形如 pkg#face/method", () => {
    assert.equal(FACE_NAME, "dshBrowserKit");
    assert.equal(TYPERT.package, "@local/dsh-browser-kit");
    assert.equal(TYPERT.service, FACE_NAME);
    assert.equal(TYPERT.invocations.length, 10);
    assert.deepEqual(
      TYPERT.invocations.map((i) => i.id),
      ["reportClient", "saveShot", "saveAnnotations", "saveMerged", "deleteAnnotations", "getStats", "clearArtifacts", "getInjectScript", "takeCommand", "commandResult"].map(
        (m) => `@local/dsh-browser-kit#dshBrowserKit/${m}`,
      ),
    );
  });

  await t.test("每个参数 codec.mode 均为 strict", () => {
    for (const inv of TYPERT.invocations) {
      for (const p of inv.parameters) assert.equal(p.codec.mode, "strict");
    }
  });

  await t.test("saveAnnotations 的 meta 参数带 acceptsUndefined:true；必选参数不带", () => {
    const ann = TYPERT.invocations.find((i) => i.method === "saveAnnotations");
    assert.equal(ann.parameters.find((p) => p.name === "meta").acceptsUndefined, true);
    const shot = TYPERT.invocations.find((i) => i.method === "saveShot");
    assert.equal("acceptsUndefined" in shot.parameters.find((p) => p.name === "meta"), false);
    assert.equal("acceptsUndefined" in shot.parameters.find((p) => p.name === "dataUrl"), false);
  });
});

/* ─────────────── 3.7b writeArtifact（H2 提取的三合一落盘尾部） ─────────────── */

test("writeArtifact：mkdir/dedupe/写入/索引行 一体化", (t) => {
  const { pluginDir } = makePaths(t);
  const dir = join(pluginDir, "shots");
  const a = writeArtifact(dir, "shot.png", Buffer.from([1, 2, 3, 4]), (n) => ({ file: n, bytes: 4 }));
  assert.equal(a.finalName, "shot.png");
  assert.equal(existsSync(a.file), true);
  const b = writeArtifact(dir, "shot.png", Buffer.from([5]), (n) => ({ file: n }));
  assert.equal(b.finalName, "shot-2.png", "同名去重追加 -2");
  const idx = readFileSync(join(dir, "index.jsonl"), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
  assert.equal(idx.length, 2);
  assert.equal(idx[0].file, "shot.png");
  assert.equal(idx[1].file, "shot-2.png");
});

/* ─────────────── 3.8b getStatsImpl / clearArtifactsImpl（面板统计 + 一键清空） ─────────────── */

test("getStatsImpl / clearArtifactsImpl：统计回环 / kind 白名单 / 一键清空", (t) => {
  const { pluginDir } = makePaths(t);
  saveAnnotationsImpl({ pluginDir }, "# Web page annotations: 1\n\n## Annotation 1\nTag: button\n", { title: "T" });
  const shot = saveShotImpl({ pluginDir }, { title: "页" }, `data:image/png;base64,${randomBytes(600).toString("base64")}`);
  assert.equal(shot.ok, true);
  const stats = getStatsImpl({ pluginDir });
  assert.equal(stats.ok, true);
  assert.equal(stats.annotations.count, 1, "1 个批注文件（index.jsonl 不计）");
  assert.equal(stats.shots.count, 1, "1 张截图");
  assert.ok(stats.annotations.bytes > 0 && stats.shots.bytes >= 600);
  const cleared = clearArtifactsImpl({ pluginDir }, "all");
  assert.equal(cleared.ok, true);
  assert.equal(cleared.removed.annotations, 2, "批注 md + index.jsonl");
  assert.equal(cleared.removed.shots, 2, "截图 png + index.jsonl");
  assert.equal(getStatsImpl({ pluginDir }).annotations.count, 0);
  assert.equal(getStatsImpl({ pluginDir }).shots.count, 0);
  assert.equal(clearArtifactsImpl({ pluginDir }, "nonsense").ok, false, "kind 白名单外拒绝");
});

/* ─────────────── 3.8 deleteAnnotationsImpl（撤回：删文件 + 清索引行 / 越界拒绝） ─────────────── */

test("deleteAnnotationsImpl：撤回回环 / 越界拒绝 / 缺文件 / 空 path", async (t) => {
  await t.test("正常撤回：saveAnnotations → delete → 文件消失 + 索引行清掉", (t) => {
    const { pluginDir } = makePaths(t);
    const save = saveAnnotationsImpl(
      { pluginDir },
      "# Web page annotations: 1\n\n## Annotation 1\nTag: button\n",
      { url: "https://example.com/a", title: "T" },
    );
    assert.equal(save.ok, true);
    const del = deleteAnnotationsImpl({ pluginDir }, save.path);
    assert.equal(del.ok, true);
    assert.equal(del.removedFile, save.path);
    assert.ok(del.removedIndexEntries >= 1, "至少清掉一行索引");
    assert.equal(existsSync(save.path), false, "批注文件应已删除");
    const indexRaw = readFileSync(join(pluginDir, "..", "annotations", "index.jsonl"), "utf8");
    assert.equal(indexRaw.trim(), "", "索引应为空");
  });

  await t.test("越界拒绝：annotations/ 之外一律不删（安全线）", (t) => {
    const { pluginDir } = makePaths(t);
    const r = deleteAnnotationsImpl({ pluginDir }, join(pluginDir, ".data", "command.json"));
    assert.equal(r.ok, false);
    assert.match(r.error, /越界/);
    const r2 = deleteAnnotationsImpl({ pluginDir }, pluginDir);
    assert.equal(r2.ok, false);
  });

  await t.test("annotations/ 内不存在的文件 → ok:false 文件不存在", (t) => {
    const { pluginDir } = makePaths(t);
    const r = deleteAnnotationsImpl({ pluginDir }, join(pluginDir, "..", "annotations", "nope.md"));
    assert.equal(r.ok, false);
    assert.match(r.error, /不存在/);
  });

  await t.test("空 path → ok:false", (t) => {
    const { pluginDir } = makePaths(t);
    assert.equal(deleteAnnotationsImpl({ pluginDir }, "").ok, false);
    assert.equal(deleteAnnotationsImpl({ pluginDir }, "   ").ok, false);
    assert.equal(deleteAnnotationsImpl({ pluginDir }, null).ok, false);
  });
});

/* ─────────────── 3.9 client.js 共享会话静态契约（P25/P26 回归钉） ─────────────── */

/** 读 client.js 源码（普通 script，非 ESM——静态契约为最经济的守护面）。 */
const clientSource = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8");

test("client.js 共享会话静态契约（P25 成员先入册 / P26 编号下限不双加）", async (t) => {
  await t.test("P26：joinFloorIndex 存在，且不再把 sessionMaxIndex()+1 当下限", () => {
    assert.match(clientSource, /const joinFloorIndex = \(maxUsed\) => \(Number\(maxUsed\) \|\| 0\)/);
    // 旧实现 `(await sessionMaxIndex() : 0) + 1` 直接跳号（窗口1批1 → 窗口2变3）
    assert.doesNotMatch(clientSource, /sessionMaxIndex\(\)[^;\n]*\+ 1/);
  });

  await t.test("P25：joinPane 内成员入册（push）先于 startPaneInSession", () => {
    const m = clientSource.match(/const joinPane = async \(target\) => \{([\s\S]*?)\n          \};/);
    assert.ok(m, "joinPane 函数体可定位");
    const body = m[1];
    const pushAt = body.search(/st\.panes\.push\(target\)/);
    const startAt = body.indexOf("startPaneInSession(target");
    assert.ok(pushAt >= 0, "joinPane 显式入册成员");
    assert.ok(startAt >= 0, "joinPane 调用 startPaneInSession");
    assert.ok(pushAt < startAt, "先入册再 start（start 的 Promise 到提交/取消才 settle）");
  });

  await t.test("自动加入与退出记忆：leftIds 存在且自动加入检查它；会话结束清空", () => {
    assert.match(clientSource, /leftIds: new Set\(\)/);
    assert.match(clientSource, /st\.leftIds\.has\(id\)/); // 自动加入跳过显式退出的面板
    assert.match(clientSource, /st\.leftIds\.clear\(\)/);
  });

  await t.test("面板身份按 webContentsId 比对（重渲染换节点不失配）", () => {
    assert.match(clientSource, /const paneIdOf = \(el\) =>/);
    assert.match(clientSource, /getWebContentsId/);
    assert.match(clientSource, /const refreshPanes = \(\) =>/);
  });

  await t.test("1.5.0：版本锁同步 + 提交提示写输入框 + 清除按钮 + 同页门控（防串窗）", () => {
    assert.match(clientSource, /EXPECTED_ANNOT_VERSION = '1\.5\.0'/);
    // 提交提示：primeSessionInput（textarea/contenteditable 双兜底）+ 提交链接入
    assert.match(clientSource, /const primeSessionInput = \(text\) =>/);
    assert.match(clientSource, /announceSubmission\(r\)/);
    const annotSource = readFileSync(new URL("../src/element-annotator.js", import.meta.url), "utf8");
    assert.match(annotSource, /__dshKitAnnotatorVersion = "1\.5\.0"/);
    // 同页门控：sync 快照带 href、来源页 URL 登记、推送附 _originUrl；annotator 按 pageOk 抑制徽标
    assert.match(clientSource, /href: location\.href/);
    assert.match(clientSource, /st\.originUrls\[a\.gid\] = s\.url/);
    assert.match(clientSource, /_originUrl/);
    assert.match(clientSource, /originUrls: \{\}/);
    assert.match(annotSource, /function samePageHref\(/);
    assert.match(annotSource, /pageOk/);
    // 清除按钮：存在于面板、append 顺序在 chevron 之前（DOM 顺序 = 图标左侧）
    assert.match(annotSource, /data-dsh-kit-panel-clear/);
    assert.match(
      annotSource,
      /header\.append\(icon, title, panelCount, clearBtn, panelChevron\)/,
      "清除按钮必须 append 在展开/收起图标左侧（悬浮 popout 的 header.append 不算）",
    );
    // clearAll 语义：写删除日志（否则共享会话下其他窗口 1.5s 后会被推回来）
    assert.match(annotSource, /function clearAllAnnots\(/);
    assert.match(annotSource, /clearAll: function \(/);
    const clearAllBody = annotSource.match(/function clearAllAnnots\(\) \{[\s\S]*?\n  \}/);
    assert.ok(clearAllBody, "clearAllAnnots 函数体可定位");
    assert.match(clearAllBody[0], /__dshKitDeletedGids/);
  });

  await t.test("P29：REMOTE_CONTRIBUTION 必须声明 saveMerged（face 装配缺口回归钉）+ gui-eval 诊断", () => {
    // 1.4.x 实测：wire.host 有 7 方法但 client 只 mount 6 个 → mergeAndSave 抛
    // 「svc.saveMerged is not a function」→ 提交静默失败、输入框提示永不触发
    assert.match(clientSource, /\['saveMerged', \['sets', 'meta'\]/);
    assert.match(clientSource, /case 'gui-eval'/);
    assert.match(clientSource, /lastPrime: stateRef\.lastPrime/);
  });

  await t.test("胶囊（ZCode 式）：输入框卡片内侧 + 会话指纹门控（P31 跨会话不泄漏）", () => {
    assert.match(clientSource, /dsh-kit-annot-chip/);
    assert.match(clientSource, /mode: 'saved', count/); // announceSubmission 挂 saved 模型
    assert.match(clientSource, /const ensureAnnotChip = \(\) =>/);
    assert.match(clientSource, /svc\.deleteAnnotations\(m\.path\)/); // × 撤回
    assert.match(clientSource, /clearAll \? window\.__dshKitAnnotator\.clearAll\(\) : undefined/); // × 清除（会话中）
    // 会话指纹：document.title（去宿主后缀）建模时捕获、渲染前比对，切会话即隐藏
    assert.match(clientSource, /const convoTitle = \(\) => \(document\.title \|\| ''\)\.replace/);
    assert.match(clientSource, /model\.convo !== convoTitle\(\)/);
    assert.match(clientSource, /convo: convoTitle\(\)/);
    // 位置：ZCode 式独占一行——卡片内 data-inputScroll 前插 30px 占位行，胶囊悬于其上，正文不遮挡
    assert.match(clientSource, /dsh-kit-annot-spacer/);
    assert.match(clientSource, /ce\.closest\('\[data-inputScroll\]'\)/);
    assert.match(clientSource, /const removeChipSpacer = \(\) =>/);
    assert.match(clientSource, /removeChipSpacer\(\)/);
    // 双主题：胶囊只走主题令牌（T.bg/T.border/T.text/T.shadow），零字面底色；× hover 走令牌样式表
    assert.match(clientSource, /background:' \+ T\.bg \+ ';border:1px solid ' \+ T\.border/);
    assert.match(clientSource, /dsh-kit-annot-chip-style/);
    assert.match(clientSource, /--dsw-alias-interactive-bg-hover/);
    // 调试面板：默认隐藏可唤出（panel-toggle 命令 + localStorage 持久化；探测/上报等功能保留）
    assert.match(clientSource, /dsh-browser-kit:panel:hidden:v1/);
    assert.match(clientSource, /case 'panel-toggle'/);
    assert.match(clientSource, /PANEL_TOGGLE_EVENT/);
  });

  await t.test("W3：client descriptors ↔ wire FACE_METHOD_TABLE 逐字对账（P29 防复发）", async () => {
    // P29 实测：两端清单漂移 = face 调用静默失败。此测试把漂移变成红灯。
    const wire = await import("../plugin/wire.host.mjs");
    const wireMethods = wire.TYPERT.invocations.map((i) => ({ id: i.id, params: i.parameters.map((p) => ({ name: p.name, acceptsUndefined: !!p.acceptsUndefined })) }));
    // 从 client.js 源提取 REMOTE_CONTRIBUTION.descriptors 行：['method', ['a','b'], "sig（可含单引号）", ['opt']]
    const descRe = /\['([A-Za-z]+)', \[([^\]]*)\], (?:"[^"]*"|'(?:[^'\\]|\\.)*'), \[([^\]]*)\]\]/g;
    const clientMethods = [];
    let m;
    while ((m = descRe.exec(clientSource)) !== null) {
      const params = m[2].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean);
      const optionals = m[3].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean);
      clientMethods.push({
        id: `@local/dsh-browser-kit#dshBrowserKit/${m[1]}`,
        params: params.map((name) => ({ name, acceptsUndefined: optionals.includes(name) })),
      });
    }
    assert.ok(clientMethods.length >= 10, `client descriptors 至少 10 个（实际 ${clientMethods.length}）`);
    assert.deepEqual(clientMethods, wireMethods, "client descriptors 与 wire TYPERT 必须逐字一致（方法序、参数名、可选标记）");
  });

  await t.test("A6：switch case 标签唯一性（F2 复发钉）+ guest-eval document 参数遮蔽（P23 回归钉）", () => {
    // A6a：executeCommand 的 switch 里每个 case 只能出现一次（page-inject 曾复制成死分支）
    const caseLabels = [...clientSource.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]);
    const dup = caseLabels.filter((v, i) => caseLabels.indexOf(v) !== i);
    assert.deepEqual(dup, [], `executeCommand 内重复的 case 标签：${dup.join(",")}`);
    // A6b：guest-eval 的 document 必须经函数参数传入（P23：var 遮蔽会让函数体内 document=undefined）；
    // docExpr 按 frame 分支解析成表达式（cmd-99/101 回归）
    assert.match(clientSource, /return \(function \(document\) \{\\n\$\{code\}\\n\}\)\(\$\{docExpr\}\)/);
    assert.match(clientSource, /docExpr/);
  });
});
