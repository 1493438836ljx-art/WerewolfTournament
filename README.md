# 狼人杀 Sub Agent 锦标赛平台

AI Coding 比赛平台：检验选手的 sub agent 开发能力。选手用任意语言/框架（Claude Code、OpenCode、自研）开发狼人杀玩家 agent，通过 CLI 进程协议（stdin/stdout JSONL）接入平台对局；LLM 裁判主持，规则引擎保证公平可重放。

## 架构

```
Web 看板(React) ── REST/WS ── 编排器(@wt/server)
                                  ├─ AgentRunner（选手 agent 子进程 + 沙箱）
                                  ├─ RulesEngine(@wt/engine 纯函数可重放)
                                  ├─ LLM 裁判(@wt/llm 多供应商+降级)
                                  └─ PostgreSQL(Drizzle ORM)
```

## 快速开始

```bash
pnpm install
cp .env.example .env                 # 填入裁判 LLM key（没有也能跑，裁判降级模板）
docker compose up -d postgres        # 本地起 PostgreSQL
pnpm db:generate && pnpm db:migrate  # 生成并执行迁移
pnpm dev:server                      # 后端 :3000
pnpm dev:web                         # 看板 :5173
```

## 验证

```bash
pnpm test          # 44 个测试：引擎规则矩阵 / 协议 roundtrip / 信息隔离属性 / runner 集成 / 裁判降级
pnpm sim           # 纯引擎随机跑一局完整狼人杀（无进程、无 DB）
pnpm e2e           # 全链路：注册 agent -> 9 副本锦标赛 -> 积分榜（需 postgres）
```

看板：浏览器打开 http://localhost:5173 —— 「选手 Agent」扫描注册并自检 →「锦标赛」创建并开始 → 点开对局实时观战（座位环/发言流/票型/翻牌）。

## 文档

- `docs/PROTOCOL.md` —— 选手 agent 接入协议（必读）
- `docs/RULES.md` —— 狼人杀规则细节
- `docs/TOURNAMENT.md` —— 赛制与积分

## 选手 agent

见 `agents/template-python/`、`agents/template-node/`；示例 bot 见 `agents/random-bot/`。
