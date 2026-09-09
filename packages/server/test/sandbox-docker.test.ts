// docker 沙箱集成测试（需本机 docker 可用 + wt-agent-python 镜像已构建）。
// 覆盖：容器化 spawn→ready 握手、请求回合、资源限制生效、kill 后容器清理。
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentProcess } from "../src/agents/runner.js";
import { loadManifest } from "../src/agents/manifest.js";
import { dockerSandbox } from "../src/agents/sandbox.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const randomBotDir = path.join(repoRoot, "agents/random-bot");

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function imageReady(): boolean {
  try {
    execSync("docker image inspect wt-agent-python:latest", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const RUN = dockerAvailable() && imageReady();
const d = RUN ? describe : describe.skip;

const processes: AgentProcess[] = [];
afterAll(async () => {
  await Promise.all(processes.map((p) => p.kill("test-end").catch(() => {})));
  execSync("docker ps -aq --filter name=wt-agent-gtest --format {{.ID}} | xargs -r docker rm -f", { stdio: "ignore" });
});

async function spawnBot(seat: number): Promise<AgentProcess> {
  const { dir, manifest } = loadManifest(randomBotDir);
  const workDir = await mkdtemp(path.join(tmpdir(), "wt-docker-"));
  const ap = await AgentProcess.spawn(manifest, dockerSandbox(), {
    gameId: "gtest",
    seat,
    agentDir: dir,
    workDir,
    agentId: "docker-test-bot",
  });
  processes.push(ap);
  return ap;
}

d("docker 沙箱", () => {
  beforeAll(() => {
    // 网络就绪（build-agent-images.sh 已建；防御性确保）
    try {
      execSync("docker network inspect wt-agent-net", { stdio: "ignore" });
    } catch {
      execSync("docker network create -o com.docker.network.bridge.enable_icc=false wt-agent-net", { stdio: "ignore" });
    }
  }, 30_000);

  it(
    "容器内 spawn -> ready -> 完整请求回合",
    async () => {
      const ap = await spawnBot(3);
      ap.notify({
        type: "game_start",
        you: { seat: 3, role: "villager", faction: "village" },
        config: {
          player_count: 9,
          role_set: { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1 },
          win_condition: "kill_side",
          speech_char_limit: 2000,
          timeouts_ms: { night_action: 10000, speech: 10000, vote: 10000, last_words: 10000, hunter: 10000 },
        },
        players: Array.from({ length: 9 }, (_, i) => ({ seat: i + 1, name: `b${i + 1}` })),
      } as never);

      const vote = await ap.request({
        type: "vote_request",
        day: 1,
        round: 1,
        candidates: [5, 7],
        abstain_allowed: false,
        alive: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        timeout_ms: 8000,
      } as never);
      expect(vote.ok).toBe(true);
      if (vote.ok && vote.res.type === "vote") expect([5, 7]).toContain(vote.res.target);

      const speech = await ap.request({
        type: "day_speech_request",
        day: 1,
        order: [3],
        alive: [1, 2, 3],
        char_limit: 2000,
        timeout_ms: 8000,
      } as never);
      expect(speech.ok).toBe(true);
    },
    60_000,
  );

  it(
    "资源限制按 manifest 生效（memory/pids）",
    async () => {
      const ap = await spawnBot(5);
      const inspect = execSync(
        `docker inspect wt-agent-gtest-s5 --format '{{.HostConfig.Memory}} {{.HostConfig.PidsLimit}} {{.HostConfig.ReadonlyRootfs}} {{.Config.User}}'`,
        { encoding: "utf8" },
      ).trim();
      // random-bot manifest: 256MB / pids 128 / read-only / 10001
      const [mem, pids, ro, user] = inspect.split(" ");
      expect(Number(mem)).toBe(256 * 1024 * 1024);
      expect(Number(pids)).toBe(128);
      expect(ro).toBe("true");
      expect(user).toBe("10001:10001");
    },
    60_000,
  );

  it(
    "网络隔离：network=none 的容器无法访问宿主端口",
    async () => {
      // random-bot network=none -> 容器应无网络。用一次性容器直接验证（不依赖 bot 行为）
      let blocked = true;
      try {
        execSync(
          `docker run --rm --network none wt-agent-python:latest python3 -c "import socket,urllib.request;urllib.request.urlopen('http://host.docker.internal:3000',timeout=3)"`,
          { stdio: "ignore", timeout: 15000 },
        );
        blocked = false;
      } catch {
        blocked = true;
      }
      expect(blocked).toBe(true);
      void (await spawnBot(7)); // 顺带验证 7 号位 spawn 正常
    },
    30_000,
  );

  it(
    "kill 后容器被回收（--rm）",
    async () => {
      const ap = await spawnBot(9);
      await ap.kill("test");
      await new Promise((r) => setTimeout(r, 2000));
      let exists = true;
      try {
        execSync("docker inspect wt-agent-gtest-s9", { stdio: "ignore" });
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    },
    60_000,
  );
});
