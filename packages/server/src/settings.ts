// 平台运行配置：settings kv 表 + 全局并发信号量。
// 全局最大并发对局数限制所有比赛共享的对局执行总数（超限的局排队等待）。
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { settings } from "./db/schema.js";

export const KEY_MAX_CONCURRENT_GAMES = "maxConcurrentGames";
export const DEFAULT_MAX_CONCURRENT_GAMES = 3;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return (row?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value: value as object, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as object, updatedAt: new Date() } });
}

/** 全局对局信号量：acquire 排队等待；上限可在运行时调整并即时放行等待者 */
export class GameSlots {
  private limit: number;
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.limit = Math.max(1, limit);
  }

  get current() {
    return { active: this.active, limit: this.limit, waiting: this.waiters.length };
  }

  setLimit(n: number) {
    this.limit = Math.max(1, Math.min(50, Math.round(n)));
    this.drain();
  }

  private drain() {
    while (this.active < this.limit && this.waiters.length > 0) {
      const wake = this.waiters.shift()!;
      wake();
      this.active++;
    }
  }

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }
}
