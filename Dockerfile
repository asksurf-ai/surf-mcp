FROM oven/bun:1.3.11-alpine AS build

WORKDIR /app
COPY package.json bun.lock tsconfig.json tsup.config.ts ./
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun run build

FROM oven/bun:1.3.11-alpine

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
USER bun

CMD ["bun", "dist/index.js", "--http"]
