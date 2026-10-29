# 新会话开工指引（dev onboarding）

> 给**接手本仓库的开发会话 / Agent** 的开工清单：先读什么、怎么验证、有哪些硬性规范。
> 工具使用规范另有专文：[`tool-usage-rules.md`](./tool-usage-rules.md)；踩坑记录：[`pitfalls.md`](../pitfalls.md)。

---

**读单（按序）**：
1. 仓库根 README（全景 + 纪律）；
2. [browser-annotation-and-screenshot-research.md](browser-annotation-and-screenshot-research.md)——**§0 摘要 → §4 DSH 实测事实 → §5 落地方案 → §6 路线与验收**；§2（ZCode 解剖）与 §8（文件索引）在写代码时对照查阅。

**环境事实**：
| 项 | 值 |
|---|---|
| 本项目目录 | `F:\My Code\dsh-browser-kit\` |
| ZCode 源码克隆 | `F:\My Code\ZCode\`（github.com/zai-org/ZCode，main 分支，浅克隆） |
| 插件范例仓 | `F:\My Code\zcode-dispatch\`（完整 host+client 范例 `zcode-dispatch\`；官方模板副本 `refs\templates\decoration\`） |
| DSH 应用 | `D:\DeepSeek\DeepSeek Harness.exe`（Electron 44 / Chromium 152；asar 于 `D:\DeepSeek\resources\app.asar`，**本项目不改 asar**） |
| GUI | http://127.0.0.1:19387 ；client plugin HMR 接收器已激活，但插件产物重建需 `pnpm run dev:web` watcher 或手动重建 Web 产物后刷新页面 |

**第一步（MVP-0，✅ 已完成 2026-10-04，证据与结论见 [delivery-02-mvp0.md](delivery-02-mvp0.md)）**：
1. ~~调 `cordis_inspect_list`~~ ✅（注意：本 harness 版本 `cordis_inspect_query` 的 `input` 参数有 bug，传对象即拒；host `Service.listService` 是静态声明目录，验证不了运行期 face 注册）；
2. ~~读插件范例源码~~ ✅ 范例在 `F:\My Code\zcode-dispatch\`（早前记录的 `dsh-plugins\` 已不存在）；
3. ~~写最小 client plugin 探测~~ ✅ 探测插件 `@local/dsh-browser-kit`（`plugin\`）已装进 desktop profile：GUI 主世界直得原生 WebViewElement，`executeJavaScript('1+1')=2`、`capturePage()` 真实 PNG、`getWebContentsId()` 全通；
4. ~~定主路径~~ ✅ **A（client plugin）为主、host 插件做落盘+工具面的混合架构**：host 插件实测运行于 `ELECTRON_RUN_AS_NODE=1` 的 dsh-desktop-host runner 子进程，**不可触达 webContents/BrowserWindow**（Path B 否决）；Path C（外挂 Chrome）不需要。

**纪律**：踩坑即记 `pitfalls.md`（仓库根，自建）；DSH 升级后回归 MVP-0 清单；移植 ZCode 代码保留 Apache-2.0 版权与 NOTICE；改动落在本项目目录内，勿散落。

## 工具使用规范（**硬性**，Agent 必读）

> 完整规范见 [`tool-usage-rules.md`](tool-usage-rules.md)（含自检清单与变更方式）。

1. **自持浏览器默认「小窗静默操作」，非必要不开大窗**（用户硬性要求，2026-10-10）：
   所有自动化（open / navigate / 点击 / 取文本 / 表单 / 批注）都在 **collapsed 小窗**完成；
   **要看全貌用 `browser_agent_window op=screenshot`**（内部临时展开、截完自动收回）。
   **仅当**①用户明确要求看大窗，或②必须交互式操作小窗装不下的内容时才 `op=expand`，
   **必须传 `reason`**，且用毕 `op=collapse` 收回。
   *落地*：工具 description 开头即本规范；`op=expand` 的工具结果带 `notice`（未传 reason ⇒ 明确标违规）；
   回归钉子 `test/tool-usage-rules.test.mjs`。
2. **账号与密码等凭据不可被 Agent 读取、不得进入上下文**（「钥匙」图标面板，仅本机 localStorage；见 tool-usage-rules.md 规范 2 与 	est/credential-manager.test.mjs）。
3. **不往用户输入框写任何文字**（`primeSessionInput` 类操作不得用于自动化输出）—— 见 `pitfalls.md` P89。
4. **操作前先核对落点**（多窗口/多面板场景）：报告"功能没生效"之前先证明操作确实落在目标对象上 —— 见 P95。
