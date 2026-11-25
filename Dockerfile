# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build \
 && npx esbuild scripts/migrate.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/migrate.js \
 && mkdir -p dist/public/frontend && cp -r frontend/. dist/public/frontend/
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app/app
# procps provides `ps`, which the telemetry/system monitor spawns (missing in slim images)
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=build /app/public ./public
# /app/storage = ../storage relative to cwd (speech utils); uploads/data are volumes
RUN mkdir -p /app/storage /app/app/uploads /app/app/data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
CMD ["sh","-c","node dist/migrate.js && node dist/boot.js"]
