# dsh-browser-kit 踩坑记录（pitfalls.md）

> 纪律：踩坑即记（README §3）。格式：现象 → 根因 → 对策。

## 任务01 实施期（2026-10-04）

### P1 Node vm 沙箱不继承 Event/EventTarget/TextEncoder 全局
- **现象**：注入 IIFE 在 `node:vm` 沙箱报 `ReferenceError: EventTarget is not defined`；Serial `write('HELLO')` 的 TX `hex` 为 undefined。
- **根因**：vm context 只有纯 JS intrinsics，主 realm 的 Event/EventTarget/TextEncoder 等 Node 全局不会自动进入新 context（浏览器里有，容易想当然）。
- **对策**：`test/helpers/sandbox.mjs` 显式注入 `Event/EventTarget/TextEncoder/TextDecoder`；`src/hid-observer.js` 的 `toBytes` 全程鸭子类型（`ArrayBuffer.isView` 等），不依赖跨 realm `instanceof`。

### P2 assert.deepStrictEqual 比较跨 realm 对象与 undefined 值键
- **现象**：`deepEqual(vm数组, 主realm数组)` 报 "same structure but are not reference-equal"；`{a: undefined}` 与 `{}` 判不等（modern deepEqual 实际按 deepStrictEqual 语义比较键）。
- **根因**：跨 realm 对象 prototype 不同；`deepStrictEqual` 比较 undefined 值键的 own-key 集合。
- **对策**：vm 数组先 `Array.from` 落回主 realm；比较元素对象前用 `compact()` 剔除 undefined 值键；跨 realm TypeError 用消息正则断言而非构造器断言。

### P3 跨 realm 双重包桩（double-wrap）
- **现象**：每条 TX 记录两遍（console 打两行、断言计数翻倍）。
- **根因**：同一设备实例会以不同代理身份两次进入 `acquireDevice`（promise 结果跨 realm 传递时），而 `WeakSet.has()` 对跨 realm 代理身份不可靠 → 第二次 wrap 把 wrapper 又包了一层。
- **对策**：`wrapFunction` 给 wrapper 加非枚举标记 `__dshKitWrappedByObserver`，见标记即跳过（标记属性跨 realm 可读）；保留 WeakSet 作同 realm 快路径。

### P4 设备实例标记残留 → 重注入后采集全失效
- **现象**：第二次注入 observer 后 sendReport 不再记录（TX=0）。
- **根因**：最初把「已采集」标记定义在**设备实例**上（`defineProperty(dev, '__dshKitObservedByObserver')`），detach 不可能遍历 WeakSet 清理页面对象上的标记 → 新实例看到标记直接跳过采集。
- **对策**：标记只放**每实例自己的 WeakSet**（detach 时实例整体废弃）；镜像监听用 `mirrorRecords.some(target+type)` 同实例去重。教训：**「防重」标记放在会随实例废弃的结构里，不要放在页面对象上**。

### P5 USB transferOut 记 TX 取错参数
- **现象**：`transferOut(1, data)` 的 TX hex 为空。
- **根因**：`bytes: isControl ? b : a` —— transferOut 是 `(endpoint, data)`，data 是第 2 参；写成了第 1 参（endpoint 号）。
- **对策**：两类 OUT 传输的 data 均为第 2 参，统一 `bytes: b`。

### P6 测试间共享类原型残留
- **现象**：observer 单测首测过后，后续测试 TX 全部记录到旧实例（防重标记跳过了新实例的 wrap）。
- **根因**：`VirtualHIDDevice.prototype` 是模块级共享对象，测试 1 的 wrap 不清理会跨测试残留。
- **对策**：`afterEach` 统一 `__dshKitHidObserver.detach()` 还原原生。教训：**改 prototype 的测试必须在 afterEach 还原**。

