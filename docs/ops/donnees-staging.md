# Données fictives de staging

Remplit la base **staging** avec plusieurs centaines à plusieurs milliers de lignes cohérentes,
pour essayer l'application sur des volumes réalistes. Ce n'est pas le seed de développement
(`npm run db:seed`, comptes de démonstration, base locale) : celui-ci ne crée **aucun compte**.

- Source : `scripts/db-seed-staging.ts`, `scripts/lib/staging-seed/` (`guard.ts`, `generate.ts`,
  `apply.ts`). Tests : `tests/integration/staging-seed.test.ts`.
- Dans l'image : `cli/db-seed-staging.mjs`, bundle autonome produit par `npm run build:cli`
  (Faker compris, locale française seulement). Aucune dépendance à installer dans le conteneur.
- Jamais lancé au démarrage : ni `server.js`, ni `instrumentation.ts`, ni le `Dockerfile` ne
  l'appellent. Il ne tourne que sur commande.

## Garde-fous

Le script refuse de tourner, avant toute écriture, sauf si **toutes** ces conditions sont réunies :

1. `SEED_ALLOWED` vaut exactement `true` (`1`, `yes`, `TRUE` sont refusés).
2. `DATABASE_URL` désigne la base `nuera_os_staging`, à la lettre, sans paramètre `dbname`,
   `database` ni `options` qui pourrait en changer.
3. Une fois connecté, PostgreSQL confirme `current_database() = 'nuera_os_staging'` (protège d'un
   alias, d'un pooler ou d'une URL trompeuse).

`NODE_ENV` n'est **pas** consulté : l'image de staging tourne en `production`. La base de
production `nuera_os` est donc refusée par son nom, quel que soit l'environnement.

Ce qui n'est jamais touché :

