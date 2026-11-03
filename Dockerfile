# syntax=docker/dockerfile:1
#
# Image de production de Nuera OS (sortie Next.js « standalone »).
# Aucun secret n'est nécessaire au build : la configuration est lue au démarrage.
# Recommandation : épingler l'image de base par digest (`node:24-alpine@sha256:…`).

FROM node:24-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1

# --- Dépendances (couche mise en cache tant que le lockfile ne change pas) -----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# --- Build ----------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Exécution (utilisateur non privilégié, fichiers minimaux) -----------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Migrations SQL, appliquées au démarrage si DB_MIGRATE_ON_START=true.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1

CMD ["node", "server.js"]
