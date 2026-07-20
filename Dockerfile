# syntax=docker/dockerfile:1.7

# Authoritative Node major from .nvmrc / CI. Pin bookworm-slim minor line (not latest).
ARG NODE_IMAGE=node:24.11-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
# Install all dependencies (including TypeScript) for the builder. Do not set
# NODE_ENV=production here or npm ci will omit required build tooling.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

FROM deps AS builder
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=1536
COPY . .
# Repository may not ship a public/ directory; standalone still expects the path.
RUN mkdir -p public
# Build must succeed without database/provider/OAuth secrets in the image context.
RUN npm run build

# ---------------------------------------------------------------------------
# Web: Next.js standalone server
# ---------------------------------------------------------------------------
FROM base AS web
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 cernix \
 && useradd --system --uid 1001 --gid cernix --home-dir /app --shell /usr/sbin/nologin cernix
COPY --from=builder /app/public ./public
COPY --from=builder --chown=cernix:cernix /app/.next/standalone ./
COPY --from=builder --chown=cernix:cernix /app/.next/static ./.next/static
USER cernix
ENV PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NODE_OPTIONS=--max-old-space-size=256
EXPOSE 3000
CMD ["node", "server.js"]

# ---------------------------------------------------------------------------
# Worker / migrate: shared runtime for tsx worker entrypoints and db:migrate
# ---------------------------------------------------------------------------
FROM base AS worker
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 cernix \
 && useradd --system --uid 1001 --gid cernix --home-dir /app --shell /usr/sbin/nologin cernix
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev
COPY --chown=cernix:cernix tsconfig.json ./
COPY --chown=cernix:cernix server ./server
COPY --chown=cernix:cernix lib ./lib
USER cernix
ENV CERNIX_SKIP_LOCAL_ENV=1 \
    NODE_OPTIONS=--max-old-space-size=128
# No default command: Compose sets migrate or a specific worker script.
CMD ["node", "--version"]
