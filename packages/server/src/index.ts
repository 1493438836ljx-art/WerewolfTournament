import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { execSync } from "node:child_process";
import { EventBus } from "./game/bus.js";
import { GameService } from "./game/service.js";
import { registerRest } from "./api/rest.js";
import { registerWs } from "./api/ws.js";
import { initReferee } from "./llmreferee.js";
import { llmConfigFromEnv } from "@wt/llm";
import { createLlmProxy, proxyForAgent } from "./llmproxy.js";
import { ensureAdminSeed, registerAuthRoutes } from "./auth.js";
import { registerUploadRoute } from "./upload.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true, bodyLimit: 4 * 1024 * 1024 });
await app.register(websocket);
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

await ensureAdminSeed();
registerAuthRoutes(app);

const bus = new EventBus();
const agentsRoot = process.env.WT_AGENTS_ROOT ?? path.resolve(__dirname, "../../../agents");
const sandbox = (process.env.WT_SANDBOX === "docker" ? "docker" : "none") as "none" | "docker";

initReferee();
// 平台 LLM 代理（配置了裁判 LLM 即启用；agent 沙箱内唯一 LLM 出口）
const proxy = createLlmProxy(app, llmConfigFromEnv());
// docker 沙箱内访问宿主须用 host.docker.internal；none 模式直连本机
const proxyHost = sandbox === "docker" ? "host.docker.internal" : "127.0.0.1";
const gameService = new GameService(bus, {
  agentsRoot,
  sandbox,
  llmProxyFor: proxy
    ? (agentId) => proxyForAgent(proxy, `${proxyHost}:${port}`, agentId)
    : undefined,
});

// docker 沙箱前置检查：docker 可用 + 镜像与代理网络就绪
if (sandbox === "docker") {
  const check = (cmd: string): boolean => {
    try {
      execSync(cmd, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  if (!check("docker info")) {
    app.log.error("WT_SANDBOX=docker 但 docker daemon 不可用 —— 请先启动 Docker");
    process.exit(1);
  }
  if (!check("docker image inspect wt-agent-python:latest")) {
    app.log.warn("缺少镜像 wt-agent-python —— 运行 scripts/build-agent-images.sh 构建");
  }
  if (!check("docker network inspect wt-agent-net")) {
    app.log.warn("缺少网络 wt-agent-net —— 运行 scripts/build-agent-images.sh 创建");
  }
}

await gameService.loadSettings();
registerRest(app, gameService, { agentsRoot, sandbox });
registerUploadRoute(app, { uploadsRoot: path.join(agentsRoot, "uploads") });
registerWs(app, bus, {
  adminToken: process.env.WT_ADMIN_TOKEN,
  getGodView: () => null,
});

app.listen({ port, host }).then(() => {
  app.log.info(`server listening on ${host}:${port} (sandbox=${sandbox}, agents=${agentsRoot}, llmProxy=${!!proxy})`);
});
