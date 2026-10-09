/**
 * src/webhid-shim.js — WebHID polyfill（R-HID 第二段）：在 guest 页内 hook navigator.hid，
 * 把 requestDevice/getDevices/open/read/write/close 代理到 dsh-browser-kit 的 HID 桥
 * （host 侧 node-hid 系统层直连，绕开 Chromium select-hid-device 宿主缺口——P35）。
 *
 * 页面零修改：WebHID 硬件配置器站点调 navigator.hid.requestDevice() 时，本 shim 弹出
 * dsh-kit 自己的选择器 UI（复用批注面板视觉语言），选择结果经桥打开设备并回传 HIDDevice
 * 形状对象；后续 open/oninputreport/sendReport 全部转发桥。
 *
 * 通信通道（guest 摸不到 face，client 摸不到 guest——双向靠队列轮询）：
 *  - guest→client 请求：window.__dshKitHidQueue（数组），client 每 2s tick 里
 *    executeJavaScript 取走执行（face hidList/hidOpen/hidRead/hidWrite/hidClose）；
 *  - client→guest 结果：window.__dshKitHidResolve(reqId, result)（client 拿到结果后
 *    executeJavaScript 回推，shim 里 pending 表 resolve 对应 Promise）。
 *
 * 版本：1.0.0（__dshKitHidShimVersion）
 */
