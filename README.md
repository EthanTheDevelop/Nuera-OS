# Nuera OS

Cockpit métier de l'agence **Nuera Studio** : une seule application pour piloter le commercial, les devis, les contrats, les projets, le temps, les sites, le support, les finances, les documents et les automatisations, avec un portail pour les clients.

Nuera OS pilote les outils de l'agence sans les remplacer : Twenty reste maître du CRM, Coolify des déploiements, Indy de la facturation légale.

État détaillé : [docs/PROGRESS.md](docs/PROGRESS.md).

## Stack

| Rôle             | Choix                                                                        |
| ---------------- | ---------------------------------------------------------------------------- |
| Application      | Next.js 16 (App Router) · React 19 · TypeScript 6 (strict)                   |
| Base de données  | PostgreSQL 17 · Drizzle ORM · migrations SQL versionnées                     |
| Authentification | better-auth (sessions en base, double authentification) + RBAC applicatif    |
| Validation       | Zod 4 (messages en français)                                                 |
| Interface        | Tailwind CSS 4, tokens issus de la maquette Figma, composants maison         |
| Qualité          | ESLint 9 · Prettier · Vitest · PGlite · Playwright                           |
| Déploiement      | Image Docker `standalone` sur Coolify (production `main`, staging `staging`) |

Justification des choix : [docs/architecture.md](docs/architecture.md).

## Prérequis

- **Node.js 24** (`.nvmrc`, imposé par `engine-strict`) et npm 11.
- **Docker** pour PostgreSQL et, en option, Twenty en local. Les tests n'en ont pas besoin.

## Démarrage local

```bash
cp .env.example .env          # puis renseigner POSTGRES_PASSWORD, DATABASE_URL, BETTER_AUTH_SECRET
npm ci
docker compose up -d          # PostgreSQL local (127.0.0.1:5432)
npm run db:migrate            # applique les migrations
npm run db:seed               # données fictives ; imprime les mots de passe une seule fois
npm run dev                   # http://localhost:3000
```

Générer `BETTER_AUTH_SECRET` :
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`

L'inscription publique est désactivée. Sans seed, créer un compte avec `npm run user:create` (mot de passe saisi sans écho, 12 caractères minimum).

Twenty en local, facultatif :

```bash
docker compose -f docker-compose.twenty.yml --env-file .env up -d
npm run twenty:bootstrap      # compte, clé d'API et étapes d'opportunité, écrits dans .env
```

Sur `/dev/ui`, en développement seulement : la galerie des composants d'interface.

## Commandes

| Commande                   | Effet                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| `npm run dev`              | Serveur de développement                                                   |
| `npm run build` / `start`  | Build et serveur de production                                             |
| `npm run build:cli`        | Compile les outils d'exploitation de l'image (`dist/cli`)                  |
| `npm run check`            | Format + lint + types + tests, à lancer avant chaque commit                |
| `npm test`                 | Tests unitaires et d'intégration sur PGlite, sans Docker                   |
| `npm run test:e2e`         | Parcours Playwright, sur un serveur lancé et une base seedée               |
| `npm run test:live`        | Contrôle du port CRM contre une vraie instance Twenty                      |
| `npm run db:generate`      | Génère une migration SQL depuis le schéma (`drizzle/`) : **relire le SQL** |
| `npm run db:check`         | Vérifie les migrations : synchronisées avec le schéma et non destructives  |
| `npm run db:migrate`       | Applique les migrations en attente                                         |
| `npm run db:seed`          | Données de développement. Refusé en production                             |
| `npm run db:seed:staging`  | Données fictives en volume, base `nuera_os_staging` uniquement             |
| `npm run db:studio`        | Explorateur de base Drizzle Studio                                         |
| `npm run user:create`      | Crée un compte (`--email`, `--name`, `--role`)                             |
| `npm run twenty:bootstrap` | Prépare une instance Twenty : étapes, clé d'API locale, webhook            |

## Structure

```
src/
  app/            Routes : (auth), (app) pour l'équipe, espace/ pour le portail, api/
  modules/        Domaines : <domaine>/{schema, repository, service, actions, components}
  components/     Interface partagée : ui, charts, states, motion, layout
  integrations/   Twenty, Coolify, Uptime Kuma, DocuSeal, Indy, n8n, OpenAI, SMTP, stockage
  server/         Socle : configuration, base, authentification, erreurs, journaux, démarrage
  config/         Registre de navigation
  lib/            Utilitaires isomorphes
  proxy.ts        CSP à nonce et redirection vers /login
  instrumentation.ts  Appelle src/server/startup.ts au démarrage
