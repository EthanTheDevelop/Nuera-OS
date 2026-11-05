# Sauvegarde et restauration

Deux contenus à protéger, à sauvegarder ensemble : la base PostgreSQL et le volume des documents (`STORAGE_DIR`). L'un sans l'autre laisse des fiches sans fichier, ou des fichiers sans fiche.

Les « Backups » de la ressource PostgreSQL dans Coolify ([guide de déploiement](../deployment-coolify.md)) restent la sauvegarde rapide d'avant migration. Ils ne couvrent pas le volume des documents : c'est le rôle de `scripts/backup.sh`.

## Ce que fait `scripts/backup.sh`

1. `pg_dump` au format personnalisé, avec le nombre de lignes de chaque table.
2. Archive du dossier des fichiers et empreinte SHA-256 de chacun, sauf `.tmp` (dépôts en cours).
3. `SHA256SUMS` sur l'ensemble, puis copie par rclone hors du serveur.
4. Relecture de la copie distante (`rclone check --download`), purge distante, purge locale.
5. Appel de la sonde de surveillance, seulement après un succès complet.

Le script refuse une base sans table, un dossier de fichiers vide (`--allow-empty-files` sur une installation neuve), une exécution concurrente, et l'absence de destination distante sauf `--local-only` explicite.

## Variables

| Variable                       | Rôle                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| `BACKUP_PG_CONTAINER`          | Conteneur PostgreSQL local, utilisé par `docker exec`. Mode conseillé      |
| `DATABASE_URL`                 | Sinon, `pg_dump` et `psql` du `PATH`, de version au moins égale au serveur |
| `BACKUP_WORK_DIR`              | Dossier local des sauvegardes                                              |
| `BACKUP_STORAGE_DIR`           | Dossier des fichiers, chemin vu par le script                              |
| `BACKUP_REMOTE`                | Destination rclone hors du VPS                                             |
| `BACKUP_NAME`                  | Sous-dossier, `nuera-os` par défaut                                        |
| `BACKUP_REMOTE_RETENTION_DAYS` | Purge distante, 30 jours par défaut, 0 pour ne rien purger                 |
| `BACKUP_LOCAL_KEEP`            | Sauvegardes gardées sur le serveur, 3 par défaut                           |
| `BACKUP_HEARTBEAT_URL`         | Sonde « push » d'Uptime Kuma, appelée après un succès complet              |

## Mise en place sur le serveur

À faire par le responsable, avec ses accès. Prérequis sur l'hôte : `docker`, `rclone`, `sha256sum`, `tar`.

