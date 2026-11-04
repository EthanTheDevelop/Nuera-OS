# Nuera OS · instructions du dépôt

Cockpit métier de l'agence Nuera Studio. Lire avant tout lot : `docs/domain-model.md` (contrat de domaine, arbitrages, répartition des fichiers), `docs/architecture.md` (couches), `docs/PROGRESS.md` (état d'avancement).

Sources visuelles : `docs/design/figma-map.md`, `tokens.md`, `motion.md`. Figma « Nuera Design » `nlvRWAtD1x2fKf8gVgcM0g`, page `57:3`. La page `199:3` (« NUERA DEV ») est un autre produit.

## Commandes

Node 24 obligatoire (`engine-strict`). Docker pour PostgreSQL et Twenty en local.

- `npm run check` : format, lint, types, tests. À passer avant chaque commit.
- `npm test` : tests sur PGlite, sans Docker.
- `npm run db:generate` puis relire le SQL ; `npm run db:migrate`.
- `docker compose up -d` : PostgreSQL. `docker compose -f docker-compose.twenty.yml --env-file .env up -d` : Twenty.

## Règles

- Couches : page → action → service → repository. L'interface n'importe jamais la base (règle ESLint). Un module appelle le service d'un autre, jamais son repository.
- Chaque service : `assertCan` → validation Zod → règles → écriture + `recordAudit` dans la même transaction.
- Zod depuis `@/lib/zod` uniquement. Configuration via `getEnv()` uniquement. Pas de `any`.
- Interface en français. Montants HT en centimes, durées en minutes.
- Aucune donnée métier en dur, aucun mock dans le code livré. Valeur absente : état vide ou indisponible. Fixtures uniquement sous `tests/` ou dans le seed de développement.
- Intégration absente : `IntegrationUnavailableError` et état « connexion requise ». Jamais de succès simulé.
- Versions de dépendances figées, publiées depuis au moins 14 jours.

## Git

- Messages `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, courts, décrivant le travail et sa validation.
- Aucune mention d'IA, d'agent ou d'outil de génération, aucun trailer `Co-Authored-By`, dans les commits, PR et notes de livraison.
- Ne pas pousser, fusionner ni déployer sans autorisation. Ne pas indexer `NUERA_OS_PROMPT_ALL_IN_ONE_CLAUDE_CODE_READY.md`.

## Enseignements

- `next build` n'a besoin d'aucun secret : ne pas lire l'environnement à l'import.
- La CSP à nonce bloque les attributs `style` rendus côté serveur : vérifier toute animation au premier rendu.
- Twenty : introspection GraphQL désactivée, se fier à `/rest/open-api/*`. Détails dans `docs/integrations/twenty.md`.
