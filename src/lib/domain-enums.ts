/**
 * Valeurs fermées du domaine, source unique pour le schéma (contraintes CHECK), les services (Zod)
 * et l'interface (libellés, filtres). Fichier pur, sans dépendance : importable côté client,
 * contrairement à `@/server/db/*` que la règle ESLint interdit à l'interface.
 *
 * Ajouter une valeur = l'ajouter ici + son libellé + migration (la contrainte CHECK en dépend).
 */

// --- CRM ---------------------------------------------------------------------------------------

export const COMPANY_STATUSES = ["prospect", "client", "subscriber", "former", "partner"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];
export const COMPANY_STATUS_LABELS: Record<CompanyStatus, string> = {
  prospect: "Prospect",
  client: "Client",
  subscriber: "Abonné",
  former: "Ancien client",
  partner: "Partenaire",
};

export const CONTACT_ROLES = ["decision", "signatory", "technical", "billing"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  decision: "Décideur",
  signatory: "Signataire",
  technical: "Technique",
  billing: "Facturation",
};

/** Mêmes valeurs que `OPPORTUNITY_STAGES` du port CRM (`src/integrations/twenty/crm-gateway.ts`). */
export const OPPORTUNITY_STAGES = [
  "NEW",
  "QUALIFIED",
  "QUOTE_SENT",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];
export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  NEW: "Nouveau",
  QUALIFIED: "Qualifié",
  QUOTE_SENT: "Devis envoyé",
  NEGOTIATION: "Négociation",
  WON: "Gagné",
  LOST: "Perdu",
};

export const ACTIVITY_KINDS = ["note", "call", "meeting", "email", "task"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  note: "Note",
  call: "Appel",
  meeting: "Réunion",
  email: "E-mail",
  task: "Tâche",
};

// --- Offres ------------------------------------------------------------------------------------

export const CATALOG_ITEM_KINDS = ["project", "recurring", "option"] as const;
export type CatalogItemKind = (typeof CATALOG_ITEM_KINDS)[number];
export const CATALOG_ITEM_KIND_LABELS: Record<CatalogItemKind, string> = {
  project: "Prestation",
  recurring: "Service récurrent",
  option: "Option",
};

/** Activités vendues (catalogue, projets, modèles, reporting par activité). */
export const OFFER_ACTIVITIES = [
  "vitrine",
  "landing",
  "ecommerce",
  "sur_mesure",
  "maintenance",
  "hebergement",
  "accompagnement",
  "audit",
] as const;
export type OfferActivity = (typeof OFFER_ACTIVITIES)[number];
export const OFFER_ACTIVITY_LABELS: Record<OfferActivity, string> = {
  vitrine: "Site vitrine",
  landing: "Landing page",
  ecommerce: "E-commerce",
  sur_mesure: "Sur mesure",
  maintenance: "Maintenance",
  hebergement: "Hébergement",
  accompagnement: "Accompagnement",
  audit: "Audit",
};

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "negotiation",
  "accepted",
  "refused",
  "expired",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  negotiation: "Négociation",
  accepted: "Accepté",
  refused: "Refusé",
  expired: "Expiré",
};

export const SIGNATURE_STATUSES = ["none", "pending", "signed", "declined", "unavailable"] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];
export const SIGNATURE_STATUS_LABELS: Record<SignatureStatus, string> = {
  none: "Non demandée",
  pending: "En attente",
  signed: "Signé",
  declined: "Refusée",
  unavailable: "Indisponible",
};

// --- Production --------------------------------------------------------------------------------

export const PROJECT_STATUSES = [
  "preparation",
  "active",
  "blocked",
  "in_validation",
  "delivered",
  "closed",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  preparation: "Préparation",
  active: "En cours",
  blocked: "Bloqué",
  in_validation: "En validation",
  delivered: "Livré",
  closed: "Clôturé",
};

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
  urgent: "Urgente",
};

