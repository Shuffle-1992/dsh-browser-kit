/**
 * 工具使用规范回归钉子（硬性规范：自持浏览器默认小窗静默操作，非必要不开大窗）。
 *
 * 规范是**可检查的产物**：工具 description（模型可见） + 展开时工具结果回显 + 文档。
 * 谁把规范删了/改弱了，这里立刻变红 ⇒ 不允许"悄悄失效"。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const hostSrc = readFileSync(new URL("../plugin/browser-tools.host.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const docs = readFileSync(new URL("../docs/tool-usage-rules.md", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("规范常量存在且写明「默认小窗静默操作 / 非必要不展开 / 用 screenshot 看全貌」", () => {
  assert.match(hostSrc, /export const TOOL_RULE_OWNED_SMALL_WINDOW =/, "缺少规范常量");
  const a = hostSrc.indexOf("export const TOOL_RULE_OWNED_SMALL_WINDOW");
  const body = hostSrc.slice(a, hostSrc.indexOf("export const BROWSER_TOOL_SPECS", a));
  assert.match(body, /默认小窗静默操作/, "规范必须写明默认小窗静默操作");
  assert.match(body, /非必要不展开/, "规范必须写明非必要不展开");
  assert.match(body, /op=screenshot/, "规范必须给出合规的替代动作（screenshot 内部临时展开并收回）");
  assert.match(body, /reason/, "规范必须要求 expand 给出 reason");
  assert.match(body, /collapse/, "规范必须要求用毕收回小窗");
});

test("browser_agent_window 的工具描述开头就是该规范（模型每次可见）", () => {
  const i = hostSrc.indexOf("name: 'browser_agent_window'");
  assert.ok(i > 0, "找不到 browser_agent_window 规格");
  const desc = hostSrc.slice(i, i + 1200);
  assert.match(desc, /【硬性工具规范】默认小窗静默操作/, "工具描述必须以硬性规范开头");
  assert.match(desc, /非必要不得 expand/, "工具描述必须写明非必要不得 expand");
  assert.match(desc, /仅当/, "工具描述必须写清例外条件");
});

test("op=expand 必须声明 reason 参数", () => {
  const i = hostSrc.indexOf("name: 'browser_agent_window'");
  const block = hostSrc.slice(i, hostSrc.indexOf("name: 'browser_check'", i));
  assert.match(block, /reason: \{ type: 'string', description: '[^']*op=expand 必填/, "reason 参数要标注 op=expand 必填");
});

test("展开时把规范回显进工具结果（未带 reason = 违规提示）", () => {
  assert.match(hostSrc, /let notice = null;/, "缺少 notice 装配");
  assert.match(hostSrc, /String\(params\.op \|\| ''\) === 'expand'/, "notice 只应在 expand 时出现");
  assert.match(hostSrc, /⚠️ 违反工具规范：本次 op=expand \*\*未提供 reason\*\*/, "未带 reason 必须明确标违规");
  assert.match(hostSrc, /\.\.\.\(notice \? \{ notice \} : \{\}\)/, "notice 必须真的进结果对象");
});

test("文档三处齐备（规范文件 / README 章节 / 评估文档引用）", () => {
  assert.ok(existsSync(new URL("../docs/tool-usage-rules.md", import.meta.url)), "docs/tool-usage-rules.md 必须存在");
  assert.match(docs, /自持浏览器默认\*\*小窗静默操作\*\*/, "规范文件要写清规范 1");
  assert.match(docs, /## 规范 1（硬性）/, "规范文件要有编号章节（便于引用）");
  assert.match(readme, /工具使用规范/, "README 必须有「工具使用规范」入口");
  assert.match(readme, /tool-usage-rules\.md/, "README 必须链接规范文件");
});