### P7 since 过滤的毫秒边界竞态
- **现象**：`dump({since: cutoff})` 断言 1 条，偶发 4 条/3 条。
- **根因**：快机器上 getDevices+open+sendReport 整段在 1ms 内完成，`Date.now()` 截止值与早期条目同毫秒，`>=` 全部命中。
- **对策**：时间相关断言只用确定性远 past/future 值 + ISO/epoch 同参等价断言，不比较「当前时刻」。

### P8 `node --test test/` 目录形式在 Windows 不可用
- **现象**：`npm test`（`node --test test/`）报 `Cannot find module '...\test'`；显式文件列表与 glob 可用。
- **根因**：Windows 下 npm→cmd 传参后，目录形式被当模块入口解析（Node 24.14.1 + npm 11.11.0）。
- **对策**：`package.json` 用 `node --test` 默认发现模式（自动扫描 test/ 目录，45 项全过）。

### P9 Chrome 关闭后立即删 user-data-dir 报 EPERM
- **现象**：`close()` 里 `rmSync` 偶发 `EPERM, Permission denied`（时序性 flake）。
- **根因**：taskkill /F 后 renderer/crashpad 未完全退出，user-data-dir 仍被锁；固定 sleep(300) 不够。
- **对策**：`close()` 轮询所有 `proc.exitCode !== null`（上限 5s）再删；`rmSync` 重试预算加到 12×250ms。

### P10 Chrome 后台窗口定时器节流
- **现象**：fixture 的 60ms 应答定时器偶发推迟超过 200ms，固定 sleep 后 RX 缺失。
- **根因**：Chrome 对非前台/启动繁忙窗口的定时器队列会节流/合并。
- **对策**：冒烟测试用 `waitFor(谓词, 5000)` 轮询代替固定 sleep；异步条件一律轮询。

### P11 file:// 下 ES Module 不可用（设计约束，非缺陷）
- **现象**：冒烟 fixtures 用 file:// 加载（避免常驻 HTTP 服务），`<script type="module" src>` 会因 opaque origin CORS 直接失败。
- **对策**：ESM 模块仅供 Node 侧 import；浏览器注入一律走自包含 IIFE（协议 builder 在批注层内嵌副本，由 parity 测试逐字对拍防漂移）；fixture 用经典 `<script>` 内联伪造。

### P12 ZCode 协议 v1 的两个解析缺陷（移植时的设计修正）
- **现象**：v1 `parsePromptWebElementContexts` 丢弃 Rect/Attributes；`appendOptionalLine` 截断时在行字段内插入 `\n\n[truncated]` 会破坏行式解析（>8000 的 Selector 尾部丢失）。
- **对策**：协议 v2 parse 无损还原 Rect/Attributes；行字段截断改为行内 `[truncated]`（围栏字段沿用 v1 的 `\n\n[truncated]`）。已在 `src/annotations-protocol.js` 头注登记。

## MVP-0 实施期（2026-10-04）

### P13 host 插件入口模块被 Node ESM 缓存，toggle 不换新代码
- **现象**：`plugin_manager set_plugin`（disable→enable）后 `apply()` 确实重跑（探测报告时间戳更新），但跑的是**旧模块实例**——模块级 `startedAt` 不变、新加的字段不出现；换 `exports["."]` 指向新文件、重跑 `install_bundle` 都无效（后者报 `ambiguous-install`，已装的包须走 set_plugin）。
- **根因**：入口模块由 loader 经 Node ESM 加载并缓存（按 resolved URL + 包 exports 解析缓存，进程内不失效）；disable/enable 只重跑缓存的 `apply()`，不重新 import。**entry 模块自身无法热换**。
- **对策**：双层结构——入口 `entry.mjs` 保持**永久薄壳**（只做动态 import 转发，改它 = 又要重启）；业务全放 `host.impl.mjs`，每次 apply 按「impl 文件 mtime + 激活序号」构造带查询参数的 import URL（`./host.impl.mjs?ts=<mtime>-<seq>`）——参数变 ⇒ Node 视为新模块 ⇒ 免重启热换。**引导成本**：薄壳首次生效前仍需一次 DSH 重启。
- **附**：client 半边（client.js）无此问题——页面刷新即加载新代码。

