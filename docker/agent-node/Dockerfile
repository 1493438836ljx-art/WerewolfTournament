# 选手 agent 运行时镜像 · Node.js
# 可用构建参数覆盖基础镜像源（受限网络环境）：
#   docker build --build-arg BASE=docker.m.daocloud.io/library/node:22-slim ...
ARG BASE=node:22-slim
FROM ${BASE}

# 非 root 运行用户（与 docker run --user 保持一致）
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin agent

RUN mkdir -p /tmp/work && chown -R agent:agent /tmp

USER 10001
WORKDIR /agent

# agent 源码由平台在启动时只读挂载到 /agent
ENTRYPOINT []
