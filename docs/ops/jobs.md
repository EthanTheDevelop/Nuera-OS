# Tâches planifiées

Nuera OS n'a pas de planificateur interne : Coolify (« Scheduled Tasks » de l'application) appelle `POST /api/jobs/<tâche>`.

```sh
wget -qO- --post-data="" --header="Authorization: Bearer $JOBS_SECRET" http://127.0.0.1:3000/api/jobs/events-dispatch
```

Commande vérifiée dans l'image de production, qui contient `wget` mais pas `curl`. Écrire `127.0.0.1` : `localhost` y répond « connexion refusée », le serveur n'écoutant qu'en IPv4.

- `JOBS_SECRET` (32 caractères minimum) doit être défini, sinon toutes ces routes répondent 404. Secret à garder hors du dépôt.
- Toute tâche est répétable : clés `dedupe_key`, `automation_runs` unique par règle et événement, `notifications` unique par compte et clé.
- Deux lancements qui se croisent : verrou consultatif par tâche, le second répond `{"status":"skipped"}` sans rien faire.
- Chaque exécution est tracée dans `sync_runs` (`scope = job:<tâche>`), visible dans Administration.

Réponses : 200 `succeeded`, `skipped` ou `not_configured` (intégration absente, trace en échec avec « connexion requise ») ; 502 `failed` ; 401 secret faux ; 404 tâche inconnue ou `JOBS_SECRET` absent.

## Planification (heure du serveur)

| Tâche                   | Cron           | Ce qu'elle fait                                                                                                         |
| ----------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `events-dispatch`       | `* * * * *`    | Distribue `domain_events` aux règles actives, reprend les échecs (bornés)                                               |
| `emails-drain`          | `* * * * *`    | Vide `email_outbox`, efface le contenu après envoi                                                                      |
| `crm-reconcile`         | `*/15 * * * *` | Réconciliation Twenty par curseur (le webhook n'est qu'un accélérateur)                                                 |
| `sites-coolify`         | `*/5 * * * *`  | État des applications, déploiements et sauvegardes                                                                      |
| `sites-uptime`          | `*/5 * * * *`  | Lecture d'Uptime Kuma                                                                                                   |
| `tickets-due`           | `*/30 * * * *` | `ticket.due_soon` une fois par échéance                                                                                 |
| `backups-failed`        | `0 * * * *`    | `backup.failed` une fois par sauvegarde, `backup.missing` au-delà de 48 h                                               |
| `connections-check`     | `0 * * * *`    | Vérifie Twenty, Coolify, Uptime Kuma, DocuSeal, SMTP. Ni OpenAI, ni n8n                                                 |
| `sites-tls`             | `0 5 * * *`    | Contrôle des certificats                                                                                                |
| `domains-expiring`      | `15 5 * * *`   | `domain.expiring` une fois par domaine et date d'échéance                                                               |
| `invoices-overdue`      | `0 6 * * *`    | Passe les factures dépassées en retard, `invoice.overdue`                                                               |
| `contracts-deadlines`   | `10 6 * * *`   | Renouvellements, expirations, alertes des contrats                                                                      |
| `quotes-reminders`      | `20 6 * * *`   | Expire les devis dépassés, prépare les relances J+7 ; sans SMTP, elles restent dues et la tâche répond `not_configured` |
| `projects-budgets`      | `30 6 * * *`   | `budget.threshold_80` à 80 % de consommation                                                                            |
| `tasks-overdue`         | `40 6 * * *`   | `task.overdue` une fois par tâche et échéance                                                                           |
| `opportunities-actions` | `45 6 * * *`   | Prochaine action d'une affaire due : un rappel par date                                                                 |
| `requirements-overdue`  | `50 6 * * *`   | Contenus attendus en retard : une relance à J+3, une à J+7                                                              |
| `deliverables-overdue`  | `55 6 * * *`   | Validations client en retard : une relance à J+3, une à J+7                                                             |
| `digest-daily`          | `0 7 * * *`    | Résumé du matin aux comptes qui l'ont demandé                                                                           |

## Webhooks entrants

| Route                       | Authentification                                                        | Sans secret |
| --------------------------- | ----------------------------------------------------------------------- | ----------- |
| `/api/webhooks/uptime-kuma` | En-tête `x-nuera-webhook-token` = `UPTIME_KUMA_WEBHOOK_SECRET`          | 404         |
| `/api/webhooks/n8n`         | `x-nuera-timestamp` et `x-nuera-signature` (HMAC, `N8N_WEBHOOK_SECRET`) | 404         |

Corps attendu par `/api/webhooks/n8n` : `{ id, title, body?, severity?, href? }`. Signature : `sha256=<hex>` de HMAC-SHA256 sur `<timestamp en ms>.<corps brut>`, valable 5 minutes.

## n8n, sens sortant

La règle « Relais vers n8n » (désactivée par défaut) poste les événements sur `N8N_WEBHOOK_URL`, l'URL de production du nœud Webhook. Le nœud n'a pas de vérification HMAC intégrée : régler son authentification sur Header Auth (`x-nuera-token` = `N8N_WEBHOOK_HEADER_TOKEN`), et vérifier `x-nuera-signature` avec un nœud Crypto si le scénario doit garantir l'intégrité du corps.
