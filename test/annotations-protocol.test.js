/**
 * test/annotations-protocol.test.js — 协议 v2 round-trip 全分支
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAnnotationsMarkdown,
  parseAnnotationsMarkdown,
  STALE_MARKER,
} from "../src/annotations-protocol.js";

const fullPayload = {
  pageUrl: "http://localhost:5173/checkout",
  pageTitle: "结算页",
  tagName: "button",
  role: "button",
  accessibleName: "提交订单",
  selector: "#checkout > div.cart > button.submit",
  xpath: "/html/body/div[1]/main/section/div[2]/button[1]",
  text: "提交订单",
  nearbyText: "购物车汇总",
  htmlExcerpt: '<button class="submit">提交订单</button>',
  attributes: { id: "submit", class: "btn primary", "aria-label": "提交订单" },
  rect: { x: 120, y: 840, width: 180, height: 48 },
  style: {
    color: "#FFFFFF",
    backgroundColor: "#2563EB",
    fontFamily: "Inter, system-ui",
    fontSize: "16px",
    fontWeight: "600",
    display: "flex",
  },
  capturedAt: 1759574400000,
};

/** deepStrictEqual 会比较 undefined 值键；parse 输出含全量 undefined 字段，比较前剔除。 */
function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

/** 对比 parse 输出与输入（capturedAt 不进 markdown，parse 恒为 0）。 */
function expectRoundTrip(annotations) {
  const markdown = buildAnnotationsMarkdown(annotations);
  const parsed = parseAnnotationsMarkdown(markdown);
  assert.equal(parsed.annotations.length, annotations.length, "条数应一致");
  parsed.annotations.forEach((out, i) => {
    const input = annotations[i];
    assert.equal(out.index, input.index ?? i + 1);
    assert.equal(out.note ?? undefined, input.note ?? undefined);
    assert.equal(out.stale ?? undefined, input.stale ?? undefined);
    const { capturedAt: _dropped, ...expectedElement } = input.element;
    assert.deepEqual(compact(out.element), { ...compact(expectedElement), capturedAt: 0 });
  });
  return { markdown, parsed };
}

test("header 与计数：`# Web page annotations: N`", () => {
  const markdown = buildAnnotationsMarkdown([
    { element: { tagName: "div" } },
    { element: { tagName: "button" } },
  ]);
  assert.ok(markdown.startsWith("# Web page annotations: 2\n\n"), markdown);
  assert.ok(markdown.includes("## Annotation 1"));
  assert.ok(markdown.includes("## Annotation 2"));
});

test("全字段 + Note：round-trip 无损", () => {
  const { markdown, parsed } = expectRoundTrip([
    { index: 1, note: "这个按钮太小，加大 padding 和字号", element: fullPayload },
  ]);
  assert.ok(markdown.includes("Note: 这个按钮太小，加大 padding 和字号"));
  assert.ok(markdown.includes("Text:\n```\n提交订单\n```"));
  assert.ok(markdown.includes("HTML excerpt:\n```html"));
  // 字段顺序（Note 在元素信息前）
  assert.ok(markdown.indexOf("Note:") < markdown.indexOf("URL:"));
  assert.equal(parsed.visibleContent, "");
});

test("无 Note（快速引用等价形态）", () => {
  const { markdown, parsed } = expectRoundTrip([{ element: { ...fullPayload, capturedAt: 0 } }]);
  assert.ok(!markdown.includes("Note:"));
  assert.equal(parsed.annotations[0].note, undefined);
});

test("stale 标记：Status 行进块、parse 还原 stale=true", () => {
  const { markdown, parsed } = expectRoundTrip([
    { index: 2, element: { tagName: "div" }, stale: true },
  ]);
  assert.ok(markdown.includes(`Status: ${STALE_MARKER}`));
  assert.equal(parsed.annotations[0].stale, true);
});

test("字段截断 8000 + [truncated]（围栏字段）", () => {
  const longText = "字".repeat(9000);
  const markdown = buildAnnotationsMarkdown([{ element: { tagName: "div", text: longText } }]);
  assert.ok(markdown.includes("[truncated]"));
  const parsed = parseAnnotationsMarkdown(markdown);
  assert.equal(parsed.annotations[0].element.text, "字".repeat(8000) + "\n\n[truncated]");
  assert.equal(parsed.annotations[0].element.tagName, "div");
  assert.equal(parsed.annotations.length, 1);
});

test("字段截断 8000 + [truncated]（行字段，行内截断不破格式）", () => {
  const longSelector = "div" + " > span".repeat(4000);
  const markdown = buildAnnotationsMarkdown([
    { element: { tagName: "div", selector: longSelector } },
  ]);
  const selectorLine = markdown.split("\n").find((line) => line.startsWith("Selector: "));
  assert.ok(selectorLine, "Selector 应保持单行");
  assert.ok(selectorLine.includes("[truncated]"));
  const parsed = parseAnnotationsMarkdown(markdown);
  assert.equal(parsed.annotations[0].element.selector, longSelector.slice(0, 8000) + " [truncated]");
  assert.equal(parsed.annotations.length, 1);
});

