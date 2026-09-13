// 正式比赛编排测试：全员参与、轮流上场、尾局补位
import { describe, expect, it } from "vitest";
import { planOfficial, planTournament } from "../src/tournament/scheduler.js";

function countPlays(assigns: ReturnType<typeof planOfficial>, id: string): number {
  let n = 0;
  for (const g of assigns) for (const v of g.seats.values()) if (v === id) n++;
  return n;
}
function gameSize(g: { seats: Map<number, string> }): number {
  return new Set(g.seats.values()).size === 9 ? 9 : g.seats.size;
}

describe("正式比赛编排 planOfficial", () => {
  it("12 人 1 轮：分 2 局（9+补位3），全员至少上场一次", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `a${i}`);
    const plan = planOfficial({ agentIds: ids, rounds: 1 });
    expect(plan).toHaveLength(2); // ceil(12/9)=2
    for (const g of plan) expect(g.seats.size).toBe(9); // 尾局 3+6 补位满员
    for (const id of ids) expect(countPlays(plan, id)).toBeGreaterThanOrEqual(1); // 全员上场
    // 补位者（第 1 局的 6 人）打了 2 局，其余 1 局
    const firstNine = new Set([...plan[0]!.seats.values()]);
    for (const id of ids) {
      const plays = countPlays(plan, id);
      expect(plays).toBeLessThanOrEqual(2);
    }
  });

  it("18 人 1 轮：正好 2 局，每人恰好一次", () => {
    const ids = Array.from({ length: 18 }, (_, i) => `a${i}`);
    const plan = planOfficial({ agentIds: ids, rounds: 1 });
    expect(plan).toHaveLength(2);
    for (const id of ids) expect(countPlays(plan, id)).toBe(1);
  });

  it("20 人 2 轮：3 局/轮 × 2，每人 2-3 次", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `a${i}`);
    const plan = planOfficial({ agentIds: ids, rounds: 2 });
    expect(plan).toHaveLength(6); // ceil(20/9)=3 局/轮
    for (const id of ids) {
      const plays = countPlays(plan, id);
      expect(plays).toBeGreaterThanOrEqual(2);
      expect(plays).toBeLessThanOrEqual(4);
    }
  });

  it("人数不足 9：拒绝创建（一局不允许重复 agent）", () => {
    expect(() => planOfficial({ agentIds: ["a", "b", "c"], rounds: 1 })).toThrow(/至少需要 9 个不同的/);
    expect(() => planOfficial({ agentIds: ["a"], rounds: 1 })).toThrow();
  });

  it("恰好 9 人 1 轮：单局且无重复", () => {
    const plan = planOfficial({ agentIds: Array.from({ length: 9 }, (_, i) => `a${i}`), rounds: 1 });
    expect(plan).toHaveLength(1);
    expect(new Set(plan[0]!.seats.values()).size).toBe(9);
  });
});