### P14 `import('electron')` 静默返回空壳——host 插件根本不在 Electron 主进程
- **现象**：MVP-0 首测 `await import('electron')` 不抛错且 `process.versions.electron = 44.0.0`，但取 `webContents` 报 undefined；CJS require 从任何根都 `Cannot find module 'electron'`。
- **根因（重启后进程身份鉴定一锤定音）**：host 插件运行在 **`ELECTRON_RUN_AS_NODE=1` 的 desktop-host runner 子进程**（argv 指向 `app.asar\dsh\...\dsh-desktop-host\lib\index.js`；`process.type=null`、`Module.builtinModules` 不含 `'electron'`）。RUN_AS_NODE 下 Electron 主进程 API（webContents/BrowserWindow）**架构性不可达**；`import('electron')` 被 loader 的互操作层吞成 `{default:{}, "module.exports":{}}` 空壳——**「不抛错」不等于「加载成功」，必须校验导出面**。
- **对策**：`extractApi` 按 `[mod, mod.default, mod.default.default, mod['module.exports']]` 找带 `webContents/app` 的对象，找不到即判定不可达（本次即此结局）；`processIdentity` 记录 type/argv/execPath/builtinModules 入报告。**Path B（host 直触 guest）否决**；host 半边定位改为落盘 + agent 工具 + client→host face（docs/delivery-02-mvp0.md §2.2/§4）。

### P15 client 顶层 ctx 直取自挂远端命名空间被 cordis 守卫拒
- **现象**：client 插件 `$mount` 后直接 `ctx.remote.dshBrowserKit.reportClient(...)` 报 `cannot get property "remote.dshBrowserKit" without inject`，上报失败。
- **根因**：cordis 对 ctx 属性访问按 `inject` 声明守卫；自挂命名空间不能写进顶层 `inject`（会等自己→web boot 死锁，zcode-dispatch client.js 头注警告过），顶层直取也不行。
- **对策**：官方公开 API `ctx.remote.$mount({package, descriptors})` 在 apply 里立即挂载（结果留痕），另开**子 fiber** `ctx.inject(['remote.<名>'], (scope) => { svc = scope.remote.<名> })`——子作用域声明只影响该 fiber，缺席时 pending 不阻塞条目；上报代码只消费子 fiber 存下的 svc（等就绪轮询 300ms×27）。与 zcode-dispatch 的 live 数据通道同款。

### P16 相对导入丢查询参数——wire 也被缓存，face 新方法「看起来注册了却调不到」
- **现象**：impl 用 `?ts=` 动态加载后，若 impl 顶部仍静态 `import './wire.host.mjs'`，该相对导入解析回**无参数的规范 URL** → 命中进程级缓存的旧 wire → face 类没有新方法（原型标记也不含）。
- **根因**：URL 相对解析只保留路径段，base 的查询参数不继承（`'./x.mjs'` 相对 `'/d/impl.mjs?ts=1'` 解析为 `'/d/x.mjs'`）。
- **对策**：impl 内改为 `import(\`./wire.host.mjs?ts=${随机}\`)` 动态加载。**正面结论（MVP-1 实测）**：face 新增方法（saveShot）经 typertGateway **SRC 原型标记路径**即时路由成功——typert-loader 的旧 manifest 不拦截；⇒ face 迭代也是纯热换，唯一要重启的场景只剩改 entry.mjs 薄壳本身。

### P17 capturePage 的 1×1 假成功要代码层设防
- **现象**（ZCode 同款坑，调研文档 §5.3 已预警）：guest 隐藏/后台时 capturePage 可能假成功返回 1×1 图。
- **对策**：host `saveShotImpl` 对解码后 PNG < 500 字节直接判失败并如实返回错误（`疑似 1×1 假成功`），不落盘。
