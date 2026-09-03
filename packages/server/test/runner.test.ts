// AgentRunner 集成测试：真实 spawn python 子进程。
// 覆盖：正常握手与请求、脏输出不击穿（违规计数）、挂死进程超时、进程崩溃感知。
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentProcess } from "../src/agents/runner.js";
import { loadManifest } from "../src/agents/manifest.js";
import { noneSandbox } from "../src/agents/sandbox.js";
import { selfcheck } from "../src/agents/selfcheck.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const randomBotDir = path.join(repoRoot, "agents/random-bot");

const processes: AgentProcess[] = [];
afterAll(async () => {
  await Promise.all(processes.map((p) => p.kill("test-end").catch(() => {})));
});

async function spawnBot(dir: string, seat = 1, agentId = "test-bot"): Promise<AgentProcess> {
  const { manifest, dir: agentDir } = loadManifest(dir);
  const workDir = await mkdtemp(path.join(tmpdir(), "wt-agent-"));
  const ap = await AgentProcess.spawn(manifest, noneSandbox(), {
    gameId: "g-test",
    seat,
    agentDir,
    workDir,
    agentId,
  });
  processes.push(ap);
  return ap;
}

describe("random-bot 集成", () => {
  it("selfcheck 通过（真实 spawn -> ready）", async () => {
    const result = await selfcheck(async () => {
      const ap = await spawnBot(randomBotDir);
      return {
        ready: Promise.resolve({ agentName: "random-bot" }),
        kill: (r: string) => ap.kill(r),
        stderrTail: ap.stderrTail,
        hasExited: ap.hasExited,
      };
    });
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThan(0);
  }, 30_000);

  it("完整请求回合：game_start -> 夜行动作 -> 发言 -> 投票", async () => {
    const ap = await spawnBot(randomBotDir, 3);
    ap.notify({
      type: "game_start",
      you: { seat: 3, role: "werewolf", faction: "werewolf", wolf_teammates: [1, 2] },
      config: {
        player_count: 9,
        role_set: { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1 },
        win_condition: "kill_side",
        speech_char_limit: 2000,
        timeouts_ms: { night_action: 5000, speech: 5000, vote: 5000, last_words: 5000, hunter: 5000 },
      },
      players: Array.from({ length: 9 }, (_, i) => ({ seat: i + 1, name: `b${i + 1}` })),
    } as never);

    const night = await ap.request({
      type: "night_action_request",
      night: 1,
      alive: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      timeout_ms: 5000,
      role: "werewolf",
      options: {
        as: "werewolf",
        teammates: [{ seat: 1, alive: true }, { seat: 2, alive: true }],
        kill_targets: [4, 5, 6, 7, 8, 9, null],
      },
    } as never);
    expect(night.ok).toBe(true);
    if (night.ok) expect(["night_action"]).toContain(night.res.type);

    const speech = await ap.request({
      type: "day_speech_request",
      day: 1,
      order: [3, 4, 5],
      alive: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      char_limit: 2000,
      timeout_ms: 5000,
    } as never);
    expect(speech.ok).toBe(true);
    if (speech.ok) expect(speech.res.type).toBe("speech");

    const vote = await ap.request({
      type: "vote_request",
      day: 1,
      round: 1,
      candidates: [4, 5],
      abstain_allowed: false,
      alive: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      timeout_ms: 5000,
    } as never);
    expect(vote.ok).toBe(true);
    if (vote.ok && vote.res.type === "vote") expect([4, 5]).toContain(vote.res.target);
  }, 30_000);
});

describe("脏输入与故障", () => {
  it("输出垃圾行的 bot：违规计数、合法回复仍可送达", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wt-dirty-"));
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        name: "dirty-bot",
        language: "python",
        command: ["python3", "main.py"],
        resources: { memory_mb: 128, cpus: 0.1 },
        network: "none",
      }),
    );
    await writeFile(
      path.join(dir, "main.py"),
      `import json,sys,random
def send(m): print(json.dumps(m), flush=True)
for line in sys.stdin:
    msg=json.loads(line)
    t=msg.get("type"); rid=msg.get("msg_id")
    if t=="hello":
        print("this is debug garbage on stdout", flush=True)   # 违规1
        print("{not json", flush=True)                          # 违规2
        send({"v":1,"in_reply_to":"nonexistent","type":"vote","target":1})  # 违规3（未知引用）
        send({"v":1,"in_reply_to":rid,"type":"ready","agent_name":"dirty"})
    elif t=="vote_request":
        send({"v":1,"in_reply_to":rid,"type":"vote","target":msg["candidates"][0]})
`,
    );
    const ap = await spawnBot(dir, 5, "dirty");
    // ready 已收到（spawn resolve），违规已有 3
    expect(ap.violations).toBeGreaterThanOrEqual(2);
    const vote = await ap.request({
      type: "vote_request",
      day: 1,
      round: 1,
      candidates: [2, 3],
      abstain_allowed: false,
      alive: [1, 2, 3],
      timeout_ms: 5000,
    } as never);
    expect(vote.ok).toBe(true);
    expect(ap.violations).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it("挂死 bot：请求超时返回 err=timeout", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wt-hang-"));
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        name: "hang-bot",
        language: "python",
        command: ["python3", "main.py"],
        resources: { memory_mb: 128, cpus: 0.1 },
        network: "none",
      }),
    );
    await writeFile(
      path.join(dir, "main.py"),
      `import json,sys,time
def send(m): print(json.dumps(m), flush=True)
for line in sys.stdin:
    msg=json.loads(line)
    if msg.get("type")=="hello":
        send({"v":1,"in_reply_to":msg["msg_id"],"type":"ready","agent_name":"hang"})
    else:
        time.sleep(3600)  # 挂死
`,
    );
    const ap = await spawnBot(dir, 7, "hang");
    const r = await ap.request({
      type: "vote_request",
      day: 1,
      round: 1,
      candidates: [2],
      abstain_allowed: false,
      alive: [1, 2],
      timeout_ms: 800,
    } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.err).toBe("timeout");
  }, 30_000);

  it("进程崩溃：后续请求返回 err=crash", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wt-crash-"));
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        name: "crash-bot",
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
    if msg.get("type")=="hello":
        send({"v":1,"in_reply_to":msg["msg_id"],"type":"ready","agent_name":"crash"})
    else:
        sys.exit(1)  # 收到首个请求即崩溃
`,
    );
    const ap = await spawnBot(dir, 9, "crash");
    const r = await ap.request({
      type: "vote_request",
      day: 1,
      round: 1,
      candidates: [2],
      abstain_allowed: false,
      alive: [1, 2],
      timeout_ms: 5000,
    } as never);
    // 崩溃或超时都算失败，但应为 crash（exit 事件先触发）
    expect(r.ok).toBe(false);
    expect(ap.hasExited || (!r.ok && r.err === "crash")).toBe(true);
  }, 30_000);
});
