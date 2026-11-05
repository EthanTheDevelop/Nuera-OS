# syntax=docker/dockerfile:1
#
# Image de production de Nuera OS (sortie Next.js « standalone »), utilisée telle
# quelle par Coolify (Build Pack « Dockerfile ») pour main et staging.
#
# - Aucun secret n'est nécessaire au build : la configuration (DATABASE_URL,
#   BETTER_AUTH_*…) est lue et validée au démarrage. Dans Coolify, les variables
#   doivent être disponibles à l'exécution uniquement (pas au build).
# - Le conteneur écoute en HTTP sur le port 3000 ; le TLS est terminé par le proxy
#   de Coolify (Traefik / Caddy). Voir docs/deployment-coolify.md.
#
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
# Application Next.js, puis outils d'exploitation autonomes (migrations, comptes).
RUN npm run build && npm run build:cli

# --- Exécution (utilisateur non privilégié, fichiers minimaux) -----------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# /data/storage : point de montage du volume des documents (STORAGE_DIR). Un volume nommé neuf
# hérite de ce propriétaire. Sans volume, définir STORAGE_DIR perdrait les fichiers au redéploiement.
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs \
    && mkdir -p /data/storage && chown -R nextjs:nodejs /data

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Migrations SQL versionnées : appliquées au démarrage si DB_MIGRATE_ON_START=true,
# ou manuellement avec `node cli/db-migrate.mjs`.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
# CLI : `node cli/db-migrate.mjs`, `node cli/user-create.mjs --email … --name … --role admin`.
COPY --from=builder --chown=nextjs:nodejs /app/dist/cli ./cli

USER nextjs
EXPOSE 3000

# Sain uniquement si le serveur répond ET si PostgreSQL est joignable.
# `start-period` couvre l'application des migrations au démarrage.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1

CMD ["node", "server.js"]
