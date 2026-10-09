/**
 * dsh-browser-kit — element-annotator.js
 *
 * 网页批注层：hover 高亮（ZCode picker 基座）+ capture 阶段事件拦截 + 元素 payload 全字段采集
 * + 批注模式扩展（编号徽标钉标 → 就地意见输入 → 页内批注面板 → 提交打包）。
 * 自包含 IIFE：Electron executeJavaScript / CDP 注入均可。
 *
 * 归属（Apache-2.0）：hover 高亮 overlay/popover、payload 采集（selector/xpath/attributes/style 等）
 * 与「函数即模板」注入方式移植自 ZCode（github.com/zai-org/ZCode）
 *   packages/ui/src/lib/webElementPickerScript.ts，
 *   Copyright 2026 Z.AI Co., Ltd。
 * 修改点：前缀改名 data-zcode-* → data-dsh-kit-* / __zcodeWebElementPicker → __dshKitAnnotator；
 *   移除 workspacePath 宿主耦合字段；新增批注状态机（调研文档 §5.2）。
 *
 * 交互状态机（调研文档 §5.2）：
 *   idle → picking（hover 高亮）
 *        → 点击元素：采集 payload → 左上角钉编号徽标（absolute + 文档坐标，滚动/缩放跟随）
 *                    → 就地意见输入框（textarea + 确认/删除，可留空）
 *        → Enter/确认：意见与元素绑定入列表，徽标变实心，继续 picking
 *        → 面板「提交」：打包 `# Web page annotations:` 协议块 → 剪贴板（保底）+ onSubmit 回调
 *   Esc / 取消：清理全部图层
 *   徽标交互：点击 → 重编辑/删除该条
 * 边界：意见框 keydown stopPropagation；批注态点击 capture 拦截；密码框跳过（iframe 内元素
 *   事件天然不可达，无需处理）；selector 失联 → 徽标置灰 + 提交标注 [element no longer matched]。
 */
