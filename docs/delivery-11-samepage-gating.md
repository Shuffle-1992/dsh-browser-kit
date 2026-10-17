# delivery-11 — 同页门控：跨窗口共享不再串徽标（annotator 1.5.0）

日期：2026-10-05　前置：delivery-09/10
用户反馈：窗口1在密码输入框批注 #1，窗口2（另一页面）的密码输入框也显示 #1——「批注串窗口了」。

## 根因（P28）

共享同步只认 gid 不认页面：syncPanes 把批注推给所有成员面板，`addExternal` 在目标页
`querySelector(selector)` 命中同类元素（密码框到处都有）就渲染徽标。
「同一页面开两窗口 → 徽标两边出现」的核心诉求被放大成「任何页面命中就出现」。

## 修复（同页门控）

- **共享板块不变**：列表全量共享、编号跨窗口延续、互相引用、提交合并——全部保持。
- client syncPanes：快照一次带回各面板 `location.href`；新 gid 登记 `st.originUrls[gid] = 来源页 URL`；
  推送项附 `_originUrl`。
- annotator `addExternal`（1.5.0）：`samePageHref(_originUrl, location.href)`（origin+pathname 相等，
  query/hash 忽略）判 `pageOk`——
  - 同页：照常渲染徽标（原核心诉求保留）；
  - 非同页：只进共享列表，**不渲染徽标、不留 el（防 selector 误命中）、无 stale 语义**
    （`isStale` 对 `pageOk===false` 直接 false，`start()` 重钉标循环同样跳过）。
- 版本 1.4.0 → **1.5.0**：版本检查触发全量重注入，清掉用户页面上已串窗的历史徽标。

## 验证

- 冒烟新增段：`addExternal` 带 `_originUrl=http://other.example/...` → 列表 +1、徽标 0、无 stale；
  带 `_originUrl=location.href` → 徽标渲染。
- 静态契约：双端版本锁 1.5.0；client `href: location.href` / `st.originUrls[...]` / `_originUrl` /
  `originUrls: {}`；annotator `samePageHref` / `pageOk`。
- `npm test` 91/91 全绿；已 toggle 热换。

## 语义总表（共享会话 × 页面关系）

| 场景 | 列表（共享板块） | 徽标渲染 |
| --- | --- | --- |
| 同一页面开两个窗口 | 两边都见，编号延续 | 两边都渲染（原核心诉求） |
| 不同页面（如 A 站登录页 / B 站登录页） | 两边都见，编号延续 | 只在来源页渲染 |
