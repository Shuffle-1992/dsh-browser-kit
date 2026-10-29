# 当前状态与下一步（status）

> 交付时点快照。**现行行为以 `src/` 与 `pitfalls.md` 为准**，本文可能滞后。

---


- ✅ 调研完成：ZCode 方案解剖 + 业界对比 + DSH 宿主实测 + 落地草案 + MVP 路线（见调研文档）。
- ✅ 任务01（ZCode）：可移植资产层——45/45 测试全绿（delivery-01.md）。
- ✅ 任务02（主会话）：**MVP-0 接入验证**——主路径 A（client plugin）+ host 落盘/工具面的混合架构，Path B 否决（host 插件在 RUN_AS_NODE 子进程，pitfalls P14），Path C 不需要（delivery-02-mvp0.md）。
- ✅ 任务03（主会话）：**MVP-1 截图管线**——client `capturePage()` → face `saveShot` → `shots/*.png` + index.jsonl，agent `read_image` 正确识别页面（公网 Vue 站点实测）；face 加方法免重启（pitfalls P16）（delivery-03-mvp1.md）。
- ✅ 任务04（主会话）：**MVP-2 批注模式接入**——`element-annotator.js` 零改动注入 guest，机器全链路验收（合成事件 3 条批注 → `saveAnnotations` 落盘 → 协议解析 round-trip 无损）；命令通道（MVP-4 种子：`guest-eval` 等）顺带交付（delivery-04-mvp2.md）。
- ✅ 任务05（主会话）：**MVP-3 闭环体验**——「批注→agent 修改→截图确认」单轮闭环全自主跑通（demo 页实物验证）；面板 ZCode 式批注图标开关 + 左下角定位；关键约束发现：guest 导航受 allowedNavigation 白名单（agent 侧用 document.write 替代）（delivery-05-mvp3.md）。
- ✅ 任务06（ZCode 派发 + 主会话落地）：**host impl 单元测试**——39 项全绿（全量 83/83）；P21：headless 派发会话无许可客户端，读写类派发须 mode=yolo 或交互会话执行（delivery-06-plugin-tests.md）。
- ✅ 任务07（主会话）：**MVP-4 agent 自动化命令集**——snapshot（真实页面 21 元素实测）/ click / type / reload / navigate / page-inject / page-open / guest-eval(frame)；P22 document.write 悬挂、P23 var 遮蔽、P24 iframe CSP 两道墙（delivery-07-mvp4.md）。
- ✅ 任务08（主会话）：**共享批注会话 + 正式形态入口**——同会话多窗口共用批注（编号跨窗口延续、saveMerged 合并单文件）、工具条批注图标（每标签一个，尽力而为注入）+ 标签菜单项 + 面板最小化；自诊断体系（kit-status/PanelBoundary/findings.gui）（delivery-08-shared-session.md）。
- ✅ 任务09-12（主会话，2026-10-05 连续迭代，delivery-09..12）：**共享会话真打通 + 输入框胶囊 + 主题适配**——
  - P25/P26/P27 三根因修复（成员先入册再 start / 编号下限不双加 / webContentsId 身份统一）+ 会话自动加入（窗口1开启 → 全部窗口数秒内亮起，leftIds 防拉回）+ 导航自愈；
  - **P29 face 装配对账**（client descriptors ↔ wire 方法表漂移 = 调用静默失败，W3 静态契约守护）；P30 Lexical 输入框延迟回读（同步回读必误报）；P31 会话指纹（document.title）防胶囊跨会话泄漏；P32 tbLeft 未声明（MutationObserver 快速重挂整体失效）；
  - **ZCode 式胶囊**：提交后输入框卡片内独占一行「N 条批注 ×」，× = 撤回（deleteAnnotations face，annotations/ 围栏）；同页门控（pageOk）防徽标串窗；样式全走主题令牌（明暗双主题自适应）；
  - **face 扩到 10 方法**（+deleteAnnotations/getStats/clearArtifacts），插件管理页卡片显示批注/截图数量与字节占用 + 一键清空；
  - 调试面板默认隐藏（panel-toggle 唤出，功能保留）；清理项：死 case 分支、tbLeft、双份助手、writeArtifact 三合一、dirname 内置化。
- ⏭️ 下一步：**人工验收包**——① 业务 Vue 项目（localhost:5173）连续 3 轮「批注→修改→截图」；② 双窗口共享批注人工确认（窗口2 编号从窗口1 最大号+1 延续）；③ 真实表单走 snapshot→type→click→screenshot 组合；④ 明暗主题下胶囊/徽标视觉复核；⑤ 向 DSH 官方提浏览器工具条插槽需求。
- 📋 队列中：MVP-5 = F4/F5（设备报文观测 + 控制台调试，调研文档 §5.5）——真实 Chrome 主路径已有 `cdp/drive.mjs` + `hid-observer.js` 全套资产；DSH 内置浏览器侧的注入走 client 插件（同 MVP-1 通道）。
- 关键修正（推翻调研文档 §4.4 预判）：host plugin 无 main 进程能力；`browserUse`/`computerUse` 等自动化属 DSH 主进程自有服务，第三方插件无门（F3 远期需求届时再评估）。
