/**
 * dsh-browser-kit — annotations-protocol.js
 *
 * 批注协议 v2（`# Web page annotations:`）：build ↔ parse 无损对偶。
 * 纯函数 ESM，Node 可直接单测（`node --test`），浏览器侧由 element-annotator.js 内嵌同构副本。
 *
 * 归属：字段布局与往返解析移植自 ZCode（github.com/zai-org/ZCode）
 *   packages/ui/src/lib/webElementContext.ts，Copyright 2026 Z.AI Co., Ltd，Apache-2.0。
 * v2 修改点（相对 v1 `# Web page elements:`）：
 *   - 每条批注增加 `Note:`（意见，可缺席）与 `Status:`（失效标记）两个批注级行；
 *   - parse 升级为无损：还原 Rect / Attributes（v1 parse 丢弃这两者）；
 *   - 行字段截断改为行内 `[truncated]`（v1 在行字段里插 `\n\n[truncated]` 会破坏行式解析）；
 *   - URL/Title 缺席时整行省略（对齐调研文档 §5.2 样例 Annotation 2）；
 *   - 宿主耦合字段（workspacePath/workspaceIdentity）移除。
 */

const BLOCK_TITLE = "# Web page annotations";
const MAX_MARKDOWN_FIELD_LENGTH = 8000;
export const STALE_MARKER = "[element no longer matched]";

/** Annotation = { index, note?, element: Payload, stale? }；element 见 README/调研文档 §5.2（与 ZCode payload 同构，去 workspace 字段）。 */

// ---------------------------------------------------------------- build 侧

function truncateFencedValue(value) {
  if (!value) {
    return "";
  }
  const normalized = String(value).trim();
  return normalized.length > MAX_MARKDOWN_FIELD_LENGTH
    ? `${normalized.slice(0, MAX_MARKDOWN_FIELD_LENGTH)}\n\n[truncated]`
    : normalized;
}

/** 行字段：压成单行，超限行内截断（不插入换行，保证 `Label: value` 行式解析不被破坏）。 */
function truncateLineValue(value) {
  if (!value) {
    return "";
  }
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized.length > MAX_MARKDOWN_FIELD_LENGTH
    ? `${normalized.slice(0, MAX_MARKDOWN_FIELD_LENGTH)} [truncated]`
    : normalized;
}

function appendOptionalLine(lines, label, value) {
  const normalized = truncateLineValue(value);
  if (normalized) {
    lines.push(`${label}: ${normalized}`);
  }
}

function formatAttributes(attributes) {
  if (!attributes || typeof attributes !== "object" || Object.keys(attributes).length === 0) {
    return "";
  }
  return Object.entries(attributes)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
}

function formatFont(style) {
  if (!style || (!style.fontSize && !style.fontFamily)) {
    return "";
  }
  return [style.fontSize, style.fontFamily].filter(Boolean).join(" ");
}

function buildAnnotationItem(annotation, position) {
  const index =
    Number.isInteger(annotation?.index) && annotation.index > 0 ? annotation.index : position + 1;
  const element = annotation?.element ?? {};

  const lines = [`## Annotation ${index}`];

  const note = truncateLineValue(annotation?.note);
  if (note) {
    lines.push(`Note: ${note}`);
  }
  if (annotation?.stale) {
    lines.push(`Status: ${STALE_MARKER}`);
  }

  appendOptionalLine(lines, "URL", element.pageUrl);
  appendOptionalLine(lines, "Title", element.pageTitle);
  lines.push(`Tag: ${String(element.tagName ?? "").toLowerCase()}`);
  appendOptionalLine(lines, "Role", element.role);
  appendOptionalLine(lines, "Accessible name", element.accessibleName);
  appendOptionalLine(lines, "Selector", element.selector);
  appendOptionalLine(lines, "XPath", element.xpath);
  appendOptionalLine(lines, "Attributes", formatAttributes(element.attributes));
  appendOptionalLine(lines, "Color", element.style?.color);
  appendOptionalLine(lines, "Background", element.style?.backgroundColor);
  appendOptionalLine(lines, "Font", formatFont(element.style));
  appendOptionalLine(lines, "Font weight", element.style?.fontWeight);
  appendOptionalLine(lines, "Display", element.style?.display);

  if (element.rect) {
    lines.push(
      `Rect: x=${Math.round(element.rect.x)}, y=${Math.round(element.rect.y)}, width=${Math.round(element.rect.width)}, height=${Math.round(element.rect.height)}`,
    );
  }

  const text = truncateFencedValue(element.text);
  if (text) {
    lines.push("", "Text:", "```", text, "```");
  }

  const nearbyText = truncateFencedValue(element.nearbyText);
  if (nearbyText) {
    lines.push("", "Nearby context:", "```", nearbyText, "```");
  }

  const htmlExcerpt = truncateFencedValue(element.htmlExcerpt);
  if (htmlExcerpt) {
    lines.push("", "HTML excerpt:", "```html", htmlExcerpt, "```");
  }

  return lines.join("\n");
}

/**
 * buildAnnotationsMarkdown(annotations) => string
 * 空列表返回空串（不产出空协议块）。
 */
export function buildAnnotationsMarkdown(annotations) {
  if (!Array.isArray(annotations) || annotations.length === 0) {
    return "";
  }
  const items = annotations.map((annotation, position) => buildAnnotationItem(annotation, position));
  return [`${BLOCK_TITLE}: ${annotations.length}`, "", items.join("\n\n")].join("\n");
}

