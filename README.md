# dsh-browser-kit

> DSH 内置浏览器增强工具集：**元素批注 · 截图回传 · 视觉反馈闭环**
> 状态：**MVP-0 接入验证完成（2026-10-04），主路径 = client plugin（混合架构）** · 本 README 是实施会话的入口文件

## 1. 项目定位

让 DeepSeek Harness（DSH，本机 Electron 桌面应用）的内置浏览器具备与 agent 协作的交互能力：

1. **元素批注（核心差异点）**：批注态下连续点选多个元素，每个元素就地钉编号标记并输入修改意见（可留空），意见与元素一一绑定；一键提交后 agent 收到的每条批注都是「意见 → 元素信息」的明确配对——弥补 ZCode「元素→会话附件」多元素无法区分描述的短板；
2. **截图回传**：一键截取当前页面，agent 拿截图做视觉识别——自动化测试与视觉验收的基础设施；
3. **设备通讯观测 + 控制台调试（SDK 无关）**：hook 在 `navigator.hid / serial / usb` 平台 API 层，任意项目、任意 SDK 通用（当前 keysion WebHID，后续其它项目其它 SDK 直接复用）；agent 能获取收发报文、页面 console 流，并执行调试操作（CDP evaluate / 注入 mock）验证通讯链路；
4. **（远期）agent 自动化**：agent 主动操作内置浏览器（navigate / click / type / snapshot / screenshot）。

**明确不做**：画笔涂鸦式批注；MVP 阶段不做后台/隐藏 tab 截图；不修改 DSH 权限策略（无必要，见调研文档 §4.3）。

## 2. 背景一页纸

- DSH 内置浏览器 = GUI 文档里按 lease 挂载的 `<webview>` guest（sandbox/contextIsolation 强制开启，main 侧 `will-attach-webview` 白名单校验）。目前它只有「看」的能力：用户无法指元素、agent 拿不到视觉。
- 对 DSH 的二进制级实测（调研文档 §4）确认：批注/截图所需能力（`executeJavaScript` / `capturePage` / `debugger`）是**宿主侧 API，不受浏览器 deny-all 权限策略影响**——与 WebHID 探测中发现的权限锁完全无关，本项目的实现不依赖也不触碰 DSH 权限配置。
- 方案主体照抄 ZCode（Z.ai 官方开源 coding agent，Apache-2.0）：它的 element picker + Markdown 上下文协议 + CDP 截图管线已在生产验证，源码已克隆本地可精读。
- **与 ZCode 的关键差异**：ZCode 把元素作为会话附件堆积，多元素时无法区分描述；本项目主形态是「点击元素 → 就地钉标 → 就地批注」，意见与元素一一绑定（交互原型：BugHerd / Marker.io 类设计协作工具；开源参照 pageflag、onlook）。

## 3. 新会话开工指引

**读单（按序）**：
1. 本 README（全景 + 纪律）；
2. [browser-annotation-and-screenshot-research.md](browser-annotation-and-screenshot-research.md)——**§0 摘要 → §4 DSH 实测事实 → §5 落地方案 → §6 路线与验收**；§2（ZCode 解剖）与 §8（文件索引）在写代码时对照查阅。

