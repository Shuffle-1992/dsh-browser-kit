# 审查证据说明

对应 [全面审查报告](../项目全面审查报告-2026-10-27.md)。时间：2026-10-27，时区 Asia/Shanghai。

## 文件与口径

- `baseline.json`：开始时 HEAD、工具版本及全部跟踪文件 SHA-256。
- `code-integrity.json`：77 个产品/测试/市场文件内容未改变；记录外部 `92798cd` 文档整理。
- `tests-serial.txt`：首轮受限环境运行，3 个 Chrome 失败，不是最终验收。
- `browser-smoke-unrestricted.txt`：同一浏览器代码在受限环境外通过。
- `tests-final.txt`：最终完整串行门禁，279/278/0/1（总数/通过/失败/跳过）。
- `targeted-probes-browser.json`：最终 11 个定向验证结果；`reproduced:true` 表示问题被复现，不表示已修复。
- `targeted-probes.json`：中间纯 Node 子集结果；最终以 browser 版本为准。
- `source-extracts.json`：从当前 `plugin/client.js` 提取的运行函数、起始行和截取边界；只规范化 CRLF 为 LF，不改函数逻辑。
- `temporary-script.json`：测试脚本路径及删除前哈希；脚本已按要求删除。
- `syntax-checks.json`：30 个脚本语法检查。
- `dependency-audit.json`：受限网络下失败的首次尝试；不是有效漏洞结论。
- `dependency-audit-live.json`：在允许网络的执行环境取得的有效 npm audit 结果。
- `pack-dry-run.json`、`pack-summary.json`：本机打包预演清单和汇总，包含路径/大小，不含运行日志内容。预演时为 `7250a79` 文档布局；后续 `92798cd` 仅在发布清单增加根 pitfalls，并未改变 `plugin/` 的宽泛包含规则。
- `market-validation.txt`：本地来源门禁失败、官方解析通过的原始输出。其“would install a 404”是验证器推断，未由远端请求证实。
- `remote-heads.txt`：只读远端查询的凭据错误。
- `official-local-sources.json`：读取过的官方 DSH 0.2.1-rc.2 缓存源码路径与哈希；用于安装规则核对，不代表对最新 DSH 版本的兼容证明。

## 定向验证方法

所有凭据、设备路径、会话 id 都是虚构值；未接入当前 DSH，不写它的 `.data/command.json`。文件通道测试只在 `test/.review-probes-*` 隔离目录运行，结束后检查绝对路径在 `test/` 内再清理。

| 结果 id | 方法及断言 |
|---|---|
| session-owned-window | 执行原 `scopeCheck` 和 `inputTargetOf`，A 有自持窗口、B 无面板；断言 B 未被拒绝且选中 A 的替身窗口 |
| credential-http-downgrade | 原 `credMatch` 输入 HTTPS 保存项与同 host HTTP 页面；断言命中 |
| gui-eval-credential-channel | 原 handler 运行于只有哨兵 localStorage 的独立 VM；断言哨兵返回，未访问真实存储 |
| hid-queue-no-grant | VM 网页只创建请求队列，不装 shim/选择器；原 `pumpHidOnce` 将虚构设备路径交给 face 替身 |
| watchdog-resets-fresh-command | 抽取原 45 秒 interval 回调；busySince 为 100ms 前，直接模拟周期 tick；断言 busy 被清且 epoch 推进 |
| expired-command-still-executable | 实际 `runBrowserCommand` 设置极短宿主期限；超时后执行实际 `takeCommandImpl` 仍取回 click 信封 |
| result-byte-limit-not-enforced | 实际 `commandResultImpl` 写单条 3MiB 哨兵结果；断言轮转后文件仍大于 2MiB |
| root-package-entry | 将根清单放入无默认 index 的隔离包目录，执行 Node 包解析；断言 MODULE_NOT_FOUND；结合实际 pack 清单及官方 resolver 审查 |
| annotation-pending-overwrite-and-error-loss | 执行原 `registerAnnotDelivery`，官方消息工厂替换为受控失败函数；两次登记只剩一批，工厂失败后 pending 为 0 |
| guest-mirror-script-execution | 原 `syncAnnotMirror` 在独立 headless Chrome 执行，webview 返回值用虚构 HTML 替身；无网络图片错误事件写入宿主哨兵标记 |
| autofilled-password-in-element-tool | 独立 headless Chrome 创建登录表单；运行原 `fillCredential` 与原 `element` handler；工具结果包含哨兵密码 |

上述替身的角色分别是平台边界、几何/元信息、授权设备服务或官方消息工厂；没有用重新实现的业务函数替代被测函数。前两个浏览器验证没有使用 DSH CSP、Cordis 或真实 webview，其适用边界在主报告中列明。

## 可复跑的仓库门禁

```powershell
npm test -- --test-concurrency=1 --test-reporter=tap
npm --prefix plugin audit --omit=dev --json
npm pack --dry-run --ignore-scripts --json
node market/verify-index.cjs
```

这些命令不等价于完整 DSH 实机验收。打包预演不会上传或发布；若目录中有真实运行数据，不应将预演结果中的候选文件当作已获准发布的内容。

按当前任务边界，未修改业务代码，未提交或推送 Git。
