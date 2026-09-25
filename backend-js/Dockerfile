FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY backend-js/package.json backend-js/package-lock.json ./
RUN npm ci
COPY backend-js/prisma ./prisma
COPY backend-js/prisma.config.js ./
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm run db:generate && npm prune --omit=dev \
    && rm -rf node_modules/prisma node_modules/@prisma/config node_modules/mysql2 node_modules/deepmerge-ts

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8000 HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY backend-js/package.json ./
COPY backend-js/src ./src
EXPOSE 8000
CMD ["node", "src/server.js"]
