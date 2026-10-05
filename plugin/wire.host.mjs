/**
 * @local/dsh-browser-kit —— 宿主 face 描述符（exports["./typert"]）。
 *
 * MVP-1 face 契约（一次定全，含 MVP-2 要用的方法）：
 *  - reportClient(findings)：client 探测结果上报（落 .data/probe-report.json，诊断用）；
 *  - saveShot(meta, dataUrl)：截图 PNG（dataURL）落盘 <项目>/shots/，返回绝对路径（MVP-1 主通道）；
 *  - saveAnnotations(markdown)：批注协议块落盘 <项目>/annotations/，返回绝对路径（MVP-2 主通道）。
 *
 * 形态完全照抄 @local/zcode-dispatch 的 wire.host.mjs（本机 DSH 上已验证可用的两条并存路径）：
 * A) dsh-typert-loader 自动发现：读包 exports["./typert"] → ctx.typert.register(TYPERT)；
 * B) typertGateway SRC 兜底：ctx.provide(FACE_NAME, face) 注册带 typertRemote 绑定 +
 *    原型方法标记的 cordis 服务，网关据此派发端点。
 */

/** 远端面服务名（客户端 ctx.remote.<名> 的命名空间，须与 TYPERT.namespace 一致）。 */
export const FACE_NAME = 'dshBrowserKit';

/** 协议原型方法标记键（typertGateway collectSrcClaims 认领依据；与 zcode-dispatch 同款）。 */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';

/** 透传校验器：face 的边界契约就是「JSON 可序列化」（宿主网关 decode 后仍做 JSON 安全断言）。 */
const JSON_ANY = Object.freeze({ parse: (value) => value });

/**
 * 创建宿主 face。
 * @param {{
 *   onReport: (findings: unknown) => Promise<{ok: boolean, savedAt?: string, error?: string}>,
 *   onSaveShot: (meta: unknown, dataUrl: string) => Promise<{ok: boolean, path?: string, bytes?: number, error?: string}>,
 *   onSaveAnnotations: (markdown: string) => Promise<{ok: boolean, path?: string, bytes?: number, error?: string}>,
 *   onGetInjectScript: () => {ok: boolean, source?: string, mtime?: string, bytes?: number, error?: string},
 *   onTakeCommand: () => {ok: boolean, command?: unknown, error?: string},
 *   onCommandResult: (id: string, result: unknown) => {ok: boolean, error?: string},
 * }} hooks
 */
