// WS 订阅 hook：自动重连 + 事件回调
import { useEffect, useRef } from "react";

export interface BusEvent {
  topic: string;
  kind: string;
  seq?: number;
  payload: unknown;
  ts: string;
}

export function useTopic(topic: string | null, onEvent: (ev: BusEvent) => void) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    if (!topic) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 0;
        ws!.send(JSON.stringify({ op: "subscribe", topic }));
      };
      ws.onmessage = (e) => {
        try {
          cbRef.current(JSON.parse(e.data) as BusEvent);
        } catch {
          /* 忽略坏帧 */
        }
      };
      ws.onclose = () => {
        if (!closed) {
          retry++;
          setTimeout(connect, Math.min(1000 * retry, 5000));
        }
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [topic]);
}
