# Nuera OS · contrat de domaine

Référence partagée par tous les lots de développement. Ce fichier fixe le modèle de données, les statuts,
les rôles, les appels entre modules et la répartition des fichiers. Une évolution se décide ici d'abord.

Sources : cadrage `NUERA_OS_PROMPT_ALL_IN_ONE_CLAUDE_CODE_READY.md` (périmètre), `docs/spec/feature-tree.md`
(détail fonctionnel), `docs/design/figma-map.md`, `tokens.md`, `motion.md` (visuel), `docs/architecture.md` (couches).

## 1. Arbitrages

| #   | Sujet                                                          | Décision                                                                                                                                                                                                                                                                                               | Raison                                                                                                   |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| A1  | Twenty absent du dépôt, « non tranché » dans `architecture.md` | Twenty est maître des organisations, contacts, opportunités et activités. Nuera OS écrit via son API et garde une **projection locale** indexée par `twenty_id`                                                                                                                                        | Le cadrage acte Twenty et interdit une base CRM parallèle ; 100 requêtes/min excluent la lecture directe |
| A2  | Étapes du pipeline                                             | Nouveau, Qualifié, Devis envoyé, Négociation, Gagné, Perdu. Colonnes Kanban au style de l'écran 03                                                                                                                                                                                                     | Le cadrage fixe le périmètre, Figma le visuel                                                            |
| A3  | Reporting                                                      | Page `/reporting` conservée, calculée par le même service que le tableau de bord                                                                                                                                                                                                                       | Barre latérale validée par Nezar, aucun calcul en double                                                 |
| A4  | Sous-traitants                                                 | Livrés (`team_members.kind = contractor`), section visible                                                                                                                                                                                                                                             | Le cadrage, plus récent, les inclut. À confirmer avec la décision du 21/10                               |
| A5  | Parcours support                                               | Reçue, Qualifiée, En cours, Résolue, Clôturée. 5 colonnes au style de l'écran 11                                                                                                                                                                                                                       | Cadrage                                                                                                  |
| A6  | Capacité                                                       | Calculée par membre depuis `weekly_capacity_minutes` ; rien de figé à deux associés                                                                                                                                                                                                                    | Les maquettes se contredisent (18 j semaine ou mois)                                                     |
| A7  | Seuils                                                         | Charge : `warn` ≥ 90 %, `danger` > 100 %. Consommation de budget : alerte à 80 %                                                                                                                                                                                                                       | Écran 18 et cadrage §06                                                                                  |
| A8  | Réaction d'interface                                           | 150 ms                                                                                                                                                                                                                                                                                                 | Note Mouvement, plus précise que `--dur-fast`                                                            |
| A9  | Services des maquettes hors cadrage                            | ChatGPT : API OpenAI par clé serveur (« Sign in with ChatGPT » n'est pas une API ouverte aux tiers), suggestion sans envoi automatique. Surveillance : adaptateur Uptime Kuma. Rendez-vous : saisie interne, Cal.diy en webhook optionnel. **Google Agenda et Figma de l'écran 14 ne sont pas livrés** | Cadrage §2 et §6 : aucun bouton fictif, aucun service ajouté sans nécessité                              |
| A10 | Suggestion IA                                                  | « Utiliser la réponse » remplit le champ ; l'envoi reste une action humaine                                                                                                                                                                                                                            | Règle produit de l'écran 05                                                                              |
| A11 | Facturation                                                    | Indy n'a pas d'API vérifiée : import CSV et saisie manuelle des références, état « API à vérifier »                                                                                                                                                                                                    | Cadrage §6 : ne pas inventer d'API                                                                       |
| A12 | Co-traitance                                                   | Une échéance peut produire plusieurs `financial_documents`, chacun rattaché à un associé émetteur                                                                                                                                                                                                      | Écran 21                                                                                                 |
| A13 | Écarts visuels                                                 | Thème sombre dérivé des tokens ; accent personnalisable conservé (écran 14) ; responsive jusqu'à 390 px                                                                                                                                                                                                | Non dessinés, mêmes tokens                                                                               |

## 2. Conventions de données

- UUID (`id()`), `timestamps()`. Montants **HT en centimes** (`integer`, suffixe `_cents`), devise EUR. Durées **en minutes**. Dates métier en `date`, instants en `timestamptz`.
- Pas de suppression physique des objets métier : `archived_at`. Les opérations sensibles passent par `recordAudit`.
- Toute table liée à un client porte `company_id`. Les liens vers un objet du même client utilisent une clé composite `(objet_id, company_id)` : un lien croisé est impossible en SQL.
- Listes paginées côté serveur (plusieurs centaines de sites) : `{ items, total, page, pageSize }`, index sur les colonnes filtrées.
- Numéros lisibles (`D-2026-014`, `P-2026-007`, `T-2026-031`) issus de `sequences` (année + compteur, transactionnel).

## 3. Tables

Les champs de base (`id`, `created_at`, `updated_at`) sont implicites.

### CRM (`schema/crm.ts`), projection de Twenty

Colonnes **(T)** : maîtres dans Twenty, écrites via `CrmGateway`, jamais modifiées localement sans passer par lui. Le reste appartient à Nuera OS.

- `companies` : `twenty_id` unique, **(T)** `name`, `domain`, `address_line`, `city`, `postal_code`, `country` ; `status` (prospect, client, subscriber, former, partner), `activity`, `siren`, `phone`, `source`, `tags text[]`, `owner_member_id`, `notes`, `merged_into_id`, `archived_at`, `twenty_synced_at`. Unique partiel sur `siren`.
- `contacts` : `twenty_id`, `company_id`, **(T)** `first_name`, `last_name`, `email`, `phone`, `job_title` ; `roles text[]` (decision, signatory, technical, billing), `is_primary`, `notes`, `archived_at`, `twenty_synced_at`. Index sur `lower(email)` pour la déduplication.
- `opportunities` : `twenty_id`, `company_id`, `contact_id`, **(T)** `name`, `stage`, `amount_cents`, `expected_close_on` ; `probability` (0 à 100), `source`, `need`, `budget_estimate_cents`, `owner_member_id`, `next_action`, `next_action_on`, `lost_reason`, `won_at`, `lost_at`, `last_activity_at`, `archived_at`, `twenty_synced_at`.
- `opportunity_stage_history` : `opportunity_id`, `from_stage`, `to_stage`, `actor_id`, `at`.
- `activities` : `twenty_id` nullable (notes et tâches seulement), `kind` (note, call, meeting, email, task), `company_id`, `contact_id`, `opportunity_id`, `subject`, `body`, `due_at`, `completed_at`, `owner_member_id`, `occurred_at`.
- `crm_sync_state` : `object`, `cursor`, `last_run_at`, `last_error`.

### Offres (`schema/sales.ts`)

- `catalog_items` : `kind` (project, recurring, option), `activity` (vitrine, landing, ecommerce, sur_mesure, maintenance, hebergement, accompagnement, audit), `name`, `description`, `price_cents`, `estimated_cost_cents`, `estimated_minutes`, `scope`, `exclusions`, `conditions`, `validity_days`, `deposit_percent`, `active`.
- `quotes` : `number`, `company_id`, `opportunity_id`, `parent_quote_id` (avenant), `status` (draft, sent, negotiation, accepted, refused, expired), `current_version_id`, `accepted_version_id`, `issued_by_note`, `indy_reference`, `official_document_url`, `docuseal_submission_id`, `signature_status` (none, pending, signed, declined, unavailable), `signed_at`, `sent_at`, `last_reminder_at`.
- `quote_versions` : `quote_id`, `version`, `scope`, `exclusions`, `conditions`, `valid_until`, `deposit_percent`, `total_cents`, `estimated_cost_cents`, `estimated_minutes`, `change_note`, `created_by`. Unique `(quote_id, version)`. Figée dès l'envoi.
- `quote_lines` : `quote_version_id`, `catalog_item_id`, `label`, `quantity`, `unit_price_cents`, `estimated_cost_cents`, `estimated_minutes`, `position`.

### Production (`schema/projects.ts`)

- `projects` : `number`, `company_id`, `opportunity_id`, `quote_id` unique partiel (un devis accepté donne un seul projet), `name`, `activity`, `objective`, `scope`, `status` (preparation, active, blocked, in_validation, delivered, closed), `priority`, `owner_member_id`, `start_on`, `due_on`, `delivered_on`, `budget_cents`, `estimated_minutes`, `client_step_label`, `archived_at`.
- `project_phases` : `project_id`, `name`, `position`, `due_on`, `status` (todo, in_progress, done), `client_visible`.
- `tasks` : `number`, `project_id`, `phase_id`, `parent_task_id`, `title`, `description`, `status` (todo, in_progress, blocked, done), `priority`, `assignee_member_id`, `due_on`, `estimated_minutes`, `position`, `completed_at`.
- `task_dependencies` : `task_id`, `depends_on_task_id`. Cycle refusé en service.
- `deliverables` : `project_id`, `phase_id`, `title`, `status` (draft, to_validate, validated, changes_requested), `version`, `document_id`, `requires_client_validation`, `feedback_rounds_included`.
- `deliverable_reviews` : `deliverable_id`, `version`, `decision` (validated, changes_requested), `comment`, `reviewer_user_id`, `at`.
- `project_blockers` : `project_id`, `title`, `consequence`, `decision`, `raised_at`, `resolved_at`.
- `change_requests` : `company_id`, `project_id`, `ticket_id`, `title`, `description`, `status` (open, accepted, refused, converted), `estimated_minutes`, `amount_cents`, `quote_id`.
- `client_requirements` : `project_id`, `label`, `status` (expected, received), `due_on`, `received_at`, `document_id`. (« Contenus attendus »)
- `handover_checklist_items` : `project_id`, `label`, `done_at`, `position`.
- `project_members` : `project_id`, `member_id`, `role`.

### Temps et équipe (`schema/team.ts`)

- `team_members` : `user_id` unique nullable, `kind` (partner, employee, contractor), `full_name`, `email`, `phone`, `title`, `skills text[]`, `status` (active, inactive), `weekly_capacity_minutes`, `hourly_cost_cents`, `day_rate_cents`, `conditions`, `specialty`, `archived_at`.
- `member_absences` : `member_id`, `start_on`, `end_on`, `reason`.
- `missions` : `member_id`, `project_id`, `task_id`, `ticket_id`, `title`, `deliverable_label`, `due_on`, `status`, `planned_cost_cents`, `committed_cost_cents`.
- `time_entries` : `member_id`, `company_id`, `project_id`, `task_id`, `ticket_id`, `contract_id`, `work_on`, `minutes`, `category` (production, corrections, support, prospecting, admin), `billable`, `hourly_cost_cents` (figé à la saisie), `note`, `created_by`. Contrainte : au moins un rattachement, ou catégorie prospection/administratif.

### Sites (`schema/sites.ts`)

- `sites` : `company_id`, `project_id`, `contract_id`, `name`, `primary_domain`, `kind`, `status` (planned, staging, live, paused, archived), `technology`, `cms_kind`, `cms_admin_url`, `repo_url`, `hosting_label`, `server_label`, `owner_member_id`, `live_on`, `coolify_project_uuid`, `monitor_id`, `archived_at`. Unique `(id, company_id)`.
- `site_environments` : `site_id`, `kind` (development, staging, production), `url`, `coolify_app_uuid`, `status` (running, stopped, error, unknown), `status_checked_at`. Unique `(site_id, kind)`.
- `deployments` : `environment_id`, `external_id` unique, `status` (queued, running, succeeded, failed, cancelled), `commit_sha`, `commit_message`, `triggered_by_user_id`, `started_at`, `finished_at`, `duration_seconds`, `source` (coolify, nuera).
- `domains` : `company_id`, `site_id`, `name` unique, `registrar`, `expires_on`, `auto_renew`, `tls_status`, `tls_expires_on`, `checked_at`.
- `site_uptime_samples` : `site_id`, `day`, `uptime_ratio`, `avg_response_ms`, `checked_at`. Unique `(site_id, day)`.
- `site_backups` : `site_id`, `environment_id`, `external_id`, `status`, `taken_at`, `size_bytes`, `off_site`, `source`.

### Contrats (`schema/contracts.ts`)

- `maintenance_plans` : `name`, `description`, `price_cents`, `period` (monthly, quarterly, yearly), `included_minutes`, `included_tickets`, `scope`, `exclusions`, `response_hours`, `resolution_hours`, `active`.
- `contracts` : `number`, `company_id`, `plan_id`, `quote_id`, `name`, `kind` (hosting, maintenance, support, accompaniment), `status` (to_start, active, to_review, suspended, terminated, expired), `start_on`, `end_on`, `renews_on`, `auto_renew`, `price_cents`, `period`, `monthly_cost_cents`, `included_minutes`, `included_tickets`, `scope`, `exclusions`, `conditions`, `response_hours`, `resolution_hours`, `signature_status`, `docuseal_submission_id`, `terminated_at`, `termination_note`.
- `contract_sites` : `contract_id`, `site_id`, `company_id` (clés composites).
- `contract_events` : `contract_id`, `kind` (created, price_change, renewed, suspended, terminated, note), `from_price_cents`, `to_price_cents`, `note`, `actor_id`, `at`.
- `maintenance_interventions` : `contract_id`, `site_id`, `title`, `planned_on`, `done_on`, `result`, `minutes`, `member_id`.

### Support (`schema/support.ts`)

- `tickets` : `number`, `company_id`, `site_id`, `contract_id`, `project_id`, `subject`, `description`, `channel` (portal, email, phone, internal, monitoring), `category` (incident, bug, assistance, question, change), `severity` (low, medium, high, critical), `status` (received, qualified, in_progress, resolved, closed), `assignee_member_id`, `due_at`, `first_response_at`, `resolved_at`, `closed_at`, `coverage` (undetermined, covered, not_covered, overage), `is_incident`, `opened_by_user_id`, `change_request_id`, `archived_at`.
- `ticket_messages` : `ticket_id`, `author_user_id`, `body`, `internal`, `at`.
- `ticket_events` : `ticket_id`, `from_status`, `to_status`, `actor_id`, `note`, `at`.

### Finances (`schema/finance.ts`)

- `financial_documents` : `company_id`, `project_id`, `contract_id`, `quote_id`, `kind` (invoice, credit_note), `source` (indy_csv, manual, indy_api), `external_ref`, `issuer_member_id`, `issued_on`, `due_on`, `amount_cents`, `tax_cents`, `status` (issued, overdue, paid, cancelled), `paid_on`, `document_id`, `client_visible`, `imported_at`. Unique `(source, external_ref)`. Aucune facture créée ici n'a de valeur légale.
- `payment_schedule_items` : `company_id`, `project_id`, `quote_id`, `contract_id`, `label`, `due_on`, `amount_cents`, `status` (planned, invoiced, paid), `financial_document_id`.
- `direct_costs` : `company_id`, `project_id`, `site_id`, `contract_id`, `member_id`, `label`, `category` (subcontracting, hosting, license, purchase, other), `amount_cents`, `incurred_on`, `recurring_period`, `nature` (forecast, actual).
- `finance_imports` : `source`, `filename`, `rows_total`, `rows_created`, `rows_updated`, `rows_rejected`, `errors jsonb`, `actor_id`, `at`.

### Documents (`schema/documents.ts`)

- `documents` : `company_id`, `project_id`, `contract_id`, `site_id`, `ticket_id`, `quote_id`, `title`, `kind` (quote, contract, invoice, mockup, brief, minutes, deliverable, client_file, other), `visibility` (internal, client), `status`, `current_version_id`, `uploaded_by_client`, `archived_at`.
- `document_versions` : `document_id`, `version`, `storage_key`, `filename`, `mime_type`, `size_bytes`, `sha256`, `uploaded_by_user_id`, `note`. Unique `(document_id, version)`.
- `knowledge_articles` : `kind` (internal, technical, faq), `title`, `body`, `site_id`, `project_id`, `author_user_id`, `version`, `archived_at`.
- `knowledge_article_versions` : `article_id`, `version`, `body`, `author_user_id`, `at`.
- `templates` : `kind` (brief, checklist, message, project_plan), `activity`, `name`, `body`, `items jsonb`, `active`.

### Échanges (`schema/messaging.ts`)

- `conversations` : `company_id`, `project_id`, `contact_id`, `subject`, `last_message_at`, `unread_internal`, `unread_client`, `archived_at`.
- `messages` : `conversation_id`, `author_user_id`, `author_contact_id`, `direction` (inbound, outbound, internal), `body`, `mentions uuid[]`, `document_id`, `at`.
- `reply_suggestions` : `conversation_id`, `message_id`, `body`, `status` (ready, used, dismissed, failed), `tone`, `context_summary`, `requested_by`, `error`. Jamais d'envoi automatique.
- `comments` : `entity_type` (task, project, ticket, deliverable), `entity_id`, `parent_id`, `author_user_id`, `body`, `mentions uuid[]`, `document_id`, `archived_at`. Index `(entity_type, entity_id)`.
- `appointments` : `company_id`, `contact_id`, `project_id`, `opportunity_id`, `title`, `kind`, `starts_at`, `duration_minutes`, `channel`, `location`, `member_ids uuid[]`, `source` (manual, cal), `external_id` unique, `status`.

### Portail (`schema/portal.ts`)

- `portal_memberships` : `user_id` unique, `company_id`, `contact_id`, `status` (invited, active, revoked), `invited_by`, `invited_at`, `last_seen_at`. **Source unique du cloisonnement client.**
- `portal_preferences` : `user_id`, `notify_message`, `notify_validation`, `notify_invoice`, `notify_requirement`, `notify_report`.

### Automatisations et administration (`schema/platform.ts`)

- `sequences` : `scope`, `year`, `value`. Clé primaire `(scope, year)`.
- `domain_events` : `type`, `entity_type`, `entity_id`, `company_id`, `payload jsonb`, `actor_id`, `dedupe_key` unique nullable, `occurred_at`, `dispatched_at`. Boîte d'envoi transactionnelle.
- `automation_rules` : `key` unique, `name`, `trigger_label`, `action_label`, `tool_label`, `enabled`, `config jsonb`. Règles définies en code, activées en base.
- `automation_runs` : `rule_key`, `event_id`, `status` (running, succeeded, failed, skipped), `attempts`, `error`, `started_at`, `finished_at`, `result jsonb`. Unique `(rule_key, event_id)` : idempotence.
- `notifications` : `user_id`, `kind`, `severity` (info, warning, danger), `title`, `body`, `entity_type`, `entity_id`, `href`, `dedupe_key`, `read_at`, `emailed_at`. Unique `(user_id, dedupe_key)`.
- `notification_preferences` : `user_id`, `kind`, `in_app`, `email`. `user_preferences` : `user_id`, `theme`, `accent`, `locale`, `home_path`, `density`, `dashboard_layout jsonb`, `daily_digest`.
- `integration_connections` : `service` unique (twenty, coolify, indy, payload, docuseal, n8n, uptime_kuma, openai, smtp, cal), `status` (connected, degraded, unavailable, not_configured, to_verify), `last_check_at`, `last_success_at`, `last_error`, `details jsonb`.
- `sync_runs` : `service`, `scope`, `status`, `started_at`, `finished_at`, `items`, `error`.
- `webhook_receipts` : `service`, `external_id`, `received_at`, `status`. Unique `(service, external_id)`.
- `email_outbox` : `to_address`, `subject`, `html`, `text`, `template`, `status` (pending, sent, failed, not_configured), `attempts`, `last_error`, `sent_at`, `dedupe_key`.
- `app_settings` : `key` unique, `value jsonb`, `updated_by`.

## 4. Statuts et transitions

Chaque module expose une table de transitions autorisées en constante, testée. Une transition refusée lève `ConflictError`.

- `opportunities.stage` : NEW → QUALIFIED → QUOTE_SENT → NEGOTIATION → WON/LOST ; retour arrière autorisé tant que l'affaire n'est pas close ; LOST exige `lost_reason` ; WON exige un client et un montant ; réouverture réservée à `admin`.
- `quotes.status` : draft → sent → negotiation → accepted/refused ; sent → expired ; modifier un devis envoyé crée une nouvelle version.
- `projects.status` : preparation → active ⇄ blocked ⇄ in_validation → delivered → closed.
- `tickets.status` : received → qualified → in_progress → resolved → closed ; resolved → in_progress (réouverture).
- `contracts.status` : to_start → active ⇄ to_review ; active → suspended/terminated ; active → expired.

## 5. Rôles et permissions

Rôles : `admin` (Associé), `member` (Collaborateur), `contractor` (Prestataire), `viewer` (Lecture), `client` (Portail).

- Permissions `domaine:action`. Domaines : `crm`, `sales`, `quotes`, `catalog`, `projects`, `tasks`, `time`, `team`, `sites`, `deployments`, `contracts`, `support`, `finance`, `documents`, `knowledge`, `messages`, `automations`, `admin`, `users`, `audit`, `integrations`, `dashboard`, `export`.
- `finance:read`, `deployments:trigger`, `users:manage`, `export:run` : `admin` uniquement. Coûts et tarifs des membres : `team:read_costs`, `admin` uniquement.
- `contractor` : `projects:read_assigned`, `tasks:read_assigned`, `tasks:update_assigned`, `time:create_own`, `support:read_assigned`, `documents:read_assigned`. Chaque service filtre sur `project_members`, `missions` et `assignee_member_id` : **la permission ne suffit pas, le périmètre s'applique dans la requête**.
- `client` : aucune permission interne. Il n'accède qu'aux services `src/modules/portal`, qui exigent un `PortalContext { db, actor, companyId, contactId }` issu de `portal_memberships`. Toute lecture filtre sur `company_id` ; un objet d'un autre client répond 404.
- Les pages internes vérifient le rôle dans `(app)/layout.tsx` **et** dans chaque service. Un `client` qui ouvre une URL interne part vers `/espace`.

## 6. Contrats entre modules

Un module n'importe jamais le repository d'un autre : il appelle son service. Signatures stables, créées en squelette par le socle :

```ts
// src/modules/projects/project.service.ts
createProjectFromQuote(ctx, tx, { quoteId, opportunityId, companyId, versionId }): Promise<Project> // idempotent par quoteId
// src/modules/sites/site.service.ts
activateSiteAfterGoLive(ctx, tx, { projectId, siteId }): Promise<void>
// src/modules/contracts/contract.service.ts
resolveCoverage(db, { companyId, siteId, contractId, category }): Promise<CoverageDecision>
consumeContractQuota(tx, { contractId, minutes, ticketId }): Promise<void>
// src/modules/support/ticket.service.ts
openIncidentTicket(tx, { siteId, title, source }): Promise<Ticket> // idempotent par incident ouvert
// src/modules/finance/profitability.service.ts : source unique du calcul de marge
getMargin(db, { scope: 'project' | 'client' | 'site' | 'contract'; id; period? }): Promise<MarginBreakdown>
// src/modules/documents/document.service.ts
attachDocument(ctx, input): Promise<Document>
assertDocumentReadable(ctx | portalCtx, documentId): Promise<Document>
// src/modules/platform/events.ts
emitEvent(tx, { type, entityType, entityId, companyId, payload, actorId, dedupeKey? }): Promise<void>
// src/modules/platform/notifications.service.ts
notify(tx, { userIds | role, kind, severity, title, body, href, dedupeKey }): Promise<void>
```

**Marge** : `marge HT = revenus HT attribués − coûts directs attribués`, coût du temps inclus (`minutes × hourly_cost_cents` figé). Prévisionnel et réalisé sont séparés. Tableau de bord, projet, fiche client et finances appellent `getMargin` et rien d'autre.

**Événements** (`domain_events.type`) : `opportunity.created|stage_changed|won|lost`, `quote.sent|accepted|refused|expired`, `project.created|status_changed|delivered`, `task.overdue`, `deliverable.submitted|validated|changes_requested`, `site.live|down|up`, `deployment.finished`, `backup.failed`, `domain.expiring`, `contract.expiring|quota_80|quota_exceeded|terminated`, `ticket.created|critical|closed`, `budget.threshold_80`, `invoice.overdue|paid`, `message.received`.

Intégrations : `src/integrations/<service>/`. Chaque adaptateur a un `isConfigured`, lève `ServiceUnavailableError` (message français « connexion requise ») s'il ne l'est pas, et n'est appelé que par les services. Toute lecture externe porte sa date ; une donnée périmée s'affiche comme telle.

## 7. Parcours à tester de bout en bout (`tests/journeys/`)

1. Lead → opportunité → devis → accepté/gagné → projet, sans doublon en cas de répétition.
2. Projet → livrables/validations → mise en ligne → site actif → contrat de maintenance.
3. Site/contrat → ticket → intervention → temps/quota → clôture, avec hors forfait → demande de changement.
4. Temps + coûts + montants HT → même marge partout.
5. Retard, dépassement, renouvellement, panne, impayé → notification contextualisée, sans répétition.
6. Client connecté → validation/support → visible côté agence ; aucun accès croisé entre deux clients, y compris sur les fichiers.

## 8. Répartition des fichiers

| Lot                               | Possède                                                                                                                                                                                                                  | Écrans             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Socle données                     | `src/server/db/schema/**`, `drizzle/**`, `src/server/auth/{roles,permissions}.ts`, `src/modules/audit/audit.constants.ts`, `src/modules/platform/{events,sequences}.ts`, `src/lib/{format,money}.ts`, `tests/helpers/**` |                    |
| Socle interface                   | `src/app/globals.css`, `src/app/layout.tsx`, `src/components/**`, `src/config/navigation.ts`, `src/lib/motion.ts`, `src/proxy.ts`, `src/app/(app)/layout.tsx`, `src/app/(auth)/**`                                       | 13, 15             |
| CRM et ventes                     | `src/modules/{crm,sales}`, `src/app/(app)/{clients,pipeline}`, `src/app/api/webhooks/twenty`                                                                                                                             | 03, 04, 07         |
| Devis                             | `src/modules/quotes`, `src/app/(app)/devis`, `src/integrations/docuseal`, `src/app/api/webhooks/docuseal`                                                                                                                | 09                 |
| Projets                           | `src/modules/projects`, `src/app/(app)/projets`                                                                                                                                                                          | 08, 17, M4         |
| Temps et équipe                   | `src/modules/{time,team}`, `src/app/(app)/{temps,equipe}`                                                                                                                                                                | 18, 22             |
| Sites                             | `src/modules/sites`, `src/app/(app)/sites`, `src/integrations/{coolify,uptime-kuma}`                                                                                                                                     | 10, 19, M3         |
| Contrats                          | `src/modules/contracts`, `src/app/(app)/contrats`                                                                                                                                                                        | 20                 |
| Support                           | `src/modules/support`, `src/app/(app)/support`                                                                                                                                                                           | 11                 |
| Finances                          | `src/modules/finance`, `src/app/(app)/finances`, `src/integrations/indy`                                                                                                                                                 | 21                 |
| Documents                         | `src/modules/documents`, `src/app/(app)/documents`, `src/app/api/documents`, `src/integrations/storage`                                                                                                                  | 23                 |
| Messages                          | `src/modules/messaging`, `src/app/(app)/messages`, `src/integrations/openai`                                                                                                                                             | 02                 |
| Portail                           | `src/modules/portal`, `src/app/(portal)/espace/**`, envoi du lien de connexion                                                                                                                                           | C1 à C9            |
| Pilotage                          | `src/modules/dashboard`, `src/app/(app)/page.tsx`, `src/app/(app)/reporting`                                                                                                                                             | 01, 06, 16, M1, M2 |
| Automatisations et administration | `src/modules/{platform,admin}`, `src/app/(app)/{automatisations,administration,reglages,profil}`, `src/integrations/{n8n,smtp}`, `src/app/api/{jobs,webhooks/n8n,export}`                                                | 05, 12, 14, 24     |

Un lot qui a besoin d'une évolution hors de ses chemins l'écrit dans son rapport final ; il ne modifie pas le fichier d'un autre lot. Exception : `audit.constants.ts`, `navigation.ts` et `schema/**` sont figés par le socle et complétés par le responsable.

## 9. Précisions du socle

Choix faits en construisant le schéma, là où le texte ci-dessus laissait une impasse. Ils font référence.

**Transitions.** Devis : `sent → accepted/refused` direct (une signature DocuSeal ne passe pas par la négociation). Projet : `active ⇄ in_validation`. Contrat : `suspended → active/terminated`. Opportunité : `LOST` depuis toute étape ouverte, `WON` aussi depuis `QUOTE_SENT`. Machines : `src/modules/<domaine>/<x>.status.ts`, helper `src/server/status-machine.ts`.

**Échéances et factures.** Une échéance peut porter plusieurs factures (A12) : `financial_documents.schedule_item_id` fait foi, `payment_schedule_items.financial_document_id` désigne le document principal.

**Rôles.** `DEFAULT_ROLE` vaut `viewer`, puisque `member` a désormais des droits. Le prestataire n'a ni `dashboard:read` ni lecture du temps des autres. `time_entries.hourly_cost_cents` reste lisible avec `time:read` : les services le masquent sans `team:read_costs`.

**`company_id` nullable** sur contacts, opportunités, activités (Twenty autorise l'absence de client), documents, coûts directs, rendez-vous et temps. Des CHECK empêchent un NULL de contourner les clés composites. `messages`, `comments` et `maintenance_interventions` exigent `company_id`.

**Pièges.**

- Fusion de clients : les clés composites refusent de déplacer un parent seul. Déplacer parents et enfants dans une seule instruction `WITH … UPDATE` (exemple testé dans `tests/integration/tenancy.test.ts`).
- Synchronisation Twenty : Twenty accepte une opportunité dont le contact appartient à un autre client, pas nous. Mettre le contact à NULL et journaliser dans ce cas.
- Lignes du seed : `twenty_id` préfixé `seed-`, sans fiche dans Twenty. La réconciliation ne les considère pas comme supprimées, et toute écriture CRM sur ces lignes échoue honnêtement.
- `email_outbox` contient des liens de connexion actifs en clair : le lot SMTP les efface après envoi.
- Lien de connexion : réservé au rôle `client` avec adhésion valide. Réponse identique dans tous les cas, sans révéler si une adresse existe.
- Erreurs d'intégration : `ServiceUnavailableError` (`src/server/errors.ts`) pour tous les adaptateurs. `IntegrationUnavailableError` en est la variante CRM.
