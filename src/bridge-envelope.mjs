/**
 * src/bridge-envelope.mjs — face 外层信封 {ok, value} 剥离（A1 正典；client.js 内嵌副本 parity 锁定）。
 *
 * P43（2026-10-09 实机定论）：**信封剥离只能看信封形状，不能用业务键当谓词**。
 *  - face 每个方法经 #guard 返回 `{ok:true, value:<业务结果>}`（见 wire.host.mjs），即**双层信封**；
 *  - client 侧原 hidRead 用 `x => x.ok !== undefined` 当 peelTo 终止谓词——**外层信封自己也带 ok**，
 *    谓词在外层即刻命中，返回 `{ok:true, value:{ok:true,data:[...]}}`；
 *  - shim 判 `Array.isArray(r.data)` 失败 → 静默 return → 设备响应全到桥、页面永远收不到 inputreport
 *    （现场：固件版本/EQ TagId/麦克风全部 timeout，只有 devices.json 静态字段正常）。
 *
 * 判据：`value !== undefined && ok !== undefined` 才算信封；逐层剥到非信封为止（不假设层数）。
 */
export const faceUnwrap = (x) => {
  let cur = x;
  for (let i = 0; i < 4; i++) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && cur.value !== undefined && cur.ok !== undefined) cur = cur.value;
    else break;
  }
  return cur;
};
