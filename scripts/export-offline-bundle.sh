#!/usr/bin/env bash
# 导出离线部署包：平台 + agent 运行时 + postgres 全部镜像 + 部署脚本
# 产物 dist/offline-bundle-<date>.tar.gz（部署机：tar xzf → load.sh → up.sh）
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(date +%Y%m%d)
OUT="dist/offline-bundle-$VERSION"
mkdir -p "$OUT"

echo "== 1/3 构建平台镜像 =="
docker build -f deploy/Dockerfile -t wt-server:latest .

echo "== 2/3 导出镜像（docker save）==="
docker save wt-server:latest wt-agent-python:latest wt-agent-node:latest postgres:17-alpine \
  | gzip > "$OUT/images.tar.gz"

echo "== 3/3 打包部署脚本 =="
cp deploy/docker-compose.prod.yml "$OUT/docker-compose.yml"
cat > "$OUT/load.sh" <<'EOF'
#!/usr/bin/env bash
# 离线加载全部镜像
set -e
echo "加载镜像（约 1-2 分钟）…"
docker load < images.tar.gz
echo "创建 agent 代理网络…"
docker network inspect wt-agent-net >/dev/null 2>&1 || \
  docker network create -o com.docker.network.bridge.enable_icc=false wt-agent-net
docker images | grep -E "wt-server|wt-agent|postgres"
echo "✅ 镜像就绪"
EOF
cat > "$OUT/up.sh" <<'EOF'
#!/usr/bin/env bash
# 首次部署：生成 .env 并启动（postgres + server）
set -e
[ -f .env ] || cat > .env <<'CFG'
PORT=3000
HOST=0.0.0.0
WT_ADMIN_USERNAME=admin
WT_ADMIN_PASSWORD=change-me
WT_ADMIN_TOKEN=change-me-too
# 裁判 LLM（可后补，页面可配）
LLM_PROVIDER=anthropic
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
CFG
echo "启动服务…"
docker compose up -d
sleep 5
docker compose exec -T server pnpm --filter @wt/server db:migrate || true
echo "✅ 平台已启动: http://<本机IP>:3000  （默认管理员见 .env）"
EOF
chmod +x "$OUT/load.sh" "$OUT/up.sh"
cat > "$OUT/README.txt" <<'EOF'
狼人杀 Agent 锦标赛 · 离线部署包
==================================
前置：Linux + Docker（含 compose 插件），无需任何外网访问

1. tar xzf offline-bundle-*.tar.gz && cd offline-bundle-*
2. ./load.sh          # 加载 4 个镜像 + 创建 agent 网络
3. ./up.sh            # 生成 .env、启动 postgres + server、跑迁移
4. 浏览器访问 http://<IP>:3000，管理员账号在 .env（WT_ADMIN_*）
5. 上传 agent 需要的运行时镜像已内置（wt-agent-python / wt-agent-node）

选手 agent 上传目录：./data/uploads（compose 挂载）
裁判 LLM 配置可在「裁判 → 模型对接配置」页面随时填写
EOF

tar czf "$OUT.tar.gz" -C dist "offline-bundle-$VERSION"
SIZE=$(du -h "$OUT.tar.gz" | cut -f1)
echo "✅ 离线包: $OUT.tar.gz ($SIZE)"
