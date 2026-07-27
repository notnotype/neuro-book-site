# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.14-debian AS bun-base
WORKDIR /app

FROM bun-base AS dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM bun-base AS production-dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM dependencies AS build
COPY . .
RUN bun run build

FROM node:24.13.0-trixie-slim AS runtime
RUN groupadd --gid 10001 nbook \
    && useradd --uid 10001 --gid nbook --create-home --home-dir /home/nbook nbook

WORKDIR /app
COPY --from=production-dependencies --chown=nbook:nbook /app/node_modules ./node_modules
COPY --from=build --chown=nbook:nbook /app/.output ./.output
COPY --from=build --chown=nbook:nbook /app/dist ./dist
COPY --from=build --chown=nbook:nbook /app/prisma ./prisma
COPY --from=build --chown=nbook:nbook /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=nbook:nbook /app/package.json ./package.json
COPY --chown=nbook:nbook docker/entrypoint.sh /app/entrypoint.sh
RUN chmod 0755 /app/entrypoint.sh \
    && mkdir /data \
    && chown nbook:nbook /data

ENV NODE_ENV=production \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=640 \
    NB_MIGRATIONS_DIR=/app/prisma/migrations

USER 10001:10001
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