1. Créer une destination rclone hors du VPS, **chiffrée** (`rclone config`, type `crypt` au-dessus d'un stockage objet). Conserver la clé de chiffrement hors du serveur : sans elle, la sauvegarde est perdue.
2. Trouver le conteneur PostgreSQL et le chemin hôte du volume de l'application (`docker volume inspect`, champ `Mountpoint`).
3. Écrire les variables dans un fichier réservé à root, par exemple `/etc/nuera-os-backup.env`, en `export VARIABLE=…`.
4. Lancer une première fois à la main, vérifier la destination, puis planifier dans la crontab de root :

```cron
30 2 * * * . /etc/nuera-os-backup.env && sh /opt/nuera-os/scripts/backup.sh >> /var/log/nuera-os-backup.log 2>&1
```

Le nom du conteneur Coolify peut changer à un redéploiement de la ressource : le relire si la sonde se tait.

Twenty : même script, avec `BACKUP_NAME=twenty`, le conteneur de sa base et son volume de stockage.

## Restaurer

`scripts/restore.sh` **remplace** la base et les fichiers de la cible. Il contrôle les empreintes, rejoue la base dans une seule transaction, contrôle chaque fichier avant de vider le dossier cible, puis compare les lignes et les fichiers.

```sh
# Arrêter l'application dans Coolify, puis :
. /etc/nuera-os-backup.env
sh scripts/restore.sh --from-remote latest --verify-only          # archive saine ? aucune écriture
sh scripts/restore.sh --from-remote latest --confirm <nom_de_la_base>
# Relancer l'application : les migrations manquantes s'appliquent au démarrage.
```

`--from <dossier>` lit une sauvegarde locale, `--from-remote <horodatage>` une sauvegarde précise. Sans `--confirm` et le nom exact de la base visée, rien n'est écrit.

- Lancer le script en root pour restaurer sur un volume : la propriété des fichiers (uid 1001) et de la racine du dossier est alors conservée. Sinon l'application lit les fichiers, mais ne peut plus en déposer.
- L'utilisateur de la base doit pouvoir supprimer et recréer les schémas.
- Si un fichier extrait n'est pas conforme, la base est déjà restaurée, le dossier de fichiers reste intact et le script s'arrête en erreur : relancer avec une autre sauvegarde.
- Un écart de lignes est signalé sans faire échouer le script : le comptage suit le `pg_dump`, une écriture peut s'être glissée entre les deux. Sans écriture à ce moment-là, un écart est anormal : ne pas relancer l'application sans l'expliquer.

Faire une restauration d'essai sur une base et un dossier jetables au moins une fois par trimestre.

## Ce qui a été vérifié

Le 5 novembre 2026, sur des conteneurs, volumes et dossiers jetables, supprimés ensuite. Base de départ : migrations 0000 à 0002 et données du seed, plus deux fichiers déposés par la vraie route `/api/documents/upload` de l'image de production.

| Scénario                                                                                                            | Résultat                                                |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Sauvegarde et restauration par `docker exec`, depuis Git Bash, vers une seconde base contenant des objets à écraser | Lignes et fichiers identiques, objets écrasés           |
| Linux, `DATABASE_URL`, volume Docker, destination rclone locale, `--from-remote latest`                             | Lignes et fichiers identiques                           |
| Volume neuf, avec les outils busybox puis GNU                                                                       | Racine en 1001:1001, dépôt possible                     |
| Application lancée sur la base et le volume restaurés                                                               | Connexion 200, fichier relu conforme, nouveau dépôt 201 |
| Empreinte d'archive altérée                                                                                         | Refus, code 1                                           |
| Sans `--confirm`, sans destination, verrou présent, dossier vide                                                    | Refus, code 1                                           |
| `--allow-empty-files`, chemin `--from` relatif                                                                      | Réussite                                                |
| Sonde injoignable                                                                                                   | Copie faite, code 1                                     |

Un premier essai a révélé qu'un volume neuf restauré restait à root et bloquait les dépôts (503) : corrigé dans `restore.sh`, puis revérifié.

Empreintes SHA-256, identiques à la source, après restauration et au téléchargement quand il a eu lieu :

- `b4080c582d7a50bfadfb3f4472b52d9352eefaf139886b689bacf2f10e896b65` (texte, 61 278 octets, relu par l'API)
- `c8a0e3e3ee729122cd274eb6cfbe70fffeac7eb9f7ab3d8836f05921a3dd2770` (PDF, 9 211 octets)

Lignes par table, avant et après (comparaison indépendante du script, `diff` vide) : 74 tables, 432 lignes.

`drizzle.__drizzle_migrations` 3 · `accounts` 8 · `activities` 5 · `app_settings` 3 · `appointments` 3 · `audit_log` 16 · `automation_rules` 25 · `automation_runs` 4 · `catalog_items` 9 · `change_requests` 2 · `client_requirements` 4 · `comments` 3 · `companies` 6 · `contacts` 7 · `contract_events` 4 · `contract_sites` 4 · `contracts` 4 · `conversations` 3 · `crm_sync_state` 3 · `deliverable_reviews` 3 · `deliverables` 4 · `deployments` 4 · `direct_costs` 5 · `document_versions` 9 · `documents` 9 · `domain_events` 5 · `domains` 3 · `email_outbox` 1 · `finance_imports` 1 · `financial_documents` 5 · `handover_checklist_items` 6 · `integration_connections` 10 · `knowledge_article_versions` 2 · `knowledge_articles` 3 · `maintenance_interventions` 3 · `maintenance_plans` 3 · `member_absences` 2 · `messages` 6 · `missions` 3 · `notification_preferences` 2 · `notifications` 3 · `opportunities` 8 · `opportunity_stage_history` 5 · `payment_schedule_items` 5 · `portal_memberships` 2 · `portal_preferences` 2 · `project_blockers` 1 · `project_members` 6 · `project_phases` 15 · `projects` 3 · `quote_lines` 9 · `quote_versions` 8 · `quotes` 7 · `reply_suggestions` 2 · `sequences` 5 · `sessions` 2 · `site_backups` 4 · `site_environments` 5 · `site_uptime_samples` 60 · `sites` 4 · `sync_runs` 3 · `task_dependencies` 3 · `tasks` 9 · `team_members` 5 · `templates` 4 · `ticket_events` 4 · `ticket_messages` 4 · `tickets` 6 · `time_entries` 22 · `two_factors` 0 · `user_preferences` 2 · `users` 8 · `verifications` 0 · `webhook_receipts` 1.

**Non vérifié :** une vraie destination distante ou chiffrée (rclone a écrit vers un dossier local), la planification cron, le serveur réel, la sonde d'Uptime Kuma en succès, la sauvegarde de Twenty.