export const PHASE_STATUSES = ["todo", "in_progress", "done"] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];
export const PHASE_STATUS_LABELS: Record<PhaseStatus, string> = {
  todo: "À venir",
  in_progress: "En cours",
  done: "Fait",
};

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  blocked: "Bloquée",
  done: "Faite",
};

export const DELIVERABLE_STATUSES = [
  "draft",
  "to_validate",
  "validated",
  "changes_requested",
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
  draft: "Brouillon",
  to_validate: "À valider",
  validated: "Validé",
  changes_requested: "Retours demandés",
};

export const REVIEW_DECISIONS = ["validated", "changes_requested"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  validated: "Validé",
  changes_requested: "Retours demandés",
};

export const CHANGE_REQUEST_STATUSES = ["open", "accepted", "refused", "converted"] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];
export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  open: "Ouverte",
  accepted: "Acceptée",
  refused: "Refusée",
  converted: "Transformée",
};

export const REQUIREMENT_STATUSES = ["expected", "received"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  expected: "Attendu",
  received: "Reçu",
};

// --- Temps et équipe ---------------------------------------------------------------------------

export const MEMBER_KINDS = ["partner", "employee", "contractor"] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];
export const MEMBER_KIND_LABELS: Record<MemberKind, string> = {
  partner: "Associé",
  employee: "Collaborateur",
  contractor: "Prestataire",
};

export const MEMBER_STATUSES = ["active", "inactive"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Actif",
  inactive: "Inactif",
};

export const MISSION_STATUSES = ["planned", "in_progress", "delivered", "cancelled"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];
export const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  planned: "Prévue",
  in_progress: "En cours",
  delivered: "Livrée",
  cancelled: "Annulée",
};

export const TIME_CATEGORIES = [
  "production",
  "corrections",
  "support",
  "prospecting",
  "admin",
] as const;
export type TimeCategory = (typeof TIME_CATEGORIES)[number];
export const TIME_CATEGORY_LABELS: Record<TimeCategory, string> = {
  production: "Production",
  corrections: "Corrections",
  support: "Support",
  prospecting: "Prospection",
  admin: "Administratif",
};

// --- Sites -------------------------------------------------------------------------------------

export const SITE_KINDS = ["vitrine", "landing", "ecommerce", "sur_mesure"] as const;
export type SiteKind = (typeof SITE_KINDS)[number];
export const SITE_KIND_LABELS: Record<SiteKind, string> = {
  vitrine: "Site vitrine",
  landing: "Landing page",
  ecommerce: "E-commerce",
  sur_mesure: "Sur mesure",
};

export const SITE_STATUSES = ["planned", "staging", "live", "paused", "archived"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];
export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  planned: "Prévu",
  staging: "Préprod",
  live: "En ligne",
  paused: "En pause",
  archived: "Archivé",
};

export const CMS_KINDS = ["payload", "wordpress", "other", "none"] as const;
export type CmsKind = (typeof CMS_KINDS)[number];
export const CMS_KIND_LABELS: Record<CmsKind, string> = {
  payload: "Payload",
  wordpress: "WordPress",
  other: "Autre",
  none: "Sans CMS",
};

export const ENVIRONMENT_KINDS = ["development", "staging", "production"] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];
export const ENVIRONMENT_KIND_LABELS: Record<EnvironmentKind, string> = {
  development: "Développement",
  staging: "Staging",
  production: "Production",
};

export const ENVIRONMENT_STATUSES = ["running", "stopped", "error", "unknown"] as const;
export type EnvironmentStatus = (typeof ENVIRONMENT_STATUSES)[number];
export const ENVIRONMENT_STATUS_LABELS: Record<EnvironmentStatus, string> = {
  running: "Opérationnel",
  stopped: "Arrêté",
  error: "Erreur",
  unknown: "Indisponible",
};

export const DEPLOYMENT_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];
export const DEPLOYMENT_STATUS_LABELS: Record<DeploymentStatus, string> = {
  queued: "En file",
  running: "En cours",
  succeeded: "Réussi",
  failed: "Échec",
  cancelled: "Annulé",
};

