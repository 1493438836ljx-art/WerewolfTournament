// WebSocket /ws：订阅式事件流。
// client -> {op:"subscribe"|"unsubscribe", topic}；server -> {topic, kind, payload, ts}
// 观战视图在编排器侧已按 public 裁剪；god 全知视图需要管理员 token（?god=<token>），
// 且只对 game/* topic 附加 refereeView 快照。
import type { FastifyInstance } from "fastify";
import type { EventBus } from "../game/bus.js";

interface WsSession {
  sockets: Set<WebSocket>;
}

export function registerWs(app: FastifyInstance, bus: EventBus, opts: { adminToken?: string; getGodView?: (gameId: string) => unknown }) {
  const topics = new Map<string, WsSession>();

  app.get("/ws", { websocket: true }, (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const isGod = !!opts.adminToken && url.searchParams.get("god") === opts.adminToken;
    const unsubs = new Set<() => void>();

    socket.on("message", (raw: Buffer) => {
      let msg: { op?: string; topic?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg.topic) return;
      if (msg.op === "subscribe") {
        const topic = msg.topic;
        const handler = (ev: Parameters<Parameters<typeof bus.subscribe>[1]>[0]) => {
          socket.send(JSON.stringify(ev));
        };
        unsubs.add(bus.subscribe(topic, handler));
        socket.send(JSON.stringify({ topic, kind: "subscribed", payload: { topic }, ts: new Date().toISOString() }));
        // god 视图：订阅 game 时补发当前全知快照
        if (isGod && topic.startsWith("game/") && opts.getGodView) {
          const view = opts.getGodView(topic.slice("game/".length));
          if (view) socket.send(JSON.stringify({ topic, kind: "god_snapshot", payload: view, ts: new Date().toISOString() }));
        }
      } else if (msg.op === "unsubscribe") {
        for (const u of unsubs) u();
        unsubs.clear();
      }
    });

    socket.on("close", () => {
      for (const u of unsubs) u();
    });
  });
}
