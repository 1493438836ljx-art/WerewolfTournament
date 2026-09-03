// 进程内事件总线：编排器 -> WS 订阅者 / 看板实时推送。
export interface BusEvent {
  topic: string;
  kind: string;
  seq?: number;
  payload: unknown;
  ts: string;
}

type Handler = (ev: BusEvent) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  subscribe(topic: string, fn: Handler): () => void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(fn);
    return () => this.handlers.get(topic)?.delete(fn);
  }

  publish(ev: BusEvent): void {
    this.handlers.get(ev.topic)?.forEach((fn) => {
      try {
        fn(ev);
      } catch {
        // 单个订阅者故障不影响其他
      }
    });
  }
}
