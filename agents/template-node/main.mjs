#!/usr/bin/env node
/**
 * 选手模板（Node.js）—— 零依赖消息循环骨架。
 * 协议类型定义见 packages/protocol/src（可 import "@wt/protocol"）。
 * 策略 TODO 标注处替换为你的推理；LLM 调用示例见 docs/PROTOCOL.md §6。
 */
import readline from "node:readline";

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  try {
    handle(JSON.parse(line));
  } catch (e) {
    console.error(`[main] ${e}`); // 调试走 stderr，永不崩溃
  }
});

function handle(msg) {
  const t = msg.type, rid = msg.msg_id;
  switch (t) {
    case "hello":
      send({ v: 1, in_reply_to: rid, type: "ready", agent_name: "my-agent-ts" });
      break;
    case "game_start":
      // TODO: 记住自己的座位/角色（狼人有队友列表）
      break;
    case "day_speech_request":
    case "pk_speech_request":
      // TODO: 基于历史发言的推理；示例为保守发言
      send({ v: 1, in_reply_to: rid, type: "speech", text: "我是好人，先听大家的。" });
      break;
    case "night_action_request": {
      const o = msg.options;
      if (o.as === "werewolf") {
        const targets = o.kill_targets.filter((x) => x !== null);
        send({ v: 1, in_reply_to: rid, type: "night_action", action: { as: "werewolf", kill: targets[0] ?? null } });
      } else if (o.as === "seer") {
        send({ v: 1, in_reply_to: rid, type: "night_action", action: { as: "seer", check: o.unchecked[0] ?? msg.alive[0] } });
      } else {
        send({ v: 1, in_reply_to: rid, type: "night_action", action: { as: "witch", heal: !!o.killed_tonight && o.heal_available, poison: null } });
      }
      break;
    }
    case "vote_request": {
      const me = msg.candidates[0]; // TODO: 换成你的推理
      send({ v: 1, in_reply_to: rid, type: "vote", target: me ?? null });
      break;
    }
    case "last_words_request":
      send({ v: 1, in_reply_to: rid, type: "last_words", text: "GG，记住我的发言。" });
      break;
    case "hunter_shoot_request":
      send({ v: 1, in_reply_to: rid, type: "hunter_shoot", shoot: msg.shoot_targets[0] ?? null });
      break;
    default:
      break; // notify / game_end：维护你的对局记忆
  }
}