// ---------------------------------------------------------------- parse 侧

function readField(rawItem, label) {
  const match = new RegExp(`^${label}:[ \\t]*(.*)$`, "m").exec(rawItem);
  return match?.[1]?.trim() ?? "";
}

function readFencedSection(rawItem, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `${escapedLabel}:[ \\t]*\\n\`\`\`(?:html)?[ \\t]*\\n([\\s\\S]*?)\\n\`\`\``,
    "m",
  ).exec(rawItem);
  return match?.[1]?.trim() ?? "";
}

/**
 * 定位首个围栏段（Text / Nearby context / HTML excerpt）的起始行。
 * 行字段只在该行之前的头部区读取——防止正文围栏内容里出现 `Note:` / `Title:` 等字样被误读为字段。
 */
function readHeaderSection(rawItem) {
  const fenceStart = rawItem.search(/(^|\n)(Text|Nearby context|HTML excerpt):[ \t]*\n```/);
  return fenceStart >= 0 ? rawItem.slice(0, fenceStart) : rawItem;
}

function parseFontSummary(font) {
  const match = /^([0-9.]+(?:px|rem|em|pt|%))\s+(.+)$/iu.exec(font);
  if (!match) {
    return { fontFamily: font };
  }
  const fontSize = match[1];
  const fontFamily = match[2];
  if (!fontSize || !fontFamily) {
    return { fontFamily: font };
  }
  return { fontSize, fontFamily };
}

function readStyleSummary(header) {
  const color = readField(header, "Color");
  const backgroundColor = readField(header, "Background");
  const font = readField(header, "Font");
  const fontWeight = readField(header, "Font weight");
  const display = readField(header, "Display");
  const style = {
    ...(color ? { color } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(font ? parseFontSummary(font) : {}),
    ...(fontWeight ? { fontWeight } : {}),
    ...(display ? { display } : {}),
  };
  return Object.keys(style).length > 0 ? style : undefined;
}

function parseAttributes(header) {
  const raw = readField(header, "Attributes");
  if (!raw) {
    return undefined;
  }
  const attributes = {};
  const pairPattern = /([^\s=]+)=("(?:[^"\\]|\\.)*")/g;
  let match;
  while ((match = pairPattern.exec(raw)) !== null) {
    try {
      attributes[match[1]] = JSON.parse(match[2]);
    } catch {
      // 单个键值非法时跳过，不影响其余键值
    }
  }
  return Object.keys(attributes).length > 0 ? attributes : undefined;
}

function parseRect(header) {
  const raw = readField(header, "Rect");
  if (!raw) {
    return undefined;
  }
  const match =
    /x=(-?[\d.]+),\s*y=(-?[\d.]+),\s*width=(-?[\d.]+),\s*height=(-?[\d.]+)/.exec(raw);
  if (!match) {
    return undefined;
  }
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4]),
  };
}

function parseAnnotationItem(rawItem, position) {
  const header = readHeaderSection(rawItem);

  const headerMatch = /^## Annotation\s+(\d+)/m.exec(rawItem);
  const index = headerMatch ? Number(headerMatch[1]) : position + 1;

  const note = readField(header, "Note") || undefined;
  const status = readField(header, "Status");
  const stale = status.trim() === STALE_MARKER || undefined;

  const element = {
    pageUrl: readField(header, "URL") || undefined,
    pageTitle: readField(header, "Title") || undefined,
    tagName: readField(header, "Tag").toLowerCase() || "",
    role: readField(header, "Role") || undefined,
    accessibleName: readField(header, "Accessible name") || undefined,
    selector: readField(header, "Selector") || undefined,
    xpath: readField(header, "XPath") || undefined,
    text: readFencedSection(rawItem, "Text") || undefined,
    nearbyText: readFencedSection(rawItem, "Nearby context") || undefined,
    htmlExcerpt: readFencedSection(rawItem, "HTML excerpt") || undefined,
    attributes: parseAttributes(header),
    rect: parseRect(header),
    style: readStyleSummary(header),
    capturedAt: 0,
  };

  return { index, ...(note ? { note } : {}), element, ...(stale ? { stale } : {}) };
}

/**
 * parseAnnotationsMarkdown(text) => { annotations, visibleContent }
 * - CRLF / CR 容忍（入口统一归一化为 \n）；
 * - 未找到协议块时 annotations 为空、visibleContent 为原文；
 * - 条目以 `## Annotation k` 分割，字段缺失容忍（手工编辑的文本也能解出）。
 */
export function parseAnnotationsMarkdown(text) {
  const content = typeof text === "string" ? text : "";
  const normalized = content.replace(/\r\n?/g, "\n");

  const blockMatch = /(?:^|\n\n)# Web page annotations:[ \t]*(\d+)?[ \t]*\s*\n\n([\s\S]*?)\s*$/.exec(
    normalized,
  );
  if (!blockMatch || blockMatch[2] === undefined) {
    return { annotations: [], visibleContent: normalized };
  }

  const rawItems = blockMatch[2]
    .split(/\n(?=## Annotation(?:\s+\d+)?\n)/)
    .map((item) => item.trim())
    .filter(Boolean);

  const annotations = [];
  rawItems.forEach((item, position) => {
    const parsed = parseAnnotationItem(item, position);
    if (parsed) {
      annotations.push(parsed);
    }
  });

  return { annotations, visibleContent: normalized.slice(0, blockMatch.index).trimEnd() };
}