export const DEPLOYMENT_SOURCES = ["coolify", "nuera"] as const;
export type DeploymentSource = (typeof DEPLOYMENT_SOURCES)[number];
export const DEPLOYMENT_SOURCE_LABELS: Record<DeploymentSource, string> = {
  coolify: "Coolify",
  nuera: "Nuera OS",
};

export const TLS_STATUSES = ["valid", "expiring", "expired", "error", "unknown"] as const;
export type TlsStatus = (typeof TLS_STATUSES)[number];
export const TLS_STATUS_LABELS: Record<TlsStatus, string> = {
  valid: "Valide",
  expiring: "Expire bientôt",
  expired: "Expiré",
  error: "Erreur",
  unknown: "Inconnu",
};

export const BACKUP_STATUSES = ["running", "succeeded", "failed"] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];
export const BACKUP_STATUS_LABELS: Record<BackupStatus, string> = {
  running: "En cours",
  succeeded: "Réussie",
  failed: "Échec",
};

// --- Contrats ----------------------------------------------------------------------------------

export const BILLING_PERIODS = ["monthly", "quarterly", "yearly"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];
export const BILLING_PERIOD_LABELS: Record<BillingPeriod, string> = {
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  yearly: "Annuelle",
};

export const CONTRACT_KINDS = ["hosting", "maintenance", "support", "accompaniment"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];
export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  hosting: "Hébergement",
  maintenance: "Maintenance",
  support: "Support",
  accompaniment: "Accompagnement",
};

export const CONTRACT_STATUSES = [
  "to_start",
  "active",
  "to_review",
  "suspended",
  "terminated",
  "expired",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  to_start: "À démarrer",
  active: "Actif",
  to_review: "À revoir",
  suspended: "Suspendu",
  terminated: "Résilié",
  expired: "Expiré",
};

export const CONTRACT_EVENT_KINDS = [
  "created",
  "price_change",
  "renewed",
  "suspended",
  "terminated",
  "note",
] as const;
export type ContractEventKind = (typeof CONTRACT_EVENT_KINDS)[number];
export const CONTRACT_EVENT_KIND_LABELS: Record<ContractEventKind, string> = {
  created: "Création",
  price_change: "Changement de prix",
  renewed: "Renouvellement",
  suspended: "Suspension",
  terminated: "Résiliation",
  note: "Note",
};

// --- Support -----------------------------------------------------------------------------------

export const TICKET_CHANNELS = ["portal", "email", "phone", "internal", "monitoring"] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];
export const TICKET_CHANNEL_LABELS: Record<TicketChannel, string> = {
  portal: "Espace client",
  email: "E-mail",
  phone: "Téléphone",
  internal: "Interne",
  monitoring: "Surveillance",
};

export const TICKET_CATEGORIES = ["incident", "bug", "assistance", "question", "change"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  incident: "Incident",
  bug: "Anomalie",
  assistance: "Assistance",
  question: "Question",
  change: "Évolution",
};

export const TICKET_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number];
export const TICKET_SEVERITY_LABELS: Record<TicketSeverity, string> = {
  low: "Gravité faible",
  medium: "Gravité moyenne",
  high: "Gravité haute",
  critical: "Critique",
};

export const TICKET_STATUSES = [
  "received",
  "qualified",
  "in_progress",
  "resolved",
  "closed",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  received: "Reçue",
  qualified: "Qualifiée",
  in_progress: "En cours",
  resolved: "Résolue",
  closed: "Clôturée",
};

export const TICKET_COVERAGES = ["undetermined", "covered", "not_covered", "overage"] as const;
export type TicketCoverage = (typeof TICKET_COVERAGES)[number];
export const TICKET_COVERAGE_LABELS: Record<TicketCoverage, string> = {
  undetermined: "À déterminer",
  covered: "Couvert",
  not_covered: "Non couvert",
  overage: "Hors forfait",
};

// --- Finances ----------------------------------------------------------------------------------

