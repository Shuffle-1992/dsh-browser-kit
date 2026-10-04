/**
 * test/annotator-protocol-parity.test.js — 批注层内嵌协议 builder 与 ESM 协议逐字对拍（防漂移）
 *
 * element-annotator.js 为自包含 IIFE，无法 import ESM 协议模块，因此内嵌 buildAnnotationsMarkdown
 * 副本。本测试在 Node vm 中加载批注层，用相同输入分别产出并做字符串全等断言；
 * 一旦两处实现漂移立即红灯。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, evalScriptFile } from "./helpers/sandbox.mjs";
import { projectRoot } from "./helpers/chrome.mjs";
import {
  buildAnnotationsMarkdown,
  parseAnnotationsMarkdown,
} from "../src/annotations-protocol.js";

const ANNOTATOR_PATH = `${projectRoot}/src/element-annotator.js`;

function loadAnnotator() {
  const sandbox = createSandbox();
  evalScriptFile(sandbox, ANNOTATOR_PATH);
  const buildInPage = sandbox.window.__dshKitAnnotator?._protocol?.buildAnnotationsMarkdown;
  assert.equal(typeof buildInPage, "function", "批注层应暴露 _protocol 测试对拍口");
  return buildInPage;
}

const cases = [
  {
    name: "全字段 + Note",
    annotations: [
      {
        index: 1,
        note: "这个按钮太小，加大 padding 和字号",
        element: {
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
          attributes: { id: "submit", class: "btn primary" },
          rect: { x: 120, y: 840, width: 180, height: 48 },
          style: { color: "#FFFFFF", backgroundColor: "#2563EB", fontSize: "16px", fontFamily: "Inter", fontWeight: "600", display: "flex" },
        },
      },
    ],
  },
  {
    name: "极简条目（无 URL/Title，无 Note）",
    annotations: [
      {
        element: {
          tagName: "div",
          selector: "main > section.pricing > div.card:nth-of-type(2)",
          rect: { x: 64, y: 210, width: 380, height: 420 },
        },
      },
    ],
  },
  {
    name: "stale 标记",
    annotations: [{ index: 3, note: "已重构", element: { tagName: "section" }, stale: true }],
  },
  {
    name: "多条 + 截断",
    annotations: [
      { note: "x".repeat(8500), element: { tagName: "div", text: "y".repeat(9000) } },
      { element: { tagName: "span", nearbyText: "s".repeat(30) } },
    ],
  },
];

test("内嵌 builder 与 ESM 协议逐字一致（全 case）", () => {
  const buildInPage = loadAnnotator();
  for (const testCase of cases) {
    const fromPage = buildInPage(testCase.annotations);
    const fromEsm = buildAnnotationsMarkdown(testCase.annotations);
    assert.equal(fromPage, fromEsm, `case「${testCase.name}」两处 builder 输出不一致`);
  }
});

/** deepStrictEqual 会比较 undefined 值键；parse 输出含全量 undefined 字段，比较前剔除。 */
function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

test("内嵌 builder 产出可被 ESM parse 无损还原（round-trip 联动）", () => {
  const buildInPage = loadAnnotator();
  // 截断是有损设计（>8000 加 [truncated]），其行为由 annotations-protocol.test.js 单测覆盖；
  // 本测试用未触发截断的用例验证 build→parse 无损对偶。
  const roundTripCases = [
    cases[0],
    cases[1],
    cases[2],
    {
      name: "多条长文本（未触发截断）",
      annotations: [
        { note: "z".repeat(5000), element: { tagName: "div", text: "y".repeat(5000) } },
        { element: { tagName: "span", nearbyText: "s".repeat(30) } },
      ],
    },
  ];
  for (const testCase of roundTripCases) {
    const markdown = buildInPage(testCase.annotations);
    const parsed = parseAnnotationsMarkdown(markdown);
    assert.equal(parsed.annotations.length, testCase.annotations.length, testCase.name);
    testCase.annotations.forEach((input, i) => {
      const out = parsed.annotations[i];
      assert.equal(out.index, input.index ?? i + 1, testCase.name);
      assert.equal(out.note ?? undefined, input.note ?? undefined, testCase.name);
      assert.equal(out.stale ?? undefined, input.stale ?? undefined, testCase.name);
      const { capturedAt: _ignored, ...expected } = input.element;
      assert.deepEqual(compact(out.element), { ...compact(expected), capturedAt: 0 }, testCase.name);
    });
  }
});