export function createRemoteFace({ onReport, onSaveShot, onSaveAnnotations, onSaveMerged, onGetInjectScript, onTakeCommand, onCommandResult }) {
  /**
   * face 类：原型供方法标记与签名解析，实例带 typertRemote 绑定
   * （协议 bindTypertRemote 的落盘形状：冻结的 {service, serviceKey, namespace}）。
   */
  class RemoteFace {
    constructor() {
      this.typertRemote = Object.freeze({ service: this, serviceKey: FACE_NAME, namespace: FACE_NAME });
    }
    async #guard(fn) {
      try {
        return await fn();
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    }
    /** reportClient(findings) → {ok:true, savedAt} | {ok:false, error}。 */
    reportClient(findings) { return this.#guard(() => onReport(findings)); }
    /** saveShot(meta, dataUrl) → {ok:true, path, bytes} | {ok:false, error}。 */
    saveShot(meta, dataUrl) { return this.#guard(() => onSaveShot(meta, dataUrl)); }
    /** saveAnnotations(markdown[, meta]) → {ok:true, path, bytes} | {ok:false, error}。 */
    saveAnnotations(markdown, meta) { return this.#guard(() => onSaveAnnotations(markdown, meta)); }
    /** saveMerged(sets[, meta]) → {ok:true, path, bytes, count} | {ok:false, error}（多面板批注合并）。 */
    saveMerged(sets, meta) { return this.#guard(() => onSaveMerged(sets, meta)); }
    /** saveMerged(sets[, meta]) → {ok:true, path, bytes, count} | {ok:false, error}（多面板批注合并：sets=[{url,title,annotations[]}]，host 重编号后用协议构建器落一个文件）。 */
    saveMerged(sets, meta) { return this.#guard(() => onSaveMerged(sets, meta)); }
    /** getInjectScript() → {ok:true, source, mtime, bytes} | {ok:false, error}（MVP-2：批注层注入源）。 */
    getInjectScript() { return this.#guard(() => onGetInjectScript()); }
    /** takeCommand() → {ok:true, command}|{ok:true, command:null}|{ok:false, error}（MVP-4 种子：取走即删）。 */
    takeCommand() { return this.#guard(() => onTakeCommand()); }
    /** commandResult(id, result) → {ok:true} | {ok:false, error}（命令执行结果回传）。 */
    commandResult(id, result) { return this.#guard(() => onCommandResult(id, result)); }
  }

  // 方法标记写原型（协议 mark() 的落盘形状：版本化冻结描述符）。
  Object.defineProperty(RemoteFace.prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(FACE_METHOD_TABLE.map(([method]) => Object.freeze({
        method,
        invocation: Object.freeze({ kind: 'direct' }),
      }))),
    }),
  });

  return new RemoteFace();
}

/** face 方法面（标记/描述符共用）：[方法名, 参数名数组, 签名, 可选参数名数组]。 */
const FACE_METHOD_TABLE = [
  ['reportClient', ['findings'], 'reportClient(findings): Promise<{ok:true, savedAt}|{ok:false, error}>', []],
  ['saveShot', ['meta', 'dataUrl'], 'saveShot(meta, dataUrl): Promise<{ok:true, path, bytes}|{ok:false, error}>', []],
  ['saveAnnotations', ['markdown', 'meta'], 'saveAnnotations(markdown, meta?): Promise<{ok:true, path, bytes}|{ok:false, error}>（meta={url,title} 可选，入索引）', ['meta']],
  ['saveMerged', ['sets', 'meta'], 'saveMerged(sets, meta?): Promise<{ok:true, path, bytes, count}|{ok:false, error}>（多面板合并：sets=[{url,title,annotations[]}]，host 重编号构建单个协议文件）', ['meta']],
  ['getInjectScript', [], 'getInjectScript(): Promise<{ok:true, source, mtime, bytes}|{ok:false, error}>', []],
  ['takeCommand', [], 'takeCommand(): Promise<{ok:true, command}|{ok:false, error}>（command=null 表示无命令）', []],
  ['commandResult', ['id', 'result'], 'commandResult(id, result): Promise<{ok:true}|{ok:false, error}>', []],
];

/**
 * 宿主 face 模型描述符（dsh-typert-loader 自动发现并 ctx.typert.register）。
 * 字段形态对齐 @local/zcode-dispatch 的 TYPERT（本机已验证）。
 */
export const TYPERT = {
  package: '@local/dsh-browser-kit',
  face: 'host',
  generator: 'hand-written (MVP-0 probe)：无 zod/schemastery 依赖；strict codec 用透传校验器',
  service: FACE_NAME,
  schemas: [],
  invocations: FACE_METHOD_TABLE.map(([method, parameters, , optionals]) => ({
    id: `@local/dsh-browser-kit#${FACE_NAME}/${method}`,
    service: FACE_NAME,
    namespace: FACE_NAME,
    method,
    invocation: { kind: 'direct' },
    parameters: parameters.map((name) => ({
      name,
      wire: name,
      source: 'json',
      ...(optionals.includes(name) ? { acceptsUndefined: true } : {}),
      codec: {
        mode: 'strict',
        typeSymbol: `@local/dsh-browser-kit#${FACE_NAME}/${method}:${name}`,
        create: () => JSON_ANY,
      },
    })),
    result: {
      mode: 'strict',
      typeSymbol: `@local/dsh-browser-kit#${FACE_NAME}/${method}:result`,
      create: () => JSON_ANY,
    },
  })),
  model: {
    services: [
      {
        description: 'dsh-browser-kit 远端面：client 探测上报（reportClient）、截图落盘（saveShot）、批注落盘（saveAnnotations）。',
        summary: 'dsh-browser-kit 探测/截图/批注的 client→host 通道。',
        tags: [],
        key: FACE_NAME,
        exportName: 'createRemoteFace',
        members: FACE_METHOD_TABLE.map(([method, , signature]) => ({
          kind: 'method',
          name: method,
          signature,
        })),
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
};
