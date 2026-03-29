FROM node:20-alpine AS base
RUN apk add --no-cache openssl libc6-compat ca-certificates

# Install dependencies
FROM base AS deps
WORKDIR /app
# cache-bust: 2026-03-29-v12
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build TypeScript
FROM base AS builder
WORKDIR /app
# cache-bust: 2026-03-29-v12
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY tsconfig.json ./
# cache-bust: 2026-03-29-v3
COPY src ./src
RUN npx prisma generate
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

EXPOSE 8080
ENV PORT=8080
ENV HOST=0.0.0.0

CMD ["node", "dist/server.js"]
