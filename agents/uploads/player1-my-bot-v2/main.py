import json,sys,random
def send(m): print(json.dumps(m), flush=True)
for line in sys.stdin:
    msg=json.loads(line); t=msg["type"]; rid=msg["msg_id"]
    if t=="hello": send({"v":1,"in_reply_to":rid,"type":"ready","agent_name":"my-bot-v2"})
    elif t in ("day_speech_request","pk_speech_request"): send({"v":1,"in_reply_to":rid,"type":"speech","text":"上传的bot，过"})
    elif t=="vote_request": send({"v":1,"in_reply_to":rid,"type":"vote","target":random.choice(msg["candidates"])})
    elif t=="last_words_request": send({"v":1,"in_reply_to":rid,"type":"last_words","text":"GG"})
    elif t=="hunter_shoot_request": send({"v":1,"in_reply_to":rid,"type":"hunter_shoot","shoot":None})
    elif t=="night_action_request":
        o=msg["options"]
        if o["as"]=="werewolf": a={"as":"werewolf","kill":(o["kill_targets"] or [None])[0]}
        elif o["as"]=="seer": a={"as":"seer","check":o["unchecked"][0]}
        else: a={"as":"witch","heal":False,"poison":None}
        send({"v":1,"in_reply_to":rid,"type":"night_action","action":a})
    elif t in("sheriff_campaign_request",): send({"v":1,"in_reply_to":rid,"type":"sheriff_campaign","run":False})
    elif t in("sheriff_speech_request",): send({"v":1,"in_reply_to":rid,"type":"sheriff_speech","text":"竞选"})
    elif t in("sheriff_vote_request",): send({"v":1,"in_reply_to":rid,"type":"sheriff_vote","target":msg["candidates"][0]})
    elif t in("sheriff_transfer_request",): send({"v":1,"in_reply_to":rid,"type":"sheriff_transfer","to":None})