(function () {
  "use strict";
  if (window.__dshKitHidShimVersion) {
    return; // 幂等：重复注入直接返回
  }
  window.__dshKitHidShimVersion = "1.2.0";

  var REQ_SEQ = window.__dshKitHidReqSeq || 0;
  var REQ_QUEUE = window.__dshKitHidQueue = window.__dshKitHidQueue || [];
  /* R-SHARE：PENDING 表也挂 window（**跨重注入共享**）——旧实例发出的请求在共享队列里，若回推
   *  只认新 shim 的闭包表，旧请求永远无人应答 → 页面侧写/开 8s 超时（重注入后「connected 但读
   *  全 timeout」的第二半）。seq 同步共享，避免跨代 id 撞车。 */
  var PENDING = (function () {
    try {
      if (!window.__dshKitHidPending) window.__dshKitHidPending = {};
      return window.__dshKitHidPending;
    } catch (_) { return {}; }
  })();
  var OPEN_DEVICES = {}; // handleId -> HIDDevice shim 实例
  /* R-DIAG：现场可视诊断（挂 window，跨重注入保留）——「桥读了 N 次 / 真正投递给页面 M 次」
   *  一眼区分「没读到」与「读到了没投递」两类故障（本轮 P43 排查就是缺这一层计数）。 */
  var DIAG = window.__dshKitHidDiag = window.__dshKitHidDiag || { reads: 0, delivered: 0, samples: [], lastErr: null };

  /** 请求 id：计数器挂 window（跨代共享，避免重注入后两代同号）。 */
  function nextReqId() {
    try {
      window.__dshKitHidReqSeq = (window.__dshKitHidReqSeq || 0) + 1;
      return "r" + window.__dshKitHidReqSeq + "_" + Date.now();
    } catch (_) {
      REQ_SEQ += 1;
      return "r" + REQ_SEQ + "_" + Date.now();
    }
  }

  function callBridge(method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = nextReqId();
      var timer = setTimeout(function () {
        if (PENDING[id]) { delete PENDING[id]; reject(new Error("HID 桥超时：" + method)); }
      }, timeoutMs || 15000);
      PENDING[id] = { resolve: resolve, reject: reject, timer: timer };
      REQ_QUEUE.push({ id: id, method: method, params: params || {} });
    });
  }

  /** 桥结果防御拆包（P43 家族）：typert face 外层信封 `{ok, value}` 若泄漏到 guest 侧
   *  （client 拆包回归/多一层封装），`r.ok` 为真但**没有 data** → 事件被静默丢弃。
   *  这里按信封形状逐层剥（含 value 且缺业务字段才算信封），不假设层数。 */
  function bridgeResult(r) {
    for (var i = 0; i < 3; i++) {
      if (r && typeof r === "object" && r.value !== undefined && r.ok !== undefined && r.data === undefined && r.handleId === undefined) r = r.value;
      else break;
    }
    return r;
  }

  /** client 拿到结果后回推入口（client 经 executeJavaScript 调用）。 */
  window.__dshKitHidResolve = function (reqId, result) {
    var p = PENDING[reqId];
    if (!p) return;
    delete PENDING[reqId];
    clearTimeout(p.timer);
    p.resolve(result);
  };

  /** 批量回推入口（R-PUMP）：client 一次 executeJavaScript 回推整批结果——
   *  快泵每轮只需 2 次 guest 调用（取队列 + 批量回推），把往返延迟压到一个泵周期。 */
  window.__dshKitHidResolveBatch = function (map) {
    if (!map || typeof map !== "object") return;
    for (var id in map) {
      if (Object.prototype.hasOwnProperty.call(map, id)) window.__dshKitHidResolve(id, map[id]);
    }
  };

  // ---------- 主题（R-STYLE）：client 从 GUI 文档采集令牌实值传入，挂 guest CSS 变量 ----------

  var THEME = window.__dshKitHidTheme || {
    bg: "#243244", border: "#3a4a5e", text: "#e5e7eb", text2: "rgba(255,255,255,0.65)",
    hover: "rgba(255,255,255,0.08)", shadow: "0 12px 40px rgba(0,0,0,0.5)",
    danger: "rgba(220,38,38,0.85)", font: "13px/1.5 -apple-system,'Segoe UI','Noto Sans SC',sans-serif",
    scheme: "dark",
  };

  /** 把主题值挂到 guest documentElement 的 --dshkit-* 变量（选择器样式全走变量——
   *  主题翻转时 client 推新 THEME 后调 applyTheme 实时刷新）。 */
  function applyTheme(theme) {
    if (theme && typeof theme === "object") {
      THEME = theme;
    }
    try {
      var rootStyle = document.documentElement.style;
      rootStyle.setProperty("--dshkit-hid-bg", THEME.bg);
      rootStyle.setProperty("--dshkit-hid-border", THEME.border);
      rootStyle.setProperty("--dshkit-hid-text", THEME.text);
      rootStyle.setProperty("--dshkit-hid-text2", THEME.text2);
      rootStyle.setProperty("--dshkit-hid-hover", THEME.hover);
      rootStyle.setProperty("--dshkit-hid-shadow", THEME.shadow);
      rootStyle.setProperty("--dshkit-hid-danger", THEME.danger);
      rootStyle.setProperty("--dshkit-hid-font", THEME.font);
      rootStyle.setProperty("--dshkit-hid-row-alt", THEME.scheme === "light" ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.03)");
      rootStyle.setProperty("--dshkit-hid-row-hover", THEME.scheme === "light" ? "rgba(0,0,0,0.06)" : "rgba(124,196,255,0.15)");
    } catch (_) { /* 变量挂载失败不拦桥 */ }
  }
  applyTheme(THEME);

  /** client 推送主题更新入口（主题翻转实时跟随，无需重注 shim）。 */
  window.__dshKitHidShimApplyTheme = function (theme) { applyTheme(theme); };

  // ---------- 选择器 UI（样式全走 --dshkit-hid-* 变量，随 DSH 两主题） ----------

  var chooserState = null; // { overlay, list, chosen }

  function closeChooser() {
    if (chooserState && chooserState.overlay && chooserState.overlay.parentNode) {
      chooserState.overlay.parentNode.removeChild(chooserState.overlay);
    }
    chooserState = null;
  }

  function openChooser(devices) {
    return new Promise(function (resolve) {
      closeChooser();
      var overlay = document.createElement("div");
      overlay.setAttribute("data-dsh-kit-hid-chooser", "");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.45);"
        + "display:flex;align-items:center;justify-content:center;font:var(--dshkit-hid-font);";
      var panel = document.createElement("div");
      panel.style.cssText = "background:var(--dshkit-hid-bg);color:var(--dshkit-hid-text);"
        + "border:1px solid var(--dshkit-hid-border);border-radius:12px;min-width:360px;max-width:520px;"
        + "box-shadow:var(--dshkit-hid-shadow);overflow:hidden;";
      var head = document.createElement("div");
      head.style.cssText = "padding:12px 16px;font-weight:600;border-bottom:1px solid var(--dshkit-hid-border);"
        + "display:flex;align-items:center;justify-content:space-between;gap:10px;";
      var headText = document.createElement("span");
      headText.textContent = "选择 HID 设备（dsh-browser-kit 桥）";
      head.appendChild(headText);
      // ⓘ hover 提示（A 方案）：来源与独占语义一行说明——不弹窗、零交互成本。
      //   内容只说事实：系统枚举、与 Chrome 授权无关、独占占用会打开失败。
      var info = document.createElement("span");
      info.textContent = "ⓘ";
      info.title = "";
      info.style.cssText = "font-size:12px;font-weight:400;color:var(--dshkit-hid-text2);cursor:help;"
        + "border:1px solid var(--dshkit-hid-border);border-radius:999px;width:16px;height:16px;"
        + "display:inline-flex;align-items:center;justify-content:center;flex:none;";
      var tip = document.createElement("div");
      tip.textContent = "设备来自系统枚举（与 Chrome 授权无关）；若打开失败，请先关闭其他程序中正在使用该设备的页面（HID 独占）。";
      tip.style.cssText = "position:absolute;right:12px;top:44px;z-index:1;max-width:340px;padding:8px 12px;"
        + "background:var(--dshkit-hid-bg);border:1px solid var(--dshkit-hid-border);border-radius:8px;"
        + "color:var(--dshkit-hid-text2);font-size:12px;font-weight:400;box-shadow:var(--dshkit-hid-shadow);"
        + "display:none;text-align:left;line-height:1.5;";
      info.addEventListener("mouseenter", function () { tip.style.display = "block"; });
      info.addEventListener("mouseleave", function () { tip.style.display = "none"; });
      head.append(headText, info);
      panel.style.position = "relative"; // ⓘ 的 hover 提示以面板为定位锚
      panel.appendChild(tip);
      var list = document.createElement("div");
      list.style.cssText = "max-height:320px;overflow:auto;";
      var foot = document.createElement("div");
      foot.style.cssText = "padding:10px 16px;border-top:1px solid var(--dshkit-hid-border);text-align:right;";
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "取消";
      cancel.style.cssText = "background:transparent;border:1px solid var(--dshkit-hid-border);color:var(--dshkit-hid-text);"
        + "border-radius:8px;padding:5px 14px;cursor:pointer;";
      cancel.addEventListener("mouseenter", function () { cancel.style.borderColor = "var(--dshkit-hid-danger)"; cancel.style.color = "var(--dshkit-hid-danger)"; });
      cancel.addEventListener("mouseleave", function () { cancel.style.borderColor = "var(--dshkit-hid-border)"; cancel.style.color = "var(--dshkit-hid-text)"; });
      cancel.addEventListener("click", function () { closeChooser(); resolve(null); });
      foot.appendChild(cancel);
      panel.append(head, list, foot);
      overlay.appendChild(panel);
      document.documentElement.append(overlay);
      chooserState = { overlay: overlay, list: list };

      devices.forEach(function (d, i) {
        var row = document.createElement("div");
        row.style.cssText = "padding:10px 16px;cursor:pointer;display:flex;justify-content:space-between;gap:12px;"
          + "border-bottom:1px solid var(--dshkit-hid-border);";
        if (i % 2 === 1) row.style.background = "var(--dshkit-hid-row-alt)";
        var name = document.createElement("span");
        name.textContent = d.product || ("HID " + d.vendorId + ":" + d.productId);
        var meta = document.createElement("span");
        meta.style.cssText = "color:var(--dshkit-hid-text2);font-size:12px;";
        meta.textContent = (d.vendorId + ":" + d.productId) + (d.serialNumber ? " · " + d.serialNumber : "");
        row.append(name, meta);
        row.addEventListener("mouseenter", function () { row.style.background = "var(--dshkit-hid-row-hover)"; });
        row.addEventListener("mouseleave", function () { row.style.background = i % 2 === 1 ? "var(--dshkit-hid-row-alt)" : "transparent"; });
        row.addEventListener("click", function () {
          var chosen = d;
          closeChooser();
          resolve(chosen);
        });
        list.appendChild(row);
      });
    });
  }

  // ---------- HIDDevice shim 形状（页面上手的就是它） ----------
  // R-SEM（1.1.0，对齐 Chrome 行为的三项语义修复）：
  //  ① 惰性 open：requestDevice 只选择不打开（opened=false）——页面调 open() 才真正连桥，
  //    「已连接」状态与 Chrome 一致；桥句柄在 open 时才分配。
  //  ② 实例复用：同设备的重复 requestDevice/getDevices 返回**同一 ShimHIDDevice 实例**
  //    （Chrome 语义：同设备=同对象）；避免双句柄竞争导致通讯不通（P-R3）。
  //  ③ 持久授权：选过的设备（vid/pid/serial 匹配）记入 GRANTS，getDevices() 自动恢复
  //    （sessionStorage 持久化——页面刷新不丢，跨标签同源共享），下次无需再授权。

  var GRANTS = []; // 已授权设备信息（{vendorId, productId, serialNumber, product, path}）
  var DEVICE_INSTANCES = {}; // path -> ShimHIDDevice（实例复用；句柄见 SHARED.handles）
  // 事件表 / 打开态 / 句柄 全部走 window 级 SHARED（见下 R-SHARE）——不再用闭包内副本，避免双源。

  /* R-SHARE（1.2.0）：跨重注入共享「监听器表 + 轮询所有权 + 打开态 + 桥句柄」。
   *  client 会因 shim 源 mtime 变化重注入（旧 IIFE 作用域销毁，但**页面闭包里仍持旧 HIDDevice
   *  实例**）：只共享监听器还不够——旧实例的 `sendReport` 若继续用旧闭包里的 **过期 handleId**，
   *  写包会被桥以「句柄不存在」拒绝（迁移 re-open 后句柄号已变），页面表现为「connected 但读全
   *  timeout」（实测：重注入后 trace 再无 W 记录）。故 handleId/openState 一律以 SHARED 为准。 */
  var SHARED = (function () {
    try {
      if (!window.__dshKitHidShared) window.__dshKitHidShared = {};
      var s = window.__dshKitHidShared;
      if (!s.listeners) s.listeners = {};
      if (!s.polls) s.polls = {};
      if (!s.handles) s.handles = {}; // path -> 桥句柄 id（**唯一真源**）
      if (!s.open) s.open = {};       // path -> boolean
      return s;
    } catch (_) { return { listeners: {}, polls: {}, handles: {}, open: {} }; }
  })();

  // R-MIG（1.1.2，评审问题 3 收尾）：**跨重注入状态迁移**——client 检测 shim 源更新会
  // 重注入（旧 IIFE 作用域销毁、页面闭包里的旧设备实例失效），若不迁移：
  //  ① GRANTS 丢 → 页面要重新授权；② OPEN 状态丢 → 桥句柄悬空；③ 旧实例轮询停 → 数据断流。
  // 迁移通道：window.__dshKitHidMigrate（client 重注入前由旧 shim 的 closeAllForReinject 写入，
  // 新 IIFE 启动时恢复——含**自动恢复打开**（桥句柄是 client 域资源，re-open 幂等）。
  (function migrateIn() {
    try {
      var m = window.__dshKitHidMigrate;
      if (m && typeof m === "object") {
        if (Array.isArray(m.grants)) GRANTS = m.grants;
        var needReopen = []; // 桥侧句柄在 DSH/桥重启后已失效——需真 re-open（异步，见下）
        if (m.openPaths) {
          m.openPaths.forEach(function (p) { SHARED.open[p] = true; needReopen.push(p); });
        }
        delete window.__dshKitHidMigrate;
        // R-MIG：恢复已开设备——为每个已开 path 建新实例；桥侧 re-open **异步**进行
        // （MIG 时桥句柄可能已随 DSH/桥重启失效——open() 的幂等守卫会被打开态
        //  骗过，所以这里直接调桥 hidOpen 并以结果回写状态）。
        GRANTS.filter(function (g) { return needReopen.indexOf(g.path) >= 0; }).forEach(function (g) {
          if (!DEVICE_INSTANCES[g.path]) {
            DEVICE_INSTANCES[g.path] = new ShimHIDDevice(g);
          }
          callBridge("hidOpen", { path: g.path }, 20000).then(function (opened) {
            opened = bridgeResult(opened); // P43：信封泄漏防御
            if (opened && opened.ok) {
              SHARED.handles[g.path] = opened.handleId; // R-SHARE：句柄写共享表（旧实例的写/读都走它）
              DEVICE_INSTANCES[g.path].__dshKitHandleId = opened.handleId; // 诊断镜像
              SHARED.open[g.path] = true;
              DEVICE_INSTANCES[g.path].__dshKitStartPoll();
            } else {
              SHARED.open[g.path] = false; // 桥拒绝（设备拔出/被占）：回退状态
            }
          }).catch(function () { SHARED.open[g.path] = false; });
        });
      }
    } catch (_) { /* 迁移失败不拦启动 */ }
  })();

  function loadGrants() {
    try {
      var raw = sessionStorage.getItem("__dshKitHidGrants");
      if (raw) GRANTS = JSON.parse(raw) || [];
    } catch (_) { /* sessionStorage 不可用（file:// 隐私态）：退会话内记忆 */ }
  }
  function saveGrants() {
    try { sessionStorage.setItem("__dshKitHidGrants", JSON.stringify(GRANTS)); } catch (_) { /* 尽力而为 */ }
  }
  loadGrants();

  function grantKey(info) {
    // 持久身份：vid/pid/serial（serial 缺失退 vid/pid——与 Chrome CanStorePersistentEntry 同思路）
    return info.serialNumber ? (info.vendorId + ":" + info.productId + ":" + info.serialNumber) : (info.vendorId + ":" + info.productId);
  }
  function findGranted(pathOrInfo) {
    var key = typeof pathOrInfo === "string" ? null : grantKey(pathOrInfo);
    for (var i = 0; i < GRANTS.length; i++) {
      if (key && grantKey(GRANTS[i]) === key) return GRANTS[i];
      if (!key && GRANTS[i].path === pathOrInfo) return GRANTS[i];
    }
    return null;
  }

  function ShimHIDDevice(info) {
    var self = this;
    this.__dshKitPath = info.path;
    Object.defineProperties(this, {
      opened: { get: function () { return !!SHARED.open[info.path]; } },
      vendorId: { get: function () { return info.vendorId; } },
      productId: { get: function () { return info.productId; } },
      productName: { get: function () { return info.product || ""; } },
      serialNumber: { get: function () { return info.serialNumber || ""; } },
      collections: { get: function () { return []; } },
    });
    this.oninputreport = null;
    /* R-SHARE：监听器登记到 **window 级共享表**（跨重注入存活）——旧实例的方法在重注入后
     *  依旧有效，新 shim 的轮询把事件投递给同一张表里的全部监听器。 */
    function sharedListeners() {
      var p = info.path;
      if (!SHARED.listeners[p]) SHARED.listeners[p] = [];
      return SHARED.listeners[p];
    }
    function hasListener() { return !!self.oninputreport || sharedListeners().length > 0; }

    /* R-POLL（1.2.0 实测定论）——**单飞 + 立即续读**取代固定 250ms 轮询：
     *  ① 旧实现每 250ms 无脑发一次读（4 req/s），而 client tick 消费上限 4/2s（2 req/s）：
     *     入大于出 ⇒ guest 队列无界增长；更致命的是**已超时的旧请求仍会被执行并抢走设备响应**，
     *     而页面侧 Promise 早已丢弃 ⇒ 页面永远收不到 inputreport（现场：读 42 次、投递 0 次）。
     *  ② 单飞：同一设备**永远只有一个未决读**，响应不会被分散到多个等待者。
     *  ③ 立即续读：一次读结束后立刻排下一次（setTimeout 0），延迟只由「客户端泵周期」决定，
     *     不再叠加 250ms 固定空转。
     *  ④ 所有权 token：重注入后新实例 startPoll 抢占，旧循环下一轮即停（不双循环）。 */
    var pollTimer = 0;
    var pollToken = { path: info.path };
    function ownsPoll() { return SHARED.polls[info.path] === pollToken; }
    function dispatchReport(data) {
      // Chrome 语义：ev.data 不含 report id（单列在 ev.reportId）；桥读到的首字节即 report id。
      var reportId = data[0];
      var bytes = new Uint8Array(data.slice(1));
      // Chrome 的 InputReportEvent.data 是 **DataView**（同一 buffer 精确尺寸）——
      // 站点既有 `new Uint8Array(ev.data.buffer)` 用法，也可能用 getUint8/byteLength；
      // 给 DataView 才两边都成立（旧实现给 Uint8Array：DataView 方法调用会抛）。
      var ev = { data: new DataView(bytes.buffer), device: self, reportId: reportId };
      DIAG.delivered++;
      if (DIAG.samples.length < 5) {
        DIAG.samples.push(data.slice(0, 6).map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join(" "));
      }
      if (self.oninputreport) { try { self.oninputreport(ev); } catch (_) {} }
      sharedListeners().slice().forEach(function (fn) {
        try { fn(ev); } catch (_) { /* 页面回调异常不拦桥 */ }
      });
    }
    function pollOnce() {
      pollTimer = 0;
      if (!ownsPoll()) return; // 已被更新的实例接管：静默退场
      if (!SHARED.open[info.path] || !hasListener()) return; // 已关闭/无监听：停泵
      var handleId = SHARED.handles[info.path]; // R-SHARE：句柄唯一真源（迁移 re-open 后旧实例也读到新句柄）
      if (!handleId) return;
      DIAG.reads++;
      callBridge("hidRead", { handleId: handleId, timeoutMs: 800 }, 8000).then(function (r) {
        r = bridgeResult(r); // P43：信封泄漏防御（外层 {ok,value} 会让 data 判定落空）
        if (r && r.ok && Array.isArray(r.data) && r.data.length) dispatchReport(r.data);
        schedulePoll();
      }, function (e) {
        DIAG.lastErr = (e && e.message) || String(e);
        schedulePoll();
      });
    }
    function schedulePoll() {
      if (pollTimer || !ownsPoll()) return;
      if (!SHARED.open[info.path] || !hasListener()) return;
      pollTimer = setTimeout(pollOnce, 0);
    }
    function startPoll() {
      SHARED.polls[info.path] = pollToken; // 抢占所有权：旧 shim 的循环下一轮自停
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = 0; }
      schedulePoll();
    }
    this.__dshKitStartPoll = startPoll;
    this.__dshKitStopPoll = function () {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = 0; }
      if (ownsPoll()) delete SHARED.polls[info.path];
    };
    this.__dshKitAddListener = function (type, fn) {
      if (type === "inputreport" && typeof fn === "function") { sharedListeners().push(fn); startPoll(); }
    };
    this.__dshKitRemoveListener = function (type, fn) {
      if (type === "inputreport") {
        var l = sharedListeners().filter(function (f) { return f !== fn; });
        SHARED.listeners[info.path] = l;
      }
    };
  }
  ShimHIDDevice.prototype.addEventListener = function (type, fn) {
    if (type === "inputreport" && typeof fn === "function") { this.__dshKitAddListener(type, fn); }
  };
  ShimHIDDevice.prototype.removeEventListener = function (type, fn) {
    if (type === "inputreport") { this.__dshKitRemoveListener(type, fn); }
  };
  ShimHIDDevice.prototype.open = function () {
    var self = this;
    var path = this.__dshKitPath;
    if (SHARED.open[path]) { self.__dshKitStartPoll(); return Promise.resolve(); } // 已开：幂等（Chrome 同语义）+ 确保读泵在跑
    return callBridge("hidOpen", { path: path }).then(function (opened) {
      opened = bridgeResult(opened); // P43：信封泄漏防御
      if (!opened || !opened.ok) throw new Error((opened && opened.error) || "设备打开失败");
      SHARED.handles[path] = opened.handleId; // R-SHARE：句柄写共享表（唯一真源）
      if (DEVICE_INSTANCES[path]) DEVICE_INSTANCES[path].__dshKitHandleId = opened.handleId; // 诊断镜像
      SHARED.open[path] = true;
      self.__dshKitStartPoll();
      return;
    });
  };
  ShimHIDDevice.prototype.close = function () {
    var path = this.__dshKitPath;
    this.__dshKitStopPoll();
    var handleId = SHARED.handles[path];
    SHARED.open[path] = false;
    if (!handleId) return Promise.resolve();
    delete SHARED.handles[path];
    if (DEVICE_INSTANCES[path]) DEVICE_INSTANCES[path].__dshKitHandleId = null;
    return callBridge("hidClose", { handleId: handleId }).then(function () {});
  };
  ShimHIDDevice.prototype.sendReport = function (reportId, data) {
    var path = this.__dshKitPath;
    if (!SHARED.open[path]) return Promise.reject(new Error("InvalidStateError: 设备未打开（先调 open()）"));
    var handleId = SHARED.handles[path]; // R-SHARE：**必须读共享句柄**——重注入迁移 re-open 后句柄号已变，
    if (!handleId) return Promise.reject(new Error("InvalidStateError: 桥句柄缺失（重新 open()）")); //  旧实例持旧号会被桥拒绝 = 「connected 但读全 timeout」
    var bytes = Array.prototype.slice.call(data instanceof Uint8Array ? data : new Uint8Array(data));
    // R-COMM v2 线格式（2026-10-09 实测定论）：线包 = [reportId || 0] + dataBytes，
    // **总长补齐 64**（Windows WriteFile 硬性要求 = Output Report 长度；本设备
    // outputReports id=75/84 均 63+1=64，报告描述符 Chrome collections 已确认）。
    bytes.unshift(reportId || 0);
    while (bytes.length < 64) bytes.push(0);
    return callBridge("hidWrite", { handleId: handleId, data: bytes }).then(function (r) {
      r = bridgeResult(r); // P43：信封泄漏防御（外层 {ok,value} 会把桥错误伪装成成功）
      if (!r || !r.ok) throw new Error((r && r.error) || "hidWrite 失败");
      return;
    });
  };
  ShimHIDDevice.prototype.sendFeatureReport = function (reportId, data) {
    return this.sendReport(reportId, data); // node-hid 无 feature 读写分离，退化为主通道
  };
  ShimHIDDevice.prototype.forget = function () {
    // Chrome 语义：forget = 撤销该设备授权 + 断开
    var info = this;
    var key = grantKey(info);
    GRANTS = GRANTS.filter(function (g) { return grantKey(g) !== key; });
    saveGrants();
    return this.close();
  };

  // ---------- navigator.hid 覆盖 ----------

  function filtersMatch(device, filters) {
    if (!filters || !filters.length) return true;
    return filters.some(function (f) {
      if (f.vendorId != null && device.vendorId !== f.vendorId) return false;
      if (f.productId != null && device.productId !== f.productId) return false;
      if (f.usagePage != null && device.usagePage !== f.usagePage) return false;
      if (f.usage != null && device.usage !== f.usage) return false;
      return true;
    });
  }

  var shimHid = {
    getDevices: function () {
      // Chrome 语义：返回**已授权**设备（实例复用——同设备同对象；未 open 的 opened=false，
      // 页面自行 open 后才有句柄）——持久授权来自 GRANTS（sessionStorage 跨刷新）。
      return Promise.resolve(GRANTS.map(function (g) {
        var inst = DEVICE_INSTANCES[g.path];
        if (!inst) {
          inst = new ShimHIDDevice(g);
          DEVICE_INSTANCES[g.path] = inst;
        }
        return inst;
      }));
    },
    requestDevice: function (options) {
      return callBridge("hidList", {}).then(function (r) {
        var all = (r && r.ok && Array.isArray(r.devices)) ? r.devices : [];
        var usable = all.filter(function (d) { return d.path; }); // 无 path 的系统设备打不开，过滤
        var filtered = usable.filter(function (d) { return filtersMatch(d, options && options.filters); });
        var candidates = filtered.length ? filtered : usable;
        if (!candidates.length) {
          var err = new Error("未找到可用的 HID 设备");
          err.name = "NotFoundError";
          throw err;
        }
        return openChooser(candidates).then(function (chosen) {
          if (!chosen) {
            var cancelled = new Error("用户取消了设备选择");
            cancelled.name = "NotFoundError";
            throw cancelled;
          }
          // R-SEM：登记持久授权（下次 getDevices/免授权恢复）；**不 open**（Chrome 语义：
          // requestDevice 只选择——「已连接」由页面调 open() 后呈现）。
          if (!findGranted(chosen)) {
            GRANTS.push(chosen);
            saveGrants();
          }
          var inst = DEVICE_INSTANCES[chosen.path];
          if (!inst) {
            inst = new ShimHIDDevice(chosen);
            DEVICE_INSTANCES[chosen.path] = inst;
          }
          return [inst]; // WebHID 规范：requestDevice resolve 数组
        });
      });
    },
    getAvailableDevices: function () { // 非标准 API，Debug 用
      return callBridge("hidList", {}).then(function (r) {
        return (r && r.ok && Array.isArray(r.devices)) ? r.devices : [];
      });
    },
    onconnect: null,
    ondisconnect: null,
    addEventListener: function () {},
    removeEventListener: function () {},
    dispatchEvent: function () { return true; },
  };
  try {
    Object.defineProperty(shimHid, "ongeometryconnected", { value: null, writable: true });
  } catch (_) { /* 可选属性 */ }

  try {
    // 覆盖 navigator.hid（可写则直写；只读则 defineProperty）
    var desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "hid") || Object.getOwnPropertyDescriptor(navigator, "hid");
    if (!desc || desc.configurable) {
      Object.defineProperty(navigator, "hid", { value: shimHid, configurable: true });
    } else {
      navigator.hid = shimHid; // 兜底直写（部分环境允许实例遮蔽）
    }
  } catch (e) {
    navigator.hid = shimHid;
  }

  window.__dshKitHidShim = shimHid; // 调试句柄
  /** 重注入收尾（client 推送新版 shim 前调用）——R-MIG / R-SHARE：**写迁移数据而非破坏**：
   *  GRANTS + 已开路径交给新 shim（新实例 re-open 接管桥句柄、重启轮询）；监听器表/打开态/句柄
   *  本身就在 window 级 SHARED 里，重注入后**页面闭包里的旧设备对象继续可用**（写用共享句柄、
   *  读由新实例的轮询投递到共享监听器表）。closeChooser 防残留。 */
  window.__dshKitHidShim.closeAllForReinject = function () {
    var openPaths = Object.keys(SHARED.open).filter(function (p) { return SHARED.open[p]; });
    window.__dshKitHidMigrate = { grants: GRANTS, openPaths: openPaths };
    closeChooser();
  };
})();