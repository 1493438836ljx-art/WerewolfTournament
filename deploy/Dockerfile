# 平台 server 生产镜像（多阶段：monorepo 构建 -> 精简运行时）
# 构建上下文为仓库根目录：docker build -f deploy/Dockerfile -t wt-server:latest .

# ─── 构建阶段 ───
FROM docker.m.daocloud.io/library/node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/engine/package.json packages/engine/
COPY packages/llm/package.json packages/llm/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.base.json ./
COPY packages ./packages
RUN pnpm --filter @wt/protocol --filter @wt/engine --filter @wt/llm run build \
 && pnpm --filter @wt/web exec vite build

# ─── 运行阶段 ───
FROM docker.m.daocloud.io/library/node:22-slim AS runtime
WORKDIR /app
RUN corepack enable
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
ENV NODE_ENV=production
EXPOSE 3000
# web 静态由 server 托管（packages/web/dist）；tsx 直跑 TS 源码（与开发一致，避免构建产物漂移）
CMD ["pnpm", "--filter", "@wt/server", "start"]
