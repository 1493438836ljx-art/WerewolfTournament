import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { EventBus } from "./game/bus.js";
import { GameService } from "./game/service.js";
import { registerRest } from "./api/rest.js";
import { registerWs } from "./api/ws.js";
import { initReferee } from "./llmreferee.js";
import { llmConfigFromEnv } from "@wt/llm";
import { createLlmProxy, proxyForAgent } from "./llmproxy.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true, bodyLimit: 4 * 1024 * 1024 });
await app.register(websocket);

const bus = new EventBus();
const agentsRoot = process.env.WT_AGENTS_ROOT ?? path.resolve(__dirname, "../../../agents");
const sandbox = (process.env.WT_SANDBOX === "docker" ? "docker" : "none") as "none" | "docker";

initReferee();
// 平台 LLM 代理（配置了裁判 LLM 即启用；agent 沙箱内唯一 LLM 出口）
const proxy = createLlmProxy(app, llmConfigFromEnv());
const gameService = new GameService(bus, {
  agentsRoot,
  sandbox,
  llmProxyFor: proxy
    ? (agentId) => proxyForAgent(proxy, `127.0.0.1:${port}`, agentId)
    : undefined,
});

registerRest(app, gameService, { agentsRoot, sandbox });
registerWs(app, bus, {
  adminToken: process.env.WT_ADMIN_TOKEN,
  getGodView: () => null,
});

app.listen({ port, host }).then(() => {
  app.log.info(`server listening on ${host}:${port} (sandbox=${sandbox}, agents=${agentsRoot}, llmProxy=${!!proxy})`);
});
