// 胜负判定（屠边默认 / 屠城可选）。
import type { Faction } from "@wt/protocol";
import type { GameState } from "./types.js";
import type { GameConfig } from "./config.js";

export interface WinResult {
  faction: Faction;
  reason: string;
}

const GOD_ROLES = new Set(["seer", "witch", "hunter"]);

export function checkWin(s: GameState): WinResult | null {
  const alive = s.seats.filter((x) => x.alive);
  const wolves = alive.filter((x) => x.role === "werewolf");
  const gods = alive.filter((x) => GOD_ROLES.has(x.role));
  const villagers = alive.filter((x) => x.role === "villager");
  const others = alive.length - wolves.length;

  if (wolves.length === 0) return { faction: "village", reason: "狼人全部出局" };
  if (wolves.length >= others) return { faction: "werewolf", reason: "存活狼人数不少于好人数" };
  if (s.config.winCondition === "kill_side") {
    if (gods.length === 0) return { faction: "werewolf", reason: "神职全部出局（屠边）" };
    if (villagers.length === 0) return { faction: "werewolf", reason: "平民全部出局（屠边）" };
  }
  return null;
}

/** 供编排器/文档使用的胜负条件摘要 */
export function winConditionText(c: GameConfig): string {
  return c.winCondition === "kill_side"
    ? "好人胜=狼人全部出局；狼人胜=神职全灭 或 平民全灭 或 狼数≥好人数"
    : "好人胜=狼人全部出局；狼人胜=狼数≥好人数";
}
