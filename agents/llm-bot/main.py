#!/usr/bin/env python3
"""llm-bot —— 平台自带的 LLM 驱动示例选手。

每个决策（发言/投票/狼刀/查验/用药/猎人枪）都把对局记忆拼成 prompt，
通过平台 LLM 代理（WT_LLM_PROXY_URL）请求推理；LLM 不可用时逐级降级：
  LLM 推理 -> 角色启发式 -> 随机。永不崩溃、永不超时。

这就是"sub agent 开发能力"考察的缩影：状态维护、信息整合、语言博弈。
"""
import json
import os
import random
import re
import sys
import urllib.request

M = {
    "me": None,            # {seat, role, faction, wolf_teammates?}
    "players": {},         # seat -> name
    "alive": [],
    "speeches": [],        # (day, seat, kind, text)
    "votes": [],           # 票型轮次
    "deaths": [],          # (night, [seats])
    "checks": [],          # 我的查验记录（预言家）
    "day": 0, "night": 0,
    "llm_calls": 0,
}

FALLBACK = [
    "我是好人，昨晚的死讯大家怎么解读？",
    "听发言，我先保留。",
    "票给我怀疑的对象，别浪费今天。",
]


def send(msg):
    print(json.dumps(msg, ensure_ascii=False), flush=True)


