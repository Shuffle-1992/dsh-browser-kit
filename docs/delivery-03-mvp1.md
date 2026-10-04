# 任务03 交付说明：MVP-1 截图管线（主会话实施）

> 任务上下文：README §6 路线表 MVP-1 · 调研文档 §5.3 截图管线草案 · 完成日期：2026-10-04
> 前置：MVP-0 混合架构定论（docs/delivery-02-mvp0.md）

## 1. 一句话结论

**MVP-1 验收达成**：client `capturePage()` → dataURL → host face `saveShot()` → `shots/<时间戳>-<标题>.png`
→ agent `read_image` 正确描述页面内容（实测 keysion.cn 登录页：品牌头/表单/主题切换/双 APP 下载卡/
备案页脚全部识别）。全程**零重启**——face 新方法经 typertGateway SRC 标记路径即时路由。

## 2. 实测证据（2026-10-04 23:47）

- `shots/20261004-234750-KEYSION.png`（175,766 字节，299×1284）+ `shots/index.jsonl` 元数据行：
  `{"at":"2026-10-04T15:47:50.396Z","file":"...","url":"https://www.keysion.cn/","title":"KEYSION","bytes":175766}`
- 触发方式：client 模块重载后「首个 guest 出现」的一次性自动截图（`autoShotLeft=1`）；
  面板 [截图] 按钮可随时手动触发，路径点击复制。
- agent 侧 `read_image` 描述（验收点）：登录页视觉结构、控件层级、版本号、备案号均正确读出。

## 3. 改动清单（plugin/）

| 文件 | 说明 |
|---|---|
| `wire.host.mjs` | face 契约一次定全（MVP-1/2 共用）：`reportClient` / `saveShot(meta, dataUrl)` / `saveAnnotations(markdown)`；方法表 4 元组带 optionals 位 |
| `host.impl.mjs` | **wire 引用同样带 `?ts=` 击穿缓存**（相对导入会丢查询参数，必须显式带——P13 变体）；`saveShotImpl`：dataURL 解码 → PNG 落盘 + `index.jsonl` 元数据；**1×1 假成功防线**（PNG<500B 判失败，ZCode 同款坑）；`saveAnnotationsImpl` 备好（annotations/<ts>.md） |
| `client.js` | 面板升级为工具面板（截图 / 上报 host / 重新探测）；`captureShot()`（元数据自取 + svc 就绪等待 + 信封拆包）；路径点击复制；一次性自动截图（验收用） |

## 4. 关键事实（记入 pitfalls/patterns）

1. **face 新方法免重启生效**：impl 对 wire.host.mjs 的 import 也带 `?ts=` 后，toggle 即换新 face 类；
   新方法经 typertGateway **SRC 原型标记路径**路由成功——typert-loader 的旧 manifest（无 saveShot）
   **不构成拦截**。 ⇒ 今后 face 加方法 = 常规热换；只有动 `entry.mjs` 薄壳本身才需要重启。
2. **client 模块会自动重载**：dsh-client-hmr 对 `dsh.client.immediately:true` 的包生效（本次刷新未请求
   用户、面板自动换新）——client 迭代体验接近热换。
3. **截图尺寸 = 面板宽度**（299×1284，侧栏窄面板）：可用但偏窄；后续如需更宽图，MVP-3 可评估
   「临时拉宽面板再截」或接受现状（调研文档未要求全页/高清）。
4. **大载荷实测**：241KB dataURL 过网关 JSON 通道无碍（此前 226KB 同此）。

## 5. 未决问题（不阻塞验收）

1. `state.shots` 在报告 JSON 里滞后一拍（报告写在截图前）——诊断字段而已，权威记录在 `index.jsonl`。
2. 自动截图只测了「页面已开」场景；guest 关闭/后台时 `capturePage` 的失败路径靠 1×1 防线兜底，
   真实表现待 MVP-3 轮次实测。
3. MVP-2 批注的提交通道（`saveAnnotations`）已备好未实测——随批注层接入时验收。
