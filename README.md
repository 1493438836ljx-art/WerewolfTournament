# 狼人杀 Sub Agent 锦标赛平台

**English documentation: [README.en.md](README.en.md)**

AI Coding 比赛平台：检验选手的 sub agent 开发能力。选手用任意语言/框架（Claude Code、OpenCode、自研）开发狼人杀玩家 agent，通过 CLI 进程协议（stdin/stdout JSONL）接入平台对局；LLM 裁判主持，规则引擎保证公平可重放。

## 架构

```
Web 看板(React) ── REST/WS ── 编排器(@wt/server)
                                  ├─ AgentRunner（选手 agent Docker 沙箱）
                                  ├─ RulesEngine(@wt/engine 纯函数可重放)
                                  ├─ LLM 裁判(@wt/llm 多供应商+降级)
                                  └─ PostgreSQL(Drizzle ORM)
```

## 部署机使用方式（离线部署 · 推荐）

部署机前置条件：**Linux + Docker（含 compose 插件），无需任何外网访问**。
离线包含全部镜像（平台+前端、选手 agent 双运行时、PostgreSQL），三条命令起服务：

```bash
# 1. 下载离线包（本机可先下载后拷贝到部署机）
wget https://github.com/1493438836ljx-art/WerewolfTournament/releases/download/offline-bundle-v0.2.0/offline-bundle-20260914.tar.gz

# 2. 解压并加载镜像（约 1-2 分钟）
tar xzf offline-bundle-*.tar.gz && cd offline-bundle-*
./load.sh

# 3. 启动（自动生成 .env → 起 postgres+server → 跑数据库迁移）
./up.sh
```

浏览器访问 `http://<部署机IP>:3000`。管理员账号见生成的 `.env`（`WT_ADMIN_USERNAME/PASSWORD`，**首次登录后请修改**）；裁判 LLM 对接信息在「裁判 → 模型对接配置」页面随时填写，无需改文件重启。选手在页面注册 → 上传 agent（tar.gz）→ 自检 → 约战。

> 重新生成离线包：`bash scripts/export-offline-bundle.sh`（产物在 dist/）。

## 快速开始（开发模式）

```bash
pnpm install
cp .env.example .env                 # 填入裁判 LLM key（没有也能跑，裁判降级模板）
docker compose up -d postgres        # 本地起 PostgreSQL
pnpm db:migrate                      # 执行迁移
pnpm dev:server                      # 后端 :3000（WT_SANDBOX=none 时 agent 裸跑）
WT_SANDBOX=docker pnpm dev:server    # 或：agent 走 Docker 沙箱（正式形态）
pnpm dev:web                         # 看板 :5173
```

## 验证

```bash
pnpm test          # 62 个测试：引擎规则矩阵（含警长竞选）/ 协议 / 信息隔离 / docker 沙箱 / 认证权限矩阵 / 裁判降级
pnpm sim           # 纯引擎随机跑一局完整狼人杀（无进程、无 DB）
pnpm e2e           # 全链路：注册 agent -> 完整锦标赛 -> 积分榜（需 postgres）
```

## 平台要点

- **登录体系**：选手注册 / 管理员由部署配置；选手上传作品（一人一份，重复上传自动覆盖）并自检
- **训练赛**：选手约战制——自选对手（至少含自己的一个 agent），选满 9 个**不同** agent，创建即开赛，一局定胜负
- **正式比赛**：管理员编排，全员轮转（每轮所有 agent 各上场一局），多轮分组成绩更稳
- **赛制**：9 人局（3 狼 + 预女猎 + 3 民）、警长竞选（1.5 票/警徽流）、两轮发言（陈述+反驳）、屠边制；一局中一个 agent 只有一个副本
- **并发与观战**：全局并发上限在「裁判 → 运行配置」页面可调（即时生效）；比赛详情页内嵌实时观战/回放（座位环、发言流、票型、翻牌）

## 文档

- `docs/PROTOCOL.md` —— 选手 agent 接入协议（必读）
- `docs/RULES.md` —— 狼人杀规则细节（含警长与两轮发言）
- `docs/TOURNAMENT.md` —— 赛制与积分
- `docs/SECURITY.md` —— 沙箱与防作弊

## 选手 agent

见 `agents/template-python/`、`agents/template-node/`（模板）；示例见 `agents/random-bot/`（随机策略）与 `agents/llm-bot/`（LLM 驱动）。
