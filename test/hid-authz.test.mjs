/**
 * HID 桥授权 —— **行为钉**（审查报告 F01 反例 ✓）。
 *
 * 反例：宿主把网页可写的 `__dshKitHidQueue` 当命令源 ✗ ——
 * ① 任何页面都能排 `hidOpen/hidRead/hidWrite` ✗；② 句柄 `hid-N` 全局递增**可猜** ✗（A 页句柄能被 B 页用 ✗）；
 * ③ 导航后旧句柄仍可用 ✗。修法：**默认拒绝** + origin 授权（带有效期 ✓）+ 句柄绑定 pane（不可猜 ✓）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hidOriginOfUrl,
  hidPaneKeyOf,
  hidDeviceKeyOf,
  hidAuthorizeOf,
  hidPruneGrantsOf,
  hidRevokeOf,
  hidAuthzCheckOf,
  hidHandleBindOf,
  hidHandleCheckOf,
  hidDenialOf,
  HID_GRANT_TTL_MS,
  HID_HANDLE_MAX,
  HID_CODES,
} from "../src/hid-authz.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (p) => readFileSync(join(root, p), "utf8");
const SITE = "https://device.example";
const OTHER = "https://evil.example";
const T0 = 1_700_000_000_000;

test("F01 反例：未授权的 origin 一律拒绝（旧实现任何页面都能用 ✗）", () => {
  const r = hidAuthzCheckOf({ grants: [], origin: SITE, now: T0 });
  assert.equal(r.allow, false);
  assert.equal(r.code, HID_CODES.NOT_AUTHORIZED);
  // 同一站点授权后放行 ✓
  const grants = hidAuthorizeOf({ grants: [], origin: SITE, now: T0 });
  const ok = hidAuthzCheckOf({ grants, origin: SITE, now: T0 + 1000 });
  assert.equal(ok.allow, true, "授权后必须放行 ✓");
  // 其它站点仍然拒绝 ✓（授权不串站 ✗）
  assert.equal(hidAuthzCheckOf({ grants, origin: OTHER, now: T0 + 1000 }).allow, false);
});

test("F01：授权有**有效期**，过期自动拒绝（不构成长久信任 ✓）", () => {
  const grants = hidAuthorizeOf({ grants: [], origin: SITE, now: T0 });
  assert.equal(grants.length, 1);
  assert.equal(grants[0].expiresAt, T0 + HID_GRANT_TTL_MS);
  assert.equal(hidAuthzCheckOf({ grants, origin: SITE, now: T0 + HID_GRANT_TTL_MS - 1 }).allow, true, "未过期应放行 ✓");
  const expired = hidAuthzCheckOf({ grants, origin: SITE, now: T0 + HID_GRANT_TTL_MS + 1 });
  assert.equal(expired.allow, false, "过期必须拒绝 ✗");
  assert.equal(expired.code, HID_CODES.EXPIRED);
});

test("F01：非 http/https origin 一律不授权也不放行 ✓（file:/chrome:/about: ✗）", () => {
  for (const bad of ["", "file:///etc/passwd", "chrome://settings", "about:blank", "javascript:alert(1)", "data:text/html,x"]) {
    assert.equal(hidOriginOfUrl(bad), null, `${bad} 不应有 origin ✗`);
    assert.equal(hidAuthzCheckOf({ grants: hidAuthorizeOf({ grants: [], origin: bad, now: T0 }), origin: bad, now: T0 }).allow, false);
  }
  assert.equal(hidOriginOfUrl(`${SITE}/deep/path?q=1#h`), SITE, "应归一化为 origin ✓");
});

test("F01 反例：句柄**不可猜**且绑定 pane（A 的句柄不给 B ✗；导航后失配 ✓）", () => {
  const paneA = hidPaneKeyOf({ wcId: 11, origin: SITE });
  const paneB = hidPaneKeyOf({ wcId: 12, origin: SITE });
  const paneANav = hidPaneKeyOf({ wcId: 11, origin: OTHER }); // 同 pane 导航到别的站 ⇒ key 变 ✓
  assert.ok(paneA && paneB && paneANav);
  assert.notEqual(paneA, paneB);

  let handles = new Map();
  handles = hidHandleBindOf({ handles, handleId: "hid-abc123", paneKey: paneA, deviceKey: "dev-A", at: T0 });
  // 属主可用 ✓
  assert.equal(hidHandleCheckOf({ handles, handleId: "hid-abc123", paneKey: paneA }).allow, true);
  // 别的 pane 不能用 ✗（报告：跨 origin/句柄可猜 ✗）
  const cross = hidHandleCheckOf({ handles, handleId: "hid-abc123", paneKey: paneB });
  assert.equal(cross.allow, false);
  assert.equal(cross.code, HID_CODES.HANDLE_OTHER_PANE);
  // 导航后（origin 变）旧句柄失配 ✗
  assert.equal(hidHandleCheckOf({ handles, handleId: "hid-abc123", paneKey: paneANav }).allow, false);
  // 页面自己编一个句柄 id（未登记）⇒ 拒绝 ✗
  const forged = hidHandleCheckOf({ handles, handleId: "hid-1", paneKey: paneA });
  assert.equal(forged.allow, false);
  assert.equal(forged.code, HID_CODES.HANDLE_UNKNOWN);
});

test("F01：句柄表有上限（防无限增长 ✗）", () => {
  let handles = new Map();
  for (let i = 0; i < HID_HANDLE_MAX + 5; i += 1) {
    handles = hidHandleBindOf({ handles, handleId: `h-${i}`, paneKey: "wc:1|https://a.example", deviceKey: "d", at: T0 + i });
  }
  assert.equal(handles.size, HID_HANDLE_MAX, "句柄表必须有上限 ✓");
  assert.equal(handles.has("h-0"), false, "超出上限应丢最旧 ✓");
});

test("F01：撤销（单站 / 全部）与过期剪枝 ✓", () => {
  let grants = hidAuthorizeOf({ grants: [], origin: SITE, now: T0 });
  grants = hidAuthorizeOf({ grants, origin: OTHER, now: T0 });
  assert.equal(grants.length, 2);
  assert.equal(hidRevokeOf({ grants, origin: SITE, now: T0 }).length, 1, "撤销单站 ✓");
  assert.equal(hidRevokeOf({ grants, now: T0 }).length, 0, "不传 origin = 全部撤销 ✓");
  // 过期项在剪枝时被丢弃 ✓
  assert.equal(hidPruneGrantsOf(grants, T0 + HID_GRANT_TTL_MS + 1).length, 0);
});

test("F01：paneKey 需要 wcId + origin（缺一即 null ✗）", () => {
  assert.equal(hidPaneKeyOf({ wcId: 3, origin: SITE }), `wc:3|${SITE}`);
  assert.equal(hidPaneKeyOf({ wcId: null, origin: SITE }), null);
  assert.equal(hidPaneKeyOf({ wcId: 3, origin: "" }), null);
  assert.equal(hidPaneKeyOf({}), null);
  assert.equal(hidDeviceKeyOf("   "), null);
  assert.equal(hidDeviceKeyOf("a".repeat(400)), null);
  assert.equal(hidDeviceKeyOf("  dev-1  "), "dev-1");
});

test("F01：拒绝回执结构化且可诊断（页面/Agent 都能看懂 ✓）", () => {
  const d = hidDenialOf({ code: HID_CODES.NOT_AUTHORIZED, reason: "未授权" });
  assert.equal(d.ok, false);
  assert.equal(d.denied, HID_CODES.NOT_AUTHORIZED);
  assert.match(d.error, /未授权/);
  assert.match(d.hint, /browser_hid/);
});

test("parity：client 内嵌副本与正典逐例同结果（A1 模式 ✓）", () => {
  const client = readText("plugin/client.js");
  const m = client.match(/\/\* @hid-authz-canonical-begin[\s\S]*?\/\* @hid-authz-canonical-end \*\//);
  assert.ok(m, "client.js 必须保留 @hid-authz-canonical 内嵌块 ✓");
  const embedded = new Function(
    `${m[0].replace(/^[\s\S]*?\*\//, "").replace(/\/\* @hid-authz-canonical-end \*\//, "")}; return { hidOriginOfUrl, hidPaneKeyOf, hidDeviceKeyOf, hidAuthorizeOf, hidPruneGrantsOf, hidRevokeOf, hidAuthzCheckOf, hidHandleBindOf, hidHandleCheckOf, hidDenialOf, HID_CODES, HID_GRANT_TTL_MS };`,
  )();
  assert.equal(embedded.HID_GRANT_TTL_MS, HID_GRANT_TTL_MS);
  for (const u of [`${SITE}/a`, "file:///x", "about:blank", ""]) {
    assert.equal(embedded.hidOriginOfUrl(u), hidOriginOfUrl(u), "origin 归一化必须一致 ✓ " + u);
  }
  const grantsC = hidAuthorizeOf({ grants: [], origin: SITE, now: T0 });
  assert.deepEqual(embedded.hidAuthorizeOf({ grants: [], origin: SITE, now: T0 }), grantsC, "授权结构必须一致 ✓");
  for (const now of [T0, T0 + HID_GRANT_TTL_MS + 1]) {
    assert.deepEqual(
      embedded.hidAuthzCheckOf({ grants: grantsC, origin: SITE, now }),
      hidAuthzCheckOf({ grants: grantsC, origin: SITE, now }),
      "判定必须一致 ✓",
    );
  }
  let h = new Map();
  h = hidHandleBindOf({ handles: h, handleId: "x", paneKey: "wc:1|a", deviceKey: "d", at: T0 });
  const eh = embedded.hidHandleBindOf({ handles: new Map(), handleId: "x", paneKey: "wc:1|a", deviceKey: "d", at: T0 });
  assert.deepEqual([...eh.entries()], [...h.entries()]);
  assert.deepEqual(
    embedded.hidHandleCheckOf({ handles: eh, handleId: "x", paneKey: "wc:2|a" }),
    hidHandleCheckOf({ handles: h, handleId: "x", paneKey: "wc:2|a" }),
    "句柄判定必须一致 ✓",
  );
});

test("F01 接线：pump 先判授权、句柄校验、且提供授权入口 ✓", () => {
  const client = readText("plugin/client.js");
  const code = client.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // ① pump 里必须**先**判定授权，再调用 face ✓
  const iPump = code.indexOf("const pumpHidOnce = async () => {");
  const iAuthz = code.indexOf("hidAuthzCheckOf({ grants: hidGrants, origin, now: Date.now() })", iPump);
  const iCall = code.indexOf("await hidBridgeCall(svc, req)", iPump);
  assert.ok(iPump > 0 && iAuthz > iPump && iCall > iAuthz, "必须授权判定先于 face 调用 ✓");
  // ② 句柄类请求必须校验绑定 ✓
  assert.match(code, /hidHandleCheckOf\(\{ handles: hidHandles/, "pump 必须校验句柄归属 ✓");
  // ③ 拒绝要回结构化结果（不能静默丢弃 ✗）
  assert.match(code, /hidDenialOf\(authz\)/, "未授权必须回结构化拒绝 ✓");
  // ④ 授权入口（工具 → 命令）✓
  assert.match(code, /'hid-authz': async function/, "必须有单入口授权处理器 ✓");
  assert.match(code, /op === 'authorize'/, "必须支持 authorize ✓");
  assert.match(code, /op === 'revoke'/, "必须支持 revoke ✓");
  const host = readText("plugin/browser-tools.host.mjs");
  assert.match(host, /name: 'browser_hid'/, "宿主必须暴露授权工具 ✓");
  assert.match(host, /action: 'hid-authz'/, "工具必须路由到 hid-authz ✓");
  /* ⑥ **作用域钉子**（实机踩过 ✓）：内嵌正典与授权状态必须位于**共同父作用域** ——
   * 即出现在 `commandHandlers` 与 `pumpHidOnce` **两者之前** ✓。
   * 之前把它插在 HID pump 区域内 ✗ ⇒ 工具入口调用时报 `hidGrants is not defined` ✗（静态 parity 测试抓不到 ✓）。 */
  const iCanonScope = client.indexOf("@hid-authz-canonical-begin");
  const iStateScope = client.indexOf("const HID_GRANTS_KEY");
  const iHandlersScope = client.indexOf("const commandHandlers =");
  const iPumpScope = client.indexOf("const pumpHidOnce = async () =>");
  assert.ok(iCanonScope > 0 && iStateScope > iCanonScope, "内嵌正典与状态块都必须存在且顺序正确 ✓");
  assert.ok(iHandlersScope > 0 && iPumpScope > 0, "必须能定位 commandHandlers 与 pumpHidOnce ✓");
  assert.ok(iCanonScope < iHandlersScope && iStateScope < iHandlersScope, "正典/状态必须定义在 commandHandlers **之前**（否则工具入口看不到 ✗）");
  assert.ok(iCanonScope < iPumpScope && iStateScope < iPumpScope, "正典/状态必须定义在 pumpHidOnce **之前** ✓");
  /* 状态必须是**单一次**定义（多处 let 会各持一份 ⇒ 授权不共享 ✗） */
  assert.equal((client.match(/const HID_GRANTS_KEY/g) || []).length, 1, "HID_GRANTS_KEY 只能定义一次 ✓");
  // ⑤ 授权持久化（刷新后仍在，但会过期 ✓）
  assert.match(client, /HID_GRANTS_KEY/, "授权必须持久化 ✓");
});
