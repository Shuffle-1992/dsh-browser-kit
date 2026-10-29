# 目录结构（repo structure）

> 各目录职责与关键文件。改代码前先看这里，避免在错误的分层里加逻辑。
> 文档索引见仓库根 [`README.md`](../README.md)；行为以 `plugin/` 与 `src/` 为准。

---

## 目录树

```
dsh-browser-kit/
├── README.md            # 插件简介 + 安装 + 功能总览（细节全部指向 docs/）
├── pitfalls.md          # 踩坑记录 P1–P116（现象/根因/对策，本项目最值钱的一份）
├── NOTICE.md            # Apache-2.0 归属声明（ZCode 移植来源与修改说明）
├── package.json         # 零 npm 依赖 · Node ≥22 · scripts.test = node --test
├── LICENSE              # Apache-2.0
├── .gitignore           # shots/ annotations/ plugin/.data/ .local/ node_modules/
│
├── docs/                # **全部文档都在这里**（根目录只留 README + NOTICE）
│   ├── feature-reference.md               # 功能介绍完整版（设计动机/行为细节/边界）
│   ├── dev-onboarding.md                  # 新会话开工指引（先读什么、怎么验证）
│   ├── repo-structure.md                  # 本文件
│   ├── tool-usage-rules.md                # 工具使用规范（调用 browser_* 的 Agent 必读）
│   ├── delivery-01..13.md                 # 各功能交付时点快照（可能已被后续需求推翻）
│   ├── mvp0-probe-state.md / mvp3-loop-state.md
│   ├── review-*.md / zcode-*.md / DSH-0.2.1-COMPAT-REVIEW*.md
│   ├── ver-delta-0.2.1-rc.2.md / api-scout.md / browser-capability-assessment.md
│   ├── browser-annotation-and-screenshot-research.md
│   ├── market-index.md / market-launch-checklist.md
│   ├── refactor-report.md / review-report-20261006.md
│   └── tasks/                             # 派发任务包（zcode-task-*.md）
│
├── plugin/              # 运行时：DSH 按 package.json exports 加载（宿主 + client 两半边）
│   ├── package.json / cordis.patch.yml    # bundle 声明（exports["."] → entry.mjs；junction 安装）
│   ├── entry.mjs                          # host 入口永久薄壳（?ts=mtime-seq 击穿 ESM 缓存，P13）
│   ├── host.impl.mjs                      # host 业务（探测 / face / 落盘 / 卸载清理 / _internals 测试导出）
│   ├── browser-tools.host.mjs             # 27 个 browser_* 工具的宿主侧定义 + 命令通道传输
│   ├── wire.host.mjs                      # TYPERT 描述符 + createRemoteFace（18 方法，与 client 对账有测试）
│   ├── annot-delivery.host.mjs            # 批注 → Agent 上下文交付（agent/pre-step 注入）
│   ├── plugin-config.schema.mjs           # 插件配置 schema（schemastery 解析 + 降级）
│   ├── client.js                          # client 半边（槽位 / 批注 / 胶囊 / 命令通道 / 自持窗口 / 截图卡）
│   ├── icon.svg                           # 插件市场图标
│   ├── noop.js                            # require 锚点（构建期占位，勿删）
│   └── .data/                             # 运行期数据（command.json / probe-report.json，已 gitignore）
│
├── src/                 # 纯逻辑正典（Node 可直测；client 侧用内嵌副本 + parity 对拍）
│   ├── element-annotator.js               # 网页批注层（picker 基座 + 共享会话/同页门控/清除，自包含 IIFE）
│   ├── annotations-protocol.js            # 批注协议 build/parse（纯函数 ESM）
│   ├── annotator-sync.mjs / annotator-consume.mjs / annot-mirror-anchor.mjs / annotations-summary.mjs
│   ├── hid-observer.js                    # L1 通用设备观测（HID/Serial/USB，零 DSH 依赖）
│   ├── hid-bridge.mjs                     # node-hid 直连桥（WebHID polyfill 的宿主侧）
│   ├── webhid-shim.js                     # 页面侧 WebHID polyfill（页面零修改直连 HID）
│   ├── virtual-hid-device.js              # mock 设备（测试用）
│   ├── console-observer.js                # 页内 console/网络观察器（DSH 无 DevTools）
│   ├── shot-view.mjs                      # 截图卡渲染纯逻辑（baseName / humanBytes / createShotStore）
│   ├── tool-presentation.mjs              # 工具卡 presentCall/presentResult 纯逻辑
│   ├── session-id.mjs                     # 会话 id 唯一口径
│   ├── command-budget.mjs                 # 命令通道超时预算（P116 事故区）
│   ├── cmd-owner.mjs                      # 唯一轮询者租约（P115 事故区）
│   ├── chip-target.mjs                    # 批注胶囊落位决策（P114/M-1 事故区）
│   ├── url-policy.mjs                     # 导航 URL 策略（L-9 事故区）
│   ├── bridge-envelope.mjs                # face 信封拆包
│   └── cdp/drive.mjs                      # CDP 驱动（真实 Chrome 冒烟用）
│
├── test/                # node:test 套件（279 项 / 278 过 / 1 环境跳过）
│   ├── helpers/  fixtures/                 # vm 沙箱 + Chrome/WebHID 冒烟夹具
│   └── *.test.mjs|js                       # 含四个事故区的**行为钉**：command-budget / cmd-owner / chip-target / url-policy
│
├── market/              # DSH Plugin Hub 索引（index.json + build/verify 脚本）
│
└── shots/ annotations/  # 运行期产物（截图 / 批注落盘，已 gitignore）
```

## 分层规则（改代码前必读）

| 层 | 允许 | 禁止 |
|---|---|---|
| `src/*.mjs` | 纯函数、零副作用、可 Node 直测 | 依赖 `window`/`document`/cordis（`*.js` 页面注入 IIFE 除外） |
| `client.js` | DOM/React、槽位、命令处理 | **相对 `import`** ✗（只能内嵌 `src/` 正典副本 + parity 对拍） |
| `plugin/*.host.mjs` | Node API、cordis ctx、动态 `import(\`../src/x.mjs?ts=…\`)` | 依赖 DOM ✗ |
| `docs/` | 任何说明文字 | 被代码 import ✗（文档不参与运行） |
