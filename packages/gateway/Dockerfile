FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/gateway/package.json packages/gateway/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/gateway/tsconfig.json packages/gateway/
COPY packages/gateway/src packages/gateway/src

RUN pnpm --filter @piti/shared build && pnpm --filter @piti/gateway build

FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/gateway/package.json packages/gateway/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/gateway/dist packages/gateway/dist

CMD ["node", "packages/gateway/dist/index.js"]
