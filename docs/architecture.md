# Architecture de Nuera OS

## Principes

- **Monolithe modulaire** : une seule application Next.js, découpée par domaines
  (`src/modules/<domaine>`). Simple à exploiter (une image, une base) ; un domaine peut
  être extrait plus tard si nécessaire.
- **Nuera OS pilote, il ne remplace pas** : Coolify, Indy, Payload CMS, la supervision et
  un éventuel socle CRM restent maîtres de leurs données. Nuera OS stocke des références
  (identifiants externes) et des données de pilotage, pas des copies.
- **Sécurité par défaut** : refus par défaut des permissions, validation de toute entrée,
  journal d'audit, aucun secret dans le code ni dans les logs.

## Couches

```
Interface  src/app/**, src/components/**, src/modules/*/components/**
   │        Pages (Server Components), formulaires. Aucune requête SQL (règle ESLint).
   ▼
Adaptateurs src/modules/*/<x>.actions.ts, src/app/api/**
   │        Session → service → revalidation / redirection / réponse HTTP.
   ▼
Services   src/modules/*/<x>.service.ts
   │        Contrôle d'accès (assertCan) → validation (Zod) → règles → persistance + audit.
   │        Reçoivent un ServiceContext { db, actor } explicite : testables sans Next.js.
   ▼
Données    src/modules/*/<x>.repository.ts + src/server/db/schema/**
            Requêtes Drizzle uniquement, ni règle métier ni contrôle d'accès.

Intégrations externes : src/integrations/<service>/ (appelées par les services uniquement).
```

## Socle transverse (`src/server`)

| Besoin           | Emplacement                         | Règle                                                                       |
| ---------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| Configuration    | `config/env.ts`                     | Validée par Zod au démarrage ; jamais lue ailleurs via `process.env`        |
| Erreurs          | `errors.ts`                         | `AppError` typées (message utilisateur) ; le reste = erreur interne masquée |
| Server Actions   | `actions.ts`, `lib/action-state.ts` | `toActionErrorState` : traduction unique erreur → formulaire                |
| Validation       | `validation.ts`                     | `parseInput(schema, input)` lève `ValidationError` par champ                |
| Authentification | `auth/auth.ts`, `auth/session.ts`   | `getServiceContext()` / `requireActor()` dans chaque page                   |
| Autorisations    | `auth/permissions.ts`               | Matrice rôle → permissions, refus par défaut                                |
| Journalisation   | `logger.ts`, `security/redact.ts`   | JSON en production ; masquage automatique des clés sensibles                |
| Audit            | `modules/audit`                     | `recordAudit(tx, …)` dans la transaction de l'opération                     |
| Base             | `db/`                               | Pool unique, migrations avec verrou consultatif                             |
| Démarrage        | `startup.ts`                        | Configuration ou migration en échec : arrêt du processus, code 1            |
| Santé            | `health.ts`                         | `/api/health` et `/api/health/ready` : la base répond, état minimal         |

## Ajouter un module

1. **Spécification validée** (PO) : périmètre, règles de gestion, maquettes.
2. **Schéma** : `src/server/db/schema/<domaine>.ts`, exporté dans `schema/index.ts`,
   puis `npm run db:generate` et **relecture du SQL** généré.
3. **Permissions** : `<domaine>:read`, `<domaine>:create`… dans `permissions.ts`,
   attribuées explicitement aux rôles.
4. **Module** `src/modules/<domaine>/` :
   `<x>.schema.ts` (Zod), `<x>.repository.ts`, `<x>.service.ts`, `<x>.actions.ts`,
   `components/`. Opérations importantes ajoutées à `audit.constants.ts`.
5. **Pages** `src/app/(app)/<domaine>/` : chaque page appelle `getServiceContext()`
   et vérifie la permission (le layout ne suffit pas).
6. **Navigation** : entrée dans `src/config/navigation.ts` avec sa permission.
7. **Tests** : services testés sur PGlite (`tests/helpers/db.ts`).

## Modèle de données

Le schéma compte 73 tables (`src/server/db/schema/`, migrations `drizzle/`). Contrat complet,
arbitrages et répartition des fichiers : `docs/domain-model.md`.

## Exploitation

