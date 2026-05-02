# ── kepler-backend/upload-service/Dockerfile ────────────────────────────────
# Target: linux/amd64 | Strategy: multi-stage, slim bun base, no dev deps in final image

# ── Stage 1: Install ALL deps and build ─────────────────────────────────────
FROM --platform=linux/amd64 oven/bun:1-slim AS builder
WORKDIR /app

# Bypass self-signed cert in corporate proxy environments
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

# ── Stage 2: Production image ────────────────────────────────────────────────
FROM --platform=linux/amd64 oven/bun:1-slim AS runner
WORKDIR /app

# Bypass self-signed cert in corporate proxy environments
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
    && rm -rf /root/.bun/install/cache

# Copy compiled source from builder
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

USER bun

EXPOSE 8787

CMD ["bun", "run", "src/server.ts"]
