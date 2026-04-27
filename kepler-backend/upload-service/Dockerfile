# ── kepler-backend/upload-service/Dockerfile ────────────────────────────────
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY src ./src
COPY tsconfig.json ./

EXPOSE 8787

CMD ["bun", "run", "src/server.ts"]
