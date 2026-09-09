#!/usr/bin/env bash
# 构建选手 agent 运行时镜像（正式赛 docker 沙箱前置步骤）
set -euo pipefail
cd "$(dirname "$0")/.."

docker build -t wt-agent-python:latest docker/agent-python
docker build -t wt-agent-node:latest docker/agent-node

# LLM 代理专用网络：禁容器互访（icc=false），保留到宿主的通路
docker network inspect wt-agent-net >/dev/null 2>&1 || \
  docker network create --driver bridge \
    -o com.docker.network.bridge.enable_icc=false \
    wt-agent-net

echo "✅ 镜像与网络就绪：wt-agent-python / wt-agent-node / wt-agent-net"
