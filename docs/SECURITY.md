# 沙箱与防作弊

## 信息隔离（平台责任）

- 发给每个座位的消息**唯一出口**是引擎 `visibility.ts` 的 `agentEventsFor()`，私有事件（查验结果/用药/刀口）带座位可见性标签
- 属性测试覆盖：随机对局中断言座位 i 收不到座位 j 的私有信息
- `game_events` 表存有每个座位收到的消息副本，支持赛后泄漏审计

## 进程沙箱

| 模式 | 场景 | 措施 |
|---|---|---|
| `none` | 本地开发 | 环境变量白名单清洗（PATH/HOME/WT_* 等，**剔除 DATABASE_URL、LLM_API_KEY 等敏感变量**）、独立工作目录、超时击杀 |
| `docker` | 正式比赛（已实测） | 每 agent 一容器：`--network none` 或仅可达 LLM 代理的专用网桥（icc 禁容器互访）、`--memory/--memory-swap/--cpus/--pids-limit` 按 manifest 强制、`--read-only` 根文件系统 + tmpfs 工作目录、非 root（10001）、源码只读挂载 `/agent`、`--rm` 自动回收 |

docker 模式启用：`.env` 设 `WT_SANDBOX=docker`，先跑 `scripts/build-agent-images.sh`（构建 `wt-agent-python/node` 镜像 + 创建 `wt-agent-net` 代理网络；受限网络环境可用 `--build-arg BASE=docker.m.daocloud.io/library/...` 加速基础镜像）。manifest 可选 `image` 字段覆盖运行时镜像（需赛事审批）。

实测记录（macOS Docker Desktop，Linux 服务器同理）：9 容器对局完整终局、资源限制 inspect 断言（内存/pids/只读/非 root）、`network=none` 容器访问宿主被拒、kill 后容器自动回收、容器内 agent 经 `host.docker.internal` 调平台 LLM 代理 53 次全部成功。

## LLM 代理（公平的资源供给）

选手 agent 需要调 LLM 做语言决策，但沙箱禁网 —— 平台起本地 **OpenAI 兼容代理**：
- 仅放行配置的模型；按 agent 限 RPM 与 token 预算（超限 429）
- 全部调用计量入 `llm_calls` 表（成本审计与选手统计）
- token 注入 `WT_LLM_PROXY_URL / WT_LLM_PROXY_TOKEN` 环境变量（`manifest.network: "proxy"` 时）

## 违规与判罚

- 非法回复 / 乱输出 / 引用过期请求：每次记 1 次违规，**3 次取消该局资格**（座位死亡、阵营按局面继续结算）
- 超时：平台按 RULES.md 的默认动作代答（比赛永不死锁）
- 刺探平台信息 / 对局外通信 / 沙箱逃逸：取消**比赛**资格

## 裁判中立性

- 规则判定 100% 由确定性引擎执行，LLM 裁判无法影响胜负与流程
- 裁判 prompt 硬约束「公告不得泄露未公开信息」，公告输入只喂公开事件
- 裁判宕机自动降级模板文案，不影响对局
