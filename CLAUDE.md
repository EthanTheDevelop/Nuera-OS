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
- Intégration absente : `ServiceUnavailableError` et état « connexion requise ». Jamais de succès simulé.
- Versions de dépendances figées, publiées depuis au moins 14 jours.

## Git

- Messages `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, courts, décrivant le travail et sa validation.
- Aucune mention d'IA, d'agent ou d'outil de génération, aucun trailer `Co-Authored-By`, dans les commits, PR et notes de livraison.
- Ne pas pousser, fusionner ni déployer sans autorisation. Ne pas indexer `NUERA_OS_PROMPT_ALL_IN_ONE_CLAUDE_CODE_READY.md`.

## Enseignements

- `next build` n'a besoin d'aucun secret : ne pas lire l'environnement à l'import.
- CSP : seul `style-src-attr 'unsafe-inline'` est relâché ; les balises `<style>` et les scripts restent à nonce. La racine lit `headers()`, donc toutes les pages sont dynamiques.
- Next.js 16.4 : documentation exacte de la version dans `node_modules/next/dist/docs/`.
- Interface : composer depuis `src/components/{ui,charts,states,motion,layout}`, visibles sur `/dev/ui` en développement. Les graphiques reçoivent des unités d'affichage : convertir les centimes avant.
- Base de développement : `npm run db:seed` imprime les mots de passe une seule fois.
- Twenty : introspection GraphQL désactivée, se fier à `/rest/open-api/*`. Détails vérifiés dans `docs/integrations/twenty.md`.
- Twenty : les webhooks sont livrés au plus une fois et perdus au-delà de 60 par minute. La réconciliation par curseur est obligatoire, le webhook n'est qu'un accélérateur.
- Twenty : une fiche archivée garde son domaine ou son e-mail réservé. Sur `CrmDuplicateError`, proposer la restauration ou la fusion, jamais une recréation.
- Twenty : téléphones au format E.164. Fusion irréversible pour la fiche perdante : confirmation explicite et audit.
- Tests de service : `tests/helpers/fake-crm-gateway.ts`, contrôlé contre la vraie instance par `npm run test:live`.
