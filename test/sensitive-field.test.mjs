/**
 * 敏感字段脱敏 —— **行为钉**（审查报告 F05 反例 ✓）。
 *
 * 反例：自动填充后的密码**不得**经 `browser_element_info` / `browser_snapshot` 回到 Agent 上下文 ✗。
 * 同时如实钉住边界：本模块只管**默认读取路径**；页内 `eval` 仍可读表单 ✗（产品承诺已收敛为"默认工具出口不返回"）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isSensitiveField, maskValueIfSensitive, MASKED_VALUE, SENSITIVE_HINTS, SENSITIVE_AUTOCOMPLETE } from "../src/sensitive-field.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (p) => readFileSync(join(root, p), "utf8");

test("F05 反例：密码框的值必须脱敏（默认读取路径 ✗ 外泄）", () => {
  assert.equal(isSensitiveField({ type: "password" }), true);
  assert.equal(maskValueIfSensitive("hunter2-sentinel", true), MASKED_VALUE);
  assert.equal(maskValueIfSensitive("hunter2-sentinel", false), "hunter2-sentinel", "非敏感字段原样返回 ✓");
});

test("autocomplete 敏感标记（密码/信用卡/一次性码 ✓）", () => {
  for (const ac of SENSITIVE_AUTOCOMPLETE) {
    assert.equal(isSensitiveField({ type: "text", autocomplete: ac }), true, `${ac} 应判敏感 ✗`);
    assert.equal(isSensitiveField({ type: "text", autocomplete: `section-x ${ac}` }), true, `组合标记 ${ac} 应判敏感 ✗`);
  }
  assert.equal(isSensitiveField({ type: "text", autocomplete: "email" }), false, "普通 email 不敏感 ✓");
});

test("name/id/placeholder 提示词命中即敏感（含中文 ✓）", () => {
  for (const h of SENSITIVE_HINTS) {
    assert.equal(isSensitiveField({ name: `user_${h}_x` }), true, `name 含 ${h} 应敏感 ✗`);
    assert.equal(isSensitiveField({ id: `id-${h}` }), true, `id 含 ${h} 应敏感 ✗`);
  }
  assert.equal(isSensitiveField({ placeholder: "请输入密码" }), true);
  assert.equal(isSensitiveField({ placeholder: "请输入验证码" }), true);
  assert.equal(isSensitiveField({ placeholder: "Search" }), false, "普通输入不敏感 ✓");
  assert.equal(isSensitiveField({}), false);
  assert.equal(isSensitiveField(null), false, "空对象不抛 ✓");
});

test("空值不伪装成脱敏（区分「空」与「已隐藏」✓）", () => {
  assert.equal(maskValueIfSensitive("", true), "");
  assert.equal(maskValueIfSensitive(null, true), null);
  assert.equal(maskValueIfSensitive(undefined, true), undefined);
});

test("parity：client.js 页内片段与正典逐例同判定（A1 模式 ✓）", () => {
  const client = readText("plugin/client.js");
  const m = client.match(/\/\* @sensitive-field-canonical-begin[\s\S]*?\/\* @sensitive-field-canonical-end \*\//);
  assert.ok(m, "client.js 必须保留 @sensitive-field-canonical 内嵌块 ✓");
  const src = new Function(
    `${m[0].replace(/^[\s\S]*?\*\//, "").replace(/\/\* @sensitive-field-canonical-end \*\//, "")}; return SENSITIVE_FIELD_SRC;`,
  )();
  assert.ok(typeof src === "string" && src.includes("__dshIsSensitive"), "内嵌块必须产出页内判定片段 ✓");
  const inPage = new Function(`${src}; return { isS: __dshIsSensitive, mask: __dshMask };`)();
  const stub = (f) => ({
    type: f.type,
    name: f.name,
    id: f.id,
    getAttribute: (k) => (k === "type" ? f.type ?? null : k === "autocomplete" ? f.autocomplete ?? null : k === "placeholder" ? f.placeholder ?? null : null),
  });
  const cases = [
    { type: "password" },
    { type: "text", autocomplete: "current-password" },
    { type: "text", autocomplete: "one-time-code" },
    { type: "text", autocomplete: "email" },
    { name: "user_password" },
    { id: "cvv" },
    { placeholder: "请输入密码" },
    { placeholder: "搜索" },
    {},
  ];
  for (const f of cases) {
    assert.equal(inPage.isS(stub(f)), isSensitiveField(f), `判定必须一致：${JSON.stringify(f)} ✗`);
  }
  assert.equal(inPage.mask("sentinel", true), MASKED_VALUE, "页内脱敏值必须一致 ✓");
  assert.equal(inPage.mask("sentinel", false), "sentinel");
});

test("两处读取端都已接线（元素档案 + 快照 ✓）", () => {
  const client = readText("plugin/client.js");
  const element = client.slice(client.indexOf("'element': async function"), client.indexOf("'check': async function"));
  assert.match(element, /__dshIsSensitive\(el\)/, "元素档案必须调用敏感判定 ✓");
  assert.match(element, /__dshMask\(el\.value, __sens\)/, "元素档案必须脱敏值 ✓");
  assert.match(element, /sensitive: \(__sens \? true : null\)/, "元素档案必须标记 sensitive ✓");
  const snapshot = client.slice(client.indexOf("'snapshot': async function"), client.indexOf("'state': async function"));
  assert.match(snapshot, /\$\{SENSITIVE_FIELD_SRC\}/, "快照必须注入敏感判定片段 ✓");
  assert.match(snapshot, /__dshMask\(el\.value, __sens\)/, "快照必须脱敏值 ✓");
});
