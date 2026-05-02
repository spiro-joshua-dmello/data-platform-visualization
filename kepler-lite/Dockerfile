# ── kepler-lite/Dockerfile ───────────────────────────────────────────────────
# Target: linux/amd64 | Strategy: multi-stage, build with bun, serve with vite preview

# ── Stage 1: Install ALL deps and build ──────────────────────────────────────
FROM --platform=linux/amd64 oven/bun:1-slim AS builder
WORKDIR /app

# Bypass self-signed cert in corporate proxy environments
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bunx vite build

# ── Stage 2: Production image — only what vite preview needs ─────────────────
FROM --platform=linux/amd64 oven/bun:1-slim AS runner
WORKDIR /app

# Bypass self-signed cert in corporate proxy environments
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
    && rm -rf /root/.bun/install/cache

COPY --from=builder /app/dist ./dist
COPY vite.config.ts ./

USER bun

EXPOSE 5173

CMD ["bunx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
