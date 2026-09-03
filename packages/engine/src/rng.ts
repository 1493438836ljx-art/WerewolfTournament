// 种子 RNG（mulberry32）—— 引擎全部随机性的唯一来源。
// RNG 状态存在 GameState 内，保证 (seed, 动作序列) 唯一决定对局（可重放）。
export type RngState = number;

export function seedFromString(s: string): RngState {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  constructor(private state: RngState) {}

  /** [0,1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)] as T;
  }

  /** Fisher-Yates 原地洗牌 */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }

  snapshot(): RngState {
    return this.state;
  }
}