drizzle/          Migrations SQL versionnées (générées, relues, commitées)
scripts/          Migrations, comptes, seed, Twenty, sauvegarde et restauration, contrôle CI
tests/            helpers, integration, journeys, e2e, live
docs/             Domaine, architecture, intégrations, exploitation, sécurité, avancement
```

Couches : page → action → service → repository. Détails et règles : [CLAUDE.md](CLAUDE.md) et [docs/architecture.md](docs/architecture.md).

## Documentation

| Sujet                                  | Fichier                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Contrat de domaine et arbitrages       | [docs/domain-model.md](docs/domain-model.md)                               |
| Architecture et ajout d'un module      | [docs/architecture.md](docs/architecture.md)                               |
| État d'avancement et limites connues   | [docs/PROGRESS.md](docs/PROGRESS.md)                                       |
| Déploiement Coolify                    | [docs/deployment-coolify.md](docs/deployment-coolify.md)                   |
| Sauvegarde et restauration             | [docs/ops/sauvegarde-restauration.md](docs/ops/sauvegarde-restauration.md) |
| Tâches planifiées et webhooks entrants | [docs/ops/jobs.md](docs/ops/jobs.md)                                       |
| Twenty                                 | [docs/integrations/twenty.md](docs/integrations/twenty.md)                 |
| better-auth                            | [docs/integrations/better-auth.md](docs/integrations/better-auth.md)       |
| Revue de sécurité                      | [docs/security-review.md](docs/security-review.md)                         |
| Maquettes, tokens, mouvement           | [docs/design/](docs/design/)                                               |

## Rôles

| Rôle         | Libellé       | Portée                                                                               |
| ------------ | ------------- | ------------------------------------------------------------------------------------ |
| `admin`      | Associé       | Tout, dont finances, coûts des membres, comptes, déploiements et export              |
| `member`     | Collaborateur | Production et commercial, sans les droits réservés aux associés                      |
| `contractor` | Prestataire   | Uniquement les projets, tâches, tickets et documents qui lui sont affectés           |
| `viewer`     | Lecture       | Consultation, rôle par défaut                                                        |
| `client`     | Portail       | `/espace` seulement, cloisonné par entreprise ; connexion par lien sans mot de passe |

Matrice complète : `src/server/auth/permissions.ts` et [docs/domain-model.md §5](docs/domain-model.md).

## Intégrations

Toutes sont facultatives et se règlent par variables d'environnement. Sans configuration, l'écran concerné affiche « connexion requise » : jamais de succès simulé. L'état de chacune se lit dans Réglages → Connexions.

| Service       | Rôle                                    | Variables                              | État vérifié                                                      |
| ------------- | --------------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Twenty        | CRM, maître des clients et affaires     | `TWENTY_*`                             | Vérifié sur une instance réelle locale v2.55.0                    |
| Stockage      | Documents sur le disque                 | `STORAGE_DIR`, `STORAGE_MAX_UPLOAD_MB` | Vérifié dans l'image, sur un volume Docker                        |
| SMTP          | E-mails sortants, liens du portail      | `SMTP_*`                               | Testé contre des bouchons, aucun serveur réel                     |
| Coolify       | État et déclenchement des déploiements  | `COOLIFY_*`                            | Testé contre un serveur HTTP local, aucun appel réel              |
| Uptime Kuma   | Supervision des sites                   | `UPTIME_KUMA_*`                        | Testé contre un serveur HTTP local, aucun appel réel              |
| DocuSeal      | Signature des devis                     | `DOCUSEAL_*`                           | Testé contre des bouchons, aucun appel réel                       |
| OpenAI        | Réponses suggérées                      | `OPENAI_*`                             | Testé contre des bouchons, aucun appel réel                       |
| Cal.diy / Cal | Rendez-vous par webhook entrant         | `CAL_WEBHOOK_SECRET`                   | Testé contre des bouchons, aucun appel réel                       |
| n8n           | Relais d'événements, dans les deux sens | `N8N_*`                                | Testé contre des bouchons, aucun appel réel                       |
| Indy          | Facturation légale                      | aucune                                 | Pas d'API vérifiée : import CSV et saisie manuelle des références |

## Déploiement (Coolify)

Deux applications Coolify indépendantes sur `NUERA-PROD-01`, construites depuis le
`Dockerfile` (Build Pack « Dockerfile », port interne `3000`) : `main` → production,
`staging` → préproduction, chacune avec sa propre base PostgreSQL 17 (`DATABASE_URL`).
Les migrations sont appliquées au démarrage (`DB_MIGRATE_ON_START=true`) ; aucune base
n'est créée par le déploiement. Le `docker-compose.yml` sert uniquement au développement local.

Guide complet (paramètres Coolify, variables, volume, réseau, healthcheck, migrations, premier
administrateur, double authentification, tâches planifiées, Twenty) : [docs/deployment-coolify.md](docs/deployment-coolify.md).

## Sécurité

Secrets uniquement dans `.env` (ignoré par Git) ou dans Coolify, jamais dans le code.
Revue complète et points ouverts : [docs/security-review.md](docs/security-review.md).
