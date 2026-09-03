#!/usr/bin/env python3
"""选手模板（Python）—— 狼人杀 agent 骨架。

在 random-bot 的基础上补齐了对局记忆（MEMORY）与 LLM 决策调用示例。
协议细节见 docs/PROTOCOL.md。

如何接入 Claude Code / OpenCode 作为大脑：
  这些框架的 headless 模式本质也是「输入 prompt -> 输出文本」。
  在 llm_decide() 里把你的框架 CLI 当子进程调用、或走平台 LLM 代理均可。
  硬规则动作（投票合法性等）建议本地代码兜底，LLM 只生成发言/推理。
"""
import json
import os
import sys
import urllib.request

# ---------------- 对局记忆 ----------------
MEMORY = {
    "me": None,          # {"seat":3,"role":"werewolf",...}
    "players": [],       # 全部座位
    "alive": [],
    "seer_checks": [],   # 我是预言家时的查验记录
    "speeches": [],      # 听到的全部发言 (day, seat, text)
    "votes": [],         # 票型历史
    "deaths": [],        # 死讯
}


def send(msg):
    print(json.dumps(msg, ensure_ascii=False), flush=True)


def note(ev):
    """维护对局记忆 —— 换成你自己的状态更新逻辑"""
    k = ev.get("kind")
    if k == "speech_heard":
        MEMORY["speeches"].append(ev)
    elif k == "vote_result":
        MEMORY["votes"].append(ev)
    elif k == "dawn_deaths":
        MEMORY["deaths"].extend(ev.get("deaths", []))
    elif k == "seer_result":
        MEMORY["seer_checks"].append(ev)


# ---------------- LLM 决策（可选）----------------
def llm(prompt: str) -> str | None:
    """走平台 LLM 代理（manifest.network=proxy）。也可替换为任意本地推理。"""
    url = os.environ.get("WT_LLM_PROXY_URL")
    if not url:
        return None
    try:
        req = urllib.request.Request(
            url.rstrip("/") + "/chat/completions",
            data=json.dumps({
                "model": os.environ.get("WT_AGENT_LLM_MODEL", "default"),
                "messages": [{"role": "user", "content": prompt}],
            }).encode(),
            headers={
                "Authorization": "Bearer " + os.environ.get("WT_LLM_PROXY_TOKEN", ""),
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"[llm] {e}", file=sys.stderr, flush=True)
        return None


def make_speech(msg) -> str:
    """发言生成：优先 LLM，失败回退简单策略。"""
    summary = json.dumps({
        "我": MEMORY["me"],
        "存活": MEMORY["alive"],
        "我的查验": MEMORY["seer_checks"],
        "最近发言": MEMORY["speeches"][-6:],
        "死讯": MEMORY["deaths"],
    }, ensure_ascii=False)
    text = llm(
        f"你在打一局狼人杀（9人局）。当前局面：{summary}\n"
        f"用第一人称写一段 80 字以内的发言：表态、给怀疑、或报信息。只输出发言内容。"
    )
    if text:
        text = text.strip().replace("\n", " ")[: msg.get("char_limit", 2000)]
        if text:
            return text
    role = (MEMORY["me"] or {}).get("role")
    if role == "seer" and MEMORY["seer_checks"]:
        last = MEMORY["seer_checks"][-1]
        return f"我是预言家，昨晚查验 {last['target']} 号：{'狼人' if last['result'] == 'wolf' else '好人'}。"
    return "我是好人，先听大家的发言。"


def vote_target(msg) -> int:
    """投票决策：换成你的推理。这里示范：最怀疑最近被指出的人，否则随机。"""
    import random
    cands = [c for c in msg.get("candidates", []) if c != (MEMORY["me"] or {}).get("seat")]
    if MEMORY["seer_checks"]:
        for chk in MEMORY["seer_checks"]:
            if chk["result"] == "wolf" and chk["target"] in cands:
                return chk["target"]
    return random.choice(cands) if cands else None


def handle(msg):
    t, rid = msg.get("type"), msg.get("msg_id")

    if t == "hello":
        send({"v": 1, "in_reply_to": rid, "type": "ready", "agent_name": "my-agent"})

    elif t == "game_start":
        MEMORY["me"] = msg["you"]
        MEMORY["players"] = msg["players"]

    elif t == "notify":
        note(msg["event"])

    elif t in ("day_speech_request", "pk_speech_request"):
        MEMORY["alive"] = msg.get("alive", [])
        send({"v": 1, "in_reply_to": rid, "type": "speech", "text": make_speech(msg)})

    elif t == "night_action_request":
        o = msg.get("options", {})
        MEMORY["alive"] = msg.get("alive", [])
        if o.get("as") == "werewolf":
            # TODO: 基于白天发言推理刀口
            targets = [x for x in o.get("kill_targets", []) if x is not None]
            action = {"as": "werewolf", "kill": targets[0] if targets else None}
        elif o.get("as") == "seer":
            # TODO: 优先验发言最可疑且未验的
            pool = o.get("unchecked") or msg.get("alive", [])
            action = {"as": "seer", "check": pool[0]}
        else:  # witch
            # TODO: 首夜自救/毒人决策
            action = {"as": "witch", "heal": bool(o.get("killed_tonight")), "poison": None}
        send({"v": 1, "in_reply_to": rid, "type": "night_action", "action": action})

    elif t == "vote_request":
        send({"v": 1, "in_reply_to": rid, "type": "vote", "target": vote_target(msg)})

    elif t == "last_words_request":
        send({"v": 1, "in_reply_to": rid, "type": "last_words", "text": "祝好人好运，记住我的发言。"})

    elif t == "hunter_shoot_request":
        # TODO: 带走最像狼的人
        targets = msg.get("shoot_targets") or []
        send({"v": 1, "in_reply_to": rid, "type": "hunter_shoot", "shoot": targets[0] if targets else None})

    # game_end / 未知消息：忽略


def main():
    for line in sys.stdin:
        if not line:
            break
        try:
            handle(json.loads(line))
        except Exception as e:
            print(f"[main] {e}", file=sys.stderr, flush=True)  # 永不崩溃


if __name__ == "__main__":
    main()
