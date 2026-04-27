# kepler-lite/Dockerfile

FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Serve the built app with vite preview
FROM oven/bun:1 AS runner
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist
COPY vite.config.ts ./

EXPOSE 5173

CMD ["bunx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
