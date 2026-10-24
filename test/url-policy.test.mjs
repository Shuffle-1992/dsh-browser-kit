/**
 * 导航 URL 策略 —— **行为钉**（review L-9 ✗：自持窗口原先没有协议过滤 ✓）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkNavUrl, ALLOWED_SCHEMES } from "../src/url-policy.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (p) => readFileSync(join(root, p), "utf8");

test("行为：只放行 http/https 与 about:blank ✓", () => {
  for (const ok of ["https://example.com", "http://127.0.0.1:5173/a?b=1#c", "about:blank", "about:blank#lease"]) {
    assert.equal(checkNavUrl(ok).ok, true, `${ok} 应放行 ✓`);
  }
  for (const bad of ["file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,<b>x", "chrome://settings", "about:config"]) {
    const r = checkNavUrl(bad);
    assert.equal(r.ok, false, `${bad} 应拒绝 ✗`);
    assert.ok(r.reason, `${bad} 必须给出原因 ✓`);
  }
});

test("行为：带**凭据**的 URL 一律拒绝（凭据不进日志/上下文 ✓）", () => {
  const r = checkNavUrl("https://user:pass@example.com/x");
  assert.equal(r.ok, false);
  assert.match(r.reason, /用户名|密码|凭据/);
});

test("行为：空值/畸形串拒绝且不抛 ✓", () => {
  for (const bad of ["", "   ", null, undefined, 42, "not a url", "//example.com"]) {
    const r = checkNavUrl(bad);
    assert.equal(r.ok, false, `${String(bad)} 应拒绝 ✗`);
  }
});

test("parity：client.js 内嵌副本与正典逐例同结果 ✓（自持窗口用的是同一道判定 ✓）", () => {
  const client = readText("plugin/client.js");
  const m = client.match(/\/\* @url-policy-canonical-begin[\s\S]*?\/\* @url-policy-canonical-end \*\//);
  assert.ok(m, "client.js 必须保留 @url-policy-canonical 内嵌块 ✓");
  const embedded = new Function(
    `${m[0].replace(/^[\s\S]*?\*\//, "").replace(/\/\* @url-policy-canonical-end \*\//, "")}; return checkNavUrl;`,
  )();
  const cases = [
    "https://example.com",
    "http://127.0.0.1:1/a",
    "about:blank",
    "file:///C:/x",
    "javascript:alert(1)",
    "https://u:p@example.com",
    "",
    null,
  ];
  for (const c of cases) {
    const want = checkNavUrl(c);
    const got = embedded(c);
    assert.equal(got.ok, want.ok, `${String(c)} 的 ok 必须一致 ✓`);
    if (!want.ok) assert.ok(got.reason, `${String(c)} 的副本也要给原因 ✓`);
  }
  assert.deepEqual(ALLOWED_SCHEMES, ["http:", "https:"]);
});

test("E1：导航只有**一处**实现（loadURL 单点 ✓ —— 两条路径分叉曾导致策略漏网 ✗）", () => {
  const client = readText("plugin/client.js");
  const sites = [...client.matchAll(/\.loadURL\(/g)].length;
  assert.equal(sites, 1, "`.loadURL(` 只应出现在 navigateAgentTab 一处 ✓");
  assert.match(client, /const navigateAgentTab = async \(tab, url\) => \{/, "必须有统一的 navigateAgentTab ✓");
  const at = client.indexOf("const navigateAgentView = async (url, opts) => {");
  assert.ok(at > 0, "必须能定位 navigateAgentView ✓");
  assert.match(client.slice(at, at + 1600), /await navigateAgentTab\(tab, url\);/, "navigateAgentView 必须复用 navigateAgentTab ✓（不得自己 loadURL ✗）");
});
