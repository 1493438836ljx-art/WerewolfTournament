// 编排器端到端：9 个真实 random-bot 进程跑完整一局（无 DB，内存 sink）。
import { describe, expect, it } from "vitest";
import path from "node:path";
import type { Seat } from "@wt/protocol";
import { Orchestrator, type GameResult, type PlayerSpec } from "../src/game/orchestrator.js";
import { EventBus, type BusEvent } from "../src/game/bus.js";
import { loadManifest } from "../src/agents/manifest.js";
import { noneSandbox } from "../src/agents/sandbox.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function players(n = 9): PlayerSpec[] {
  const { dir, manifest } = loadManifest(path.join(repoRoot, "agents/random-bot"));
  return Array.from({ length: n }, (_, i) => ({
    seat: (i + 1) as Seat,
    agentId: `bot-${i + 1}`,
    name: `random-bot-${i + 1}`,
    agentDir: dir,
    manifest: { ...manifest, name: `random-bot-${i + 1}` },
  }));
}

describe("Orchestrator 端到端", () => {
  it(
    "9 个 random-bot 跑完整局：终局、进程清理、事件广播",
    async () => {
      const bus = new EventBus();
      const events: BusEvent[] = [];
      bus.subscribe("game/e2e-1", (ev) => events.push(ev));

      const allEvents: unknown[] = [];
      let violationsSeen = 0;
      const orch = new Orchestrator(
        "e2e-1",
        bus,
        noneSandbox(),
        {
          onEvents: async (_s, evs) => allEvents.push(...evs),
          onAgentLog: (_seat, text) => {
            if (text.includes("violation")) violationsSeen++;
          },
        },
      );

      const result: GameResult = await orch.run({
        seed: "e2e-seed-1",
        config: {
          timeoutsMs: { night_action: 3000, speech: 3000, vote: 2000, last_words: 2000, hunter: 2000 },
        },
        players: players(),
      });

      // 终局结果完整
      expect(result.winnerFaction).toMatch(/werewolf|village/);
      expect(result.seats).toHaveLength(9);
      expect(result.state.log.length).toBeGreaterThan(10);
      for (const s of result.seats) {
        expect(s.role).toBeTruthy();
        expect(typeof s.teamWon).toBe("boolean");
      }

      // 引擎事件全部经过 onEvents（含公开与私有）
      expect(allEvents.length).toBe(result.state.log.length);

      // bus 收到公开事件与快照
      expect(events.some((e) => e.kind === "night_begun")).toBe(true);
      expect(events.some((e) => e.kind === "snapshot")).toBe(true);
      expect(events.filter((e) => e.kind === "snapshot").length).toBeGreaterThan(3);

      // random-bot 规规矩矩，不应有违规
      expect(violationsSeen).toBe(0);
    },
    120_000,
  );

  it(
    "坏 bot（投非法目标 3 次）被取消资格，对局仍完整走完",
    async () => {
      const { dir, manifest } = loadManifest(path.join(repoRoot, "agents/random-bot"));
      const ps = players();
      // 座位 9 换成坏 bot：投票永远投不存在的座位 99（合法 JSON 但语义非法 -> 违规）
      ps[8] = {
        ...ps[8]!,
        manifest: { ...manifest, name: "bad-vote-bot" },
        agentDir: await badVoteBotDir(),
      };

      const bus = new EventBus();
      const orch = new Orchestrator("e2e-2", bus, noneSandbox(), {
        onEvents: async () => {},
      });
      const result = await orch.run({
        seed: "e2e-seed-2",
        config: {
          timeoutsMs: { night_action: 2000, speech: 1500, vote: 1500, last_words: 1500, hunter: 1500 },
        },
        players: ps,
      });

      const bad = result.seats.find((x) => x.seat === 9)!;
      expect(bad.violations).toBeGreaterThanOrEqual(3);
      expect(result.state.disqualifications.some((d) => d.seat === 9)).toBe(true);
      expect(result.winnerFaction).toMatch(/werewolf|village/);
      void dir;
    },
    180_000,
  );
});

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
async function badVoteBotDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "wt-badvote-"));
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      name: "bad-vote-bot",
      language: "python",
      command: ["python3", "main.py"],
      resources: { memory_mb: 128, cpus: 0.1 },
      network: "none",
    }),
  );
  await writeFile(
    path.join(dir, "main.py"),
    `import json,sys
def send(m): print(json.dumps(m), flush=True)
for line in sys.stdin:
    msg=json.loads(line)
    t=msg.get("type"); rid=msg.get("msg_id")
    if t=="hello":
        send({"v":1,"in_reply_to":rid,"type":"ready","agent_name":"bad-vote"})
    elif t=="vote_request":
        send({"v":1,"in_reply_to":rid,"type":"vote","target":99})  # 非法座位
    elif t=="sheriff_vote_request":
        send({"v":1,"in_reply_to":rid,"type":"sheriff_vote","target":99})  # 非法座位
    elif t in ("day_speech_request","pk_speech_request"):
        send({"v":1,"in_reply_to":rid,"type":"speech","text":"我是好人"})
    elif t=="last_words_request":
        send({"v":1,"in_reply_to":rid,"type":"last_words","text":"LW"})
`,
  );
  return dir;
}
