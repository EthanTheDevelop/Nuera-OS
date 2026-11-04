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

Formulaires :

- `<form action={...}>` : React réinitialise le formulaire après chaque réponse, erreurs comprises. Pour un `select` contrôlé ou des cases : `onSubmit` + `preventDefault` + `startTransition`, ou recopier les valeurs envoyées dans l'état.
- Un formulaire sans `method="post"` envoyé avant l'hydratation part en GET, valeurs dans l'URL.
- En édition, toujours ajouter la valeur enregistrée aux options d'un `select` : une option absente (objet archivé, liste plafonnée) efface le lien sans bruit. Un `select` désactivé n'est pas envoyé : doubler par un champ caché.
- Valeur lue dans l'URL : tronquer plutôt que `.max()` Zod (sinon page d'erreur), `isCalendarDay` pour une date, `Object.hasOwn` pour une clé (`constructor`, `__proto__`).
- Fichier au-delà de 1 Mo en Server Action : refusé avant l'action. Contrôler la taille côté client et attraper l'erreur.

Next.js et React :

- `notFound()` sous un `loading.tsx` répond 200 : le flux est déjà parti. Garder la page `[id]` hors de cette frontière (groupe de routes pour la liste et son `loading.tsx`).
- `useMotionPreset()` dépend de `prefers-reduced-motion`, inconnu du serveur : ne pas rendre côté serveur un `motion.*` qui en dépend. Thème sombre : `data-theme` sur la racine, pas la media query.
- Le serveur de développement peut servir une sortie périmée : modifier le contenu d'un fichier, pas seulement sa date.

Données et concurrence :

- PGlite n'a qu'une connexion : il ne révèle aucune course entre transactions. Un invariant lecture-écriture exige `FOR UPDATE` et un essai sur le vrai PostgreSQL. Dans une transaction, lire via `tx`, jamais `ctx.db` (blocage). Appeler un autre service dans sa transaction : `{ ...ctx, db: tx }`, les transactions imbriquées deviennent des points de sauvegarde.
- Écriture vers Twenty avant la transaction locale : vérifier d'abord les clés composites, sinon un orphelin reste dans Twenty.
- Webhook : un reçu en échec doit pouvoir être retraité (`onConflictDoUpdate` si `status = 'failed'`). Ne pas dédoublonner par tranche de temps les webhooks qui ne sont qu'un signal.
- `sql` brut sans jointure : Drizzle écrit `"id"` non qualifié, une sous-requête corrélée peut viser la mauvaise table. Qualifier à la main.
- CSV : neutraliser les formules sans transformer les nombres négatifs en texte.

Intégrations et essais navigateur :

- DocuSeal : les URL de documents expirent. Ne pas les stocker, les relire à chaque ouverture.
- Playwright : réutiliser un `storageState` par rôle, car la connexion répétée finit en 429 et le script mesure alors la page de connexion. Lignes `seed-` : toute écriture CRM échoue, créer de nouvelles lignes.
