# NOTICE — 第三方代码归属声明

本项目（dsh-browser-kit）包含从 **ZCode**（github.com/zai-org/ZCode，Apache License 2.0）移植的代码。
依照 Apache-2.0 第 4(d) 条要求登记如下。

## 移植来源

| 本项目文件 | 来源文件（ZCode） | 移植内容 |
|---|---|---|
| `src/element-annotator.js` | `packages/ui/src/lib/webElementPickerScript.ts` | hover 高亮 overlay/popover、capture 阶段事件拦截、元素 payload 采集（selector/xpath/attributes/style 等）、「函数即模板」注入方式 |
| `src/element-annotator.js`（内嵌 builder） | `packages/ui/src/lib/webElementContext.ts` | Markdown 协议字段布局与格式化（Attributes/Font/Rect 等） |
| `src/annotations-protocol.js` | `packages/ui/src/lib/webElementContext.ts` | 协议块结构、`truncateMarkdownValue`/`appendOptionalLine`/`readField`/`readFencedSection`/`parseFontSummary` 等往返解析骨架 |

> 版权：Copyright 2026 Z.AI Co., Ltd。 Licensed under the Apache License, Version 2.0。
> 本地参照克隆：`F:\My Code\ZCode\`（github.com/zai-org/ZCode，main 分支）。

## 修改说明（相对 ZCode 原文件）

- **命名空间**：`data-zcode-*` → `data-dsh-kit-*`，`__zcodeWebElementPicker` → `__dshKitAnnotator`（任务书 §3.2/§4 钉死命名，与调研文档 §5.2 的早期占位命名 `data-dsh-*` 的差异已由项目所有者裁决：以任务书为准）。
- **payload**：移除 ZCode 宿主耦合字段 `workspacePath`/`workspaceIdentity`；字段限额沿用 4000/6000/500/8000。
- **协议 v2 扩展**（`# Web page annotations:`）：新增批注级 `Note:`/`Status:` 行；parse 升级为无损（还原 Rect/Attributes，v1 会丢弃）；行字段截断改为行内 `[truncated]`（v1 在行字段内插入 `\n\n[truncated]` 会破坏行式解析）；URL/Title 缺席时整行省略。
- **批注模式状态机**：编号徽标钉标、就地意见输入、页内批注面板、stale 判定——均为本项目新增（调研文档 §5.2）。

## 本项目原创文件（未复制 ZCode 代码）

- `src/hid-observer.js`（L1 通用设备观测，规格见调研文档 §5.5、任务书 §3.1）
- `src/virtual-hid-device.js`（mock 设备，任务书 §3.4）
- `src/cdp/drive.mjs`（CDP 驱动，任务书 §3.5）
- `test/` 全部测试与 fixtures

## 许可

本项目按仓库宿主约定分发；移植部分继续遵循 Apache-2.0（见上），其余部分随项目整体许可。
