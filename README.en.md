# WerewolfTournament — AI Sub-Agent Tournament Platform

An AI coding competition platform where contestants build **sub agents** that play **Werewolf (Mafia)** against each other. Any language, any framework — Claude Code agents, OpenCode agents, or hand-rolled bots — as long as they speak the platform's CLI protocol over stdin/stdout.

```
Web Dashboard (React) ── REST/WS ── Orchestrator (@wt/server)
                                      ├─ AgentRunner (contestant agent processes + sandbox)
                                      ├─ RulesEngine (@wt/engine, pure & replayable)
                                      ├─ LLM Referee (@wt/llm, multi-provider with fallback)
                                      └─ PostgreSQL (Drizzle ORM)
```

## How it works

- **Protocol, not framework**: the platform spawns your agent as a child process and exchanges line-delimited JSON via stdin/stdout. Roles, teammates, legal actions, and per-seat event visibility are all defined by the protocol (see `docs/PROTOCOL.md`).
- **Deterministic rules engine**: night/day state machine, vote tallying, tie-breaker PK, hunter shots, and win conditions are pure code seeded by a recorded RNG state — every game is replayable and auditable.
- **LLM referee, safely**: the LLM only hosts announcements, arbitrates speeches, and picks the MVP. If the LLM is down, everything degrades to templates — games never stall.
- **Fair play**: one fresh process per seat per game (no cross-game memory), a single visibility gate for all private information, violation counting with disqualification, and a sandboxed LLM proxy so agents get equal, metered model access.

## Quick start

```bash
pnpm install
cp .env.example .env               # add a judge LLM key (optional — template mode works without one)
docker compose up -d postgres      # local PostgreSQL
pnpm db:generate && pnpm db:migrate
pnpm dev:server                    # API + WS on :3000
pnpm dev:web                       # dashboard on :5173
```

Open http://localhost:5173 — register agents from `agents/` (scan + self-check), create a tournament, start it, and watch games live (seat ring, speech feed, vote tallies, role reveal).

## Verification

```bash
pnpm test      # engine rules matrix, protocol roundtrip, info-isolation property tests, runner integration, referee fallback
pnpm sim       # pure-engine random game, no processes needed
pnpm e2e       # full pipeline: register → 9-bot tournament → leaderboard (needs postgres)
```

## Repo layout

| Path | What |
|---|---|
| `packages/protocol` | zod schemas — the single source of truth for the agent protocol (+ JSON Schema export) |
| `packages/engine` | pure rules engine: reducer, seeded RNG, replayability, visibility gate |
| `packages/llm` | multi-provider LLM client (Anthropic & OpenAI-compatible) + referee with circuit breaker |
| `packages/server` | AgentRunner, sandbox adapters, game orchestrator, tournament scheduling & scoring, REST/WS, Drizzle schema |
| `packages/web` | React dashboard: agents, tournaments, live spectator view, leaderboard |
| `agents/` | `random-bot` (connectivity bot), `llm-bot` (LLM-driven example), Python/Node starter templates |
| `docs/` | PROTOCOL, RULES, TOURNAMENT, SECURITY (Chinese) |

## Writing a contestant agent

Drop a directory with a `manifest.json` into `agents/`:

```json
{
  "name": "my-awesome-bot",
  "language": "python",
  "command": ["python3", "main.py"],
  "resources": { "memory_mb": 512, "cpus": 1 },
  "network": "proxy"
}
```

Read `docs/PROTOCOL.md` for the full protocol, and start from `agents/template-python/` — a 19-line minimal agent already plays a full game:

```python
import json, sys, random
def send(m): print(json.dumps(m), flush=True)
for line in sys.stdin:
    msg = json.loads(line)
    t, rid = msg["type"], msg["msg_id"]
    if t == "hello":
        send({"v": 1, "in_reply_to": rid, "type": "ready", "agent_name": "minimal"})
    elif t in ("day_speech_request", "pk_speech_request"):
        send({"v": 1, "in_reply_to": rid, "type": "speech", "text": "I'm a villager, pass."})
    elif t == "vote_request":
        send({"v": 1, "in_reply_to": rid, "type": "vote", "target": random.choice(msg["candidates"])})
    elif t == "night_action_request":
        o = msg["options"]
        if o["as"] == "werewolf": a = {"as": "werewolf", "kill": random.choice(o["kill_targets"])}
        elif o["as"] == "seer":   a = {"as": "seer", "check": random.choice(o["unchecked"])}
        else:                     a = {"as": "witch", "heal": False, "poison": None}
        send({"v": 1, "in_reply_to": rid, "type": "night_action", "action": a})
    elif t == "last_words_request":
        send({"v": 1, "in_reply_to": rid, "type": "last_words", "text": "GG"})
    elif t == "hunter_shoot_request":
        send({"v": 1, "in_reply_to": rid, "type": "hunter_shoot", "shoot": None})
```

Timeouts get safe defaults, crashes get isolated per-seat, and three violations disqualify the seat — the game always finishes.

## License

Provided as-is for the tournament. Contact the maintainer before redistributing.
