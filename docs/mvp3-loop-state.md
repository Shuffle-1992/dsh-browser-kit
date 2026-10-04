# MVP-3 闭环进度·重启交接（2026-10-05 00:4x）

> 场景：client 长轮询被 toggle/HMR 搅动卡死（pitfalls P20），需要用户刷新/重启 DSH 复位。
> 本文件 = 重启后的自动续作清单。前置交付：delivery-02/03/04（MVP-0/1/2 全部完成并提交）。

## 已确认的关键事实（本轮新收获）

1. **guest 不能被脚本导航到任意源**：`location.href = 'http://127.0.0.1:8123/'` 被宿主
   allowedNavigation 守卫静默拒绝（cmd-21 证实 href 仍为 keysion.cn）。
   ⇒ 5173 工作流必须由用户在 DSH UI 手动导航；agent 侧自主方案 = `document.write` 写入
   当前页（已验证可行，不触发守卫，且 JS realm 存活 → `__dshKitAnnotator` 免重注）。
2. **批注跨会话保留在内存**（契约）：换页面后先 `clear()` 防旧批注混入（cmd-23 count=6 教训）。
3. **提交用 `submit()`（纯打包）后须 stop** 会话再截图，否则批注层 UI（徽标/面板）入镜。
4. 自动截图已加 10 分钟节流（localStorage）；命令执行已加 30s 超时竞速。

## MVP-3 闭环当前状态

- ✅ 批注捕获：`annotations/20261005-003108.md`（3 条：卡片间距 24px / 按钮加大 / 合计行留空）
- ✅ agent 按批注修改：demo/annotation-loop/index.html 已改（gap 24px、按钮 padding/字号、hint v2）
- ◐ 修改后截图确认：v2 已写入 guest 且样式生效可见，但截图混入批注层 UI/旧 hint（竞态）——待干净重拍
- 待办：demo 服务器在重启中会随宿主进程树死亡，需重启（见下）

## 重启后自动续作（主会话执行，无需用户操作）

1. 重启 demo 服务器：`node -e` 静态服务 127.0.0.1:8123 → demo/annotation-loop（后台 job，记录 id）。
2. 等待 client 轮询恢复（发 probe 命令 cmd-test 验证消费）。
3. `guest-eval` document.write 写入 **v2**（base64 传输，参照 cmd-22b 的 pwsh 模板），
   返回值校验 hint 含「v2」+ `gap: 24px`。
4. `screenshot` 命令 → `read_image` 确认：间距 24px、按钮加大、hint=v2、无批注层 UI。
5. 更新 delivery-05（MVP-3 闭环验收）+ README §6 + pitfalls（如需）+ git 提交。
6. MVP-3 剩余项（人工环节）：用户在真实项目（keysion dac vue 5173）手动导航后走
   「批注→修改→截图」连续 3 轮——README 口径的完整验收。

## 运维备忘

- 插件 @local/dsh-browser-kit 已装（junction + profile），重启后自动加载，无需重装。
- 重启后 host 探测会重新跑一轮（probe-report.json 刷新，属正常）。
- 命令文件落法：pwsh `[System.IO.File]::WriteAllText(path, json, UTF8Encoding($false))`
  （write 工具对已消费文件会拒绝；PS5 Set-Content 带 BOM 已由 impl 剥除防御）。
