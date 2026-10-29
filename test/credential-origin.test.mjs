/**
 * 凭据 origin 匹配 —— **行为钉**（审查报告 F04 反例 ✓）。
 *
 * 核心反例：`https://review.example/login` 保存的凭据**不得**匹配 `http://review.example/login` ✗。
 * 另外验证端口/子域/opaque origin 与协议降级条目全部不匹配，且这些判定在 client 内嵌副本里同样成立（parity ✓）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { credMatchOf, credPageAllowed, credEntryMatches, originInfoOf, CRED_SAFE_SCHEMES } from "../src/credential-origin.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (p) => readFileSync(join(root, p), "utf8");
const entry = (origin) => ({ origin, username: "u", password: "p" });

test("F04 反例：HTTPS 凭据不得匹配 HTTP 页面（协议降级 ✗）", () => {
  const list = [entry("https://review.example")];
  assert.equal(credMatchOf(list, "http://review.example/login"), null, "http 页面不得拿到 https 凭据 ✗");
  assert.equal(credMatchOf(list, "https://review.example/login")?.origin, "https://review.example", "同 origin 仍应匹配 ✓");
});

test("F04：端口/主机/子域变化均不匹配（origin 级而非 host 级 ✓）", () => {
  const list = [entry("https://review.example")];
  assert.equal(credMatchOf(list, "https://review.example:8443/login"), null, "端口不同不匹配 ✗");
  assert.equal(credMatchOf(list, "https://sub.review.example/login"), null, "子域不匹配 ✗");
  assert.equal(credMatchOf(list, "https://review.example.evil.com/login"), null, "后缀伪装不匹配 ✗");
});

test("协议不安全的**条目**不参与匹配（除非显式 allowHttp ✓）", () => {
  const httpEntry = [entry("http://review.example")];
  assert.equal(credMatchOf(httpEntry, "https://review.example"), null, "http 条目不得用于 https 页面 ✗");
  assert.equal(credMatchOf(httpEntry, "http://review.example", { allowHttp: true })?.origin, "http://review.example", "显式 allowHttp 才允许 ✓");
});

test("opaque / 非法 / 空 URL 一律不匹配（不猜测 ✗）", () => {
  const list = [entry("https://review.example")];
  for (const bad of ["about:blank", "data:text/html,x", "", null, undefined, "not a url", 42]) {
    assert.equal(credMatchOf(list, bad), null, `${String(bad)} 不得匹配 ✗`);
  }
  assert.equal(credMatchOf([entry("garbage")], "https://review.example"), null, "条目 origin 非法不匹配 ✗");
  assert.equal(credMatchOf(null, "https://review.example"), null);
  assert.equal(credMatchOf([], "https://review.example"), null);
});

test("辅助函数语义（页面许可 / 条目匹配 / origin 解析 ✓）", () => {
  assert.equal(credPageAllowed("https://a.example/x").ok, true);
  assert.equal(credPageAllowed("http://a.example/x").ok, false);
  assert.equal(credPageAllowed("http://a.example/x", { allowHttp: true }).ok, true);
  assert.equal(credPageAllowed("about:blank").ok, false);
  assert.equal(credEntryMatches("https://a.example", "https://a.example"), true);
  assert.equal(credEntryMatches("https://a.example", "https://a.example:8443"), false);
  assert.deepEqual(originInfoOf("https://a.example:8443/p").origin, "https://a.example:8443");
  assert.deepEqual(CRED_SAFE_SCHEMES, ["https:"]);
});

test("parity：client.js 内嵌副本与正典逐例同结果（A1 模式 ✓）", () => {
  const client = readText("plugin/client.js");
  const m = client.match(/\/\* @credential-origin-canonical-begin[\s\S]*?\/\* @credential-origin-canonical-end \*\//);
  assert.ok(m, "client.js 必须保留 @credential-origin-canonical 内嵌块 ✓");
  const embedded = new Function(
    `${m[0].replace(/^[\s\S]*?\*\//, "").replace(/\/\* @credential-origin-canonical-end \*\//, "")}; return { credMatchOf, credPageAllowed, credEntryMatches };`,
  )();
  const list = [entry("https://review.example"), entry("http://plain.example")];
  const cases = [
    ["https://review.example/login", undefined],
    ["http://review.example/login", undefined],
    ["https://review.example:8443/login", undefined],
    ["http://plain.example/x", undefined],
    ["http://plain.example/x", { allowHttp: true }],
    ["about:blank", undefined],
    ["https://review.example.evil.com/", undefined],
  ];
  for (const [url, opts] of cases) {
    assert.equal(embedded.credMatchOf(list, url, opts)?.origin, credMatchOf(list, url, opts)?.origin, `${url} 匹配结果必须一致 ✓`);
    assert.equal(embedded.credPageAllowed(url, opts).ok, credPageAllowed(url, opts).ok, `${url} 许可判定必须一致 ✓`);
  }
});
