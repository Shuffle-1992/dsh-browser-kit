# 任务06 交付说明：MVP-4 agent 自动化操作（主会话实施，夜间自主推进）

> 任务上下文：README §6 路线表 MVP-4（F3 裁剪版）· 完成日期：2026-10-05 凌晨
> 前置：任务05 的命令通道（takeCommand/guest-eval 骨架）

## 1. 一句话结论

**MVP-4 命令集落地并实测**：`snapshot`（可交互元素快照 + ref 手柄）在真实公网页面
（keysion.cn）一次捕获 21 个元素（含输入框/按钮/链接，带 placeholder/type/text）；`click`/`type`
（合成事件 + 原生 setter，机制与已验证的批注驱动脚本同源）；`reload`/`page-inject`/`page-open`/
`page-close`/`guest-eval(frame)` 全部接通。**导航受宿主白名单限制**（脚本只能同源 reload）——
跨源导航须用户在 DSH UI 手动执行，已如实写进命令返回值。

## 2. 命令集最终形态（agent 侧经 `.data/command.json` 驱动）

| action | 参数 | 说明 |
|---|---|---|
| `snapshot` | — | 可交互元素快照：ref/tag/id/text/placeholder/type/value，最多 120 项；ref 落在 `data-dsh-kit-ref` |
| `click` | `ref` 或 `selector` | 合成 MouseEvent（capture 拦截页自身行为不适用——这是普通派发点击） |
| `type` | `ref`/`selector` + `text` | 原生 value setter + input/change 事件（绕过 React/Vue 受检组件的 setter 拦截） |
| `reload` | — | 同源刷新（fire-and-forget，P19） |
| `navigate` | `url` | 尝试跨源导航；**白名单内才可能成功**，返回 currentHref 供核对 |
| `page-inject` | `html` | 整页注入（innerHTML 原语；见 P22/P24 的适用边界） |
| `page-open` / `page-close` | `html` | iframe srcdoc 沙箱（受宿主页 CSP 制约，见 P24） |
| `guest-eval` | `code`, `frame?` | 任意求值；`frame:true` 在沙箱文档内执行 |
| 其余 | — | MVP-2 的批注/截图/上报命令不变 |

## 3. 实测证据

- cmd-81 `snapshot` on keysion.cn：21 项全捕获——`input#loginAccount(text)`、
  `input#loginPassword(password)`、登录提交按钮、`styleLightLogin/styleDarkLogin`（暖晨/夜黑）、
  `downloadAndroidBtn(版本：1.4.0)`、`downloadHarmonyBtn(版本：1.3.8)`、备案/协议链接、
  DAC 工作模式区块（Class-H / Class-AB）——**ref 体系可直接驱动 click/type**；
- cmd-66 `reload`、cmd-68 `navigate`（白名单拒绝行为记录）、cmd-70 `page-open`、
  cmd-78 `page-inject` 全部按设计返回。

## 4. 本轮踩坑（P22/P23，详见 pitfalls.md）

- **P22**：`document.write` 整页写入在宿主页资源未静止时，executeJavaScript **永久悬挂**
  （cmd-41/63 消失级失败）；innerHTML 原语虽多数情况可靠，但在活跃 SPA 响应式刷新窗口内
  会被框架重绘覆盖（cmd-78/79）→ 整页注入只适合「注入后立即使用」的场景；
- **P23**：`var DOC = document; var document = DOC;` 的包裹层写法——var 提升让全函数体的
  `document` 变 undefined，所有 guest-eval 必抛（cmd-72/73）；**必须用函数参数传 document**
  （参数遮蔽安全）。此类错误的症状（"Script failed to execute"）不指明位置，排查成本高，
  特此记录；
- **P24**（随 delivery 记录）：iframe `srcdoc` 沙箱在公网页面宿主下会被页面 CSP 拦成空文档
  （cmd-70/77，bodyLen=15）——沙箱方案需目标页面无严格 CSP（用户自己的 dev server 页面不受影响）。

## 5. 使用约束（写给未来的 agent 会话）

1. snapshot → 按 ref click/type 是标准驱动流；ref 在每次 snapshot 后重排；
2. 跨源页面切换必须用户手动导航；同源 reload 可用；
3. `page-inject`/`page-open` 仅用于**用户自有 dev 页面**上的演示/测试注入，公网 SPA 上不保证持久；
4. 命令一律「立即返回」语义，30s 超时 + 45s 看门狗 + takeCommand 10s 竞速三重保险已就位。

## 6. 未决问题

1. `type`/`click` 尚未在真实登录表单上单独走一遍（机制同批注驱动脚本，风险低）；
2. `navigate` 若未来 DSH 开放白名单配置，可解锁全自动跨源导航；
3. MVP-4 完整口径（navigate/click/type/snapshot/screenshot 组合完成一次表单填写并截图验证）
   需要一个用户自有的表单页——建议与 MVP-3 的 5173 验收合并进行。
