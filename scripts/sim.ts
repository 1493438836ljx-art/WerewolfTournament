// 纯引擎模拟：不起任何进程，随机策略跑完整对局，输出事件日志。
// 用法：pnpm sim [seed] [--quiet]
import { createGame, reduce, autobotStep, Rng, seedFromString, spectatorView } from "../packages/engine/src/index.js";
import type { Seat } from "../packages/protocol/src/index.js";

const seed = process.argv[2] ?? `sim-${Date.now()}`;
const quiet = process.argv.includes("--quiet");

const g = createGame({
  gameId: `sim-${seed}`,
  seed,
  players: Array.from({ length: 9 }, (_, i) => ({
    seat: (i + 1) as Seat,
    agentId: `bot${i + 1}`,
    name: `bot${i + 1}`,
  })),
});

const rng = new Rng(seedFromString(seed + "-autobot"));
let s = g.state;
let steps = 0;
const t0 = Date.now();

while (!s.winner && steps++ < 5000) {
  if (s.pending.length === 0) throw new Error(`deadlock @ ${JSON.stringify(s.phase)}`);
  for (const a of autobotStep(s, rng)) s = reduce(s, a).state;
}

if (!quiet) {
  for (const ev of s.log) {
    const vis = ev.visibility === "public" ? "  " : `(${typeof ev.visibility === "object" ? ev.visibility.seats.join(",") : "?"})`;
    console.log(`#${String(ev.seq).padStart(3)} ${vis} ${ev.kind.padEnd(18)} ${JSON.stringify(ev.payload).slice(0, 120)}`);
  }
}

const view = spectatorView(s);
console.log("\n===== 对局摘要 =====");
console.log(`seed: ${seed} | 步数: ${steps} | 耗时: ${Date.now() - t0}ms`);
console.log(`胜负: ${s.winner?.faction} (${s.winner?.reason})`);
console.log("翻牌:", s.seats.map((x) => `${x.seat}=${x.role}${x.alive ? "" : "†"}`).join(" "));
console.log(`夜数: ${s.night} 天数: ${s.day} | 超时:`, s.penalties, "| DQ:", s.disqualifications);
if (!s.winner) {
  console.error("!! 对局未终局（guard 耗尽）");
  process.exit(1);
}
