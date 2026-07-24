# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Build stage — full dependencies, compile TypeScript to dist/.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Copy only the manifests first so `npm ci` is cached until they change.
COPY package.json package-lock.json ./
RUN npm ci

# tsconfig has rootDir "." and includes both src and scripts, so `tsc` emits
# dist/src/*.js (the server) AND dist/scripts/*.js (the migration runner).
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Runtime stage — production dependencies only, no compiler, no source.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prod deps only. Every dependency here is pure JS (bcryptjs, pg, ws, …), so
# alpine needs no build toolchain.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# The compiled migration runner lives at dist/scripts/migrate.js and resolves
# its SQL from ../migrations (i.e. dist/migrations), so the files land there.
COPY migrations ./dist/migrations

# Run as the unprivileged user the base image already provides.
USER node

EXPOSE 4000

# The app serves its own health endpoint, which also proves the DB is reachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1

# Apply any pending migrations (idempotent), then start. If migration fails the
# container exits non-zero rather than starting against a half-built schema.
#
# `exec` replaces the shell with node so the server runs as PID 1 and receives
# SIGTERM directly. Without it, sh stays PID 1 and does not forward the signal,
# so the graceful-shutdown handler in index.ts never runs and the orchestrator
# SIGKILLs the container instead — dropping in-flight requests and leaking DB
# connections, which is exactly what that handler exists to prevent.
CMD ["sh", "-c", "node dist/scripts/migrate.js && exec node dist/src/index.js"]
