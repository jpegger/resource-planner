# syntax=docker/dockerfile:1
# Multi-stage production image (Next.js standalone). Runtime listens on PORT (default 8080 for OpenShift).

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# `postinstall` runs `prisma generate` — schema + prisma.config.ts must exist before `npm ci`.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Do NOT set ENV DATABASE_URL before `next build` — Next can inline it into the server bundle
# and the container would keep connecting to 127.0.0.1 at runtime. Only pass it for prisma generate.
ENV NEXT_TELEMETRY_DISABLED=1
RUN DATABASE_URL="postgresql://build:unused@127.0.0.1:5432/unused?schema=public" npx prisma generate
# Next imports API route modules during build; Prisma is instantiated on import and needs DATABASE_URL to be set.
# Provide a dummy URL for the build step (does not need to be reachable).
RUN DATABASE_URL="postgresql://build:unused@127.0.0.1:5432/unused?schema=public" npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --shell /usr/sbin/nologin --create-home nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nodejs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nodejs:nodejs /app/.next/static ./.next/static

USER nodejs
EXPOSE 8080
CMD ["node", "server.js"]