- **Image** : `Dockerfile`, sortie `standalone`, Node 24, utilisateur non privilégié, outils
  `cli/db-migrate.mjs` et `cli/user-create.mjs`. Déploiement : `docs/deployment-coolify.md`.
- **État sur disque** : les documents seuls, sous `STORAGE_DIR`, sur un volume. Tout le reste est en base.
- **Tâches planifiées** : pas de planificateur interne, Coolify appelle `/api/jobs/*` (`docs/ops/jobs.md`).
- **Sauvegarde** : base et volume ensemble, hors du serveur (`docs/ops/sauvegarde-restauration.md`).
- **CI** : `npm run db:check` bloque les migrations destructives non justifiées, l'image est construite.

## Décisions structurantes

| Décision                    | Raison                                                                                                                    | Conséquence / à valider                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Next.js monolithe modulaire | Une seule base de code, cohérent avec Payload CMS (Next.js), déploiement simple sur Coolify                               | Si une API publique est nécessaire (portail client, webhooks), elle passe par `src/app/api`                                |
| PostgreSQL + Drizzle        | SQL explicite, migrations relisibles, typage complet                                                                      | Migrations à relire avant commit                                                                                           |
| better-auth                 | Bibliothèque maintenue (hachage scrypt, sessions, limitation de débit, CSRF) plutôt que du code maison                    | Usurpation d'identité et suppression de comptes désactivées par configuration                                              |
| Cinq rôles                  | `admin`, `member`, `contractor`, `viewer`, `client`, chacun filtré dans les services                                      | Matrice dans `permissions.ts`, voir `docs/domain-model.md` §5                                                              |
| Socle CRM : Twenty          | Maître des organisations, contacts, opportunités et activités ; écritures via son API, projection locale par `twenty_id`  | Détail dans `docs/domain-model.md` (A1) et `docs/integrations/twenty.md`. Lecture directe exclue : 100 requêtes par minute |
| Portail client              | Même identité (better-auth), rôle `client`, cloisonnement par `portal_memberships` et `PortalContext`                     | Routes `/espace/*`, services `src/modules/portal`. Voir `docs/domain-model.md` §5                                          |
| Versions des dépendances    | Figées, publiées depuis au moins 14 jours ; TS 6 et ESLint 9 (TS 7 / ESLint 10 pas encore supportés par l'outillage Next) | ESLint 9 n'est plus maintenu : migrer quand `eslint-config-next` supportera ESLint 10                                      |

## Sécurité

**En place** : inscription publique désactivée ; mots de passe de 12 caractères minimum
(hachage scrypt) ; sessions en base révocables (expiration glissante de 7 jours) ; cookie
`HttpOnly` ; contrôle d'origine (CSRF) ; limitation de débit sur l'authentification ;
CSP stricte à nonce et en-têtes de sécurité ; redirections internes uniquement après connexion ;
erreurs internes jamais exposées ; logs sans secrets (paramètres SQL exclus) ; journal
d'audit transactionnel ; image Docker non privilégiée ; build sans aucun secret.

**À valider (RSSI / DPO)** :

- Durée de session et politique de mot de passe. La double authentification est en place, exigée
  par défaut en production.
- **Conservation** du journal d'audit et des données de session (IP, user-agent).
- **Chaîne CI** : la politique impose Gitleaks et SBOM/Grype avec exceptions validées par le RSSI.
  Le workflow GitHub fourni ne couvre que la qualité (lint, types, tests, build) : intégration
  de ces contrôles à décider (template `devsecops.yml` si le dépôt passe sur Azure DevOps).
- **Vulnérabilités connues** (`npm audit`, niveau modéré, outillage de dev uniquement) :
  `drizzle-kit` embarque un esbuild ancien (GHSA-67mh-4wv8-2f99, serveur de dev esbuild
  non utilisé ici) ; `minimatch` via ESLint (GHSA-g3hv-75wg-m249). Aucune dans le code
  exécuté en production.
- **Scripts d'installation npm** non approuvés (esbuild, unrs-resolver) : le projet fonctionne
  sans eux ; ne les approuver qu'après revue.
- Limitation de débit en mémoire : suffisante pour une instance ; à passer en base si
  plusieurs instances.
