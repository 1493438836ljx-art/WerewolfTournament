// 全链路 e2e 冒烟：scan 注册 -> 创建锦标赛 -> 跑完整对局 -> 校验积分与事件流。
// 前置：docker compose up -d postgres && pnpm db:migrate
// 用法：DATABASE_URL=... pnpm e2e
import "dotenv/config";
import { scanAndRegister } from "../packages/server/src/agents/registry.js";
import { GameService } from "../packages/server/src/game/service.js";
import { EventBus } from "../packages/server/src/game/bus.js";
import { db, pool } from "../packages/server/src/db/index.js";
import { gameEvents, games } from "../packages/server/src/db/schema.js";
import { eq } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentsRoot = path.resolve(__dirname, "../agents");

async function main() {
  console.log("== e2e: 注册 agent ==");
  const { added, updated } = await scanAndRegister(agentsRoot);
  console.log(`新增 ${added.length}，更新 ${updated.length}`);
  if (added.length + updated.length === 0) throw new Error("无 agent 可注册（agents/ 目录为空？）");

  // 用第一个 agent 跑 9 副本单局锦标赛
  const agentId = added[0] ?? updated[0];
  const bus = new EventBus();
  const service = new GameService(bus, { agentsRoot, sandbox: "none" });

  console.log("== e2e: 创建并运行锦标赛（9 副本 random-bot）==");
  const tid = await service.createTournament({ name: "e2e", agentIds: [agentId], gamesPerAgent: 9, maxConcurrentGames: 1 });
  const started = Date.now();
  await service.startTournament(tid);
  console.log(`完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);

  // 校验
  const board = await service.leaderboard(tid);
  if (board.length === 0) throw new Error("积分榜为空");
  const [game] = await db.select().from(games).where(eq(games.tournamentId, tid));
  if (!game || game.status !== "done" || !game.winnerFaction) throw new Error("对局未正确终局");
  const evs = await db.select().from(gameEvents).where(eq(gameEvents.gameId, game.id));
  if (evs.length < 10) throw new Error("事件流不完整");

  console.log("\n== e2e 结果 ==");
  console.log(`对局 ${game.id}: ${game.winnerFaction} 胜（${game.winReason}），事件 ${evs.length} 条`);
  for (const b of board) {
    console.log(`  ${b.name}: ${b.points} 分，${b.wins}/${b.games} 胜，MVP ${b.mvps}，超时 ${b.timeouts}`);
  }
  console.log("\n✅ e2e 通过");
  await pool.end();
}

main().catch((e) => {
  console.error("❌ e2e 失败:", e);
  process.exit(1);
});