**环境事实**：
| 项 | 值 |
|---|---|
| 本项目目录 | `F:\My Code\dsh-browser-kit\` |
| ZCode 源码克隆 | `F:\My Code\ZCode\`（github.com/zai-org/ZCode，main 分支，浅克隆） |
| 插件范例仓 | `F:\My Code\zcode-dispatch\`（完整 host+client 范例 `zcode-dispatch\`；官方模板副本 `refs\templates\decoration\`） |
| DSH 应用 | `D:\DeepSeek\DeepSeek Harness.exe`（Electron 44 / Chromium 152；asar 于 `D:\DeepSeek\resources\app.asar`，**本项目不改 asar**） |
| GUI | http://127.0.0.1:19387 ；client plugin HMR 接收器已激活，但插件产物重建需 `pnpm run dev:web` watcher 或手动重建 Web 产物后刷新页面 |

**第一步（MVP-0，✅ 已完成 2026-10-04，证据与结论见 [docs/delivery-02-mvp0.md](docs/delivery-02-mvp0.md)）**：
1. ~~调 `cordis_inspect_list`~~ ✅（注意：本 harness 版本 `cordis_inspect_query` 的 `input` 参数有 bug，传对象即拒；host `Service.listService` 是静态声明目录，验证不了运行期 face 注册）；
2. ~~读插件范例源码~~ ✅ 范例在 `F:\My Code\zcode-dispatch\`（早前记录的 `dsh-plugins\` 已不存在）；
3. ~~写最小 client plugin 探测~~ ✅ 探测插件 `@local/dsh-browser-kit`（`plugin\`）已装进 desktop profile：GUI 主世界直得原生 WebViewElement，`executeJavaScript('1+1')=2`、`capturePage()` 真实 PNG、`getWebContentsId()` 全通；
4. ~~定主路径~~ ✅ **A（client plugin）为主、host 插件做落盘+工具面的混合架构**：host 插件实测运行于 `ELECTRON_RUN_AS_NODE=1` 的 dsh-desktop-host runner 子进程，**不可触达 webContents/BrowserWindow**（Path B 否决）；Path C（外挂 Chrome）不需要。

**纪律**：踩坑即记 `pitfalls.md`（本项目根，自建）；DSH 升级后回归 MVP-0 清单；移植 ZCode 代码保留 Apache-2.0 版权与 NOTICE；改动落在本项目目录内，勿散落。

## 4. 目录结构

```
dsh-browser-kit/
├── README.md                                        # 项目入口
├── NOTICE.md                                        # Apache-2.0 归属声明（ZCode 移植来源与修改说明）
├── package.json                                     # 零 npm 依赖 · Node ≥22 · scripts.test = node --test
├── .gitignore                                       # shots/ annotations/ node_modules/
├── browser-annotation-and-screenshot-research.md    # 方案调研（自足交接件，含 DSH 实测证据）
├── tasks/
│   └── zcode-task-01-portable-layer.md              # ZCode 任务01：可移植资产层（任务书）
│   ├── docs/
│   │   ├── delivery-01..12.md                          # 任务/交付记录（01 可移植层 → 12 胶囊+撤回 face）
│   │   └── mvp0-probe-state.md / mvp3-loop-state.md    # 探测期/闭环期交接件（历史留档）
├── plugin/                                            # DSH 插件 @local/dsh-browser-kit
│   ├── package.json / cordis.patch.yml                # bundle 声明（exports["."] → entry.mjs；junction+install_bundle 安装）
│   ├── entry.mjs                                      # host 入口永久薄壳（?ts=mtime-seq 击穿 ESM 缓存，pitfalls P13）
│   ├── host.impl.mjs                                  # host 业务（探测/face/落盘/_internals 测试导出；改后 toggle 即生效）
│   ├── wire.host.mjs                                  # TYPERT 描述符 + createRemoteFace（10 方法，client↔wire 对账有测试）
│   ├── client.js                                      # client 半边（探测/共享批注会话/胶囊/命令通道/工具条/面板）
│   └── .data/                                         # 运行期数据（command.json / command-results.jsonl / probe-report.json）
├── src/
│   ├── hid-observer.js                                # L1 通用设备观测（HID/Serial/USB，自包含 IIFE，零 DSH 依赖）
│   ├── element-annotator.js                           # 网页批注层 v1.5.0（picker 基座 + 共享会话/同页门控/清除，自包含 IIFE）
│   ├── annotations-protocol.js                        # 批注协议 v2 build/parse（纯函数 ESM）
│   ├── virtual-hid-device.js                          # mock 设备（ESM + 可注入 IIFE 双形态）
│   └── cdp/
│       └── drive.mjs                                  # CDP 驱动（launch/connect/inject/evalJs/console/screenshot）
├── test/
│   ├── helpers/                                       # vm 沙箱 + Chrome 冒烟公共工具
│   ├── fixtures/                                      # hid-mock-page / hid-docstart-page / page
│   ├── annotations-protocol.test.js                   # 协议 round-trip 全分支
│   ├── virtual-hid-device.test.js                     # mock 设备双形态
│   ├── hid-observer.test.js                           # observer 沙箱单测（HID/Serial/USB + detach/重注入）
│   ├── annotator-protocol-parity.test.js              # 批注层内嵌 builder ↔ ESM 协议逐字对拍
│   ├── cdp-smoke.test.js                              # CDP 五项冒烟（真实 Chrome）
│   ├── hid-fixture-smoke.test.js                      # 无硬件配对帧冒烟（evaluate 兜底注入）
│   └── annotator-smoke.test.js                        # 批注流全链路冒烟（含共享编号/门控/清除/删除日志）
├── pitfalls.md                                        # 踩坑记录 P1–P33（实施期自建）
├── README.md                                          # 本文件
├── NOTICE.md                                          # Apache-2.0 归属声明（ZCode 移植来源与修改说明）
├── package.json                                       # 零 npm 依赖 · Node ≥22 · scripts.test = node --test
└── shots/ annotations/                                # （运行期产物，已 gitignore）
```

## 5. 参考资料

| 资料 | 位置 |
|---|---|
| ZCode 源码（Apache-2.0） | `F:\My Code\ZCode\` · github.com/zai-org/ZCode |
| chrome-devtools-mcp | github.com/ChromeDevTools/chrome-devtools-mcp |
| playwright-mcp | github.com/microsoft/playwright-mcp |
| browser-use | github.com/browser-use/browser-use |
| pageflag（开源 BugHerd 替代，批注模式交互参照） | github.com/Laaaaksh/pageflag |
| onlook（AI 可视化编辑：点选元素→AI 检查/编辑，26.8k★） | github.com/onlook-dev/onlook |
| DSH 宿主实测证据 | 调研文档 §4（版本/fuse/权限/lease 机制，2026-10-04 探测） |

## 6. 当前状态与下一步

- ✅ 调研完成：ZCode 方案解剖 + 业界对比 + DSH 宿主实测 + 落地草案 + MVP 路线（见调研文档）。
- ✅ 任务01（ZCode）：可移植资产层——45/45 测试全绿（docs/delivery-01.md）。
- ✅ 任务02（主会话）：**MVP-0 接入验证**——主路径 A（client plugin）+ host 落盘/工具面的混合架构，Path B 否决（host 插件在 RUN_AS_NODE 子进程，pitfalls P14），Path C 不需要（docs/delivery-02-mvp0.md）。
- ✅ 任务03（主会话）：**MVP-1 截图管线**——client `capturePage()` → face `saveShot` → `shots/*.png` + index.jsonl，agent `read_image` 正确识别页面（keysion.cn 实测）；face 加方法免重启（pitfalls P16）（docs/delivery-03-mvp1.md）。
- ✅ 任务04（主会话）：**MVP-2 批注模式接入**——`element-annotator.js` 零改动注入 guest，机器全链路验收（合成事件 3 条批注 → `saveAnnotations` 落盘 → 协议解析 round-trip 无损）；命令通道（MVP-4 种子：`guest-eval` 等）顺带交付（docs/delivery-04-mvp2.md）。
- ✅ 任务05（主会话）：**MVP-3 闭环体验**——「批注→agent 修改→截图确认」单轮闭环全自主跑通（demo 页实物验证）；面板 ZCode 式批注图标开关 + 左下角定位；关键约束发现：guest 导航受 allowedNavigation 白名单（agent 侧用 document.write 替代）（docs/delivery-05-mvp3.md）。
- ✅ 任务06（ZCode 派发 + 主会话落地）：**host impl 单元测试**——39 项全绿（全量 83/83）；P21：headless 派发会话无许可客户端，读写类派发须 mode=yolo 或交互会话执行（docs/delivery-06-plugin-tests.md）。
- ✅ 任务07（主会话）：**MVP-4 agent 自动化命令集**——snapshot（真实页面 21 元素实测）/ click / type / reload / navigate / page-inject / page-open / guest-eval(frame)；P22 document.write 悬挂、P23 var 遮蔽、P24 iframe CSP 两道墙（docs/delivery-07-mvp4.md）。
- ✅ 任务08（主会话）：**共享批注会话 + 正式形态入口**——同会话多窗口共用批注（编号跨窗口延续、saveMerged 合并单文件）、工具条批注图标（每标签一个，尽力而为注入）+ 标签菜单项 + 面板最小化；自诊断体系（kit-status/PanelBoundary/findings.gui）（docs/delivery-08-shared-session.md）。
- ✅ 任务09-12（主会话，2026-10-05 连续迭代，docs/delivery-09..12）：**共享会话真打通 + 输入框胶囊 + 主题适配**——
  - P25/P26/P27 三根因修复（成员先入册再 start / 编号下限不双加 / webContentsId 身份统一）+ 会话自动加入（窗口1开启 → 全部窗口数秒内亮起，leftIds 防拉回）+ 导航自愈；
  - **P29 face 装配对账**（client descriptors ↔ wire 方法表漂移 = 调用静默失败，W3 静态契约守护）；P30 Lexical 输入框延迟回读（同步回读必误报）；P31 会话指纹（document.title）防胶囊跨会话泄漏；P32 tbLeft 未声明（MutationObserver 快速重挂整体失效）；
  - **ZCode 式胶囊**：提交后输入框卡片内独占一行「N 条批注 ×」，× = 撤回（deleteAnnotations face，annotations/ 围栏）；同页门控（pageOk）防徽标串窗；样式全走主题令牌（明暗双主题自适应）；
  - **face 扩到 10 方法**（+deleteAnnotations/getStats/clearArtifacts），插件管理页卡片显示批注/截图数量与字节占用 + 一键清空；
  - 调试面板默认隐藏（panel-toggle 唤出，功能保留）；清理项：死 case 分支、tbLeft、双份助手、writeArtifact 三合一、dirname 内置化。
- ⏭️ 下一步：**人工验收包**——① keysion dac vue（localhost:5173）连续 3 轮「批注→修改→截图」；② 双窗口共享批注人工确认（窗口2 编号从窗口1 最大号+1 延续）；③ 真实表单走 snapshot→type→click→screenshot 组合；④ 明暗主题下胶囊/徽标视觉复核；⑤ 向 DSH 官方提浏览器工具条插槽需求。
- 📋 队列中：MVP-5 = F4/F5（设备报文观测 + 控制台调试，调研文档 §5.5）——真实 Chrome 主路径已有 `cdp/drive.mjs` + `hid-observer.js` 全套资产；DSH 内置浏览器侧的注入走 client 插件（同 MVP-1 通道）。
- 关键修正（推翻调研文档 §4.4 预判）：host plugin 无 main 进程能力；`browserUse`/`computerUse` 等自动化属 DSH 主进程自有服务，第三方插件无门（F3 远期需求届时再评估）。