def dbg(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------- LLM ----------------
def llm(system: str, user: str, max_tokens=600):
    """走平台 LLM 代理；失败返回 None（触发降级）。"""
    if M["llm_calls"] >= 60:  # 局内调用上限，防预算耗尽
        return None
    url = os.environ.get("WT_LLM_PROXY_URL")
    if not url:
        return None
    M["llm_calls"] += 1
    try:
        req = urllib.request.Request(
            url.rstrip("/") + "/chat/completions",
            data=json.dumps({
                "model": os.environ.get("WT_AGENT_LLM_MODEL", "default"),
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "max_tokens": max_tokens,
            }).encode(),
            headers={
                "Authorization": "Bearer " + os.environ.get("WT_LLM_PROXY_TOKEN", ""),
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.load(r)["choices"][0]["message"]["content"].strip()
    except Exception as e:
        dbg(f"[llm] {e}")
        return None


# ---------------- 记忆维护 ----------------
def note(ev):
    k = ev.get("kind")
    if k == "speech_heard":
        M["speeches"].append((ev.get("day"), ev.get("seat"), ev.get("speech_kind"), ev.get("text")))
    elif k == "vote_result":
        M["votes"].append(ev)
    elif k == "dawn_deaths":
        M["deaths"].append((ev.get("night"), ev.get("deaths")))
    elif k == "seer_result":
        M["checks"].append(ev)


def role_cn(r):
    return {"werewolf": "狼人", "seer": "预言家", "witch": "女巫", "hunter": "猎人", "villager": "村民"}[r]


# ---------------- 局面摘要（prompt 材料） ----------------
def context():
    if M["me"] is None:
        return "（对局信息尚未就绪）"
    recent = M["speeches"][-8:]
    lines = [
        f"你是 {M['me']['seat']} 号，角色：{role_cn(M['me']['role'])}（{M['me']['faction']} 阵营）。",
    ]
    if M["me"].get("wolf_teammates"):
        lines.append(f"你的狼队友：{M['me']['wolf_teammates']} 号。")
    lines.append(f"存活：{M['alive']}。")
    if M["checks"]:
        ck = "；".join(f"{c['target']} 号={'狼' if c['result']=='wolf' else '好人'}" for c in M["checks"])
        lines.append(f"你的查验记录：{ck}。")
    if M["deaths"]:
        lines.append("死讯：" + "；".join(f"第{n}夜{d}" for n, d in M["deaths"][-3:]))
    if recent:
        lines.append("最近发言：")
        for day, seat, kind, text in recent:
            tag = {"speech": "", "pk": "[PK]", "last_words": "[遗言]"}.get(kind, "")
            lines.append(f"  {seat} 号（第{day}天）{tag}：{text[:80]}")
    if M["votes"]:
        last = M["votes"][-1]
        lines.append("上轮票型：" + "，".join(f"{b['voter']}→{b['target']}" for b in last.get("tally", [])))
    return "\n".join(lines)


def my_faction_goal():
    if M["me"] and M["me"].get("faction") == "werewolf":
        return "你是狼人：白天伪装好人、带偏投票，夜晚刀掉神职。绝不能暴露狼身份。"
    return "你是好人：分析发言找狼，神职择机带队。狼人会说谎，注意甄别。"


def ask_json(prompt, valid):
    """LLM -> JSON 决策（valid 为合法值列表）；失败 None"""
    out = llm(
        my_faction_goal() + "\n只输出一个 JSON 对象，不要输出其他内容。",
        context() + "\n\n" + prompt + "\n合法值：" + json.dumps(valid, ensure_ascii=False)
        + '。输出格式：{"target": <值>}',
        max_tokens=200,
    )
    if not out:
        return None
    m = re.search(r"\{[^}]*\}", out, re.S)
    if not m:
        return None
    try:
        v = json.loads(m.group(0)).get("target")
    except Exception:
        return None
    return v if v in valid else None


def ask_speech(char_limit, speech_round=1, campaign=False):
    """发言生成：竞选发言 / 第一轮陈述 / 第二轮针对性反驳。"""
    if campaign:
        guide = ("这是警长竞选发言。用第一人称直接输出正文，200 字以内：说明你为什么适合当警长、"
                 "你的阵营立场和带队思路。狼人要伪装好人视角。")
    elif speech_round == 2:
        guide = ("这是第二轮发言（反驳轮）。用第一人称直接输出正文，300 字以内：针对第一轮发言中"
                 "与你观点冲突或最可疑的人进行反驳与追问，可以修正自己的判断，给出更明确的票向。")
    else:
        guide = ("这是第一轮发言（陈述轮）。用第一人称直接输出正文，400 字以内：梳理已知信息"
                 "（死讯/发言/票型），给出你的怀疑链与理由，明确表态。")
        if M["me"] and M["me"].get("role") == "seer":
            guide += "你是预言家：局势需要时果断报查验。"
    out = llm(
        my_faction_goal() + "\n" + guide + "不要引号、不要解释。",
        context() + "\n\n现在轮到你发言。",
        max_tokens=1200,
    )
    if out:
        out = re.sub(r"\s+", " ", out).strip().strip('"')[:char_limit]
        if out:
            return out
    return random.choice(FALLBACK)


# ---------------- 各决策 ----------------
def decide_wolf_kill(options):
    targets = [t for t in options.get("kill_targets", []) if t is not None]
    if not targets:
        return None
    v = ask_json("夜晚行动：作为狼人，分析谁最像神职（发言带队的、报查验的），选择今晚的刀口。", targets)
    return v if v is not None else random.choice(targets)


def decide_seer_check(options):
    pool = options.get("unchecked") or M["alive"]
    me = M["me"]["seat"] if M["me"] else None
    pool = [x for x in pool if x != me] or pool
    v = ask_json("夜晚行动：作为预言家，选择今晚要查验的人（优先验发言最可疑的）。", pool)
    return v if v is not None else random.choice(pool)


def decide_witch(options):
    killed = options.get("killed_tonight")
    heal = bool(killed) and options.get("heal_available", False)
    if heal and killed:
        v = ask_json("女巫决策：今晚被刀的是这个座位，要用解药救吗？（true/false）", [True, False])
        heal = v if v is not None else (killed != M["me"]["seat"] or random.random() < 0.5)
    return {"as": "witch", "heal": bool(heal), "poison": None}


def decide_vote(candidates):
    me = M["me"]["seat"] if M["me"] else None
    cands = [c for c in candidates if c != me] or candidates
    v = ask_json("投票：综合全场发言与票型，选出最像狼的人放逐。", cands)
    return v if v is not None else random.choice(cands)


def decide_hunter(targets):
    if not targets:
        return None
    v = ask_json("你是猎人，翻牌开枪：带走最像狼的人。", targets)
    return v if v is not None else random.choice(targets)


# ---------------- 消息循环 ----------------
def handle(msg):
    t, rid = msg.get("type"), msg.get("msg_id")

    if t == "hello":
        send({"v": 1, "in_reply_to": rid, "type": "ready", "agent_name": "llm-bot"})

    elif t == "game_start":
        M["me"] = msg["you"]
        M["players"] = {p["seat"]: p["name"] for p in msg["players"]}

    elif t == "notify":
        note(msg["event"])

    elif t == "day_speech_request" or t == "pk_speech_request":
        M["alive"] = msg.get("alive", M["alive"])
        M["day"] = msg.get("day", M["day"])
        send({"v": 1, "in_reply_to": rid, "type": "speech",
              "text": ask_speech(msg.get("char_limit", 2000), speech_round=msg.get("round", 1))})

    elif t == "sheriff_campaign_request":
        M["alive"] = msg.get("alive", M["alive"])
        run = ask_json("警长竞选开始：是否上警竞选警长？（上警要发言并接受检视，神职带队收益大，"
                       "狼人可伪装上警抢警徽）", [True, False])
        send({"v": 1, "in_reply_to": rid, "type": "sheriff_campaign", "run": bool(run) if run is not None else (M["me"] or {}).get("role") in ("seer", "villager")})

    elif t == "sheriff_speech_request":
        send({"v": 1, "in_reply_to": rid, "type": "sheriff_speech",
              "text": ask_speech(msg.get("char_limit", 2000), campaign=True)})

    elif t == "sheriff_vote_request":
        cands = msg.get("candidates") or []
        v = ask_json("警长投票：综合竞选发言，选出最有带队能力的警长（可以投自己）。弃票 null。", cands + [None])
        send({"v": 1, "in_reply_to": rid, "type": "sheriff_vote",
              "target": v if v in cands else (random.choice(cands) if cands else None)})

    elif t == "sheriff_transfer_request":
        targets = msg.get("transfer_targets") or []
        v = ask_json("你是警长，即将出局。把警徽移交给最像好人的存活者（null=撕掉警徽）。", targets + [None])
        send({"v": 1, "in_reply_to": rid, "type": "sheriff_transfer",
              "to": v if v in targets else (random.choice(targets) if targets else None)})

    elif t == "night_action_request":
        M["alive"] = msg.get("alive", M["alive"])
        o = msg.get("options", {})
        if o.get("as") == "werewolf":
            action = {"as": "werewolf", "kill": decide_wolf_kill(o)}
        elif o.get("as") == "seer":
            action = {"as": "seer", "check": decide_seer_check(o)}
        else:
            action = decide_witch(o)
        send({"v": 1, "in_reply_to": rid, "type": "night_action", "action": action})

    elif t == "vote_request":
        send({"v": 1, "in_reply_to": rid, "type": "vote", "target": decide_vote(msg.get("candidates") or [])})

    elif t == "last_words_request":
        out = llm(my_faction_goal(), context() + "\n你已出局，用一句话交代遗言（可以报身份或指认）。", max_tokens=150)
        send({"v": 1, "in_reply_to": rid, "type": "last_words",
              "text": (re.sub(r"\s+", " ", out or "我是好人，别松懈。").strip())[:4000]})

    elif t == "hunter_shoot_request":
        send({"v": 1, "in_reply_to": rid, "type": "hunter_shoot", "shoot": decide_hunter(msg.get("shoot_targets") or [])})

    # game_end / 未知消息：忽略


def main():
    for line in sys.stdin:
        if not line:
            break
        try:
            handle(json.loads(line))
        except Exception as e:
            dbg(f"[main] {e}")


if __name__ == "__main__":
    main()