export const FINANCIAL_DOCUMENT_KINDS = ["invoice", "credit_note"] as const;
export type FinancialDocumentKind = (typeof FINANCIAL_DOCUMENT_KINDS)[number];
export const FINANCIAL_DOCUMENT_KIND_LABELS: Record<FinancialDocumentKind, string> = {
  invoice: "Facture",
  credit_note: "Avoir",
};

export const FINANCIAL_DOCUMENT_SOURCES = ["indy_csv", "manual", "indy_api"] as const;
export type FinancialDocumentSource = (typeof FINANCIAL_DOCUMENT_SOURCES)[number];
export const FINANCIAL_DOCUMENT_SOURCE_LABELS: Record<FinancialDocumentSource, string> = {
  indy_csv: "Import Indy (CSV)",
  manual: "Saisie manuelle",
  indy_api: "API Indy",
};

export const FINANCIAL_DOCUMENT_STATUSES = ["issued", "overdue", "paid", "cancelled"] as const;
export type FinancialDocumentStatus = (typeof FINANCIAL_DOCUMENT_STATUSES)[number];
export const FINANCIAL_DOCUMENT_STATUS_LABELS: Record<FinancialDocumentStatus, string> = {
  issued: "Envoyée",
  overdue: "En retard",
  paid: "Payée",
  cancelled: "Annulée",
};

export const SCHEDULE_ITEM_STATUSES = ["planned", "invoiced", "paid"] as const;
export type ScheduleItemStatus = (typeof SCHEDULE_ITEM_STATUSES)[number];
export const SCHEDULE_ITEM_STATUS_LABELS: Record<ScheduleItemStatus, string> = {
  planned: "Prévue",
  invoiced: "Facturée",
  paid: "Payée",
};

export const COST_CATEGORIES = [
  "subcontracting",
  "hosting",
  "license",
  "purchase",
  "other",
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  subcontracting: "Sous-traitance",
  hosting: "Hébergement",
  license: "Licence",
  purchase: "Achat",
  other: "Autre",
};

export const COST_NATURES = ["forecast", "actual"] as const;
export type CostNature = (typeof COST_NATURES)[number];
export const COST_NATURE_LABELS: Record<CostNature, string> = {
  forecast: "Prévisionnel",
  actual: "Réalisé",
};

// --- Documents ---------------------------------------------------------------------------------

export const DOCUMENT_KINDS = [
  "quote",
  "contract",
  "invoice",
  "mockup",
  "brief",
  "minutes",
  "deliverable",
  "client_file",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  quote: "Devis",
  contract: "Contrat",
  invoice: "Facture",
  mockup: "Maquette",
  brief: "Brief",
  minutes: "Compte rendu",
  deliverable: "Livrable",
  client_file: "Fichier du client",
  other: "Autre",
};

export const DOCUMENT_VISIBILITIES = ["internal", "client"] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];
export const DOCUMENT_VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  internal: "Interne",
  client: "Partagé client",
};

export const DOCUMENT_STATUSES = ["draft", "to_validate", "validated", "signed", "final"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: "Brouillon",
  to_validate: "À valider",
  validated: "Validé",
  signed: "Signé",
  final: "Définitif",
};