test("Note 超长：压成单行并行内截断", () => {
  const longNote = "改 " + "这里间距统一 24px ".repeat(800);
  assert.ok(longNote.length > 8000, "用例应超过 8000 阈值");
  const markdown = buildAnnotationsMarkdown([{ note: longNote, element: { tagName: "div" } }]);
  const noteLine = markdown.split("\n").find((line) => line.startsWith("Note: "));
  assert.ok(noteLine, "Note 应保持单行");
  assert.ok(noteLine.includes("[truncated]"));
  const parsed = parseAnnotationsMarkdown(markdown);
  assert.ok(parsed.annotations[0].note.startsWith("改 这里间距统一 24px"));
});

test("CRLF 容忍：\\r\\n 与裸 \\r 归一化", () => {
  const markdown = buildAnnotationsMarkdown([
    { note: "间距 24px", element: { tagName: "div", text: "卡片" } },
  ]);
  const parsedCrlf = parseAnnotationsMarkdown(markdown.replace(/\n/g, "\r\n"));
  assert.equal(parsedCrlf.annotations.length, 1);
  assert.equal(parsedCrlf.annotations[0].note, "间距 24px");
  assert.equal(parsedCrlf.annotations[0].element.text, "卡片");
  const parsedCr = parseAnnotationsMarkdown(markdown.replace(/\n/g, "\r"));
  assert.equal(parsedCr.annotations.length, 1);
});

test("visibleContent：协议块前的消息正文保留", () => {
  const markdown = buildAnnotationsMarkdown([{ element: { tagName: "div" } }]);
  const message = "整体风格保持不变，按批注改\n\n" + markdown;
  const parsed = parseAnnotationsMarkdown(message);
  assert.equal(parsed.visibleContent, "整体风格保持不变，按批注改");
  assert.equal(parsed.annotations.length, 1);
});

test("空列表 / 无协议块 / 非字符串输入", () => {
  assert.equal(buildAnnotationsMarkdown([]), "");
  assert.equal(buildAnnotationsMarkdown(undefined), "");
  const empty = parseAnnotationsMarkdown("");
  assert.deepEqual(empty, { annotations: [], visibleContent: "" });
  const plain = parseAnnotationsMarkdown("没有协议块的普通消息");
  assert.deepEqual(plain, { annotations: [], visibleContent: "没有协议块的普通消息" });
  const invalid = parseAnnotationsMarkdown(null);
  assert.deepEqual(invalid, { annotations: [], visibleContent: "" });
});

test("极简条目（对齐调研文档样例 Annotation 2：无 URL/Title）", () => {
  const { markdown, parsed } = expectRoundTrip([
    {
      element: {
        tagName: "div",
        selector: "main > section.pricing > div.card:nth-of-type(2)",
        rect: { x: 64, y: 210, width: 380, height: 420 },
      },
    },
  ]);
  assert.ok(!markdown.includes("URL:"));
  assert.ok(!markdown.includes("Title:"));
  assert.ok(markdown.includes("Tag: div"));
  assert.ok(markdown.includes("Rect: x=64, y=210, width=380, height=420"));
  assert.equal(parsed.annotations[0].element.tagName, "div");
});

test("围栏正文里出现 Note:/Title: 字样不被误读为字段", () => {
  const markdown = buildAnnotationsMarkdown([
    {
      element: {
        tagName: "pre",
        text: "示例输出：\nNote: 这不是意见\nTitle: 也不是标题",
      },
    },
  ]);
  const parsed = parseAnnotationsMarkdown(markdown);
  assert.equal(parsed.annotations[0].note, undefined);
  assert.equal(
    parsed.annotations[0].element.text,
    "示例输出：\nNote: 这不是意见\nTitle: 也不是标题",
  );
});

test("Attributes 引号与转义无损", () => {
  const { parsed } = expectRoundTrip([
    {
      element: {
        tagName: "input",
        attributes: { title: 'He said "hi"', "aria-label": "a=b c", placeholder: "" },
      },
    },
  ]);
  assert.deepEqual(parsed.annotations[0].element.attributes, {
    title: 'He said "hi"',
    "aria-label": "a=b c",
    placeholder: "",
  });
});

test("Font 字段 parse 还原为 fontSize + fontFamily", () => {
  const markdown = buildAnnotationsMarkdown([{ element: { ...fullPayload, capturedAt: 0 } }]);
  const parsed = parseAnnotationsMarkdown(markdown);
  assert.deepEqual(parsed.annotations[0].element.style, {
    color: "#FFFFFF",
    backgroundColor: "#2563EB",
    fontSize: "16px",
    fontFamily: "Inter, system-ui",
    fontWeight: "600",
    display: "flex",
  });
});

test("手工编辑容忍：无计数头 + 字段缺失 + 索引还原", () => {
  const handWritten = [
    "# Web page annotations:",
    "",
    "## Annotation 7",
    "Tag: section",
    "Selector: main",
  ].join("\n");
  const parsed = parseAnnotationsMarkdown(handWritten);
  assert.equal(parsed.annotations.length, 1);
  assert.equal(parsed.annotations[0].index, 7);
  assert.equal(parsed.annotations[0].element.tagName, "section");
  assert.equal(parsed.annotations[0].element.selector, "main");
});
