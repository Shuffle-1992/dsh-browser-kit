/**
 * v23 回归护栏：批注镜像面板**不能依赖"只在打开自持窗口时才启动"的 1s tick**。
 *
 * 事故（2026-10-10 用户实测）：「点开批注，右下角什么都没有」。
 * 根因：`syncAnnotMirror()` 只被 `agentViewIdleTick`（1s）驱动，而该 tick 由
 * `startAgentViewIdleTick()` 在**自持窗口 open 路径**里启动 ⇒ 没开自持窗口的会话里它根本不跑；
 * 同时页内面板被 `mirror:true` 隐藏 ⇒ 两头都空。定位靠新加的 `kit-status.annotMirror.idleTimerOn=false`。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clientSource = readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8");

const sliceBetween = (startMark, endMark) => {
  const a = clientSource.indexOf(startMark);
  assert.ok(a > 0, `找不到起点：${startMark}`);
  const b = clientSource.indexOf(endMark, a);
  assert.ok(b > a, `找不到终点：${endMark}`);
  return clientSource.slice(a, b);
};

test("v23：镜像同步由「必定在跑」的主 2s tick 驱动（不能只留在 1s idle tick）", () => {
  const mainTick = sliceBetween("try { stateRef.tickAt = new Date().toISOString();", "await tickSelfHealAndAutoJoin(");
  assert.match(mainTick, /syncAnnotMirror\(\)/, "主 2s tick 必须驱动镜像同步（否则没开自持窗口就没有面板）");
  assert.match(mainTick, /removeAnnotMirror\(\)/, "会话结束时应撤掉镜像（同一 tick 内收口）");
  // 1s idle tick 里保留一份无害（自持窗口开着时更及时），但**不能是唯一入口**
  const idleTick = sliceBetween("const agentViewIdleTick = () => {", "const startAgentViewIdleTick = () => {");
  assert.match(idleTick, /syncAnnotMirror\(\)/);
});

/** 剥掉注释再比较：注释里也会出现被检查的代码文本（本次就踩到——护栏得先把自己的假阳性修掉）。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("v23：1s idle tick 里的批注块必须在「自持窗口存在」这道门之前", () => {
  const idleTick = stripComments(sliceBetween("const agentViewIdleTick = () => {", "const startAgentViewIdleTick = () => {"));
  const mirrorAt = idleTick.indexOf("syncAnnotMirror()");
  const gateAt = idleTick.indexOf("if (!agentViewWebview()) return;");
  assert.ok(mirrorAt > 0 && gateAt > 0, "idle tick 结构变化，护栏需同步");
  assert.ok(mirrorAt < gateAt, "批注镜像同步必须在 `if (!agentViewWebview()) return;` 之前，否则无自持窗口时不执行");
});

test("v23：镜像失败必须可查（不再静默）", () => {
  assert.match(clientSource, /mirrorDiag: \{ calls: 0, injected: 0, skippedBusy: 0, skippedNoPane: 0, skippedNoHtml: 0, resetForced: 0, lastError: null, lastAt: null \}/);
  assert.match(clientSource, /dg\.skippedBusy \+= 1/);
  assert.match(clientSource, /dg\.skippedNoPane \+= 1/);
  assert.match(clientSource, /dg\.lastError = msgOf\(e\)/);
  assert.match(clientSource, /annotMirror: \{/, "kit-status 必须暴露 annotMirror 诊断块");
  assert.match(clientSource, /idleTimerOn: !!agentView\.idleTimer/, "诊断需含 idleTimerOn（本次事故的定位字段）");
});

test("v23：boot 期不得调用作用域外的 startAgentViewIdleTick（保持注释警示）", () => {
  // 该函数定义在自持窗口 open 路径内，模块级调用取不到（曾经静默无效）；此处钉住"不要再加回去"
  const bootArea = sliceBetween("trackInterval(setInterval(() => { pollCommands()", "/* 看门狗：单条命令最长占用 30s");
  assert.doesNotMatch(bootArea, /startAgentViewIdleTick\(\)/, "boot 期调用无效（作用域外），勿再加回");
});
