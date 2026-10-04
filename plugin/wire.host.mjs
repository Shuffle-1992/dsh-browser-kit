/**
 * @local/dsh-browser-kit —— 宿主 face 描述符（exports["./typert"]）。
 *
 * MVP-0 探测用最小面：只有一个 `reportClient(findings)`，client 半边把 webview 探测结果
 * 上报给 host 半边，host 落盘 `.data/probe-report.json` 供实施会话读取。
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
 * @param {{ onReport: (findings: unknown) => Promise<{ok: boolean, savedAt?: string, error?: string}> }} hooks
 */
export function createRemoteFace({ onReport }) {
  /**
   * face 类：原型供方法标记与签名解析，实例带 typertRemote 绑定
   * （协议 bindTypertRemote 的落盘形状：冻结的 {service, serviceKey, namespace}）。
   */
  class RemoteFace {
    constructor() {
      this.typertRemote = Object.freeze({ service: this, serviceKey: FACE_NAME, namespace: FACE_NAME });
    }
    /** reportClient(findings) → {ok:true, savedAt} | {ok:false, error}。 */
    async reportClient(findings) {
      try {
        return await onReport(findings);
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    }
  }

  // 方法标记写原型（协议 mark() 的落盘形状：版本化冻结描述符）。
  Object.defineProperty(RemoteFace.prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([
        Object.freeze({ method: 'reportClient', invocation: Object.freeze({ kind: 'direct' }) }),
      ]),
    }),
  });

  return new RemoteFace();
}

/** face 方法面（标记/描述符共用）：[方法名, 参数名数组, 签名]。 */
const FACE_METHOD_TABLE = [
  ['reportClient', ['findings'], 'reportClient(findings): Promise<{ok:true, savedAt}|{ok:false, error}>'],
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
  invocations: FACE_METHOD_TABLE.map(([method, parameters, ]) => ({
    id: `@local/dsh-browser-kit#${FACE_NAME}/${method}`,
    service: FACE_NAME,
    namespace: FACE_NAME,
    method,
    invocation: { kind: 'direct' },
    parameters: parameters.map((name) => ({
      name,
      wire: name,
      source: 'json',
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
        description: 'dsh-browser-kit MVP-0 探测远端面：client 半边把 webview 探测结果上报给 host 半边落盘。',
        summary: 'dsh-browser-kit 探测上报面（MVP-0）。',
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
