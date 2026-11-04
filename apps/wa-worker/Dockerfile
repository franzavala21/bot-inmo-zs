# Worker de WhatsApp para Railway. Contexto de build: la raíz del repo.
FROM node:22-slim
WORKDIR /app
RUN corepack enable

# Primero solo los manifiestos, para aprovechar la caché de capas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/wa-worker/package.json apps/wa-worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter "wa-worker..."

COPY packages/core packages/core
COPY apps/wa-worker apps/wa-worker

ENV NODE_ENV=production
WORKDIR /app/apps/wa-worker
# La sesión de WhatsApp vive en el volumen de Railway (AUTH_DIR=/data/auth), no en la imagen.
CMD ["node_modules/.bin/tsx", "src/index.ts"]