(function () {
  "use strict";
  if (typeof window === "undefined") {
    return;
  }

  var STATE_KEY = "__dshKitAnnotator";
  var UI_FLAG = "data-dsh-kit-ui";
  var OVERLAY_FLAG = "data-dsh-kit-picker-overlay";
  var MARKER_FLAG = "data-dsh-kit-marker";
  var STALE_MARKER = "[element no longer matched]";
  var LIMITS = { maxTextChars: 4000, maxHtmlChars: 6000, maxAttributeChars: 500 };
  var ACCENT = "#2563eb";
  var STALE_COLOR = "#9ca3af";

  // 重注入护栏：先干净结束旧实例的会话
  var existing = window[STATE_KEY];
  if (existing && typeof existing.stop === "function") {
    try {
      existing.stop();
    } catch (_) {
      /* 旧实例清理失败不阻塞新实例 */
    }
  }

  // ================================================================
  // 协议 v2 builder（与 src/annotations-protocol.js 保持同步，
  // 由 test/annotator-protocol-parity.test.js 逐字对拍防漂移）
  // ================================================================

  var MAX_MARKDOWN_FIELD_LENGTH = 8000;

  function truncateFencedValue(value) {
    if (!value) {
      return "";
    }
    var normalized = String(value).trim();
    return normalized.length > MAX_MARKDOWN_FIELD_LENGTH
      ? normalized.slice(0, MAX_MARKDOWN_FIELD_LENGTH) + "\n\n[truncated]"
      : normalized;
  }

  function truncateLineValue(value) {
    if (!value) {
      return "";
    }
    var normalized = String(value).replace(/\s+/g, " ").trim();
    return normalized.length > MAX_MARKDOWN_FIELD_LENGTH
      ? normalized.slice(0, MAX_MARKDOWN_FIELD_LENGTH) + " [truncated]"
      : normalized;
  }

  function appendOptionalLine(lines, label, value) {
    var normalized = truncateLineValue(value);
    if (normalized) {
      lines.push(label + ": " + normalized);
    }
  }

  function formatAttributes(attributes) {
    if (!attributes || typeof attributes !== "object" || Object.keys(attributes).length === 0) {
      return "";
    }
    return Object.keys(attributes)
      .map(function (key) {
        return key + "=" + JSON.stringify(attributes[key]);
      })
      .join(" ");
  }

  function formatFont(style) {
    if (!style || (!style.fontSize && !style.fontFamily)) {
      return "";
    }
    return [style.fontSize, style.fontFamily].filter(Boolean).join(" ");
  }

  function buildAnnotationItem(annotation, position) {
    var index =
      Number.isInteger(annotation && annotation.index) && annotation.index > 0
        ? annotation.index
        : position + 1;
    var element = (annotation && annotation.element) || {};

    var lines = ["## Annotation " + index];

    var note = truncateLineValue(annotation && annotation.note);
    if (note) {
      lines.push("Note: " + note);
    }
    if (annotation && annotation.stale) {
      lines.push("Status: " + STALE_MARKER);
    }

    appendOptionalLine(lines, "URL", element.pageUrl);
    appendOptionalLine(lines, "Title", element.pageTitle);
    lines.push("Tag: " + String(element.tagName == null ? "" : element.tagName).toLowerCase());
    appendOptionalLine(lines, "Role", element.role);
    appendOptionalLine(lines, "Accessible name", element.accessibleName);
    appendOptionalLine(lines, "Selector", element.selector);
    appendOptionalLine(lines, "XPath", element.xpath);
    appendOptionalLine(lines, "Attributes", formatAttributes(element.attributes));
    appendOptionalLine(lines, "Color", element.style && element.style.color);
    appendOptionalLine(lines, "Background", element.style && element.style.backgroundColor);
    appendOptionalLine(lines, "Font", formatFont(element.style));
    appendOptionalLine(lines, "Font weight", element.style && element.style.fontWeight);
    appendOptionalLine(lines, "Display", element.style && element.style.display);

    if (element.rect) {
      lines.push(
        "Rect: x=" + Math.round(element.rect.x) +
          ", y=" + Math.round(element.rect.y) +
          ", width=" + Math.round(element.rect.width) +
          ", height=" + Math.round(element.rect.height),
      );
    }

    var text = truncateFencedValue(element.text);
    if (text) {
      lines.push("", "Text:", "```", text, "```");
    }
    var nearbyText = truncateFencedValue(element.nearbyText);
    if (nearbyText) {
      lines.push("", "Nearby context:", "```", nearbyText, "```");
    }
    var htmlExcerpt = truncateFencedValue(element.htmlExcerpt);
    if (htmlExcerpt) {
      lines.push("", "HTML excerpt:", "```html", htmlExcerpt, "```");
    }

    return lines.join("\n");
  }

  function buildAnnotationsMarkdown(annotations) {
    if (!Array.isArray(annotations) || annotations.length === 0) {
      return "";
    }
    var items = annotations.map(function (annotation, position) {
      return buildAnnotationItem(annotation, position);
    });
    return ["# Web page annotations: " + annotations.length, "", items.join("\n\n")].join("\n");
  }

  // ================================================================
  // payload 采集（移植自 webElementPickerScript.ts，去 workspace 字段）
  // ================================================================

  function truncate(value, maxLength) {
    var normalized = (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
    return normalized.length > maxLength ? normalized.slice(0, maxLength) + "..." : normalized;
  }

  function clampColorChannel(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function toHexColor(red, green, blue) {
    return (
      "#" +
      [red, green, blue]
        .map(function (channel) {
          return clampColorChannel(channel).toString(16).padStart(2, "0");
        })
        .join("")
        .toUpperCase()
    );
  }

  function parseAlpha(value) {
    if (!value) {
      return 1;
    }
    if (value.endsWith("%")) {
      return Number(value.slice(0, -1)) / 100;
    }
    return Number(value);
  }

  function formatComputedColor(value) {
    var normalized = String(value == null ? "" : value).trim();
    var match =
      /^rgba?\(\s*([0-9.]+)(?:,|\s)+([0-9.]+)(?:,|\s)+([0-9.]+)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/iu.exec(
        normalized,
      );
    if (!match) {
      return normalized;
    }
    var red = Number(match[1]);
    var green = Number(match[2]);
    var blue = Number(match[3]);
    var alpha = parseAlpha(match[4]);
    if ([red, green, blue, alpha].some(function (channel) {
      return Number.isNaN(channel);
    })) {
      return normalized;
    }
    if (alpha <= 0) {
      return "transparent";
    }
    return toHexColor(red, green, blue);
  }

  function readStyleSummary(element) {
    var style = window.getComputedStyle(element);
    var backgroundColor = formatComputedColor(style.backgroundColor);
    return {
      backgroundColor: backgroundColor !== "transparent" ? backgroundColor : undefined,
      color: formatComputedColor(style.color),
      display: style.display,
      fontFamily: truncate(style.fontFamily, 160),
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
    };
  }

  function cssEscape(value) {
    var escape = window.CSS && window.CSS.escape;
    if (escape) {
      return escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function readElementText(element) {
    if (typeof HTMLInputElement !== "undefined" && element instanceof HTMLInputElement) {
      if (element.type.toLowerCase() === "password") {
        return "[masked password input]";
      }
      return truncate(
        element.getAttribute("aria-label") ||
          element.getAttribute("placeholder") ||
          element.name ||
          element.type,
        LIMITS.maxTextChars,
      );
    }
    if (typeof HTMLTextAreaElement !== "undefined" && element instanceof HTMLTextAreaElement) {
      return truncate(
        element.getAttribute("aria-label") ||
          element.getAttribute("placeholder") ||
          element.name ||
          "textarea",
        LIMITS.maxTextChars,
      );
    }
    return truncate(element.innerText || element.textContent, LIMITS.maxTextChars);
  }

  function getImplicitRole(element) {
    var tagName = element.tagName.toLowerCase();
    if (tagName === "button") return "button";
    if (tagName === "a" && element.hasAttribute("href")) return "link";
    if (tagName === "img") return "img";
    if (tagName === "input") {
      var type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "button" || type === "submit" || type === "reset") return "button";
      return "textbox";
    }
    if (tagName === "textarea") return "textbox";
    if (tagName === "select") return "combobox";
    if (tagName === "nav") return "navigation";
    if (tagName === "main") return "main";
    if (tagName === "form") return "form";
    if (/^h[1-6]$/u.test(tagName)) return "heading";
    return "";
  }

  function getAccessibleName(element) {
    var labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      var label = labelledBy
        .split(/\s+/)
        .map(function (id) {
          var node = document.getElementById(id);
          return node ? node.textContent || "" : "";
        })
        .join(" ");
      var normalizedLabel = truncate(label, LIMITS.maxTextChars);
      if (normalizedLabel) {
        return normalizedLabel;
      }
    }
    return truncate(
      element.getAttribute("aria-label") ||
        element.getAttribute("alt") ||
        element.getAttribute("title") ||
        element.getAttribute("placeholder") ||
        readElementText(element),
      LIMITS.maxTextChars,
    );
  }

  function getAttributes(element) {
    var attributes = {};
    Array.from(element.attributes).forEach(function (attribute) {
      var name = attribute.name.toLowerCase();
      var allowed =
        name === "id" ||
        name === "class" ||
        name === "href" ||
        name === "src" ||
        name === "alt" ||
        name === "title" ||
        name === "name" ||
        name === "type" ||
        name === "placeholder" ||
        name.indexOf("aria-") === 0;
      if (!allowed || name === "value") {
        return;
      }
      attributes[name] = truncate(attribute.value, LIMITS.maxAttributeChars);
    });
    return attributes;
  }

  function getSelector(element) {
    if (element.id) {
      return "#" + cssEscape(element.id);
    }
    var parts = [];
    var current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
      var tagName = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(tagName + "#" + cssEscape(current.id));
        break;
      }
      var classNames = Array.from(current.classList)
        .filter(Boolean)
        .slice(0, 2)
        .map(function (className) {
          return "." + cssEscape(className);
        })
        .join("");
      var part = tagName + classNames;
      var parentElement = current.parentElement;
      if (parentElement) {
        var sameTagSiblings = Array.from(parentElement.children).filter(function (sibling) {
          return sibling.tagName === current.tagName;
        });
        if (sameTagSiblings.length > 1) {
          part += ":nth-of-type(" + (sameTagSiblings.indexOf(current) + 1) + ")";
        }
      }
      parts.unshift(part);
      current = parentElement;
    }
    return parts.join(" > ");
  }

  function getXPath(element) {
    var parts = [];
    var current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 12) {
      var tagName = current.tagName.toLowerCase();
      var parentElement = current.parentElement;
      if (!parentElement) {
        parts.unshift("/" + tagName);
        break;
      }
      var sameTagSiblings = Array.from(parentElement.children).filter(function (sibling) {
        return sibling.tagName === current.tagName;
      });
      parts.unshift(tagName + "[" + (sameTagSiblings.indexOf(current) + 1) + "]");
      current = parentElement;
    }
    return ("/" + parts.join("/")).replace(/^\/\//u, "/");
  }

  function getNearbyText(element) {
    var container =
      element.closest("article, section, main, form, li, tr, dialog") ||
      element.parentElement ||
      element;
    return truncate(container.innerText || container.textContent, LIMITS.maxTextChars);
  }

  function getHtmlExcerpt(element) {
    var clone = element.cloneNode(true);
    if (!(clone instanceof Element)) {
      return "";
    }
    clone.querySelectorAll("script, style, noscript, template").forEach(function (node) {
      node.remove();
    });
    clone.querySelectorAll("input, textarea").forEach(function (node) {
      if (typeof HTMLInputElement !== "undefined" && node instanceof HTMLInputElement) {
        node.removeAttribute("value");
        if (node.type.toLowerCase() === "password") {
          node.setAttribute("type", "password");
        }
      }
      if (typeof HTMLTextAreaElement !== "undefined" && node instanceof HTMLTextAreaElement) {
        node.textContent = "";
      }
    });
    return truncate(clone.outerHTML, LIMITS.maxHtmlChars);
  }

  function collectElement(element) {
    var rect = element.getBoundingClientRect();
    return {
      pageUrl: location.href,
      pageTitle: document.title,
      tagName: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || getImplicitRole(element) || undefined,
      accessibleName: getAccessibleName(element) || undefined,
      selector: getSelector(element),
      xpath: getXPath(element),
      text: readElementText(element) || undefined,
      nearbyText: getNearbyText(element) || undefined,
      htmlExcerpt: getHtmlExcerpt(element) || undefined,
      attributes: getAttributes(element),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      style: readStyleSummary(element),
      capturedAt: Date.now(),
    };
  }

  // ================================================================
  // 会话与图层
  // ================================================================

  var annotations = []; // { index, note, element, el, badge }
  var session = null; // { resolve, onSubmit }
  var indexBase = 0; // 跨窗口共享编号：start({ startIndex }) 设置下限（多面板会话由宿主计算传入）
  var listExpanded = false; // 页内面板批注列表展开/收起（默认收起）
  var panelChevron = null;
  var inputState = null; // { record, isNew, container, field }

  var overlay = null;
  var popover = null;
  var panel = null;
  var panelList = null;
  var panelCount = null;
  window.__dshKitAnnotatorVersion = "1.6.4"; // 1.6.4：面板固定尺寸（1/uiScale 反向缩放）+ 右下角定位 + 提示条同款（R-05）、resize rAF 合帧（R-06）、popover 尺寸缓存（R-07）；1.6.1：B5 hover rAF 合帧
  var toastEl = null;
  var toastTimer = null;
  var sessionListeners = []; // { target, type, handler, capture }

  function isUiTarget(target) {
    return Boolean(target && target.closest && target.closest("[" + UI_FLAG + "]"));
  }

  function makeElement(tag, styles) {
    var el = document.createElement(tag);
    if (styles) {
      Object.assign(el.style, styles);
    }
    return el;
  }

  function addSessionListener(target, type, handler, capture) {
    target.addEventListener(type, handler, capture === true);
    sessionListeners.push({ target: target, type: type, handler: handler, capture: capture === true });
  }

  function removeAllSessionListeners() {
    sessionListeners.forEach(function (rec) {
      rec.target.removeEventListener(rec.type, rec.handler, rec.capture);
    });
    sessionListeners = [];
  }

  /** 同页判定（跨窗口共享的门控）：origin+pathname 相同即同页（query/hash 差异不影响）。
   *  用户实测：窗口1在 A 页密码框批注 → 窗口2的 B 页密码框 selector 也命中，徽标串窗。
   *  共享板块保持全量（编号延续/互相引用），但**徽标只在同页渲染**。 */
  function samePageHref(a, b) {
    if (!a || !b) {
      return false;
    }
    if (a === b) {
      return true;
    }
    try {
      var u1 = new URL(a);
      var u2 = new URL(b);
      return u1.origin === u2.origin && u1.pathname === u2.pathname;
    } catch (_) {
      return false;
    }
  }

  function isStale(record) {
    if (record.pageOk === false) {
      return false; // 跨页共享项：元素本就不在本页，不存在 stale 语义
    }
    if (!record.el || !record.el.isConnected) {
      return true;
    }
    var selector = record.element && record.element.selector;
    if (selector) {
      try {
        return document.querySelector(selector) !== record.el;
      } catch (_) {
        return true;
      }
    }
    return false;
  }

  function publicAnnotation(record) {
    var out = { index: record.index, element: record.element };
    if (record.gid) {
      out.gid = record.gid;
    }
    if (record.note) {
      out.note = record.note;
    }
    if (isStale(record)) {
      out.stale = true;
    }
    return out;
  }

  function packageAnnotations() {
    var list = annotations.map(publicAnnotation);
    return { markdown: buildAnnotationsMarkdown(list), annotations: list };
  }

  function nextIndex() {
    return Math.max(
      annotations.reduce(function (max, record) {
        return Math.max(max, record.index);
      }, 0),
      indexBase,
    ) + 1;
  }

  // ---------------------------------------------------------------- hover 高亮（ZCode 基座）

  function ensureHoverLayers() {
    if (overlay && overlay.isConnected) {
      return;
    }
    overlay = makeElement("div", {
      background: "rgba(37, 99, 235, 0.12)",
      border: "2px solid " + ACCENT,
      borderRadius: "4px",
      boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.10)",
      boxSizing: "border-box",
      display: "none",
      left: "0",
      pointerEvents: "none",
      position: "fixed",
      top: "0",
      zIndex: "2147483647",
    });
    overlay.setAttribute(OVERLAY_FLAG, "overlay");

    popover = makeElement("div", {
      backdropFilter: "blur(10px)",
      background: "rgba(17, 24, 39, 0.92)",
      border: "1px solid rgba(255, 255, 255, 0.14)",
      borderRadius: "18px",
      boxShadow: "0 18px 38px rgba(15, 23, 42, 0.28)",
      boxSizing: "border-box",
      color: "#f9fafb",
      display: "none",
      font: "12px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      left: "0",
      maxWidth: "calc(100vw - 16px)",
      minWidth: "214px",
      padding: "12px 18px 14px",
      pointerEvents: "none",
      position: "fixed",
      top: "0",
      width: "min(320px, calc(100vw - 16px))",
      zIndex: "2147483647",
    });
    popover.setAttribute(OVERLAY_FLAG, "popover");

    document.documentElement.append(overlay, popover);
  }

  function removeHoverLayers() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (popover) {
      popover.remove();
      popover = null;
    }
  }

  function clampPosition(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getPopoverPosition(rect, labelWidth, labelHeight) {
    var padding = 8;
    var gap = 12;
    var maxLeft = Math.max(padding, window.innerWidth - labelWidth - padding);
    var maxTop = Math.max(padding, window.innerHeight - labelHeight - padding);
    var centeredLeft = rect.left + rect.width / 2 - labelWidth / 2;
    var centeredTop = rect.top + rect.height / 2 - labelHeight / 2;
    var candidates = [
      { left: clampPosition(centeredLeft, padding, maxLeft), top: rect.bottom + gap },
      { left: clampPosition(centeredLeft, padding, maxLeft), top: rect.top - labelHeight - gap },
      { left: rect.right + gap, top: clampPosition(centeredTop, padding, maxTop) },
      { left: rect.left - labelWidth - gap, top: clampPosition(centeredTop, padding, maxTop) },
    ];
    var viewportSafe = candidates.find(function (candidate) {
      return (
        candidate.left >= padding &&
        candidate.top >= padding &&
        candidate.left + labelWidth <= window.innerWidth - padding &&
        candidate.top + labelHeight <= window.innerHeight - padding
      );
    });
    if (viewportSafe) {
      return viewportSafe;
    }
    var availableSpaces = [
      {
        left: clampPosition(centeredLeft, padding, maxLeft),
        size: window.innerHeight - rect.bottom - padding,
        top: clampPosition(rect.bottom + gap, padding, maxTop),
      },
      {
        left: clampPosition(centeredLeft, padding, maxLeft),
        size: rect.top - padding,
        top: clampPosition(rect.top - labelHeight - gap, padding, maxTop),
      },
      {
        left: clampPosition(rect.right + gap, padding, maxLeft),
        size: window.innerWidth - rect.right - padding,
        top: clampPosition(centeredTop, padding, maxTop),
      },
      {
        left: clampPosition(rect.left - labelWidth - gap, padding, maxLeft),
        size: rect.left - padding,
        top: clampPosition(centeredTop, padding, maxTop),
      },
    ].sort(function (a, b) {
      return b.size - a.size;
    });
    // 交互修正：元素贴边/近全屏时选可用空间最大的方向并夹在视口内（ZCode 同款注释语义）
    return availableSpaces[0] || { left: padding, top: padding };
  }

  function appendPopoverRow(name, value) {
    if (!value) {
      return;
    }
    var row = makeElement("div", {
      alignItems: "baseline",
      columnGap: "16px",
      display: "grid",
      gridTemplateColumns: "auto minmax(0, 1fr)",
      minWidth: "0",
    });
    var nameNode = makeElement("span", {
      color: "rgba(255, 255, 255, 0.62)",
      fontSize: "15px",
      fontWeight: "600",
      minWidth: "0",
      whiteSpace: "nowrap",
    });
    nameNode.textContent = name;
    var valueNode = makeElement("span", {
      color: "#ffffff",
      fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace",
      fontSize: "15px",
      fontWeight: "700",
      minWidth: "0",
      overflow: "hidden",
      textAlign: "right",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    valueNode.textContent = value;
    row.append(nameNode, valueNode);
    popover.append(row);
  }

  function renderPopover(target, rect) {
    var style = readStyleSummary(target);
    popover.replaceChildren();

    var header = makeElement("div", {
      alignItems: "baseline",
      columnGap: "16px",
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      minWidth: "0",
    });
    var tagNode = makeElement("span", {
      color: "#ffffff",
      fontSize: "16px",
      fontWeight: "800",
      minWidth: "0",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    tagNode.textContent = target.tagName.toLowerCase();
    var sizeNode = makeElement("span", {
      color: "#ffffff",
      fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace",
      fontSize: "15px",
      fontWeight: "800",
      whiteSpace: "nowrap",
    });
    sizeNode.textContent = Math.round(rect.width) + "x" + Math.round(rect.height);
    header.append(tagNode, sizeNode);
    popover.append(header);

    appendPopoverRow("Color", style.color);
    if (style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)") {
      appendPopoverRow("Background", style.backgroundColor);
    }
    appendPopoverRow("Font", truncate([style.fontSize, style.fontFamily].filter(Boolean).join(" "), 96));
    // R-07（评审）：popover 尺寸缓存——内容未变则宽高恒定，updateOverlay 无需每帧再读
    // offsetWidth/offsetHeight（两次潜在强制布局）。视口跨 320px 阈值导致宽度变化时，
    // 由下一次目标变化（重建）刷新；resize 会话收尾一并清空。
    popoverSize = { w: popover.offsetWidth || 240, h: popover.offsetHeight || 90 };
  }

  var hoverTarget = null; // B5：最近一次已渲染 popover 的目标（同目标跳过重建，消除高频强制布局）
  var hoverRaf = 0; // B5 增强（1.6.1）：rAF 合帧——mousemove 高频，每帧只处理最新目标一次
  var hoverPending = null;
  var resizeRaf = 0; // R-06（1.6.2）：resize 合帧——拖拽窗口时每帧最多重定位一次
  var popoverSize = null; // R-07（1.6.2）：popover 尺寸缓存（内容不变则宽高恒定）

  function updateOverlay(target) {
    if (
      !target ||
      isUiTarget(target) ||
      target === overlay ||
      target === popover ||
      (popover && popover.contains(target))
    ) {
      overlay.style.display = "none";
      popover.style.display = "none";
      hoverTarget = null;
      return;
    }
    var rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      overlay.style.display = "none";
      popover.style.display = "none";
      hoverTarget = null;
      return;
    }
    overlay.style.display = "block";
    overlay.style.left = Math.max(0, rect.left) + "px";
    overlay.style.top = Math.max(0, rect.top) + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";

    popover.style.display = "block";
    // B5：同目标只更新位置、不重建 popover（mousemove 高频——旧实现每次全量
    // replaceChildren + getComputedStyle + offsetWidth 强制布局）；目标变化才重建
    if (target !== hoverTarget) {
      renderPopover(target, rect);
      hoverTarget = target;
    }
    var labelWidth = (popoverSize && popoverSize.w) || popover.offsetWidth || 240;
    var labelHeight = (popoverSize && popoverSize.h) || popover.offsetHeight || 90;
    var position = getPopoverPosition(rect, labelWidth, labelHeight);
    popover.style.left = position.left + "px";
    popover.style.top = position.top + "px";
  }

  // ---------------------------------------------------------------- 徽标 / 意见框 / 面板 / toast

  function docCoordsOf(element) {
    var rect = element.getBoundingClientRect();
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  }

  function renderBadge(record) {
    if (record.badge && record.badge.isConnected) {
      return record.badge;
    }
    var badge = makeElement("div", {
      alignItems: "center",
      background: ACCENT,
      border: "2px solid " + ACCENT,
      borderRadius: "50%",
      boxShadow: "0 2px 8px rgba(15, 23, 42, 0.35)",
      boxSizing: "border-box",
      color: "#ffffff",
      display: "flex",
      font: "600 11px/1 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      height: "20px",
      justifyContent: "center",
      position: "absolute",
      userSelect: "none",
      width: "20px",
      zIndex: "2147483646",
    });
    badge.setAttribute(MARKER_FLAG, String(record.index));
    badge.setAttribute(UI_FLAG, "");
    badge.textContent = String(record.index);
    badge.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openNoteInput(record, false);
    });
    record.badge = badge;
    document.documentElement.append(badge);
    positionBadge(record);
    return badge;
  }

  function positionBadge(record) {
    if (!record.badge || !record.badge.isConnected) {
      return;
    }
    // isStale 首条已覆盖 el 缺失/脱离（B4：此处不再重复判定）
    var stale = isStale(record);
    var pending = Boolean(inputStateRecordIs(record));
    if (stale) {
      record.badge.setAttribute("data-state", "stale");
      record.badge.style.background = STALE_COLOR;
      record.badge.style.borderColor = STALE_COLOR;
      return;
    }
    var doc = docCoordsOf(record.el);
    record.badge.style.left = Math.max(0, doc.x - 10) + "px";
    record.badge.style.top = Math.max(0, doc.y - 10) + "px";
    record.badge.setAttribute("data-state", pending ? "pending" : "confirmed");
    record.badge.style.background = pending ? "rgba(37, 99, 235, 0.25)" : ACCENT;
    record.badge.style.borderColor = ACCENT;
  }

  function inputStateRecordIs(record) {
    return inputState && inputState.record === record;
  }

  function repositionAllBadges() {
    annotations.forEach(positionBadge);
  }

  function renderPanel() {
    if (!panel) {
      return;
    }
    if (panelCount) {
      panelCount.textContent = String(annotations.length);
    }
    if (panelChevron) {
      panelChevron.textContent = listExpanded ? "▾" : "▸";
      panelChevron.title = listExpanded ? "收起批注列表" : "展开批注列表";
    }
    if (!panelList) {
      return;
    }
    panelList.style.display = listExpanded ? "" : "none";
    panelList.replaceChildren();
    if (!listExpanded) {
      return;
    }
    annotations.forEach(function (record) {
      var row = makeElement("div", {
        alignItems: "baseline",
        background: "transparent",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        columnGap: "8px",
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "auto auto minmax(0, 1fr)",
        padding: "6px 2px",
      });
      var indexNode = makeElement("span", {
        background: isStale(record) ? STALE_COLOR : ACCENT,
        borderRadius: "8px",
        color: "#ffffff",
        flexShrink: "0",
        font: "600 10px/1 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        padding: "3px 6px",
      });
      indexNode.textContent = String(record.index);
      var tagNode = makeElement("span", {
        color: "rgba(255,255,255,0.72)",
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        fontSize: "11px",
      });
      tagNode.textContent = record.element.tagName || "?";
      var noteNode = makeElement("span", {
        color: "#f9fafb",
        fontSize: "12px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });
      noteNode.textContent = record.note || "(未填写意见)";
      row.append(indexNode, tagNode, noteNode);
      row.addEventListener("click", function (event) {
        event.stopPropagation();
        openNoteInput(record, false);
      });
      panelList.append(row);
    });
  }

  /* ── R-OWN v12：**可见带**定位 ──
   * 面板套了"设备尺寸"后，guest 视口可能远宽于实际可见的板块宽（外层 `transform: scale` 只缩放显示），
   * 此时 `position:fixed; right:12px` 的面板会落到可见区之外（用户实测：面板被挤出右边界看不到）。
   * client 通过 `start({ visibleWidth })` / `setVisibleWidth(w)` 告知"可见的 guest 宽度"，
   * 面板与提示条据此锚定；未告知时按视口宽（等价于原来的 right:12，布局不变）。 */
  var visibleWidth = 0;
  var visibleHeight = 0; // R-OWN v13：可见带高度（guest px）——自持窗口 100% 显示时 guest 比舞台高，底部会被裁
  var uiScale = 1; // R-OWN v13：guest→屏幕的放大倍数（设备尺寸缩放 × 页面缩放 × dpr）；面板据此**反向缩放**
  function viewportWidth() {
    try {
      return Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1);
    } catch (e) { return 1024; }
  }
  function visibleBand() {
    var vw = viewportWidth();
    return visibleWidth > 0 ? Math.min(visibleWidth, vw) : vw;
  }
  /** R-OWN v13：可见带高度（vh 内我们实际看得见的那段）。 */
  function visibleBandHeight() {
    var vh = 0;
    try { vh = Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1); } catch (e) { vh = 720; }
    return visibleHeight > 0 ? Math.min(visibleHeight, vh) : vh;
  }
  /** R-OWN v13：面板/提示条的尺寸**固定不随分辨率变化** —— 用 1/uiScale 反向缩放抵消外层
   *  （设备尺寸 transform、页面缩放、dpr），视觉尺寸恒为 264px 宽（实测基准 264×82）。 */
  function applyPanelScale(el, origin) {
    if (!el) return;
    try {
      if (uiScale && uiScale !== 1) {
        el.style.transformOrigin = origin;
        el.style.transform = "scale(" + (1 / uiScale).toFixed(4) + ")";
      } else {
        el.style.transformOrigin = "";
        el.style.transform = "none";
      }
    } catch (e) { /* 忽略 */ }
  }
  /** 面板定位：**右下角**（用户 2026-10-10 指定）+ 落在可见带内。
   *  用 offsetWidth（不受 transform 影响）算左边界，避免反向缩放后自反馈。 */
  function positionPanel() {
    if (!panel || !panel.isConnected) return;
    try {
      var band = visibleBand();
      var w = panel.offsetWidth || 264;
      var vh = 0;
      try { vh = Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1); } catch (e) { vh = 720; }
      // 右下角：右缘贴可见带右侧，下缘贴**可见带底部**（可见带底部可能高于视口底部——自持窗口 100% 显示时）
      var bottomGap = Math.max(12, Math.round(vh - visibleBandHeight()) + 12);
      panel.style.top = "auto";
      panel.style.bottom = bottomGap + "px";
      panel.style.left = Math.max(8, Math.round(band - w - 12)) + "px";
      panel.style.right = "auto";
      applyPanelScale(panel, "bottom right");
    } catch (e) { /* 忽略 */ }
  }

  function ensurePanel() {
    if (panel && panel.isConnected) {
      renderPanel();
      positionPanel();
      return;
    }
    panel = makeElement("div", {
      all: "initial", // R-OWN v12：隔离宿主页面 CSS（否则不同站点下面板排版会不一致）
      background: "rgba(17, 24, 39, 0.95)",
      borderRadius: "12px",
      boxShadow: "0 18px 38px rgba(15, 23, 42, 0.4)",
      boxSizing: "border-box",
      color: "#f9fafb",
      display: "flex",
      flexDirection: "column",
      font: "12px/1.5 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      maxHeight: "60vh",
      padding: "10px 12px",
      position: "fixed",
      right: "12px",
      top: "12px",
      width: "264px",
      zIndex: "2147483647",
    });    panel.setAttribute("data-dsh-kit-panel", "");
    panel.setAttribute(UI_FLAG, "");

    var header = makeElement("div", {
      alignItems: "center",
      columnGap: "6px",
      display: "flex",
      marginBottom: "6px",
    });
    var icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("width", "14");
    icon.setAttribute("height", "14");
    icon.setAttribute("aria-hidden", "true");
    var iconPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    iconPath.setAttribute(
      "d",
      "M8 1a4 4 0 0 1 4 4c0 2.6-2.4 5.6-3.6 6.9a.55.55 0 0 1-.8 0C6.4 10.6 4 7.6 4 5a4 4 0 0 1 4-4zm0 2.4A1.6 1.6 0 1 0 8 6.6a1.6 1.6 0 0 0 0-3.2zM3 13.2h10a.8.8 0 0 1 0 1.6H3a.8.8 0 0 1 0-1.6z",
    );
    iconPath.setAttribute("fill", ACCENT);
    icon.append(iconPath);

    var title = makeElement("span", { fontWeight: "700", fontSize: "12px" });
    title.textContent = "批注";
    panelCount = makeElement("span", {
      background: ACCENT,
      borderRadius: "7px",
      color: "#ffffff",
      display: "inline-block",
      font: "600 10px/1 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      minWidth: "14px",
      padding: "2px 4px",
      textAlign: "center",
    });
    panelCount.textContent = "0";
    panelChevron = makeElement("button", {
      background: "transparent",
      border: "none",
      color: "rgba(255,255,255,0.72)",
      cursor: "pointer",
      fontSize: "10px",
      padding: "2px 4px",
    });
    panelChevron.type = "button";
    panelChevron.textContent = "▸";
    panelChevron.title = "展开批注列表";
    panelChevron.setAttribute("data-dsh-kit-panel-chevron", "");
    panelChevron.style.marginLeft = "auto";
    panelChevron.addEventListener("click", function (event) {
      event.stopPropagation();
      listExpanded = !listExpanded;
      renderPanel();
    });
    // 「清除」按钮：位于展开/收起图标左侧（用户指定位置）；清空本面板全部批注，
    // gid 全量进删除日志 → 宿主广播 removeExternal，共享会话下所有窗口同步移除
    var clearBtn = makeElement("button", {
      background: "transparent",
      border: "1px solid rgba(255,255,255,0.24)",
      borderRadius: "6px",
      color: "rgba(255,255,255,0.72)",
      cursor: "pointer",
      font: "10px/1 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      padding: "3px 6px",
    });
    clearBtn.type = "button";
    clearBtn.textContent = "清除";
    clearBtn.title = "清除全部批注（共享会话下所有窗口同步移除）";
    clearBtn.setAttribute("data-dsh-kit-panel-clear", "");
    clearBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      clearAllAnnots();
    });
    header.append(icon, title, panelCount, clearBtn, panelChevron);
    panel.append(header);

    panelList = makeElement("div", { overflowY: "auto", minHeight: "24px" });
    panel.append(panelList);

    var footer = makeElement("div", {
      columnGap: "8px",
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      marginTop: "8px",
    });
    var submitBtn = makeElement("button", {
      background: ACCENT,
      border: "none",
      borderRadius: "8px",
      color: "#ffffff",
      cursor: "pointer",
      font: "600 12px/1 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      padding: "8px 0",
    });
    submitBtn.type = "button";
    submitBtn.textContent = "提交";
    submitBtn.setAttribute("data-dsh-kit-panel-submit", "");
    submitBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      handlePanelSubmit();
    });
    var cancelBtn = makeElement("button", {
      background: "transparent",
      border: "1px solid rgba(255,255,255,0.24)",
      borderRadius: "8px",
      color: "#f9fafb",
      cursor: "pointer",
      font: "12px/1 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      padding: "8px 0",
    });
    cancelBtn.type = "button";
    cancelBtn.textContent = "取消";
    cancelBtn.setAttribute("data-dsh-kit-panel-cancel", "");
    cancelBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      stopAnnotating();
    });
    footer.append(submitBtn, cancelBtn);
    panel.append(footer);

    // 键盘/点击屏蔽：面板内的按键不透传给页面（capture 阶段 stopPropagation，
    // 不影响面板自身按钮的默认激活）
    panel.addEventListener("keydown", function (event) {
      event.stopPropagation();
    }, true);
    panel.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    document.documentElement.append(panel);
    positionPanel(); // R-OWN v12：按可见带锚定（未告知可见宽时等价于 right:12）
    renderPanel();
  }

  function removePanel() {
    if (panel) {
      panel.remove();
      panel = null;
      panelList = null;
      panelCount = null;
      panelChevron = null; // B8：漏置空——重建时会被覆盖，但悬空引用属隐患
    }
  }

  function openNoteInput(record, isNew) {
    closeNoteInput(false);
    ensurePanel();

    var container = makeElement("div", {
      background: "rgba(17, 24, 39, 0.96)",
      borderRadius: "10px",
      boxShadow: "0 18px 38px rgba(15, 23, 42, 0.4)",
      boxSizing: "border-box",
      color: "#f9fafb",
      font: "12px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      padding: "10px",
      position: "absolute",
      width: "264px",
      zIndex: "2147483647",
    });
    container.setAttribute("data-dsh-kit-note-input", "");
    container.setAttribute(UI_FLAG, "");

    var heading = makeElement("div", {
      color: "rgba(255,255,255,0.72)",
      fontSize: "11px",
      marginBottom: "6px",
    });
    heading.textContent =
      "#" + record.index + " <" + (record.element.tagName || "?") + ">" + (isNew ? "" : " 重新编辑");
    container.append(heading);

    var field = makeElement("textarea", {
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: "6px",
      boxSizing: "border-box",
      color: "#f9fafb",
      display: "block",
      font: "12px/1.4 inherit",
      height: "58px",
      marginBottom: "8px",
      padding: "6px 8px",
      resize: "vertical",
      width: "100%",
    });
    field.placeholder = "修改意见（可留空）";
    field.setAttribute("data-dsh-kit-note-field", "");
    field.value = record.note || "";
    container.append(field);

    var actions = makeElement("div", { columnGap: "8px", display: "grid", gridTemplateColumns: "1fr 1fr" });
    var confirmBtn = makeElement("button", {
      background: ACCENT,
      border: "none",
      borderRadius: "6px",
      color: "#ffffff",
      cursor: "pointer",
      font: "600 12px/1 inherit",
      padding: "7px 0",
    });
    confirmBtn.type = "button";
    confirmBtn.textContent = "确认";
    confirmBtn.setAttribute("data-dsh-kit-confirm", "");
    confirmBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      commitNoteInput();
    });
    var deleteBtn = makeElement("button", {
      background: "transparent",
      border: "1px solid rgba(255,255,255,0.24)",
      borderRadius: "6px",
      color: "#f9fafb",
      cursor: "pointer",
      font: "12px/1 inherit",
      padding: "7px 0",
    });
    deleteBtn.type = "button";
    deleteBtn.textContent = "删除";
    deleteBtn.setAttribute("data-dsh-kit-delete", "");
    deleteBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      discardRecord(record);
    });
    actions.append(confirmBtn, deleteBtn);
    container.append(actions);

    // 意见框内键盘事件不透传（调研文档 §5.2：防页面快捷键劫持）+ Enter/Esc 交互。
    // R-01 修复（2026-10-06 评审）：原先 field 上的 Enter/Esc 监听是**死代码**——本容器
    // 在 capture 阶段 stopPropagation 后事件不会进入 target 阶段，field 的监听永不触发
    // （实际行为退化为「Enter 换行、Esc 无响应」）。现将交互合并进 capture 监听按 target 分流。
    container.addEventListener("keydown", function (event) {
      if (event.target === field) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          commitNoteInput();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeNoteInput(true);
          return;
        }
      }
      event.stopPropagation();
    }, true);
    container.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    var doc = record.el && record.el.isConnected ? docCoordsOf(record.el) : { x: 0, y: 0 };
    var left = clampPosition(doc.x + 24, 4, Math.max(4, (document.documentElement.scrollWidth || window.innerWidth) - 272));
    var top = clampPosition(doc.y - 6, 4, Math.max(4, (document.documentElement.scrollHeight || window.innerHeight) - 160));
    container.style.left = left + "px";
    container.style.top = top + "px";

    document.documentElement.append(container);
    inputState = { record: record, isNew: isNew, container: container, field: field };
    field.focus();
    positionBadge(record);
  }

  function commitNoteInput() {
    if (!inputState) {
      return;
    }
    var record = inputState.record;
    var value = String(inputState.field.value || "").trim();
    record.note = value || "";
    closeNoteInput(false);
    positionBadge(record);
    renderPanel();
  }

  function closeNoteInput(rollbackNew) {
    if (!inputState) {
      return;
    }
    var state = inputState;
    inputState = null;
    if (state.container) {
      state.container.remove();
    }
    if (rollbackNew && state.isNew) {
      removeRecord(state.record);
    } else {
      positionBadge(state.record);
    }
  }

  function removeRecord(record) {
    var at = annotations.indexOf(record);
    if (at >= 0) {
      annotations.splice(at, 1);
    }
    if (record.badge) {
      record.badge.remove();
      record.badge = null;
    }
    if (record.gid) {
      // 删除日志（跨面板同步）：宿主轮询合并各窗口的删除记录，广播移除。
      // R-05（评审）：push 前按 gid 去重——原先每次 removeExternal 都追加一条，
      // 日志单调增长且被 syncPanes 每 1.5s 全量序列化；去重后上界 = 历史唯一被删 gid 数。
      window.__dshKitDeletedGids = window.__dshKitDeletedGids || [];
      if (window.__dshKitDeletedGids.indexOf(record.gid) < 0) {
        window.__dshKitDeletedGids.push(record.gid);
      }
    }
    renderPanel();
  }

  /** 清除全部批注（面板「清除」按钮 / clearAll API）：本面板清空 + 全部 gid 进删除日志。
   *  共享会话下必须写删除日志——否则其他窗口的批注 1.5s 后会被 addExternal 推回来；
   *  宿主 syncPanes 合并各窗口删除日志后广播 removeExternal，实现全窗口同步移除。 */
  function clearAllAnnots() {
    var count = annotations.length;
    window.__dshKitDeletedGids = window.__dshKitDeletedGids || [];
    annotations.slice().forEach(function (record) {
      if (record.gid && window.__dshKitDeletedGids.indexOf(record.gid) < 0) {
        window.__dshKitDeletedGids.push(record.gid);
      }
      if (record.badge) {
        record.badge.remove();
        record.badge = null;
      }
    });
    annotations.length = 0;
    closeNoteInput(false); // 正开着的批注输入框一并收掉（B3：复用关闭分支，不走 removeRecord）
    renderPanel();
    showToast(count > 0 ? "已清除 " + count + " 条批注（所有窗口同步移除）" : "当前没有批注");
  }

  function discardRecord(record) {
    if (inputState && inputState.record === record) {
      var container = inputState.container;
      inputState = null;
      if (container) {
        container.remove();
      }
    }
    removeRecord(record);
  }

  function showToast(text) {
    if (toastEl) {
      toastEl.remove();
    }
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastEl = makeElement("div", {
      all: "initial", // R-OWN v12：隔离宿主页面 CSS
      background: "rgba(17, 24, 39, 0.92)",
      borderRadius: "8px",
      bottom: "24px",
      boxSizing: "border-box",
      color: "#f9fafb",
      font: "12px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      left: Math.round(visibleBand() / 2) + "px", // R-OWN v12：可见带内居中（缩放裁剪下也看得见）
      padding: "8px 14px",
      position: "fixed",
      transform: "translateX(-50%)" + (uiScale && uiScale !== 1 ? " scale(" + (1 / uiScale).toFixed(4) + ")" : ""),
      transformOrigin: "bottom center", // R-OWN v13：与反向缩放配合，底边保持贴底
      zIndex: "2147483647",
    });
    toastEl.setAttribute(UI_FLAG, "");
    toastEl.textContent = text;
    document.documentElement.append(toastEl);
    toastTimer = setTimeout(function () {
      if (toastEl) {
        toastEl.remove();
        toastEl = null;
      }
      toastTimer = null;
    }, 1800);
  }

  function copyToClipboard(text) {
    var fallback = function () {
      try {
        var helper = makeElement("textarea", {
          left: "0",
          opacity: "0",
          position: "fixed",
          top: "0",
        });
        helper.value = text;
        document.body.append(helper);
        helper.select();
        var ok = document.execCommand("copy");
        helper.remove();
        return Promise.resolve(ok);
      } catch (_) {
        return Promise.resolve(false);
      }
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        return navigator.clipboard.writeText(text).then(
          function () {
            return true;
          },
          function () {
            return fallback();
          },
        );
      }
    } catch (_) {
      /* 走降级 */
    }
    return fallback();
  }

  // ---------------------------------------------------------------- 批注态事件（capture 拦截）

  function handlePickClick(event) {
    if (!session) {
      return;
    }
    var target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (isUiTarget(target)) {
      return; // 自有 UI（面板/意见框/徽标）自行处理
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.button !== 0) {
      return; // 非左键只拦截不采集
    }
    if (inputState) {
      commitNoteInput(); // 点新元素前自动落定上一条意见
    }
    // 密码框不再跳过（2026-10-05 用户反馈移除）：批注载荷只含选择器/样式/白名单属性，
    // 输入值永不被采集（attributes 白名单显式排除 value）——开发评审场景无敏感泄露。
    var record = {
      gid: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), // 跨面板同步标识（宿主广播用）
      index: nextIndex(),
      note: "",
      element: collectElement(target),
      el: target,
      badge: null,
    };
    annotations.push(record);
    renderBadge(record);
    openNoteInput(record, true);
    renderPanel();
  }

  function handleMouseMove(event) {
    if (!session) {
      return;
    }
    var target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    // B5 增强（1.6.1）：rAF 合帧——同一帧内的多次 mousemove 只保留最新目标，
    // updateOverlay 每帧最多执行一次（原实现每次 mousemove 都做 rect + 两次强制布局）。
    hoverPending = target;
    if (hoverRaf) {
      return;
    }
    hoverRaf = requestAnimationFrame(function () {
      hoverRaf = 0;
      var t = hoverPending;
      hoverPending = null;
      if (!session || !t) {
        return; // 会话已结束/目标丢失：丢弃该帧
      }
      updateOverlay(t);
    });
  }

  function handleKeyDown(event) {
    if (!session) {
      return;
    }
    if (isUiTarget(event.target)) {
      return; // 意见框/面板内按键由其自身处理
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stopAnnotating();
    }
  }

  function handleResize() {
    if (!session) {
      return;
    }
    // R-06（评审）：resize 拖拽窗口时每秒数十次事件，每次对全部批注做
    // querySelector(isStale) + getBoundingClientRect —— 与 B5 hover 同族的高频强制布局。
    // rAF 合帧：每帧最多重定位一次（浏览器每帧至多渲染一次，视觉不可分辨）。
    if (resizeRaf) {
      return;
    }
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = 0;
      if (!session) {
        return; // 会话已结束：丢弃该帧
      }
      repositionAllBadges();
      positionPanel(); // R-OWN v12：视口/可见带变化时面板也要跟着回位
    });
  }

  async function handlePanelSubmit() {
    var result = packageAnnotations();
    var current = session; // B1：进 await 前捕获——期间若 start() 开了新会话，endSession 不得误杀
    var copied = false;
    try {
      copied = await copyToClipboard(result.markdown);
    } catch (_) {
      copied = false;
    }
    showToast(copied ? "批注 Markdown 已复制到剪贴板" : "已生成批注（复制失败，可经回调获取）");
    if (current && typeof current.onSubmit === "function") {
      try {
        current.onSubmit(result);
      } catch (_) {
        /* 回调异常不阻塞交付 */
      }
    }
    if (session === current) {
      endSession("submitted"); // 仅当仍是发起提交的会话才收束；否则新会话已接棒
    }
  }

  // ---------------------------------------------------------------- 会话生命周期

  function startAnnotating(options) {
    if (session) {
      endSession("cancelled");
    }
    closeNoteInput(true);
    var opts = options || {};
    if (opts.startIndex != null) {
      indexBase = Number(opts.startIndex) || 0; // 多面板共享编号：后加入窗口从全局最大号之后继续
    }
    if (opts.visibleWidth != null) {
      visibleWidth = Math.max(0, Number(opts.visibleWidth) || 0); // R-OWN v12：可见带宽度（guest px）
    }
    if (opts.uiScale != null) {
      uiScale = Math.max(0.05, Number(opts.uiScale) || 1); // R-OWN v13：反向缩放基准（视觉尺寸恒定）
    }
    return new Promise(function (resolve) {
      session = {
        resolve: resolve,
        onSubmit: typeof opts.onSubmit === "function" ? opts.onSubmit : null,
      };
      ensureHoverLayers();
      ensurePanel();
      annotations.forEach(function (record) {
        if (record.pageOk === false) {
          return; // 跨页共享项：不渲染徽标（防串窗）
        }
        renderBadge(record); // 跨会话保留的批注重新钉标
      });
      document.documentElement.style.cursor = "crosshair";
      addSessionListener(document, "mousemove", handleMouseMove, true);
      addSessionListener(document, "click", handlePickClick, true);
      addSessionListener(document, "keydown", handleKeyDown, true);
      addSessionListener(window, "resize", handleResize, false);
    });
  }

  function removeBadges() {
    annotations.forEach(function (record) {
      if (record.badge) {
        record.badge.remove();
        record.badge = null;
      }
    });
  }

  function removeAllLayers() {
    closeNoteInput(false);
    removeHoverLayers();
    removePanel();
    removeBadges();
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }
    removeAllSessionListeners();
    document.documentElement.style.cursor = "";
  }

  function endSession(status) {
    var current = session;
    session = null;
    removeAllLayers();
    hoverTarget = null; // B5：会话结束重置 hover 状态（防止新会话首 hover 跳过渲染）
    hoverPending = null; // B5 增强：丢弃挂起帧（rAF 回调自带 session 判空，双保险）
    if (hoverRaf) {
      cancelAnimationFrame(hoverRaf);
      hoverRaf = 0;
    }
    // R-06：resize 合帧状态复位（照抄 hover 收尾模式）
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = 0;
    }
    if (current) {
      try {
        current.resolve(status);
      } catch (_) {
        /* resolve 异常忽略 */
      }
    }
  }

  function stopAnnotating() {
    if (!session) {
      return;
    }
    endSession("cancelled");
  }

  // ---------------------------------------------------------------- 公开契约（任务书 §3.2，钉死）

  window[STATE_KEY] = {
    /** 开始批注会话；返回 Promise<'cancelled' | 'submitted'>。opts.onSubmit 在面板提交时回调；
     *  opts.startIndex 设置批注编号下限（多面板共享编号：后加入窗口从全局最大号之后继续）。 */
    start: function (options) {
      return startAnnotating(options);
    },
    /** 结束当前会话并清理图层（已收集的批注保留在内存，clear() 才清空）。 */
    stop: function () {
      stopAnnotating();
    },
    /** R-OWN v12：设置"可见带宽度"（guest px）——设备尺寸缩放/裁剪时，面板与提示条据此锚定在可见区内。
     *  传 0 或不传 = 按视口宽（原行为）。 */
    setVisibleWidth: function (w) {
      visibleWidth = Math.max(0, Number(w) || 0);
      positionPanel();
      return { visibleWidth: visibleWidth, band: visibleBand() };
    },
    /** R-OWN v13：设置 uiScale（guest→屏幕放大倍数）——面板按 1/uiScale 反向缩放，**视觉尺寸恒定**，
     *  不随分辨率/页面缩放变化。 */
    setUiScale: function (s) {
      uiScale = Math.max(0.05, Number(s) || 1);
      positionPanel();
      return { uiScale: uiScale };
    },
    /** R-OWN v13：一次性同步"可见带 + 缩放"（client 侧合并调用，少一次跨进程往返）。 */
    setPaneMetrics: function (m) {
      var o = m || {};
      if (o.visibleWidth != null) visibleWidth = Math.max(0, Number(o.visibleWidth) || 0);
      if (o.visibleHeight != null) visibleHeight = Math.max(0, Number(o.visibleHeight) || 0);
      if (o.uiScale != null) uiScale = Math.max(0.05, Number(o.uiScale) || 1);
      positionPanel();
      return { visibleWidth: visibleWidth, visibleHeight: visibleHeight, band: visibleBand(), bandH: visibleBandHeight(), uiScale: uiScale };
    },
    /** 打包当前批注（纯函数式：不结束会话、不清空）。 */
    submit: function () {
      return packageAnnotations();
    },
    /** 当前批注列表（stale 实时判定）。 */
    list: function () {
      return annotations.map(publicAnnotation);
    },
    /** 清空全部批注并移除徽标。
     *  ⚠️ R-02（评审）：**不写跨面板删除日志**——共享会话下其他窗口的 union 仍含这些 gid，
     *  1.5s 同步圈会把批注 `addExternal` 推回来（「清了又回来」）。跨窗口清除一律用
     *  `clearAll()`（全量 gid 进删除日志，宿主广播 removeExternal）。当前 client 全链只用
     *  clearAll；本 API 保留为单窗口语义，勿在共享会话下使用。 */
    clear: function () {
      annotations.length = 0;
      if (session) {
        removeBadges();
        renderPanel();
      }
    },
    /** 清除全部批注 + 全量 gid 进删除日志（共享会话跨窗口广播移除；面板「清除」按钮同源）。 */
    clearAll: function () {
      clearAllAnnots();
      return { cleared: true };
    },
    /** 跨面板同步：按 gid 合并外部批注（已存在则同步 note/index），返回是否有变更。 */
    addExternal: function (items) {
      var changed = false;
      (items || []).forEach(function (item) {
        if (!item || !item.gid) {
          return;
        }
        var existing = null;
        for (var i = 0; i < annotations.length; i++) {
          if (annotations[i].gid === item.gid) {
            existing = annotations[i];
            break;
          }
        }
        var index = Number(item.index) || (existing ? existing.index : nextIndex());
        if (existing) {
          if (existing.note !== (item.note || "")) {
            existing.note = item.note || "";
            changed = true;
          }
          if (existing.index !== index) {
            existing.index = index;
            changed = true;
            if (existing.badge) {
              existing.badge.textContent = String(index);
            }
          }
          return;
        }
        var el = null;
        try {
          el = item.element && item.element.selector ? document.querySelector(item.element.selector) : null;
        } catch (_) {
          el = null;
        }
        // 同页门控：跨页共享项只进共享板块（列表/编号/提交），不在本页渲染徽标（防串窗）
        var pageOk = true;
        if (item._originUrl) {
          try {
            pageOk = samePageHref(item._originUrl, location.href);
          } catch (_) {
            pageOk = true;
          }
        }
        var record = {
          gid: item.gid,
          index: index,
          note: item.note || "",
          element: item.element || {}, // B6：脏输入兜底——renderPanel 直取 tagName，缺 element 会打崩列表渲染
          el: pageOk ? el : null, // 非同页不留 el（selector 在别的页面可能误命中同类元素）
          badge: null,
          pageOk: pageOk,
        };
        annotations.push(record);
        if (pageOk) {
          renderBadge(record);
          if (!record.el && item.element && item.element.rect) {
            // B7：badge 是文档坐标（absolute），rect 是视口坐标（getBoundingClientRect）——
            // 页面滚过后需补 scroll 偏移，否则徽标错位
            record.badge.style.left = Math.max(0, (Number(item.element.rect.x) || 0) + (window.scrollX || 0)) + "px";
            record.badge.style.top = Math.max(0, (Number(item.element.rect.y) || 0) + (window.scrollY || 0)) + "px";
          }
        }
        changed = true;
      });
      if (changed) {
        renderPanel();
      }
      return { changed: changed };
    },
    /** 跨面板同步：按 gid 移除批注（其他窗口删除时广播）。 */
    removeExternal: function (gid) {
      for (var i = 0; i < annotations.length; i++) {
        if (annotations[i].gid === gid) {
          removeRecord(annotations[i]);
          return { removed: true };
        }
      }
      return { removed: false };
    },
    // 非契约字段：仅供 parity 测试对拍内嵌协议 builder（勿在宿主代码中使用）
    _protocol: { buildAnnotationsMarkdown: buildAnnotationsMarkdown },
  };
})();
