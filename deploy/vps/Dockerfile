# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=idosi-npm-cache,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --no-audit --no-fund \
      --fetch-retries=2 \
      --fetch-retry-mintimeout=10000 \
      --fetch-retry-maxtimeout=30000 \
      --fetch-timeout=120000
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ARG IDOSI_RELEASE_SHA=unknown
LABEL org.opencontainers.image.revision="$IDOSI_RELEASE_SHA" \
    io.idosi.static-topology="sha-volume-v1"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    IDOSI_DB_PATH=/app/data/idosi.sqlite \
    IDOSI_IMAGES_DIR=/app/data/identity-images \
    IDOSI_MIGRATIONS_DIR=/app/drizzle \
    IDOSI_STATIC_DIR=/app/dist/client

WORKDIR /app
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/server ./server
COPY --from=build /app/src/domain ./src/domain
COPY --from=build /app/drizzle ./drizzle
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "server/vps/server.mjs"]
