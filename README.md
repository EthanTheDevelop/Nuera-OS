# Nuera OS

Plateforme interne de pilotage de l'agence **Nuera Studio**.

> **État : fondations techniques uniquement.** Aucun module métier n'est développé.
> Le dépôt fournit l'architecture, l'outillage, l'authentification, la base de données
> (tables techniques seulement) et les conventions pour développer les modules ensuite,
> à partir de spécifications et de maquettes validées.

## Stack

| Rôle                | Choix                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Application         | Next.js 16 (App Router) · React 19 · TypeScript 6 (strict)                 |
| Base de données     | PostgreSQL 17 · Drizzle ORM · migrations SQL versionnées                   |
| Authentification    | better-auth (sessions en base, plugin admin) + RBAC applicatif             |
| Validation          | Zod 4 (messages en français)                                               |
| Interface           | Tailwind CSS 4 (tokens provisoires, à remplacer par les maquettes)         |
| Qualité             | ESLint 9 · Prettier · Vitest · PGlite (PostgreSQL embarqué pour les tests) |
| Déploiement (prévu) | Image Docker `standalone` sur Coolify                                      |

Le détail et la justification des choix sont dans [docs/architecture.md](docs/architecture.md).

## Prérequis

- **Node.js 24** (voir `.nvmrc`) et npm 11.
- **Docker** pour le PostgreSQL local, ou tout PostgreSQL 17 accessible via `DATABASE_URL`.

## Démarrage local

```bash
cp .env.example .env          # puis renseigner POSTGRES_PASSWORD, DATABASE_URL, BETTER_AUTH_SECRET
npm ci
docker compose up -d          # PostgreSQL local (127.0.0.1:5432)
npm run db:migrate            # applique les migrations
npm run user:create -- --email vous@exemple.fr --name "Prénom Nom" --role admin
npm run dev                   # http://localhost:3000
```

Générer `BETTER_AUTH_SECRET` :
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`

L'inscription publique est désactivée : les comptes se créent avec `npm run user:create`
(mot de passe saisi sans écho, 12 caractères minimum).

## Scripts

| Commande                  | Effet                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| `npm run dev`             | Serveur de développement                                                   |
| `npm run build` / `start` | Build et serveur de production                                             |
| `npm run check`           | Format + lint + types + tests (à lancer avant chaque PR)                   |
| `npm test`                | Tests (unitaires + intégration sur PostgreSQL embarqué, sans Docker)       |
| `npm run db:generate`     | Génère une migration SQL depuis le schéma (`drizzle/`) — **relire le SQL** |
| `npm run db:migrate`      | Applique les migrations en attente                                         |
| `npm run db:studio`       | Explorateur de base Drizzle Studio                                         |
| `npm run user:create`     | Crée un compte (`--email`, `--name`, `--role admin\|member`)               |

## Structure

```
src/
  app/            Routes Next.js : pages et API. Couche « interface » fine, sans logique métier.
    (auth)/       Pages publiques (connexion)
    (app)/        Zone authentifiée (layout + pages des modules)
    api/          Routes HTTP : auth (better-auth), health
  modules/        Domaines fonctionnels : <domaine>/{schema, repository, service, actions, components}
  components/     Composants d'interface partagés (ui/, layout/)
  config/         Registre de navigation (point d'extension des modules)
  integrations/   (à venir) Clients des services externes : Coolify, Indy, Payload…
  server/         Socle serveur : config, base, auth/permissions, erreurs, logs, sécurité
  lib/            Utilitaires isomorphes (client + serveur)
  proxy.ts        CSP à nonce + redirection vers /login
  instrumentation.ts  Validation de la config et migrations au démarrage
drizzle/          Migrations SQL versionnées (générées, relues, commitées)
scripts/          CLI : migrations, création de compte
tests/            Helpers et tests d'intégration
docs/             Architecture, décisions, sécurité
```

## Développer un module

Voir [docs/architecture.md § Ajouter un module](docs/architecture.md#ajouter-un-module).
En résumé : tables dans `src/server/db/schema/<domaine>.ts` → migration → permissions dans
`src/server/auth/permissions.ts` → `src/modules/<domaine>/` (schéma Zod, repository,
service, actions) → pages dans `src/app/(app)/<domaine>/` → entrée dans `src/config/navigation.ts`.

## Déploiement (Coolify)

Non effectué : aucune opération n'a été réalisée sur l'infrastructure. Le `Dockerfile`
fournit une image `standalone` non privilégiée avec healthcheck (`/api/health`).
Variables à définir dans Coolify : `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
(URL publique HTTPS), `DB_MIGRATE_ON_START=true`. L'application doit être exposée
**uniquement via le reverse proxy** (Traefik) : l'IP cliente est lue dans `X-Forwarded-For`.

## Sécurité

Secrets uniquement dans `.env` (ignoré par Git) ou dans Coolify — jamais dans le code.
Points de vigilance et décisions à valider : [docs/architecture.md § Sécurité](docs/architecture.md#sécurité).
