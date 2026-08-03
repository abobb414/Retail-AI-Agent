#!/usr/bin/env node

import assert from "node:assert/strict";

globalThis.defineEventHandler ??= (handler) => handler;

const { buildWorkerMessage } = await import("../frontend/server/api/chat.post.ts");

const firstRequest = "给我推荐一块室内照明灯具预算300";
const followUp = "阅读照明";

assert.equal(
  buildWorkerMessage([
    { role: "user", content: firstRequest },
    { role: "assistant", content: "准备放在哪，主要是阅读照明还是氛围灯？" },
    { role: "user", content: followUp },
  ]),
  `${firstRequest}；${followUp}`,
);

assert.equal(
  buildWorkerMessage([
    { role: "user", content: firstRequest },
    { role: "assistant", content: "准备放在哪，主要是阅读照明还是氛围灯？" },
    { role: "user", content: "好的预算500" },
  ]),
  `${firstRequest}；好的预算500`,
);

assert.equal(
  buildWorkerMessage([
    { role: "user", content: "卧室想换四件套预算500" },
    { role: "assistant", content: "我记下了" },
    { role: "user", content: "颜色想要浅一点，容易搭家具" },
  ]),
  "卧室想换四件套预算500；颜色想要浅一点，容易搭家具",
);

console.log("Chat context regression passed: follow-up conditions preserve prior product context.");
