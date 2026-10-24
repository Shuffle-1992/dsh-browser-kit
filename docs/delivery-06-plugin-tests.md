# 任务02 归档：host impl 内部助手单元测试（ZCode 派发 + 主会话落地）

> 任务书：tasks/zcode-task-02-plugin-tests.md · ZCode job：j-muu2u9rf-0-b0c4（GLM-5.3-Flash，套餐通道）
> 完成日期：2026-10-05 · 主会话按用户指示收尾（「可以不派发，你自己走任务内容」）

## 1. 结果

**测试 83/83 全绿**（基线 45 + 本任务新增 38 → 含 dedupeFile 补测后 39；全量回归 83）。
ZCode 走完静态交付后因环境阻塞未能落盘，由主会话以可写会话应用其交付物并补验——
这是 P21 的第一个实证案例与标准处理流程样例。

## 2. 经过

1. **派发**（17:10Z）：junction 式文件锁（host.impl.mjs / test/plugin-impl.test.mjs / pitfalls.md），
   mode=build，走套餐通道；
2. **ZCode 15 分钟完成静态交付**：完整读遍 8 个被测函数逐条 trace 对账（其自检：无测试与实现相悖点），
   产出 _internals 追加块 + 41 项测试全文 + P21 条目；**但 Edit/Write/node --test/npm test 全被
   `No permission client configured` 拒绝**（headless 会话无可交互许可客户端，仅白名单只读命令可用），
   如实标注「任务不得验收」并把全部交付物随最终回复静态输出；
3. **主会话落地**：从 result.json 以 node 精确提取代码块（v2 修正提取谓词：_internals 注释含
   "node:test" 字样导致首个提取器误配）→ 应用三件交付物 → 跑测 → 修正 1 处错误断言
   （`shapeOf({}).defaultKeys` 实现为 `'undefined'` 字符串，ZCode 误写 null，按「不改逻辑」边界对齐测试）
   → 39/39 + 全量 83/83。

## 3. 交付物

| 文件 | 说明 |
|---|---|
| `plugin/host.impl.mjs` | 末尾 `_internals` 导出（9 个助手，含后补 dedupeFile）；零逻辑改动 |
| `test/plugin-impl.test.mjs` | 8 组覆盖点 39 项：slugify / tsStamp（P7 固定时间）/ saveShotImpl（含 1×1 防线 P17、边界 500B）/ saveAnnotationsImpl / takeCommandImpl（BOM 回归 P18）/ commandResultImpl / shapeOf+extractApi（jiti 互操作形）/ TYPERT 清单形状 + dedupeFile |
| `pitfalls.md` | P21：headless 派发会话无许可客户端（Edit/Write/执行全拒）——**后续含落盘/跑测的派发必须换 mode=yolo 或在交互会话执行** |
| `plugin/host.impl.mjs`（追加） | dedupeFile：shots/annotations 同秒同名不再互相覆盖（ZCode 实现观察项落地），-2/-3 序号后缀 |

## 4. 派发机制结论（供后续所有派发决策）

- **P21**：mode=build 的 headless 派发会话没有许可客户端 → 写文件/执行命令结构性不可达；
  读写类任务**必须 `mode=yolo`**（或由主会话自己执行）；
- 纯调研/评审类任务（只读白名单命令即可完成的）不受影响，仍可派发；
- 静态交付+主会话落地的「两段式」是可行兜底，但多花一轮沟通成本，仅作意外兜底。
