/**
 * dsh-browser-kit — console-observer.js（L1 通用控制台/网络观测，SDK 无关）
 *
 * 为什么存在：
 *   DSH 内置浏览器的 webview 拿不到 DevTools / CDP 时，agent 看不到页面 console 与网络
 *   活动——只能靠「注入一段脚本 + 事后 dump」。本文件就是那段脚本：自包含、零依赖、
 *   纯 ES5 IIFE，可直接 executeJavaScript 注入任意公网页面 main world。
 *
 * 暴露契约（钉死）：
 *   window.__dshKitConsole = {
 *     version: '1.0.0',
 *     entries(),                     —— 只读语义：函数形式暴露（不导出可变数组）
 *     dump({ level, since, limit, filter, net }),   —— 返回条目**副本**数组
 *     clear(),                       —— 清空并返回被清空条数
 *     stats(),                       —— { total, dropped, byKind, installedAt }
 *     mark(label),                   —— 打一个 kind:'mark' 时间锚点（配合 since 用）
 *     uninstall()                    —— 还原全部 hook 与监听，返回 { ok:true }
 *   }
 *
 * dump(options) 语义：
 *   level  : 'error'|'warn'|'info'|'log'|'debug'|'all'（缺省 all）——按 level 字段过滤；
 *            'error' 同时含 uncaught / unhandledrejection（它们 level 也是 'error'）。
 *   since  : 毫秒时间戳，只返回 t >= since 的条目（配合 mark() 取「我操作之后」的日志）。
 *   limit  : 最多返回**末尾** N 条，缺省 200，硬上限 500。
 *   filter : 字符串 = 对 text 做子串匹配；{ re:'正则字符串' } = 正则匹配（非法正则忽略）。
 *   net    : true 时只返回 kind === 'fetch' | 'xhr'。
 *
 * Entry 形状（字段固定，agent 侧可直接解析）：
 *   { seq, t(Date.now 毫秒), kind, level, text(<=500), args(string[], <=5 项、每项 <=300),
 *     url?, method?, status?, durationMs?, source?, line?, col? }
 *   kind ∈ console | uncaught | unhandledrejection | fetch | xhr | mark
 *
 * 手法：包裹 console.* / window.fetch / XMLHttpRequest.prototype.open|send（保留原行为，
 *   一律继续调用原函数，绝不吞日志、不改请求语义、**不读 body**——避免消费响应流）；
 *   window 'error' / 'unhandledrejection' 走 addEventListener 镜像监听。
 *
 * 坑（踩过的）：
 *   - 重复注入幂等：第二次注入检测到 window.__dshKitConsole 直接返回 'exists'，不重复包 hook。
 *   - 参数序列化必须防御性：JSON.stringify 面对循环引用 / BigInt / 抛错 getter / Symbol 会抛，
 *     逐项 try/catch 降级到 String(x)，任何情况都不得让页面侧异常冒泡。
 *   - XHR 用 loadend（最稳，error/abort/timeout 都会到）+ WeakSet 防同实例重复挂监听。
 *   - uninstall() 后 dump() 仍要能读历史条目：只还原 API，不清缓冲。
 *
 * 归属：dsh-browser-kit 原创实现，未复制 ZCode 代码。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || !window) {
    return;
  }

  // 防重注入：已有实例即幂等返回（不重复包 hook、不覆盖旧实例）。
  if (window.__dshKitConsole) {
    return 'exists';
  }

  var VERSION = '1.0.0';
  var MAX_ENTRIES = 500; // 环形缓冲硬上限
  var DEFAULT_LIMIT = 200; // dump 缺省条数
  var TEXT_CAP = 500;
  var ARG_CAP = 300;
  var ARGS_MAX = 5;
  var STACK_CAP = 600;
  var CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'];

  // ---------------------------------------------------------------- 状态

  var seqCounter = 0;
  var dropped = 0;
  var entries = [];
  var byKind = {};
  var installedAt = Date.now();

  var consoleOwner = null; // 被 hook 的 console 宿主（裸 console 即全局 console）
  var restores = []; // { owner, key, had, orig } —— uninstall 时按序还原
  var listeners = []; // { type, fn }
  var xhrSeen = typeof WeakSet === 'function' ? new WeakSet() : null; // 防同 XHR 实例重复挂监听

  // ---------------------------------------------------------------- 小工具

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function truncate(s, cap) {
    s = String(s);
    return s.length > cap ? s.slice(0, cap) : s;
  }

  /** 永不抛的 String()。 */
  function toStr(x) {
    try {
      return String(x);
    } catch (_) {
      return '[unprintable]';
    }
  }

  function isErrorLike(v) {
    try {
      return (
        v instanceof Error ||
        (v && typeof v === 'object' && typeof v.message === 'string' && typeof v.name === 'string')
      );
    } catch (_) {
      return false;
    }
  }

  /**
   * 防御性值格式化：任何取值/属性访问都可能抛（getter、Proxy），逐处 try/catch。
   * 循环引用用 ancestors 栈按身份判定，不依赖 JSON.stringify。
   */
  function fmtValue(v, depth, ancestors) {
    if (v === null) {
      return 'null';
    }
    if (v === undefined) {
      return 'undefined';
    }
    var t = typeof v;
    if (t === 'string') {
      return truncate("'" + v + "'", ARG_CAP);
    }
    if (t === 'number' || t === 'boolean') {
      return toStr(v);
    }
    if (t === 'bigint') {
      return toStr(v) + 'n';
    }
    if (t === 'symbol') {
      try {
        return typeof Symbol !== 'undefined' && Symbol.prototype.toString
          ? Symbol.prototype.toString.call(v)
          : '[symbol]';
      } catch (_) {
        return '[symbol]';
      }
    }
    if (t === 'function') {
      try {
        return '[Function ' + (v.name || 'anonymous') + ']';
      } catch (_) {
        return '[Function]';
      }
    }

    // 对象/数组：循环引用检测
    var i;
    for (i = 0; i < ancestors.length; i++) {
      if (ancestors[i] === v) {
        return '[Circular]';
      }
    }
    if (depth <= 0) {
      return isArrayLike(v) ? '[Array]' : '[Object]';
    }

    if (isErrorLike(v)) {
      var name = '[Error]';
      var msg = '';
      var stack = '';
      try {
        name = toStr(v.name) || 'Error';
      } catch (_) {
        /* getter 抛错保持默认 */
      }
      try {
        msg = toStr(v.message);
      } catch (_) {
        msg = '[message threw]';
      }
      try {
        stack = v.stack ? toStr(v.stack) : '';
      } catch (_) {
        stack = '[stack threw]';
      }
      var out = name + ': ' + truncate(msg, ARG_CAP);
      if (stack) {
        out += '\n    at ' + truncate(stack, STACK_CAP);
      }
      return truncate(out, ARG_CAP + STACK_CAP);
    }

    ancestors.push(v);
    var res;
    try {
      if (isArrayLike(v)) {
        var n = 0;
        try {
          n = typeof v.length === 'number' ? v.length : 0;
        } catch (_) {
          n = 0;
        }
        var parts = [];
        var lim = n < 10 ? n : 10;
        for (i = 0; i < lim; i++) {
          try {
            parts.push(fmtValue(v[i], depth - 1, ancestors));
          } catch (_) {
            parts.push('[threw]');
          }
        }
        if (n > lim) {
          parts.push('+' + (n - lim) + ' more');
        }
        res = '[' + parts.join(', ') + ']';
      } else {
        var keys;
        try {
          keys = Object.keys(v);
        } catch (_) {
          keys = [];
        }
        var kv = [];
        var klim = keys.length < 10 ? keys.length : 10;
        for (i = 0; i < klim; i++) {
          var k = keys[i];
          var val;
          try {
            val = fmtValue(v[k], depth - 1, ancestors); // getter 抛错在这里兜住
          } catch (_) {
            val = '[threw]';
          }
          kv.push(k + ': ' + val);
        }
        if (keys.length > klim) {
          kv.push('+' + (keys.length - klim) + ' more');
        }
        res = '{' + kv.join(', ') + '}';
      }
    } catch (_) {
      res = isArrayLike(v) ? '[Array]' : '[Object]';
    }
    ancestors.pop();
    return truncate(res, ARG_CAP);
  }

  function isArrayLike(v) {
    try {
      return Array.isArray(v) || (typeof v.length === 'number' && typeof v !== 'string');
    } catch (_) {
      return false;
    }
  }

  /** 单个参数 → 字符串（永不出栈抛错）。 */
  function safeString(v) {
    if (typeof v === 'string') {
      return truncate("'" + v + "'", ARG_CAP);
    }
    return truncate(fmtValue(v, 3, []), ARG_CAP);
  }

  /** 参数数组 → 字符串数组（≤5 项、每项 ≤300）。 */
  function safeArgs(args) {
    var out = [];
    if (!args) {
      return out;
    }
    var n = 0;
    try {
      n = typeof args.length === 'number' ? args.length : 0;
    } catch (_) {
      n = 0;
    }
    var lim = n < ARGS_MAX ? n : ARGS_MAX;
    for (var i = 0; i < lim; i++) {
      var v;
      try {
        v = args[i];
      } catch (_) {
        out.push('[threw]');
        continue;
      }
      try {
        out.push(safeString(v));
      } catch (_) {
        out.push('[unserializable]');
      }
    }
    if (n > lim) {
      out.push('+' + (n - lim) + ' more');
    }
    return out;
  }

  /** 条目主文本：优先复用参数的字符串化结果，避免二次格式化踩错。 */
  function textOf(args, stringed) {
    if (!args || !args.length) {
      return '';
    }
    if (stringed && stringed.length) {
      return truncate(stringed.join(' '), TEXT_CAP);
    }
    return '';
  }

  // ---------------------------------------------------------------- 条目写入

  function addEntry(entry) {
    seqCounter++;
    entry.seq = seqCounter;
    entry.t = Date.now();
    if (!entry.text && entry.text !== '') {
      entry.text = '';
    }
    try {
      entry.text = truncate(entry.text, TEXT_CAP);
    } catch (_) {
      entry.text = '';
    }
    if (!entry.args) {
      entry.args = [];
    }
    entries.push(entry);
    var k = entry.kind || 'unknown';
    byKind[k] = (byKind[k] || 0) + 1;
    // 环形缓冲：超上限丢最旧并累加 dropped（丢到正好等于上限为止）
    while (entries.length > MAX_ENTRIES) {
      entries.shift();
      dropped++;
    }
    return entry;
  }

  /** 条目副本（agent 侧拿到的是快照，改它不影响内部缓冲）。 */
  function cloneEntry(e) {
    var c = {
      seq: e.seq,
      t: e.t,
      kind: e.kind,
      level: e.level,
      text: e.text,
      args: e.args ? e.args.slice(0) : [],
    };
    if (e.url !== undefined) {
      c.url = e.url;
    }
    if (e.method !== undefined) {
      c.method = e.method;
    }
    if (e.status !== undefined) {
      c.status = e.status;
    }
    if (e.durationMs !== undefined) {
      c.durationMs = e.durationMs;
    }
    if (e.source !== undefined) {
      c.source = e.source;
    }
    if (e.line !== undefined) {
      c.line = e.line;
    }
    if (e.col !== undefined) {
      c.col = e.col;
    }
    if (e.error !== undefined) {
      c.error = e.error;
    }
    return c;
  }

  // ---------------------------------------------------------------- console hook

  function patchConsole() {
    if (typeof console === 'undefined' || !console) {
      return;
    }
    consoleOwner = console;
    for (var i = 0; i < CONSOLE_METHODS.length; i++) {
      (function (method) {
        var orig;
        try {
          orig = consoleOwner[method];
        } catch (_) {
          return;
        }
        if (typeof orig !== 'function') {
          return;
        }
        restores.push({ owner: consoleOwner, key: method, had: hasOwn(consoleOwner, method), orig: orig });
        consoleOwner[method] = function () {
          // 先取条目（不依赖上下文），再无条件转发原函数——绝不吞日志
          var stringed = safeArgs(arguments);
          try {
            addEntry({
              kind: 'console',
              level: method === 'log' ? 'log' : method,
              text: textOf(arguments, stringed),
              args: stringed,
            });
          } catch (_) {
            /* 观测失败不得影响页面本身 */
          }
          return orig.apply(this, arguments);
        };
      })(CONSOLE_METHODS[i]);
    }
  }

  // ---------------------------------------------------------------- 全局错误 hook

  function onWindowError(event) {
    try {
      var msg = event && event.message !== undefined ? toStr(event.message) : 'Uncaught error';
      var source = event && event.filename !== undefined ? toStr(event.filename) : undefined;
      var line = event && typeof event.lineno === 'number' ? event.lineno : undefined;
      var col = event && typeof event.colno === 'number' ? event.colno : undefined;
      var err = event && event.error;
      var args = [truncate(msg, ARG_CAP)];
      if (err !== undefined && err !== null) {
        try {
          args.push(safeString(err));
        } catch (_) {
          /* 忽略 */
        }
      }
      addEntry({
        kind: 'uncaught',
        level: 'error',
        text: truncate(msg, TEXT_CAP),
        args: args,
        source: source,
        line: line,
        col: col,
      });
    } catch (_) {
      /* 观测失败不得影响页面本身 */
    }
  }

  function onUnhandledRejection(event) {
    try {
      var reason = event ? event.reason : undefined;
      var text;
      try {
        text = reason === undefined || reason === null ? 'Unhandled rejection' : safeString(reason);
      } catch (_) {
        text = 'Unhandled rejection';
      }
      addEntry({
        kind: 'unhandledrejection',
        level: 'error',
        text: truncate(text, TEXT_CAP),
        args: [truncate(text, ARG_CAP)],
      });
    } catch (_) {
      /* 观测失败不得影响页面本身 */
    }
  }

  function addListener(type, fn) {
    if (typeof window.addEventListener !== 'function') {
      return;
    }
    window.addEventListener(type, fn);
    listeners.push({ type: type, fn: fn });
  }

  // ---------------------------------------------------------------- fetch hook

  function normalizeUrl(input) {
    try {
      if (typeof input === 'string') {
        return truncate(input, TEXT_CAP);
      }
      if (input && typeof input.url === 'string') {
        return truncate(input.url, TEXT_CAP); // Request 对象
      }
    } catch (_) {
      /* 忽略 */
    }
    return '';
  }

  function patchFetch() {
    if (typeof window.fetch !== 'function') {
      return;
    }
    var origFetch = window.fetch;
    restores.push({
      owner: window,
      key: 'fetch',
      had: hasOwn(window, 'fetch'),
      orig: origFetch,
    });

    window.fetch = function (input, init) {
      var method = 'GET';
      try {
        if (init && init.method) {
          method = toStr(init.method).toUpperCase();
        } else if (input && typeof input.method === 'string') {
          method = input.method.toUpperCase();
        }
      } catch (_) {
        method = 'GET';
      }
      var url = normalizeUrl(input);
      var started = Date.now();
      var p;
      try {
        p = origFetch.apply(this, arguments);
      } catch (err) {
        // 同步抛错（非法 URL 等）：记一条失败网络条目后原样抛出，不改变页面行为
        try {
          addEntry({
            kind: 'fetch',
            level: 'error',
            text: method + ' ' + url + ' → sync throw: ' + truncate(toStr(err && err.message), 200),
            args: [truncate(toStr(err && err.message), ARG_CAP)],
            url: url,
            method: method,
            durationMs: Date.now() - started,
            error: truncate(toStr(err), ARG_CAP),
          });
        } catch (_) {
          /* 忽略 */
        }
        throw err;
      }
      if (!p || typeof p.then !== 'function') {
        return p;
      }
      return p.then(
        function (res) {
          try {
            var status;
            var ok;
            try {
              status = res && typeof res.status === 'number' ? res.status : undefined;
              ok = res && typeof res.ok === 'boolean' ? res.ok : undefined;
            } catch (_) {
              status = undefined;
              ok = undefined;
            }
            var bad = ok === false || (typeof status === 'number' && status >= 400);
            // 刻意不读 body：避免消费响应流，页面自己仍可正常读
            addEntry({
              kind: 'fetch',
              level: bad ? 'error' : 'log',
              text: truncate(method + ' ' + url + ' → ' + toStr(status), TEXT_CAP),
              args: [truncate(method + ' ' + url, ARG_CAP)],
              url: url,
              method: method,
              status: status,
              durationMs: Date.now() - started,
            });
          } catch (_) {
            /* 忽略 */
          }
          return res;
        },
        function (err) {
          try {
            addEntry({
              kind: 'fetch',
              level: 'error',
              text: truncate(method + ' ' + url + ' → failed: ' + toStr(err && err.message), TEXT_CAP),
              args: [truncate(toStr(err && err.message), ARG_CAP)],
              url: url,
              method: method,
              durationMs: Date.now() - started,
              error: truncate(toStr(err), ARG_CAP),
            });
          } catch (_) {
            /* 忽略 */
          }
          throw err; // 原样透传 rejection，不改变页面行为
        }
      );
    };
  }

  // ---------------------------------------------------------------- XHR hook

  function resolveXhrProto() {
    try {
      if (typeof XMLHttpRequest === 'function' && XMLHttpRequest.prototype) {
        return XMLHttpRequest.prototype;
      }
    } catch (_) {
      /* 忽略 */
    }
    return null;
  }

  function bindXhrInstance(xhr) {
    if (!xhr || typeof xhr.addEventListener !== 'function') {
      return;
    }
    if (xhrSeen) {
      try {
        if (xhrSeen.has(xhr)) {
          return;
        }
        xhrSeen.add(xhr);
      } catch (_) {
        /* WeakSet 失败就退化为每次都挂（仍不影响行为） */
      }
    }
    try {
      xhr.addEventListener('loadend', function () {
        try {
          var status;
          try {
            status = typeof xhr.status === 'number' ? xhr.status : undefined;
          } catch (_) {
            status = undefined;
          }
          var bad =
            (typeof status === 'number' && status >= 400) ||
            (status === 0 && !(xhr.readyState === 4 && xhr.responseURL));
          var elapsed = xhr.__dshKitStart !== undefined ? Date.now() - xhr.__dshKitStart : undefined;
          var method = xhr.__dshKitMethod || 'GET';
          var url = xhr.__dshKitUrl || '';
          addEntry({
            kind: 'xhr',
            level: bad ? 'error' : 'log',
            text: truncate(method + ' ' + url + ' → ' + toStr(status), TEXT_CAP),
            args: [truncate(method + ' ' + url, ARG_CAP)],
            url: url,
            method: method,
            status: status,
            durationMs: elapsed,
          });
        } catch (_) {
          /* 忽略 */
        }
      });
    } catch (_) {
      /* 挂监听失败不影响请求本身 */
    }
  }

  function patchXhr() {
    var proto = resolveXhrProto();
    if (!proto) {
      return;
    }

    if (typeof proto.open === 'function') {
      var origOpen = proto.open;
      restores.push({ owner: proto, key: 'open', had: hasOwn(proto, 'open'), orig: origOpen });
      proto.open = function (method, url) {
        try {
          this.__dshKitMethod = method !== undefined && method !== null ? toStr(method).toUpperCase() : 'GET';
          this.__dshKitUrl = truncate(toStr(url), TEXT_CAP);
          bindXhrInstance(this);
        } catch (_) {
          /* 忽略 */
        }
        return origOpen.apply(this, arguments);
      };
    }

    if (typeof proto.send === 'function') {
      var origSend = proto.send;
      restores.push({ owner: proto, key: 'send', had: hasOwn(proto, 'send'), orig: origSend });
      proto.send = function () {
        try {
          this.__dshKitStart = Date.now();
          bindXhrInstance(this);
        } catch (_) {
          /* 忽略 */
        }
        return origSend.apply(this, arguments);
      };
    }
  }

  // ---------------------------------------------------------------- 公共 API

  /** 只读语义：函数形式暴露（返回副本，页面/agent 改不到内部缓冲）。 */
  function entriesView() {
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      out.push(cloneEntry(entries[i]));
    }
    return out;
  }

  function matchFilter(entry, filter) {
    if (filter === undefined || filter === null || filter === '') {
      return true;
    }
    var text = typeof entry.text === 'string' ? entry.text : '';
    if (typeof filter === 'string') {
      return text.indexOf(filter) !== -1;
    }
    if (typeof filter === 'object') {
      var re = filter.re;
      if (re === undefined || re === null) {
        return true;
      }
      try {
        // 跨 realm 的 RegExp 过不了 instanceof（agent 侧 regex 与页面 main world 不同 realm），
        // 所以用鸭子类型认 RegExp，否则取其 source。
        var rx;
        if (re instanceof RegExp) {
          rx = re;
        } else if (re && typeof re === 'object' && typeof re.source === 'string') {
          rx = new RegExp(re.source, typeof re.flags === 'string' ? re.flags : '');
        } else {
          rx = new RegExp(toStr(re));
        }
        return rx.test(text);
      } catch (_) {
        return true; // 非法正则忽略（不静默丢光所有条目）
      }
    }
    return true;
  }

  function dump(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var limit = DEFAULT_LIMIT;
    if (typeof opts.limit === 'number' && isFinite(opts.limit) && opts.limit >= 0) {
      limit = Math.floor(opts.limit);
    }
    if (limit > MAX_ENTRIES) {
      limit = MAX_ENTRIES; // 硬上限
    }
    var level = opts.level === undefined || opts.level === null ? 'all' : toStr(opts.level);
    var since = typeof opts.since === 'number' ? opts.since : null;
    var netOnly = opts.net === true;
    var filter = opts.filter;

    var picked = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (level !== 'all' && e.level !== level) {
        continue;
      }
      if (since !== null && !(typeof e.t === 'number' && e.t >= since)) {
        continue;
      }
      if (netOnly && e.kind !== 'fetch' && e.kind !== 'xhr') {
        continue;
      }
      if (!matchFilter(e, filter)) {
        continue;
      }
      picked.push(e);
    }
    // limit 语义：末尾 N 条
    if (picked.length > limit) {
      picked = picked.slice(picked.length - limit);
    }
    var out = [];
    for (i = 0; i < picked.length; i++) {
      out.push(cloneEntry(picked[i]));
    }
    return out;
  }

  function clear() {
    var n = entries.length;
    entries = [];
    byKind = {};
    dropped = 0;
    return n;
  }

  function stats() {
    var by = {};
    for (var k in byKind) {
      if (hasOwn(byKind, k)) {
        by[k] = byKind[k];
      }
    }
    return {
      total: entries.length,
      dropped: dropped,
      byKind: by,
      installedAt: installedAt,
    };
  }

  function mark(label) {
    var text = label === undefined || label === null ? 'mark' : truncate(toStr(label), TEXT_CAP);
    var e = addEntry({
      kind: 'mark',
      level: 'log',
      text: text,
      args: label === undefined || label === null ? [] : [truncate(text, ARG_CAP)],
    });
    return { seq: e.seq, t: e.t };
  }

  function uninstall() {
    for (var i = restores.length - 1; i >= 0; i--) {
      var r = restores[i];
      try {
        if (r.had) {
          r.owner[r.key] = r.orig;
        } else {
          try {
            delete r.owner[r.key];
          } catch (_) {
            r.owner[r.key] = r.orig;
          }
        }
      } catch (_) {
        /* 单个还原失败不阻塞其余 */
      }
    }
    restores = [];

    if (typeof window.removeEventListener === 'function') {
      for (i = 0; i < listeners.length; i++) {
        try {
          window.removeEventListener(listeners[i].type, listeners[i].fn);
        } catch (_) {
          /* 忽略 */
        }
      }
    }
    listeners = [];
    try {
      window.__dshKitConsole = api; // 历史条目仍可 dump（只卸载 hook，不清缓冲）
    } catch (_) {
      /* 忽略 */
    }
    return { ok: true };
  }

  var api = {
    version: VERSION,
    entries: entriesView,
    dump: dump,
    clear: clear,
    stats: stats,
    mark: mark,
    uninstall: uninstall,
  };

  // ---------------------------------------------------------------- 安装

  function install() {
    patchConsole();
    addListener('error', onWindowError);
    addListener('unhandledrejection', onUnhandledRejection);
    patchFetch();
    patchXhr();
  }

  try {
    install();
  } catch (_) {
    /* 安装期异常不应把页面搞崩：能装的 hook 保持可用 */
  }

  try {
    window.__dshKitConsole = api;
  } catch (_) {
    /* 忽略 */
  }

  return 'installed';
})();
