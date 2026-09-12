#!/usr/bin/env python3
"""random-bot —— 平台自带示例选手（纯随机策略，零依赖）。

设计目标：永不崩溃。
- 未知消息一律忽略
- 任何异常兜底回复一个合法默认动作
- 只依赖请求里显式给出的合法选项（kill_targets/unchecked/candidates/...）
"""
import json
import random
import sys

random.seed()  # 每局进程全新，熵来自 OS

SPEECHES = [
    "我是好人，昨晚信息不多，先听大家的。",
    "我视角里发言最冲的那个有问题，先挂个怀疑。",
    "同意上位的分析，这轮跟票走。",
    "我是平民，神职请站出来带节奏。",
    "票型很清楚了，别浪，稳住。",
    "我保留意见，先过。",
]
LAST_WORDS = [
    "我是好人，别浪费票在我身上。",
    "记住我的发言，帮你们排狼坑。",
    "我是神职，位置你们自己悟。",
]


def send(msg):
    print(json.dumps(msg, ensure_ascii=False), flush=True)


def main():
    me = {"seat": None, "role": None}
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        try:
            handle(json.loads(line), me)
        except Exception as e:  # 兜底：绝不让进程死掉
            print(f"[random-bot] error: {e}", file=sys.stderr, flush=True)


def handle(msg, me):
    t = msg.get("type")
    rid = msg.get("msg_id")

    if t == "hello":
        send({"v": 1, "in_reply_to": rid, "type": "ready", "agent_name": "random-bot"})

    elif t == "game_start":
        you = msg.get("you", {})
        me["seat"] = you.get("seat")
        me["role"] = you.get("role")

    elif t == "night_action_request":
        o = msg.get("options", {})
        as_role = o.get("as")
        if as_role == "werewolf":
            targets = [x for x in o.get("kill_targets", []) if x is not None]
            action = {"as": "werewolf", "kill": random.choice(targets) if targets and random.random() > 0.05 else None}
        elif as_role == "seer":
            pool = o.get("unchecked") or msg.get("alive", [])
            action = {"as": "seer", "check": random.choice(pool)}
        elif as_role == "witch":
            heal = o.get("killed_tonight") is not None and o.get("heal_available") and random.random() < 0.5
            action = {"as": "witch", "heal": heal, "poison": None}
        else:
            action = {"as": "witch", "heal": False, "poison": None}
        send({"v": 1, "in_reply_to": rid, "type": "night_action", "action": action})

    elif t in ("day_speech_request", "pk_speech_request"):
        send({"v": 1, "in_reply_to": rid, "type": "speech", "text": random.choice(SPEECHES)})

    elif t == "vote_request":
        cands = msg.get("candidates") or []
        target = random.choice(cands) if cands else None
        if target is None and not msg.get("abstain_allowed"):
            target = cands[0] if cands else None
        send({"v": 1, "in_reply_to": rid, "type": "vote", "target": target})

    elif t == "last_words_request":
        send({"v": 1, "in_reply_to": rid, "type": "last_words", "text": random.choice(LAST_WORDS)})

    elif t == "hunter_shoot_request":
        targets = msg.get("shoot_targets") or []
        shoot = random.choice(targets) if targets and random.random() < 0.8 else None
        send({"v": 1, "in_reply_to": rid, "type": "hunter_shoot", "shoot": shoot})

    elif t == "sheriff_campaign_request":
        send({"v": 1, "in_reply_to": rid, "type": "sheriff_campaign", "run": random.random() < 0.5})

    elif t == "sheriff_speech_request":
        send({"v": 1, "in_reply_to": rid, "type": "sheriff_speech", "text": random.choice(SPEECHES)})

    elif t == "sheriff_vote_request":
        cands = msg.get("candidates") or []
        send({"v": 1, "in_reply_to": rid, "type": "sheriff_vote",
              "target": random.choice(cands) if cands else None})

    elif t == "sheriff_transfer_request":
        targets = msg.get("transfer_targets") or []
        send({"v": 1, "in_reply_to": rid, "type": "sheriff_transfer",
              "to": random.choice(targets) if targets and random.random() < 0.8 else None})

    elif t in ("notify", "game_end"):
        pass  # 随机策略不消费事件；真实 agent 应维护对局记忆

    # 未知消息：忽略


if __name__ == "__main__":
    main()
