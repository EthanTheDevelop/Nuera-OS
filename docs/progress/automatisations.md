# Automatisations et administration

Construit et audité.

## Fait

- `notify` réel, repository, centre de notifications, `getAutomationsSummary`, coque (`shell.service`).
- Répartiteur et 24 règles (`automation.rules.ts`), relance sans doublon.
- SMTP (nodemailer 10.1.7), `drainEmailOutbox`, effacement du contenu après envoi.
- Tâches `POST /api/jobs/[job]`, `docs/ops/jobs.md`. Webhooks n8n et Uptime Kuma.
- Écrans 05, 12, 14, 24, journal, exécutions, notifications, onglets de Réglages.
- Auth : réinitialisation, audit 2FA, exigence 2FA. Export `/api/export`.
- Relances ajoutées : affaire (14.01.01), validation client (14.02.03), sauvegarde absente (14.03.03).
- Audit : routes HTTP `/admin/*` de better-auth fermées, relance refusée sur règle désactivée, événement gardé en file si une autre règle attend, liens `/\` refusés, relances de devis sans SMTP dites et gardées dues, échappement HTML, journal avant le lien d'invitation, paramètres d'URL illisibles tolérés, date Indy retirée, pagination des tâches, apparence suivie sur un nouveau navigateur. Tests : `tests/integration/automations/audit-regressions.test.ts`.

## Restant

Hors périmètre : photo de profil, écarts de seed, `unstable_rethrow` des autres routes d'export. Vérifier sur serveur de dev redémarré que `/api/auth/admin/list-users` répond 404.

## Décisions

- `sync_runs.service` n'a pas de valeur « système » : tâches tracées sous `n8n`, `scope = job:<nom>`. Demande de schéma au rapport.
- Exigence 2FA : `getServiceContext` applique, le layout et /profil ne bloquent pas. Un associé sans 2FA ne peut pas l'exiger : il ne pourrait plus revenir sur son choix.
- Événements ajoutés : `ticket.client_message`, `ticket.due_soon`, `quote.reminder_due`, `requirement.overdue`, `opportunity.action_due`, `deliverable.validation_overdue`, `backup.missing`.
- Attente d'une validation mesurée sur `deliverables.updated_at` : pas de date de soumission en base.
- Contexte de capture du lien (`reset-link.ts`) sur `globalThis` : l'instance d'auth est créée par un seul point d'entrée, Next charge le module par point d'entrée.
- Apparence : le cookie reste le choix du navigateur ; le compte ne le remplit que s'il est absent.
