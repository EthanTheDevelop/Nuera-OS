# Déploiement sur Coolify

Ce document décrit la configuration des deux applications Coolify de Nuera OS.
**Aucun déploiement n'est déclenché par le dépôt** : Coolify construit et lance l'image
lui-même, à partir de la branche configurée.

## Vue d'ensemble

| Élément              | Production                         | Staging                             |
| -------------------- | ---------------------------------- | ----------------------------------- |
| Serveur              | `NUERA-PROD-01` (VPS OVH)          | `NUERA-PROD-01` (VPS OVH)           |
| Branche Git          | `main`                             | `staging`                           |
| Application Coolify  | `nuera-os-production`              | `nuera-os-staging`                  |
| Base PostgreSQL 17   | ressource Coolify existante (prod) | ressource Coolify existante (stg)   |
| Domaine (exemple)    | `https://os.nuera.studio`          | `https://staging.os.nuera.studio`   |
| `BETTER_AUTH_SECRET` | secret propre à la production      | secret propre au staging, différent |

```
Internet ──HTTPS──▶ Proxy Coolify (Traefik/Caddy, TLS Let's Encrypt)
                        │ HTTP, réseau Docker « coolify »
                        ▼
              Conteneur Nuera OS :3000  ──TCP 5432──▶  PostgreSQL 17 (ressource Coolify)
```

- **Un seul service applicatif** (Next.js standalone) : un `Dockerfile` multi-stage suffit,
  aucun Compose de production n'est nécessaire. `docker-compose.yml` reste réservé au
  PostgreSQL de développement local et **ne doit pas** être utilisé par Coolify.
- **Aucune base n'est créée par le déploiement** : l'application se connecte uniquement à la
  base désignée par `DATABASE_URL` et y applique les migrations versionnées (`drizzle/`).
- Sessions et données métier sont en base. **Seuls les documents déposés sont sur disque** :
  un volume persistant monté sur `/data/storage` (`STORAGE_DIR`, voir § 6).

## Image Docker

`Dockerfile` (racine), trois étapes :

