// 模板公告文案 —— LLM 不可用时的保底主持（永远可用，比赛不中断）。
import type { Seat } from "@wt/protocol";

interface AnnounceInput {
  kind: string;
  payload: Record<string, unknown>;
}

export function templateAnnounce(ev: AnnounceInput): string | null {
  const p = ev.payload;
  switch (ev.kind) {
    case "game_started":
      return `⚖️ 对局开始，天黑请闭眼。`;
    case "night_begun":
      return `🌙 第 ${p.night} 夜，全体闭眼。`;
    case "dawn_deaths": {
      const deaths = (p.deaths as Seat[]) ?? [];
      if (deaths.length === 0) return `☀️ 第 ${(p.night as number) + 1 > 0 ? p.night : ""} 天天亮，昨夜是平安夜。`;
      return `☀️ 天亮了，昨夜倒下的是 ${deaths.map((d) => `${d} 号`).join("、")}。`;
    }
    case "speech_order":
      return `🗣️ 从 ${((p.order as Seat[]) ?? [])[0]} 号开始依次发言。`;
    case "vote_result": {
      if ((p.pk_candidates as Seat[] | undefined)?.length) {
        return `🗳️ 平票！${(p.pk_candidates as Seat[]).map((c) => `${c} 号`).join(" 与 ")}进入 PK 辩词。`;
      }
      if (p.eliminated === null || p.eliminated === undefined) return `🗳️ 本轮平安日，无人出局。`;
      return `🗳️ 投票结束，${p.eliminated} 号被放逐。`;
    }
    case "hunter_shot": {
      if (p.target === null || p.target === undefined) return `🔫 ${p.by} 号翻牌猎人，选择不开枪。`;
      return `🔫 ${p.by} 号翻牌猎人，带走 ${p.target} 号！`;
    }
    case "player_disqualified":
      return `⚠️ ${p.seat} 号因违规被取消资格。`;
    case "win":
      return `🏆 对局结束，${p.faction === "werewolf" ? "狼人阵营" : "好人阵营"}获胜（${p.reason}）。全员亮牌。`;
    default:
      return null;
  }
}
