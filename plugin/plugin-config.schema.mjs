/**
 * plugin-config.schema.mjs —— bundle config schema（DSH 插件详情页「配置区」的存在条件）。
 *
 * 为什么需要：Cordis Inspect 取证（2026-10-05）——DSH 的插件详情页只在 bundle
 * **声明了 config schema** 时才渲染配置区（`plugins.bundle.config` 卡片的宿主）；
 * 无 schema 的 bundle 在 Config provider 里 status = "absent"，卡片与说明都无处落。
 * 实测对照：dsh-connect-trae / @local/dsh-connect-zcode 均 status="schema" → 卡片可见；
 * 本插件原为 "absent" → 卡片注册成功（active:true）但页面上无内容。
 *
 * 为什么不用 schemastery（`import z from "@deepseek-ai/schemastery"`）：
 *  1. 本包是 link: 插件，裸 import 该包在 DSH 进程内解析不到（它在 app.asar 内嵌
 *     node_modules；profile 树无此包）——实测 profile 与 asar.unpacked 均无该目录；
 *  2. zcode/trae 走的是「宿主候选链」动态 resolve（见 zcode lib/host-modules.js 的
 *     resolveSchemastery，含 asar 路径推导与 env 逃生口）；其注释明确：拿不到时可退回
 *     **手写 schema**，代价仅是 volatile 标记缺失（写入门禁场景才需要）；
 *  3. 本插件的配置项都是普通标量/数组，不需要 volatile 语义。
 * 故用纯对象字面量声明：零依赖、加载期不可能失败。
 *
 * 字段说明：这些 config 项目前仅作为「声明存在」的载体（详情页配置区 + 未来可调项）；
 * 运行时读取见 host.impl.mjs 的 apply(ctx, config, paths)。
 */

/** 顶层 schema：DSH/cordis 读取入口模块的静态导出 `Config`。 */
export const DSH_BROWSER_KIT_CONFIG_SCHEMA = {
  type: 'object',
  description: 'dsh-browser-kit 运行参数（当前均为可选；缺省即默认行为）',
  properties: {
    debugPanelDefaultHidden: {
      type: 'boolean',
      default: true,
      description: '调试面板默认隐藏（true）还是默认展开（false）；运行期可用 panel-toggle 命令随时切换',
    },
    autoJoinPanes: {
      type: 'boolean',
      default: true,
      description: '共享批注会话开启时是否自动拉入其余浏览器窗口/标签（用户核心诉求：窗口1开启 → 窗口2自动亮起）',
    },
    annotatorSamePageOnly: {
      type: 'boolean',
      default: true,
      description: '徽标是否只在来源同页渲染（true = 防跨页串窗，P28）；关闭后任意 selector 命中即渲染',
    },
    shotsRoot: {
      type: 'string',
      description: '截图输出目录覆盖（缺省 <项目>/shots）；相对路径按项目根解析',
    },
    annotationsRoot: {
      type: 'string',
      description: '批注输出目录覆盖（缺省 <项目>/annotations）；相对路径按项目根解析',
    },
  },
};