1. `deps` : `npm ci` (dépendances figées par `package-lock.json`).
2. `builder` : `npm run build` (Next.js `standalone`) puis `npm run build:cli`
   (outils d'exploitation autonomes, voir plus bas). **Aucun secret requis.**
3. `runner` : `node:24-alpine`, utilisateur non privilégié `nextjs` (uid 1001),
   `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0`, `HEALTHCHECK` sur `/api/health`,
   commande `node server.js`.

Contenu de `/app` dans l'image : `server.js` (serveur Next.js), `.next/static`, `public/`,
`drizzle/` (migrations SQL) et `cli/` (`db-migrate.mjs`, `user-create.mjs`,
`db-seed-staging.mjs`). `/data/storage`
appartient à `nextjs`, pour accueillir le volume des documents.

### Comportement au démarrage

1. Validation de la configuration (`src/server/config/env.ts`). Variable manquante ou
   invalide → message explicite (sans la valeur) et **arrêt du conteneur (code 1)**.
2. Si `DB_MIGRATE_ON_START=true` : application des migrations en attente sous verrou
   consultatif PostgreSQL. Échec → **arrêt du conteneur (code 1)**.
3. Serveur prêt (`startup.ready` dans les logs).

Comme le nouveau conteneur ne devient jamais sain en cas d'erreur, Coolify conserve
l'ancien conteneur en service (mise à jour progressive, voir § Healthcheck).

## Configuration Coolify — pas à pas

À faire **deux fois**, une par application. Seules les valeurs marquées ⚠ diffèrent.

### 1. Créer la ressource

1. Projet Coolify (ex. `Nuera OS`) → environnement `production` (puis `staging`)
   → **+ New** → **Private Repository (with GitHub App)**.
2. Dépôt : `ethanthedevelop/nuera-os`.
3. ⚠ **Branch** : `main` (production) / `staging` (staging).
4. **Build Pack** : `Dockerfile`.
5. Serveur / **Destination** : `NUERA-PROD-01`, **même destination (réseau Docker) que la
   ressource PostgreSQL correspondante** — par défaut le réseau `coolify`.

### 2. Onglet « General »

| Champ                           | Valeur                                                          |
| ------------------------------- | --------------------------------------------------------------- |
| Name                            | ⚠ `nuera-os-production` / `nuera-os-staging`                    |
| Build Pack                      | `Dockerfile`                                                    |
| Base Directory                  | `/`                                                             |
| Dockerfile Location             | `/Dockerfile`                                                   |
| Docker Build Stage Target       | `runner` (ou vide : dernière étape)                             |
| Custom Docker Options           | vide                                                            |
| Domains                         | ⚠ `https://os.nuera.studio` / `https://staging.os.nuera.studio` |
| Direction                       | `Redirect to non-www`                                           |
| Ports Exposes                   | `3000`                                                          |
| Ports Mappings                  | **vide** (jamais de port publié sur l'hôte)                     |
| Install / Build / Start Command | non applicables (Build Pack Dockerfile) — laisser vides         |
| Pre-deployment command          | vide                                                            |
| Post-deployment command         | vide                                                            |

- Le domaine se saisit **avec `https://` et sans port** : le proxy Coolify obtient le
  certificat Let's Encrypt, redirige HTTP → HTTPS et route vers le port exposé `3000`.
  Le DNS (enregistrement A/AAAA) doit pointer vers `NUERA-PROD-01` avant le premier
  déploiement.
- Ne **pas** renseigner de « Ports Mappings » ni de nom de conteneur personnalisé : cela
  exposerait l'application sans TLS et désactiverait la mise à jour progressive.

### 3. Onglet « Environment Variables »

Pour **chaque** variable : décocher **Build Variable / Available at Buildtime** (le build
n'a besoin d'aucune variable et un secret passé au build peut fuir dans l'image), laisser
**Available at Runtime** coché. Cocher **Is Literal** pour `DATABASE_URL` et
`BETTER_AUTH_SECRET` (évite toute interprétation des caractères `$`).

| Variable              | Obligatoire | Valeur                                                                                                      |
| --------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | oui         | ⚠ URL **interne** de la ressource PostgreSQL de l'environnement (voir § Réseau)                             |
| `BETTER_AUTH_SECRET`  | oui         | ⚠ secret aléatoire ≥ 32 caractères, **différent** entre production et staging                               |
| `BETTER_AUTH_URL`     | oui         | ⚠ URL publique exacte, identique au domaine : `https://os.nuera.studio` / `https://staging.os.nuera.studio` |
| `DB_MIGRATE_ON_START` | oui         | `true`                                                                                                      |
| `LOG_LEVEL`           | non         | `info` (production) / `debug` possible en staging                                                           |
| `DATABASE_POOL_MAX`   | non         | `10` par défaut (1 à 100) ; rester sous `max_connections` de la base                                        |
| `STORAGE_DIR`         | non         | `/data/storage`, avec le volume du § 6. Absente : documents en « connexion requise »                        |
| `JOBS_SECRET`         | non         | Secret des tâches planifiées, ≥ 32 caractères. Absente : `/api/jobs/*` répond 404                           |

Intégrations, toutes facultatives. Sans elles, l'écran concerné affiche « connexion requise ».
Chaque variable est décrite dans `.env.example` :

| Variables                                                                          | Rôle                                               |
| ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `STORAGE_MAX_UPLOAD_MB`                                                            | Taille maximale d'un document déposé               |
| `TWENTY_API_URL`, `TWENTY_API_KEY`, `TWENTY_WEBHOOK_SECRET`                        | CRM Twenty : API et signature du webhook           |
| `COOLIFY_API_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_WEBHOOK_SECRET`                   | État et déclenchement des déploiements des sites   |
| `UPTIME_KUMA_URL`, `UPTIME_KUMA_STATUS_SLUG`, `UPTIME_KUMA_WEBHOOK_SECRET`         | Supervision des sites                              |
| `DOCUSEAL_API_URL`, `DOCUSEAL_API_KEY`, `DOCUSEAL_WEBHOOK_SECRET`                  | Signature des devis                                |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`                                | Réponses suggérées                                 |
| `CAL_WEBHOOK_SECRET`                                                               | Rendez-vous par webhook Cal.diy ou Cal.com         |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | E-mails sortants, dont les liens du portail client |
| `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `N8N_WEBHOOK_HEADER_TOKEN`                | Relais d'événements vers et depuis n8n             |

Générer un secret (à faire séparément pour chaque environnement) :

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
# ou : openssl rand -base64 32
```

À **ne pas** définir : `NODE_ENV`, `PORT`, `HOSTNAME` (fixés par l'image ; un
`NODE_ENV=production` disponible au build ferait échouer `npm ci`), `POSTGRES_PASSWORD`
(uniquement pour le Compose local).

`BETTER_AUTH_URL` sert d'origine de confiance (protection CSRF) et détermine des cookies
`Secure` (`__Secure-nuera.session_token`) : il doit correspondre **exactement** au domaine
servi, sinon les connexions sont refusées (`Invalid origin`).

### 4. Réseau et base de données

1. Ouvrir la ressource PostgreSQL de l'environnement → **General** → copier
   **Postgres URL (internal)**, de la forme
   `postgres://<utilisateur>:<mot-de-passe>@<uuid-ressource>:5432/<base>`.
   Le nom d'hôte est le nom du conteneur sur le réseau Docker de Coolify.
2. La coller dans `DATABASE_URL` de l'application **du même environnement**
   (production ↔ base de production, staging ↔ base de staging — ne jamais croiser).
3. L'application et la base doivent être sur la **même destination** (réseau `coolify`
   de `NUERA-PROD-01`). Sinon : option **Connect to Predefined Network** de l'application.
4. Laisser **Make it publicly available** **désactivé** sur les bases : aucun port
   PostgreSQL ne doit être exposé sur Internet.
5. Caractères spéciaux dans le mot de passe : ils doivent être encodés en URL
   (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`…). L'URL fournie par Coolify l'est déjà.
6. Droits requis pour l'utilisateur de la base : connexion, `CREATE` sur la base (création
   du schéma `drizzle` de suivi des migrations au premier démarrage) et droits complets sur
   le schéma `public`. Aucune extension ni droit superutilisateur n'est nécessaire.

> Les deux bases étant sur le même réseau Docker, l'isolation entre staging et production
> repose sur des identifiants distincts : utiliser un utilisateur et un mot de passe
> différents pour chaque base.

### 5. Healthcheck

L'image définit un `HEALTHCHECK` Docker. Le configurer aussi explicitement dans Coolify
(onglet **Healthcheck**, activé) :

| Champ        | Valeur        |
| ------------ | ------------- |
| Method       | `GET`         |
| Scheme       | `http`        |
| Host         | `127.0.0.1`   |
| Port         | `3000`        |
| Path         | `/api/health` |
| Return Code  | `200`         |
| Interval     | `30` s        |
| Timeout      | `5` s         |
| Retries      | `3`           |
| Start Period | `40` s        |

Écrire `127.0.0.1` : dans l'image, `http://localhost:3000` répond « connexion refusée » (constaté
avec `wget`, le serveur n'écoutant qu'en IPv4). `/api/health/ready` applique le même contrôle, pour
une supervision externe.

`/api/health` répond `200 {"status":"ok"}` si le serveur répond **et** si PostgreSQL
répond en moins de 2 s, sinon `503 {"status":"unavailable"}`. Aucune information interne
n'est exposée et la route ne demande pas d'authentification.

Avec un healthcheck actif et sans port publié, Coolify effectue une **mise à jour
progressive** : le nouveau conteneur démarre, doit devenir sain, puis l'ancien est arrêté.
Un déploiement cassé (configuration, migration, base injoignable) laisse donc l'ancienne
version en service.

### 6. Autres réglages

- **Persistent Storage** : un volume (Volume Mount), destination `/data/storage`, et
  `STORAGE_DIR=/data/storage`. Un volume neuf hérite du propriétaire de l'image. Un montage de
  dossier hôte (Bind Mount) doit appartenir à l'uid 1001. Sauvegarde et restauration :
  [docs/ops/sauvegarde-restauration.md](ops/sauvegarde-restauration.md).
- **Resource Limits** (recommandé) : mémoire 1 Go en production, 512 Mo en staging.
- **Auto Deploy** (webhook GitHub) : au choix de l'équipe. Recommandation : activé pour
  `staging`, manuel pour `main` (sauvegarde préalable, voir § Migrations).
- **Watch Paths** : vide (tout changement peut affecter l'image).
- **Instances** : une seule par environnement (limitation de débit de l'authentification
  en mémoire et documents sur un volume local ; à revoir avant toute mise à l'échelle horizontale).
- **Logs** : JSON une ligne par événement (`event`, `level`, `time`), sans secrets.

### 7. Premier déploiement

1. Vérifier sur chaque base cible qu'elle est **vide** ou ne contient que des objets créés
   par ces migrations (les tables de `drizzle/*.sql` et le schéma `drizzle`). Si des tables du
   même nom existent déjà, la première migration
   échoue proprement (transaction annulée, rien n'est modifié) et le conteneur s'arrête.
2. Activer les **sauvegardes planifiées** sur la ressource PostgreSQL de production
   (onglet **Backups**) et faire une sauvegarde manuelle. La sauvegarde hors du serveur, base et
   documents, se met en place à part : [docs/ops/sauvegarde-restauration.md](ops/sauvegarde-restauration.md).
3. Déployer **staging** en premier, vérifier dans les logs `db.migrations_applied` puis
   `startup.ready`, et `https://staging.os.nuera.studio/api/health`.
4. Créer le premier administrateur (onglet **Terminal** de l'application, conteneur
   applicatif) :

   ```sh
   node cli/user-create.mjs --email prenom.nom@nuera.studio --name "Prénom Nom" --role admin
   ```

   Le mot de passe (12 caractères minimum) est demandé sans écho. L'inscription publique
   est désactivée : c'est le seul moyen de créer le premier compte. Ce bundle est compilé depuis
   `scripts/user-create.ts`.

5. Activer la double authentification de ce compte (voir § 8), puis planifier les tâches (§ 9).
6. Facultatif, **staging seulement** : charger des données fictives en volume avec
   `SEED_ALLOWED=true node cli/db-seed-staging.mjs --volume medium` (Terminal de l'application
   staging). Refusé sur toute base autre que `nuera_os_staging`. Procédure complète :
   [docs/ops/donnees-staging.md](ops/donnees-staging.md).
7. Répéter pour la production, sans l'étape 6.

### 8. Double authentification

En production, elle est exigée par défaut. Un compte de l'équipe qui ne l'a pas encore est renvoyé
vers `/profil` à la connexion et ne voit aucune donnée tant qu'il ne l'a pas activée : le premier
administrateur commence donc par là. Le réglage se change dans Administration, et un associé sans
double authentification ne peut pas l'exiger. Les clients du portail se connectent par lien, sans
mot de passe.

### 9. Tâches planifiées

Définir `JOBS_SECRET`, puis créer une « Scheduled Task » par ligne du tableau de
[docs/ops/jobs.md](ops/jobs.md) : la commande avec `wget` et son cron. Les secrets des webhooks
entrants y sont aussi listés.

### 10. Twenty

Service distinct, facultatif : sans lui, le CRM affiche « connexion requise ».

- **Version figée : `twentycrm/twenty:v2.55.0`**, serveur et worker, avec sa propre base PostgreSQL et son Redis.
  Ne pas monter de version sans `npm run test:live` ([docs/integrations/twenty.md](integrations/twenty.md)).
- `docker-compose.twenty.yml` décrit cet assemblage **pour le développement** : il sert de modèle,
  avec en production `SERVER_URL`, `PG_DATABASE_URL`, `REDIS_URL`, `STORAGE_TYPE`, `APP_SECRET`,
  `ENCRYPTION_KEY` et un volume de stockage. Le déploiement sur Coolify n'a pas encore été exercé,
  pas plus que les migrations automatiques de Twenty en production.
- Créer une clé d'API dans Twenty, puis lancer `npm run twenty:bootstrap` depuis une copie du dépôt, avec
  `TWENTY_API_URL` et `TWENTY_API_KEY` en variables d'environnement. Le script ne crée aucun compte sur
  une autre instance que la locale. L'option `--webhook-url=<domaine>/api/webhooks/twenty` crée le webhook.
- Reporter `TWENTY_API_URL`, `TWENTY_API_KEY` et `TWENTY_WEBHOOK_SECRET` dans l'application Coolify, et
  planifier `crm-reconcile` : le webhook seul ne suffit pas.

Étapes d'opportunité appliquées par le bootstrap :

| Étape Nuera  | Valeur        | Étape d'origine renommée |
| ------------ | ------------- | ------------------------ |
| Nouveau      | `NEW`         | `NEW`                    |
| Qualifié     | `QUALIFIED`   | `SCREENING`              |
| Devis envoyé | `QUOTE_SENT`  | `PROPOSAL`               |
| Négociation  | `NEGOTIATION` | `MEETING`                |
| Gagné        | `WON`         | `CUSTOMER`               |
| Perdu        | `LOST`        | aucune                   |

Les étapes renommées migrent les dossiers. Une étape inconnue encore utilisée arrête le script sans
rien modifier.

## Migrations

### Fonctionnement

- Les migrations sont des fichiers SQL versionnés dans `drizzle/`, générés par
  `npm run db:generate` puis **relus** et commités.
- Au démarrage (`DB_MIGRATE_ON_START=true`), le migrateur Drizzle applique **uniquement les
  migrations absentes** de la table `drizzle.__drizzle_migrations`, dans une seule
  transaction, sous verrou consultatif PostgreSQL (`pg_advisory_lock`) : deux conteneurs ne
  migrent jamais en même temps, et une migration en échec est entièrement annulée.
- Aucune commande ne réinitialise, ne vide ni ne recrée la base. Il n'y a pas de
  migration descendante automatique.
- Migration manuelle (diagnostic, ou si `DB_MIGRATE_ON_START=false`) depuis le Terminal
  Coolify : `node cli/db-migrate.mjs` (idempotent).

### Règles

1. **Jamais** `drizzle-kit push`, `drizzle-kit drop`, ni modification ou suppression d'une
   migration déjà appliquée, ni suppression du schéma `drizzle`.
2. **Compatibilité ascendante (expand / contract)** : pendant la mise à jour progressive,
   l'ancienne version tourne encore sur le nouveau schéma. Une migration doit donc rester
   compatible avec la version précédente du code :
   - ajouter une colonne : nullable ou avec valeur par défaut ;
   - renommer / changer un type : nouvelle colonne → double écriture et recopie → bascule
     du code → suppression de l'ancienne colonne dans une **version ultérieure** ;
   - supprimer : d'abord retirer tout usage dans le code (déployé), puis supprimer.
3. `npm run db:check` (exécuté par la CI) vérifie que les migrations correspondent au schéma
   et **bloque** les instructions destructives (`DROP`, `TRUNCATE`, `DELETE FROM`,
   `RENAME`, changement de type, `SET NOT NULL`). Une telle instruction, si elle est
   réellement voulue, doit être justifiée dans le fichier par une ligne
   `-- migration-destructive: <raison et sauvegarde vérifiée>` et relue en revue.
4. Index sur une grosse table : préférer `CREATE INDEX CONCURRENTLY` dans une migration
   dédiée (hors transaction) pour ne pas bloquer les écritures.

### Procédure de mise en production

1. Branche de fonctionnalité → PR vers `staging` (CI verte, SQL relu).
2. Déploiement de staging → vérification des logs (`db.migrations_applied`) et de
   l'application.
3. **Sauvegarde manuelle de la base de production** (Coolify → ressource PostgreSQL →
   Backups → Backup Now) si la version contient une migration.
4. PR `staging` → `main`, puis déploiement de la production.
5. Retour arrière : redéployer l'image précédente (onglet **Rollback** de Coolify). Sûr
   tant que les migrations respectent la règle 2 ; sinon, restaurer la sauvegarde de
   l'étape 3 (opération manuelle, à décider explicitement).

## Vérifications locales de l'image

Vérifié le 5 novembre 2026 sur des conteneurs jetables, à partir de la branche `feat/create-nuera-os` :
Node 24.22.2, uid 1001, migrations appliquées au démarrage, `/api/health` et `/api/health/ready` à 200 puis
503 base arrêtée, arrêt en code 1 sur configuration invalide ou migration en échec, premier compte
créé par `cli/user-create.mjs`, renvoi vers `/profil` sans double authentification, dépôt et relecture d'un
document sur le volume, tâche planifiée par `wget`, données et fichiers intacts après redémarrage et
après recréation des conteneurs. Rien n'a été vérifié sur Coolify ni sur le serveur réel.

```bash
docker build -t nuera-os:local .
docker compose up -d   # PostgreSQL de développement, publié sur 127.0.0.1:5432
docker run --rm --network host \
  -e DATABASE_URL="postgres://nuera:<mot-de-passe-local>@127.0.0.1:5432/nuera_os" \
  -e BETTER_AUTH_SECRET="<32 caractères minimum>" \
  -e BETTER_AUTH_URL="http://localhost:3000" \
  -e DB_MIGRATE_ON_START=true \
  nuera-os:local
curl -i http://localhost:3000/api/health
```

`--network host` est nécessaire sous Linux car le Compose local ne publie PostgreSQL que
sur `127.0.0.1` de l'hôte.

## Dépannage

| Symptôme (logs)                                               | Cause probable / action                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `startup.invalid_configuration`                               | Variable manquante/invalide (le nom est indiqué, jamais la valeur) ; vérifier « Available at Runtime » |
| `startup.migrations_failed`, `password authentication failed` | `DATABASE_URL` erronée ou mot de passe non encodé                                                      |
| `startup.migrations_failed`, `getaddrinfo ENOTFOUND`          | Application et base sur des réseaux différents (§ Réseau)                                              |
| `startup.migrations_failed`, `already exists`                 | Base non vide (§ Premier déploiement) — ne rien supprimer sans décision explicite                      |
| `Invalid origin` à la connexion                               | `BETTER_AUTH_URL` différent du domaine réellement servi                                                |
| Conteneur « unhealthy », `health.database_unavailable`        | Base arrêtée ou saturée (`DATABASE_POOL_MAX`, `max_connections`)                                       |
| `npm ci` échoue au build                                      | Variable `NODE_ENV` (ou autre) cochée « Build Variable » : la décocher                                 |
