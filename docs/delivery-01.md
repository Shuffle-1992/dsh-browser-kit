# 任务01 交付说明：可移植资产层（portable layer）

> 任务书：`tasks/zcode-task-01-portable-layer.md` · 实施会话：ZCode · 完成日期：2026-10-04
> 环境：Windows 10 · Node v24.14.1 · Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`）

## 1. 一句话结论

任务书 §3 全部六项产出已实现并通过运行时验收：`npm test`（= `node --test`）**45/45 全绿**（含真实 Chrome 冒烟 ×6），零 npm 依赖，零 DSH 依赖，全部产物只落本项目目录。

## 2. 改动清单

| 文件 | 行数 | 说明 |
|---|---|---|
| `src/hid-observer.js` | 933 | L1 通用设备观测（自包含 IIFE）：`window.__hidLog` / `__dshKitHidObserver.detach` / `__DSH_KIT_OBSERVER_VERSION` 契约；HID（sendReport TX + inputreport 镜像 RX + open/close + getDevices/requestDevice/connect/disconnect）、Serial（write TX + open/close + data 事件镜像 best-effort + getPorts/requestPort）、USB（transferOut/controlTransferOut TX + transferIn/controlTransferIn RX + open/close）；惰性 patch（navigator getter 代理，首次访问装桩）；ring 500 可配；decoder 注册表（记录时 + 追溯）；console `[HID]` 通道可关；detach 全还原；防重注入 |
| `src/element-annotator.js` | 1425 | 网页批注层（自包含 IIFE）：ZCode picker 基座（hover 高亮/popover/capture 拦截/payload 全字段）+ 批注状态机（编号徽标文档坐标钉标、就地意见输入可留空、页内面板、submit 打包）；密码框跳过；stale 置灰 + `[element no longer matched]`；剪贴板降级链；opts.onSubmit 出口；内嵌协议 builder（与 ESM 逐字对拍） |
| `src/annotations-protocol.js` | 285 | 协议 v2（纯函数 ESM）：`buildAnnotationsMarkdown` / `parseAnnotationsMarkdown` 对偶；CRLF 容忍；字段截断 8000；stale；visibleContent |
| `src/virtual-hid-device.js` | 198 | mock 设备双形态：ESM（`VirtualHIDDevice`/`createVirtualHidWorld`）+ 可注入 IIFE（`buildVirtualHidInjectScript`，函数即模板） |
| `src/cdp/drive.mjs` | 406 | CDP 驱动（Node ≥22 原生 WebSocket，零依赖）：launch（Chrome/Edge 自动探测、临时 profile）/connect/inject（document_start + 当前文档兜底）/evalJs（returnByValue+awaitPromise+userGesture，异常透传）/consoleStream/screenshot（viewport+fullPage）/close（进程树清理 + 临时目录删除） |
| `test/`（7 套件 + 2 助手 + 3 fixtures） | ~1290 | 见 §3 |
| `package.json` / `.gitignore` / `NOTICE.md` / `pitfalls.md` / `README.md`（仅目录段） | — | 任务书边界内（`.gitignore` 经所有者批准扩界） |

## 3. 验收证据（DoD 逐条，DoD 以运行时表现为准）

命令统一为项目根执行 `npm test`（= `node --test`，默认发现模式）。

1. **node --test 全绿** —— `ℹ tests 45 · pass 45 · fail 0`（连续 4 次运行稳定）。
2. **协议 round-trip 全分支** —— `test/annotations-protocol.test.js` 15 项：全字段+Note / 无 Note / stale / 围栏截断 8000+`[truncated]` / 行字段行内截断 / Note 单行化截断 / CRLF+裸 CR / visibleContent / 空列表与非法输入 / 极简条目（对齐调研文档样例 Annotation 2）/ 围栏正文含 `Note:` 不误读 / Attributes 转义 / Font 拆解 / 手工编辑容忍。
3. **hid-observer 沙箱双测** —— `test/hid-observer.test.js` 15 项（Node vm + mock 设备）：EVENT/OPEN/TX/RX/CLOSE 顺序、hex/ascii/len/reportId/设备描述符、version 契约、entries 只读快照、ring 上限裁剪、dump/filter 全分支（dir/api/op/device/since/limit）、decoder 追溯+异常隔离+同名覆盖、export JSONL（无 bytes 本体）、clear、consoleChannel 开关与 32 字节 hex 预览、detach 全还原（方法/描述符/全局/镜像）、重注入防重、Serial write+data 镜像、USB transfer/control 全套、空页面安全、connect 事件镜像。Chrome 侧 `test/hid-fixture-smoke.test.js`：内联伪造 navigator.hid（observer 注入**前**）→ 页面按钮收发 → TX `a1 0c 00 0c 00 00` / RX `0c 4b 45 59 53 00` 配对帧 + 时序断言 + 镜像不消费（fake 自身收到报文、页面状态正常）+ JSONL export。
4. **annotator 冒烟 + round-trip** —— `test/annotator-smoke.test.js`：真实 CDP 鼠标点击 → 页面 click 处理器零记录（capture 拦截生效）→ 徽标 pending/confirmed → 就地意见 → 留空意见 → 密码框跳过 → 元素移除后 stale → API submit → `parseAnnotationsMarkdown` 对拍（selector/accessibleName/rect/Note/stale 全部还原）→ 面板提交 → onSubmit 回调 → submitted 收束 → 图层清理 → Esc cancelled → store 保留语义 → clear。`test/annotator-protocol-parity.test.js`：内嵌 builder 与 ESM 协议对相同输入**逐字一致**（4 组 case）且 round-trip 无损。
5. **cdp 冒烟五项** —— `test/cdp-smoke.test.js`（真实 Chrome）：launch/connect（含随机空闲端口与端口占用快速失败路径）、inject（`addScriptToEvaluateOnNewDocument` 对新导航自动生效，docstart 页 `getDevices` 被捕获 + 当前文档 evaluate 兜底）、evalJs（求值/异常透传/userGesture）、consoleStream（console.log 多参数归一化）、screenshot（viewport + fullPage PNG 签名校验）、close()（进程树终止 + 临时 userDataDir 删除 + 调用方自备目录保留）。
6. **NOTICE.md** —— 登记移植来源（webElementPickerScript.ts / webElementContext.ts，Copyright 2026 Z.AI Co., Ltd，Apache-2.0）、修改说明与原创文件清单。
7. **踩坑记录** —— `pitfalls.md` 12 条（P1–P12），均含现象/根因/对策。

测试后无遗留脚本：调试用临时脚本已删除（测试套件本身为交付物，保留于 `test/`）。

## 4. 设计决策与文档差异（任务书 §4 要求「在交付说明提出」）

1. **命名冲突裁决**：调研文档 §5.2 写 `data-dsh-element-picker`/`data-dsh-annotation-marker`/`__dshWebElementPicker`，任务书 §3.2/§4 钉死 `data-dsh-kit-*`/`__dshKitAnnotator`。两处矛盾已由项目所有者裁决：**以任务书为准**。
2. **单文件双形态的实现方式**：JS 单文件无法既合法 ESM 又可经典 `<script>` 加载（`export` 是语法错误）。mock 设备的「可注入 IIFE」按 ZCode 同款「函数即模板」导出（`buildVirtualHidInjectScript`）；批注层的协议 builder 以内嵌副本 + parity 测试对拍防漂移（file:// 下 ESM 模块加载被 CORS 拦截，见 pitfalls P11）。
3. **协议 v2 对 v1 的修正**：v1 parse 丢弃 Rect/Attributes、行字段截断插 `\n\n` 破坏行解析——v2 按任务书「无损还原」要求修正；`Status: [element no longer matched]` 为 v2 新增的 stale 载体行（调研文档只给了标记文案，未定义行格式）。
4. **entries 语义**：`__hidLog.entries`/`dump()` 返回**数组快照 + 条目对象共享**——数组增删不影响 ring，但 decoder 对条目的 `op/note` 回填必须对外可见（契约「自动填充」），故不做条目深拷贝。
5. **JSONL export 不含 bytes 本体**：`hex` 字段无损承载字节（契约的 `bytes` 是 Uint8Array，JSON 序列化会退化成稀疏对象）。
6. **Serial RX 局限（如实声明）**：标准 Web Serial RX 走 readable 流，无 DOM 事件可镜像；按任务书做 `data` 事件镜像 best-effort（SDK/页面自派发时可观测），代码与交付文档双处注明。
7. **注入时机边界**：`document_start` 语义由注入方保证；脚本惰性 patch（首次访问 `navigator.hid/serial/usb` getter 才装桩），`dump()/export()` 会强制补挂（晚注入兜底）。页面若在 observer 评估**之后**用 defineProperty 顶层替换 `navigator.hid`，观测受限于该新对象的原型链（代码头注已声明）。
8. **headless**：任务书钉死默认非 headless，未做默认改动；如需 CI 静默运行可传 `launch({ headless: true })`（已支持，未默认）。

## 5. Review / 优化 / Simplify 自检结论

- **Review**：静态检查零 `innerHTML`/`eval`/`new Function`（面板/列表/toast 全部 `textContent` 赋值，无 XSS 面）；事件拦截与 ZCode 同构（capture + `stopImmediatePropagation`）；前端规范合规（无 emoji、无渐变、SVG 图标、命名空间隔离）。
- **优化（性能/安全/健壮性）**：bytes 录制时拷贝防篡改；解码器异常隔离；环形上限防内存失控；`close()` 进程树清理 + 目录删除重试；冒烟全轮询化（消除 3 处时序 flake，见 pitfalls P7/P9/P10）。
- **Simplify**：删除死状态 `hoveredElement`、冗余参数 `argIndex`/`onceEvent.setup`；USB OUT 两分支合并 `bytes: b`；测试间共享原型统一 afterEach 还原。

## 6. 未决问题与建议（不阻塞验收）

1. **DSH 接入（MVP-0）**：本任务不含；`inject()` 的 `addScriptToEvaluateOnNewDocument + evaluate 兜底` 双保险即为 Path A/B 预留的接入口。
2. **L2 语义解码器**：`__hidLog.registerDecoder` 注册表已就绪，业务解码器属后续独立任务（业务前端仓，本任务未触碰）。
3. **真实硬件断言**：属 MVP-5 用户验收环节；现有冒烟已覆盖无硬件全链路，接入真机后仅需补一条配对帧断言脚本。
4. **杂项**：`textarea` 围栏内容若含 ``` 串会破坏协议围栏（ZCode v1 同款已知限制，未在 v2 处理，样本页可规避）；如需支持可改用转义或缩进围栏（建议保持与 ZCode 兼容，暂不动）。
5. **git**：按所有者裁决以本目录为独立仓库初始化并提交（见 §7）。

## 7. git 状态

`git init` 于 `F:\My Code\dsh-browser-kit`（独立仓库，父仓库不受影响），首次提交含本任务全部产出；`.gitignore` 忽略 `shots/ annotations/ node_modules/`（所有者批准的扩界项）。