export const KNOWLEDGE_KINDS = ["internal", "technical", "faq"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, string> = {
  internal: "Procédure interne",
  technical: "Documentation technique",
  faq: "Problème fréquent",
};

export const TEMPLATE_KINDS = ["brief", "checklist", "message", "project_plan"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  brief: "Brief",
  checklist: "Checklist",
  message: "Message",
  project_plan: "Plan de projet",
};

// --- Échanges ----------------------------------------------------------------------------------

export const MESSAGE_DIRECTIONS = ["inbound", "outbound", "internal"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export const MESSAGE_DIRECTION_LABELS: Record<MessageDirection, string> = {
  inbound: "Reçu",
  outbound: "Envoyé",
  internal: "Note interne",
};

export const SUGGESTION_STATUSES = ["ready", "used", "dismissed", "failed"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, string> = {
  ready: "Réponse prête",
  used: "Utilisée",
  dismissed: "Écartée",
  failed: "Échec",
};

export const COMMENT_ENTITY_TYPES = ["task", "project", "ticket", "deliverable"] as const;
export type CommentEntityType = (typeof COMMENT_ENTITY_TYPES)[number];
export const COMMENT_ENTITY_TYPE_LABELS: Record<CommentEntityType, string> = {
  task: "Tâche",
  project: "Projet",
  ticket: "Demande",
  deliverable: "Livrable",
};

export const APPOINTMENT_SOURCES = ["manual", "cal"] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];
export const APPOINTMENT_SOURCE_LABELS: Record<AppointmentSource, string> = {
  manual: "Saisie interne",
  cal: "Cal.diy",
};

export const APPOINTMENT_STATUSES = ["planned", "done", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  planned: "Prévu",
  done: "Fait",
  cancelled: "Annulé",
};

// --- Portail -----------------------------------------------------------------------------------

export const PORTAL_MEMBERSHIP_STATUSES = ["invited", "active", "revoked"] as const;
export type PortalMembershipStatus = (typeof PORTAL_MEMBERSHIP_STATUSES)[number];
export const PORTAL_MEMBERSHIP_STATUS_LABELS: Record<PortalMembershipStatus, string> = {
  invited: "Invité",
  active: "Actif",
  revoked: "Révoqué",
};

// --- Automatisations et administration ---------------------------------------------------------

export const AUTOMATION_RUN_STATUSES = ["running", "succeeded", "failed", "skipped"] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];
export const AUTOMATION_RUN_STATUS_LABELS: Record<AutomationRunStatus, string> = {
  running: "En cours",
  succeeded: "Réussie",
  failed: "Échec",
  skipped: "Ignorée",
};

export const NOTIFICATION_SEVERITIES = ["info", "warning", "danger"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];
export const NOTIFICATION_SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  info: "Information",
  warning: "Alerte",
  danger: "Urgent",
};

export const INTEGRATION_SERVICES = [
  "twenty",
  "coolify",
  "indy",
  "payload",
  "docuseal",
  "n8n",
  "uptime_kuma",
  "openai",
  "smtp",
  "cal",
] as const;
export type IntegrationService = (typeof INTEGRATION_SERVICES)[number];
export const INTEGRATION_SERVICE_LABELS: Record<IntegrationService, string> = {
  twenty: "Twenty",
  coolify: "Coolify",
  indy: "Indy",
  payload: "Payload",
  docuseal: "DocuSeal",
  n8n: "n8n",
  uptime_kuma: "Uptime Kuma",
  openai: "OpenAI",
  smtp: "E-mail (SMTP)",
  cal: "Cal.diy",
};

export const INTEGRATION_STATUSES = [
  "connected",
  "degraded",
  "unavailable",
  "not_configured",
  "to_verify",
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  connected: "Connecté",
  degraded: "Dégradé",
  unavailable: "Indisponible",
  not_configured: "Connexion requise",
  to_verify: "API à vérifier",
};

export const SYNC_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];
export const SYNC_RUN_STATUS_LABELS: Record<SyncRunStatus, string> = {
  running: "En cours",
  succeeded: "Réussie",
  failed: "Échec",
};

export const WEBHOOK_RECEIPT_STATUSES = ["received", "processed", "failed", "ignored"] as const;
export type WebhookReceiptStatus = (typeof WEBHOOK_RECEIPT_STATUSES)[number];
export const WEBHOOK_RECEIPT_STATUS_LABELS: Record<WebhookReceiptStatus, string> = {
  received: "Reçu",
  processed: "Traité",
  failed: "Échec",
  ignored: "Ignoré",
};

export const EMAIL_STATUSES = ["pending", "sent", "failed", "not_configured"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  pending: "En attente",
  sent: "Envoyé",
  failed: "Échec",
  not_configured: "Connexion requise",
};

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_LABELS: Record<Theme, string> = {
  light: "Clair",
  dark: "Sombre",
  system: "Automatique",
};

export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];
export const DENSITY_LABELS: Record<Density, string> = {
  comfortable: "Confortable",
  compact: "Compacte",
};
