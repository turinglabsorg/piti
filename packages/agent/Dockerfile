FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/agent/package.json packages/agent/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/agent/tsconfig.json packages/agent/
COPY packages/agent/src packages/agent/src

# Build
RUN pnpm --filter @piti/shared build && pnpm --filter @piti/agent build

# Production stage
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/agent/package.json packages/agent/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/agent/dist packages/agent/dist

EXPOSE 3001

CMD ["node", "packages/agent/dist/index.js"]
