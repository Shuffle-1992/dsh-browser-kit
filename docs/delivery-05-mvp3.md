# 任务05 交付说明：MVP-3 闭环体验（主会话实施）

> 任务上下文：README §6 路线表 MVP-3 · 调研文档 §5.3 · 完成日期：2026-10-05 凌晨
> 前置：MVP-0/1/2（delivery-02/03/04）

## 1. 一句话结论

**「批注 → agent 修改 → 截图确认」单轮闭环全自主跑通**：批注层注入 guest 合成事件批注 3 元素
（2 修改意见 + 1 留空）→ 协议块落盘 → agent 按批注修改 demo 页源码（gap 24px / 按钮 padding+字号）
→ v2 写回 guest → 截图逐项视觉确认修复生效。全程无人工搬运信息；面板改为 ZCode 式单图标开关。

## 2. 闭环证据链（时间序）

| 步骤 | 证据 |
|---|---|
| 批注捕获 | `annotations/20261005-003108.md`（v1 页 3 条）+ `20261005-010915.md`（v2 页复验 3 条，2888B） |
| agent 修改 | demo/annotation-loop/index.html：`gap 12px→24px`、`padding 6px 10px→12px 20px`、`font-size 12px→15px`、hint v2 |
| 写回 guest | cmd-51 返回地面真值：`gap:"24px"`, `btnPadding:"12px 20px"`, `btnFont:"15px"`, hint 含「v2」 |
| 截图确认 | `shots/20261005-010828-批注闭环-Demo--结算卡.png`（干净 v2 全景）——样式逐项与批注意见对应 |
| 提交落盘 | cmd-54/58 `saveAnnotations` → annotations/*.md + index.jsonl（count 解析入索引） |

## 3. 改动清单

| 文件 | 说明 |
|---|---|
| `plugin/client.js` | **批注图标开关（ZCode 式）**：面板首位单图标按钮（气泡+加号 SVG），点击开启/再点关闭，激活态实心高亮+批注数徽标；面板钉到左下角（用户反馈：浮层默认左上排布遮挡内容）；`screenshot` 命令动作；自动截图 10 分钟节流；命令执行 30s 超时竞速 + 45s 看门狗强制释放（P20） |
| `plugin/host.impl.mjs` | `saveAnnotations` 附 meta（url/title）入 index.jsonl；激活时显式 `clientModules.rebuilt(packageId)` 推送 client 模块热换 |
| `plugin/wire.host.mjs` | `saveAnnotations(markdown, meta?)` 契约（meta 可选） |
| `demo/annotation-loop/index.html` | 闭环 demo 页（v1→v2 即批注修改的实物证据） |
| `tasks/zcode-task-02-plugin-tests.md` | 派发任务书：host impl 助手单测（ZCode 额度执行，job j-muu2u9rf-0-b0c4） |

## 4. 本轮关键发现（pitfalls P18–P20 + 新事实）

1. **guest 不能被脚本导航到任意源**：`location.href` 指向 localhost 被宿主 allowedNavigation 守卫
   静默拒绝 → 5173 工作流须用户在 DSH UI 手动导航；agent 自主方案 = `document.write` 写当前页
   （不触发守卫，JS realm 存活，批注层免重注）；
2. **ConvertTo-Json 双重转义坑**：PS 单引号串里的 `\n` 是字面反斜杠+n，再经 ConvertTo-Json 变 `\\n`
   → guest 收到非法 JS（cmd-53 失败根因）；命令脚本一律用**真换行 here-string** 构造；
3. **toggle/HMR 搅动产生僵尸 client 实例**：抢走命令不回结果（cmd-26/29/41/44/45）——
   刷新页面/exe 重启清场；已加 30s 超时 + 45s 看门狗 + rebuilt 推送三层缓解（P20）；
4. **`clientModules.rebuilt`**：host 可显式推送本包 client 模块重建事件（页面端 client-hmr 消费），
   是否对第三方包必然生效待更多样本（本轮僵尸仍出现过一次）。

## 5. 未决问题

1. `saveAnnotations` 的 meta.url 落 index.jsonl 为 null（title 正常）——meta 第二参在网关 SRC 路径的
   传递待查（不阻塞：协议块内每条批注自带 URL 行）；
2. README 完整口径的「连续 3 轮」需真实项目（keysion dac vue 5173，用户手动导航）——归人工验收；
3. ZCode 派发的单测任务（j-muu2u9rf-0-b0c4）结果待回收（tasks/zcode-task-02-plugin-tests.md）。