- la table `users` (ni lecture, ni écriture) : aucun compte n'est créé, modifié ou supprimé ;
- toute ligne existante : rien n'est supprimé, et une ligne déjà présente n'est pas réécrite. Les
  seules mises à jour portent sur des lignes insérées par le même passage (version courante d'un
  devis, facture principale d'une échéance) ;
- Twenty, DocuSeal, SMTP et les autres services : aucun appel réseau hors PostgreSQL.

## Ce qui est généré

Pour chaque entreprise fictive, un dossier complet et cohérent, selon son statut (prospect,
client, abonné, ancien client, partenaire) :

| Domaine        | Tables                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------- |
| Équipe         | `team_members` (6 membres sans compte), `member_absences`                                    |
| Offres         | `catalog_items` (9 offres)                                                                   |
| CRM            | `companies`, `contacts`, `opportunities`, `opportunity_stage_history`, `activities`          |
| Devis          | `quotes`, `quote_versions`, `quote_lines` (négociation en deux versions, remise)             |
| Projets        | `projects`, `project_phases`, `project_members`, `tasks`                                     |
| Temps et coûts | `time_entries` (coût horaire figé du membre), `direct_costs`                                 |
| Finances       | `payment_schedule_items` (acompte, solde), `financial_documents` (payées, émises, en retard) |
| Agenda         | `appointments` (découverte, lancement, points d'avancement, passés et à venir)               |
| Support        | `tickets`, `ticket_messages` (dont notes internes), `ticket_events`                          |

Volume indicatif avec `--volume medium` (80 entreprises) : environ 4 500 lignes, dont
~150 contacts, ~65 devis, ~50 projets, ~700 tâches, ~1 300 saisies de temps et ~130 factures.
`--volume large` (200 entreprises) : environ 11 500 lignes. Durée : quelques secondes.

Repères pour reconnaître ces données :

- chaque entreprise porte l'étiquette `données-fictives` ;
- les `twenty_id` commencent par `seed-staging-` : la réconciliation Twenty les ignore, et une
  modification CRM sur ces fiches échoue honnêtement (elles n'existent pas dans Twenty) ;
- domaines et e-mails en `.example`, téléphones dans les plages réservées à la fiction par
  l'ARCEP (`01 99 00 …`, `06 39 98 …`), SIREN en `8xxxxxxxx` : aucun message ne peut atteindre
  une vraie personne ;
- factures de source `manual`, référence `STG-…` ;
- numéros de devis, projets, tâches et tickets tirés des compteurs de l'application
  (`sequences`) : un document créé ensuite à la main suit sans collision ;
- une entrée « Jeu de données fictives chargé » dans le journal d'audit, avec la graine et le
  nombre de lignes.

## Options

| Option                          | Effet                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `--volume small\|medium\|large` | 25, 80 ou 200 entreprises. Défaut : `medium`                                      |
| `--companies <n>`               | Nombre exact d'entreprises, de 1 à 1000. Prioritaire sur `--volume`               |
| `--seed <n>`                    | Graine Faker. Défaut : `20261105`                                                 |
| `--reference-date AAAA-MM-JJ`   | Date autour de laquelle s'étale l'historique. Défaut : aujourd'hui                |
| `--dry-run`                     | Insère dans une transaction **annulée** et affiche les comptes : rien n'est écrit |
| `--help`                        | Aide                                                                              |

Reproductibilité et doublons :

- même graine et même date de référence : exactement les mêmes lignes, aux mêmes identifiants ;
- relancer la même commande n'ajoute **rien** (« Déjà en place : rien à ajouter ») ;
- augmenter le volume avec la même graine ajoute seulement les nouveaux dossiers ; le réduire ne
  supprime rien ;
- une autre graine ajoute un **autre** jeu d'entreprises, à côté du premier (l'équipe et le
  catalogue fictifs restent communs) ;
- l'historique est calculé autour de la date de référence au moment de l'insertion : passer
  `--reference-date` pour obtenir les mêmes dates d'un jour à l'autre ;
- un verrou consultatif PostgreSQL empêche deux exécutions simultanées, et tout se passe dans une
  seule transaction : en cas d'erreur, rien n'est écrit.

## Exécution dans Coolify

Prérequis : l'application **staging** est déployée depuis la branche `staging` (l'image contient
alors `cli/db-seed-staging.mjs`) et ses migrations sont appliquées (`db.migrations_applied` dans
les logs, ou `node cli/db-migrate.mjs`).

1. Vérifier le nom de la base : ressource PostgreSQL **staging** → **General** → la
   **Postgres URL (internal)** doit se terminer par `/nuera_os_staging`, et la variable
   `DATABASE_URL` de l'application staging doit être cette URL. Si la base porte un autre nom,
   le script refuse : la renommer ou en créer une sous ce nom, jamais contourner le contrôle.
2. Faire une sauvegarde de la base staging (onglet **Backups** → **Backup now**). Le script
   n'efface rien, mais c'est le seul moyen de revenir à l'état précédent.
3. Ouvrir l'application **staging** (jamais la production) → onglet **Terminal** → choisir le
   conteneur applicatif.
4. Essai à blanc, recommandé :

   ```sh
   SEED_ALLOWED=true node cli/db-seed-staging.mjs --volume medium --dry-run
   ```

5. Exécution :

   ```sh
   SEED_ALLOWED=true node cli/db-seed-staging.mjs --volume medium
   ```

   Autres exemples :

   ```sh
   SEED_ALLOWED=true node cli/db-seed-staging.mjs --companies 300 --seed 42
   SEED_ALLOWED=true node cli/db-seed-staging.mjs --volume small --reference-date 2026-11-01
   ```

6. Contrôler la sortie : un tableau « prévues / insérées » par table, puis le total. Dans
   l'application, filtrer les clients sur l'étiquette `données-fictives`.

`SEED_ALLOWED=true` est passé **dans la commande**, pour cette seule exécution. Ne pas l'ajouter
aux variables d'environnement de l'application ; si on le fait quand même, uniquement sur
staging, et le retirer ensuite. Ne jamais le définir sur la production : même là, le nom de la
base `nuera_os` ferait refuser l'exécution.

Le script lit la même configuration que l'application (`getEnv()`) : `DATABASE_URL`,
`BETTER_AUTH_SECRET` et `BETTER_AUTH_URL` doivent être valides, ce qui est le cas dans un
conteneur sain.

Messages de refus courants :

| Message                                        | Cause et correction                                                |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `SEED_ALLOWED doit valoir exactement « true »` | Préfixer la commande par `SEED_ALLOWED=true`                       |
| `Base « nuera_os » refusée`                    | Terminal ouvert sur la production : s'arrêter là                   |
| `Base « postgres » refusée` (ou autre nom)     | `DATABASE_URL` de staging ne vise pas `nuera_os_staging`           |
| `Connecté à « … »`                             | L'URL annonce `nuera_os_staging` mais le serveur en sert une autre |
| `relation "…" does not exist`                  | Migrations non appliquées : `node cli/db-migrate.mjs`              |

## Retirer les données

Le script ne supprime jamais rien. Pour repartir d'une base staging propre, restaurer la
sauvegarde prise à l'étape 2 (voir `docs/ops/sauvegarde-restauration.md`). Une suppression
sélective à la main est déconseillée : les clés étrangères en `RESTRICT` imposent l'ordre inverse
de l'insertion, et des lignes créées depuis dans l'interface peuvent pointer vers ces fiches.

## En local

Avec une base locale nommée `nuera_os_staging` :

```sh
SEED_ALLOWED=true DATABASE_URL=postgres://nuera:<mdp>@127.0.0.1:5432/nuera_os_staging \
  npm run db:seed:staging -- --volume small
```
