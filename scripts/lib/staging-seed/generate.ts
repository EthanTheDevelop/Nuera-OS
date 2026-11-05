/**
 * Génération du jeu de données STAGING : un plan de lignes, calculé en mémoire, sans base.
 *
 * Reproductible : chaque dossier client est tiré par Faker réinitialisé avec `[graine, rang]`,
 * indépendamment des autres. Augmenter le volume ajoute des dossiers sans changer les premiers ;
 * la même graine et la même date de référence donnent exactement les mêmes lignes.
 *
 * Les identifiants sont dérivés de la graine et d'une clé lisible : ils servent de base à
 * l'idempotence de `apply.ts`. Les numéros lisibles (devis, projets, tâches, tickets) sont
 * attribués à l'insertion, par les compteurs de l'application.
 *
 * Les lignes CRM portent un `twenty_id` en `seed-` : la réconciliation Twenty les ignore et toute
 * écriture vers Twenty sur ces fiches échoue honnêtement (`assertCrmWritable`). Les domaines sont
 * en `.example` et les téléphones dans les plages réservées à la fiction par l'ARCEP : aucun
 * message ne peut atteindre une vraie personne.
 */
import { createHash } from "node:crypto";
import { base, Faker, fr } from "@faker-js/faker";
import type { OfferActivity, OpportunityStage, ProjectStatus } from "@/lib/domain-enums";
import { OFFER_ACTIVITY_LABELS } from "@/lib/domain-enums";
import type * as s from "@/server/db/schema";

/** Préfixe des `twenty_id` du jeu d'essai, reconnu par `crm.shared.ts`. */
export const STAGING_TWENTY_PREFIX = "seed-staging-";
/** Étiquette posée sur chaque entreprise fictive : filtre et repère dans l'interface. */
export const STAGING_TAG = "données-fictives";

export const STAGING_VOLUMES = { small: 25, medium: 80, large: 200 } as const;
export type StagingVolume = keyof typeof STAGING_VOLUMES;
export const MAX_STAGING_COMPANIES = 1000;
export const DEFAULT_STAGING_SEED = 20261105;

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

/** Ligne numérotée : le numéro lisible est attribué à l'insertion. */
type Numbered<T> = Omit<T, "number">;

export interface StagingPlan {
  teamMembers: Insert<typeof s.teamMembers>[];
  memberAbsences: Insert<typeof s.memberAbsences>[];
  catalogItems: Insert<typeof s.catalogItems>[];
  companies: Insert<typeof s.companies>[];
  contacts: Insert<typeof s.contacts>[];
  opportunities: Insert<typeof s.opportunities>[];
  opportunityStageHistory: Insert<typeof s.opportunityStageHistory>[];
  activities: Insert<typeof s.activities>[];
  quotes: Numbered<Insert<typeof s.quotes>>[];
  quoteVersions: Insert<typeof s.quoteVersions>[];
  quoteLines: Insert<typeof s.quoteLines>[];
  /** Versions courante et acceptée, posées après l'insertion des versions. */
  quoteVersionLinks: {
    quoteId: string;
    currentVersionId: string;
    acceptedVersionId: string | null;
  }[];
  projects: Numbered<Insert<typeof s.projects>>[];
  projectPhases: Insert<typeof s.projectPhases>[];
  projectMembers: Insert<typeof s.projectMembers>[];
  tasks: Numbered<Insert<typeof s.tasks>>[];
  timeEntries: Insert<typeof s.timeEntries>[];
  directCosts: Insert<typeof s.directCosts>[];
  paymentScheduleItems: Insert<typeof s.paymentScheduleItems>[];
  financialDocuments: Insert<typeof s.financialDocuments>[];
  /** Document principal d'une échéance, posé après l'insertion des factures. */
  scheduleDocumentLinks: { scheduleItemId: string; financialDocumentId: string }[];
  appointments: Insert<typeof s.appointments>[];
  tickets: Numbered<Insert<typeof s.tickets>>[];
  ticketMessages: Insert<typeof s.ticketMessages>[];
  ticketEvents: Insert<typeof s.ticketEvents>[];
}

export interface StagingOptions {
  seed: number;
  companies: number;
  /** Date de référence : les dossiers s'étalent sur l'année qui la précède. */
  referenceDate: Date;
}

// --- Identifiants et dates -----------------------------------------------------------------------

/** UUID stable, au même format que `seedId` du seed de développement, dans un espace distinct. */
export function stagingId(key: string): string {
  const hash = createHash("sha256").update(`nuera-staging-seed:${key}`).digest("hex");
  const variant = ((parseInt(hash.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `${variant}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

const DAY_MS = 86_400_000;

function clock(referenceDate: Date) {
  const origin = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  );
  const at = (offsetDays: number, hour = 9, minute = 0) =>
    new Date(origin + Math.round(offsetDays) * DAY_MS + (hour * 60 + minute) * 60_000);
  const day = (offsetDays: number) => at(offsetDays, 12).toISOString().slice(0, 10);
  return { at, day };
}

/** Jour ouvré le plus proche, vers l'avant : les rendez-vous et saisies tombent en semaine. */
function workday(offset: number, origin: (o: number, h?: number) => Date): number {
  let value = Math.round(offset);
  for (let guard = 0; guard < 3; guard += 1) {
    const weekday = origin(value).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return value;
    value += 1;
  }
  return value;
}

// --- Référentiels de vraisemblance ---------------------------------------------------------------

const CITIES: readonly [string, string][] = [
  ["Paris", "75011"],
  ["Paris", "75017"],
  ["Lyon", "69002"],
  ["Lyon", "69007"],
  ["Marseille", "13006"],
  ["Bordeaux", "33000"],
  ["Nantes", "44000"],
  ["Lille", "59000"],
  ["Rennes", "35000"],
  ["Toulouse", "31000"],
  ["Montpellier", "34000"],
  ["Strasbourg", "67000"],
  ["Rouen", "76000"],
  ["Caen", "14000"],
  ["Tours", "37000"],
  ["Angers", "49000"],
  ["Dijon", "21000"],
  ["Grenoble", "38000"],
  ["Annecy", "74000"],
  ["Nice", "06000"],
  ["La Rochelle", "17000"],
  ["Biarritz", "64200"],
  ["Le Havre", "76600"],
  ["Reims", "51100"],
  ["Clermont-Ferrand", "63000"],
];

const TRADES: readonly { activity: string; tag: string; offers: OfferActivity[] }[] = [
  { activity: "Boulangerie-pâtisserie", tag: "commerce-local", offers: ["vitrine", "landing"] },
  { activity: "Fleuriste", tag: "commerce-local", offers: ["vitrine", "ecommerce"] },
  { activity: "Cabinet d'avocats", tag: "professions-libérales", offers: ["vitrine", "audit"] },
  { activity: "Cabinet d'expertise comptable", tag: "professions-libérales", offers: ["vitrine"] },
  { activity: "Cabinet de kinésithérapie", tag: "santé", offers: ["vitrine", "landing"] },
  { activity: "Clinique vétérinaire", tag: "santé", offers: ["vitrine"] },
  { activity: "Agence immobilière", tag: "immobilier", offers: ["vitrine", "sur_mesure"] },
  { activity: "Épicerie fine", tag: "e-commerce", offers: ["ecommerce", "vitrine"] },
  { activity: "Caviste", tag: "e-commerce", offers: ["ecommerce"] },
  { activity: "Créatrice de bijoux", tag: "e-commerce", offers: ["ecommerce", "landing"] },
  { activity: "Restaurant", tag: "restauration", offers: ["vitrine", "landing"] },
  { activity: "Hôtel indépendant", tag: "tourisme", offers: ["vitrine", "sur_mesure"] },
  { activity: "Gîtes et chambres d'hôtes", tag: "tourisme", offers: ["vitrine"] },
  { activity: "Salle d'escalade", tag: "loisirs", offers: ["vitrine", "sur_mesure"] },
  { activity: "École de musique", tag: "formation", offers: ["vitrine", "sur_mesure"] },
  { activity: "Organisme de formation", tag: "formation", offers: ["sur_mesure", "landing"] },
  { activity: "Architecte d'intérieur", tag: "artisanat", offers: ["vitrine", "landing"] },
  { activity: "Menuiserie", tag: "artisanat", offers: ["vitrine"] },
  { activity: "Brasserie artisanale", tag: "e-commerce", offers: ["ecommerce", "vitrine"] },
  { activity: "Start-up SaaS", tag: "tech", offers: ["landing", "sur_mesure", "audit"] },
  { activity: "Association culturelle", tag: "associatif", offers: ["vitrine"] },
  { activity: "Cabinet de recrutement", tag: "services", offers: ["vitrine", "sur_mesure"] },
];

const SOURCES = ["Réseau", "Site", "Prescripteur", "LinkedIn", "Salon", "Bouche-à-oreille"];
const JOB_TITLES = [
  "Gérant",
  "Gérante",
  "Directrice",
  "Directeur",
  "Responsable marketing",
  "Assistante de direction",
  "Comptable",
  "Responsable communication",
  "Fondatrice",
  "Fondateur",
];
const LOST_REASONS = [
  "Budget insuffisant cette année",
  "Choix d'un prestataire moins cher",
  "Projet reporté à l'an prochain",
  "Préfère une solution clé en main",
  "Pas de réponse après relances",
];
const NEXT_ACTIONS = [
  "Relancer par téléphone",
  "Envoyer des références similaires",
  "Préparer la proposition",
  "Caler un atelier de cadrage",
  "Répondre aux questions sur le devis",
];

const PHASES = ["Cadrage", "Design", "Développement", "Recette", "Mise en ligne"] as const;
const PHASE_TASKS: Record<(typeof PHASES)[number], string[]> = {
  Cadrage: [
    "Atelier de cadrage",
    "Arborescence du site",
    "Collecte des contenus",
    "Benchmark concurrentiel",
  ],
  Design: [
    "Moodboard",
    "Maquette de la page d'accueil",
    "Maquettes des pages internes",
    "Version mobile",
  ],
  Développement: [
    "Intégration de la page d'accueil",
    "Intégration des pages internes",
    "Formulaire de contact",
    "Configuration du CMS",
    "Optimisation des performances",
  ],
  Recette: ["Recette interne", "Corrections de la recette client", "Tests multi-navigateurs"],
  "Mise en ligne": [
    "Configuration du domaine",
    "Redirections et référencement",
    "Formation du client",
  ],
};

const TICKET_SUBJECTS: readonly {
  subject: string;
  category: "bug" | "assistance" | "question" | "change" | "incident";
}[] = [
  { subject: "Le formulaire de contact n'envoie plus d'e-mail", category: "bug" },
  { subject: "Comment ajouter une actualité ?", category: "question" },
  { subject: "Changer les horaires d'ouverture", category: "assistance" },
  { subject: "Ajouter une page « Nos réalisations »", category: "change" },
  { subject: "Le site est lent sur mobile", category: "incident" },
  { subject: "Mettre à jour les photos de l'équipe", category: "assistance" },
  { subject: "Erreur au paiement sur la boutique", category: "bug" },
];

const ACTIVITY_SUBJECTS = {
  call: ["Premier appel de découverte", "Point téléphonique sur le besoin", "Relance téléphonique"],
  email: ["Envoi de la plaquette", "Envoi de références", "Questions sur le devis"],
  meeting: ["Rendez-vous de présentation", "Atelier de cadrage", "Point d'avancement"],
  note: ["Compte rendu de l'échange", "Contexte et enjeux du client", "Préférences de contact"],
} as const;

// --- Outils de tirage ----------------------------------------------------------------------------

function createFaker(seed: readonly number[]): Faker {
  const faker = new Faker({ locale: [fr, base] });
  faker.seed([...seed]);
  return faker;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * SIREN fictif mais valide (clé de Luhn), unique pour une graine : dérivé du rang du dossier, dans
 * la plage 8xxxxxxxx, distincte du seed de développement (9xxxxxxxx).
 */
export function stagingSiren(seed: number, index: number): string {
  const digits = `8${String((seed * 7919 + index) % 10_000_000).padStart(7, "0")}`;
  let sum = 0;
  for (let index = 0; index < 8; index += 1) {
    let value = Number(digits[7 - index]);
    if (index % 2 === 0) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
  }
  return `${digits}${(10 - (sum % 10)) % 10}`;
}

/** Plages ARCEP réservées aux œuvres de fiction : 01 99 00 xx xx et 06 39 98 xx xx. */
const landline = (faker: Faker) => `+3319900${faker.string.numeric(4)}`;
const mobile = (faker: Faker) => `+33639980${faker.string.numeric(3)}`;

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

// --- Équipe et catalogue, communs à toutes les graines -------------------------------------------

interface Member {
  id: string;
  kind: "partner" | "employee" | "contractor";
  hourlyCostCents: number;
}

function buildTeam(plan: StagingPlan, referenceDate: Date): Member[] {
  const faker = createFaker([0x7e4a]);
  const { day } = clock(referenceDate);
  const profiles = [
    {
      kind: "partner",
      title: "Associé·e · direction de projet",
      skills: ["Direction de projet", "Commercial"],
      capacity: 2100,
      cost: 5000,
    },
    {
      kind: "partner",
      title: "Associé·e · technique",
      skills: ["Next.js", "Infrastructure"],
      capacity: 2100,
      cost: 5000,
    },
    {
      kind: "employee",
      title: "Développeur·se",
      skills: ["Next.js", "Intégration"],
      capacity: 2100,
      cost: 3500,
    },
    {
      kind: "employee",
      title: "Chef·fe de projet",
      skills: ["Gestion de projet", "Recette"],
      capacity: 2100,
      cost: 3200,
    },
    {
      kind: "contractor",
      title: "Graphiste indépendant·e",
      skills: ["Direction artistique", "Illustration"],
      capacity: 840,
      cost: 6000,
    },
    {
      kind: "contractor",
      title: "Rédacteur·rice web",
      skills: ["Rédaction", "SEO"],
      capacity: 600,
      cost: 4500,
    },
  ] as const;
  return profiles.map((profile, index) => {
    const id = stagingId(`shared:member:${index}`);
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    plan.teamMembers.push({
      id,
      kind: profile.kind,
      fullName: `${firstName} ${lastName}`,
      email: `${slugify(firstName)}.${slugify(lastName)}@equipe.example`,
      phone: mobile(faker),
      title: profile.title,
      skills: [...profile.skills],
      weeklyCapacityMinutes: profile.capacity,
      hourlyCostCents: profile.cost,
      dayRateCents: profile.kind === "employee" ? null : profile.cost * 9,
      conditions:
        profile.kind === "contractor" ? "Facturation à la journée, 30 jours fin de mois." : null,
      specialty: profile.kind === "contractor" ? profile.skills[0] : null,
    });
    const start = faker.number.int({ min: -120, max: 60 });
    plan.memberAbsences.push({
      id: stagingId(`shared:absence:${index}`),
      memberId: id,
      startOn: day(start),
      endOn: day(start + faker.number.int({ min: 0, max: 9 })),
      reason: faker.helpers.arrayElement(["Congés", "Formation", "Salon professionnel"]),
    });
    return { id, kind: profile.kind, hourlyCostCents: profile.cost };
  });
}

interface CatalogEntry {
  id: string;
  activity: OfferActivity;
  kind: "project" | "recurring" | "option";
  name: string;
  priceCents: number;
  costCents: number;
  minutes: number;
}

function buildCatalog(plan: StagingPlan): Record<string, CatalogEntry> {
  const rows: Omit<CatalogEntry, "id">[] = [
    {
      activity: "vitrine",
      kind: "project",
      name: "Site vitrine",
      priceCents: 450000,
      costCents: 90000,
      minutes: 3600,
    },
    {
      activity: "landing",
      kind: "project",
      name: "Landing page",
      priceCents: 180000,
      costCents: 30000,
      minutes: 1440,
    },
    {
      activity: "ecommerce",
      kind: "project",
      name: "Boutique en ligne",
      priceCents: 950000,
      costCents: 210000,
      minutes: 7800,
    },
    {
      activity: "sur_mesure",
      kind: "project",
      name: "Application sur mesure",
      priceCents: 1800000,
      costCents: 420000,
      minutes: 14400,
    },
    {
      activity: "audit",
      kind: "project",
      name: "Audit de site existant",
      priceCents: 120000,
      costCents: 15000,
      minutes: 900,
    },
    {
      activity: "maintenance",
      kind: "recurring",
      name: "Maintenance mensuelle",
      priceCents: 9000,
      costCents: 1500,
      minutes: 60,
    },
    {
      activity: "hebergement",
      kind: "recurring",
      name: "Hébergement managé",
      priceCents: 3500,
      costCents: 900,
      minutes: 10,
    },
    {
      activity: "accompagnement",
      kind: "option",
      name: "Journée d'accompagnement",
      priceCents: 65000,
      costCents: 0,
      minutes: 420,
    },
    {
      activity: "vitrine",
      kind: "option",
      name: "Séance photo professionnelle",
      priceCents: 60000,
      costCents: 35000,
      minutes: 240,
    },
  ];
  const catalog: Record<string, CatalogEntry> = {};
  for (const row of rows) {
    const key = slugify(row.name);
    const entry = { ...row, id: stagingId(`shared:catalog:${key}`) };
    catalog[key] = entry;
    plan.catalogItems.push({
      id: entry.id,
      kind: row.kind,
      activity: row.activity,
      name: row.name,
      priceCents: row.priceCents,
      estimatedCostCents: row.costCents,
      estimatedMinutes: row.minutes,
      validityDays: 30,
      depositPercent: row.kind === "project" ? 30 : null,
      conditions: row.kind === "recurring" ? "Engagement de 12 mois, facturation mensuelle." : null,
    });
  }
  return catalog;
}

// --- Dossiers clients ----------------------------------------------------------------------------

const MAIN_OFFER: Record<OfferActivity, string> = {
  vitrine: "site-vitrine",
  landing: "landing-page",
  ecommerce: "boutique-en-ligne",
  sur_mesure: "application-sur-mesure",
  audit: "audit-de-site-existant",
  maintenance: "maintenance-mensuelle",
  hebergement: "hebergement-manage",
  accompagnement: "journee-d-accompagnement",
};

const STAGE_PROBABILITY: Record<OpportunityStage, number> = {
  NEW: 10,
  QUALIFIED: 30,
  QUOTE_SENT: 50,
  NEGOTIATION: 70,
  WON: 100,
  LOST: 0,
};
const STAGE_PATH: OpportunityStage[] = ["NEW", "QUALIFIED", "QUOTE_SENT", "NEGOTIATION"];

interface DossierContext {
  faker: Faker;
  seed: number;
  index: number;
  plan: StagingPlan;
  key: string;
  members: Member[];
  catalog: Record<string, CatalogEntry>;
  at: (offsetDays: number, hour?: number, minute?: number) => Date;
  day: (offsetDays: number) => string;
}

function buildDossier(ctx: DossierContext): void {
  const { faker, plan, key, members, at, day } = ctx;
  const id = (suffix: string) => stagingId(`${key}:${suffix}`);
  const partners = members.filter((member) => member.kind === "partner");
  const owner = faker.helpers.arrayElement(partners);

  const status = faker.helpers.weightedArrayElement([
    { weight: 40, value: "prospect" as const },
    { weight: 30, value: "client" as const },
    { weight: 12, value: "subscriber" as const },
    { weight: 10, value: "former" as const },
    { weight: 8, value: "partner" as const },
  ]);
  const trade = faker.helpers.arrayElement(TRADES);
  const [city, postalCode] = faker.helpers.arrayElement(CITIES);
  const name = faker.company.name();
  const domain = `${slugify(name)}.example`;
  // Premier contact : plus ancien pour un ancien client, récent pour un prospect.
  const firstContact =
    status === "former"
      ? -faker.number.int({ min: 330, max: 540 })
      : status === "prospect"
        ? -faker.number.int({ min: 5, max: 150 })
        : -faker.number.int({ min: 60, max: 360 });

  const companyId = id("company");
  plan.companies.push({
    id: companyId,
    twentyId: `${STAGING_TWENTY_PREFIX}company-${companyId}`,
    name,
    domain,
    addressLine: faker.location.streetAddress(),
    city,
    postalCode,
    country: "France",
    status,
    activity: trade.activity,
    siren: stagingSiren(ctx.seed, ctx.index),
    phone: landline(faker),
    source: faker.helpers.arrayElement(SOURCES),
    tags: [STAGING_TAG, trade.tag],
    ownerMemberId: owner.id,
    notes: faker.helpers.maybe(
      () =>
        faker.helpers.arrayElement([
          "Préfère être contacté le matin.",
          "Décision prise à deux avec l'associé.",
          "Sensible aux délais : prévenir tôt en cas de retard.",
          "Budget validé en conseil d'administration.",
        ]),
      { probability: 0.4 },
    ),
    createdAt: at(firstContact),
  });

  // Contacts : le premier est le décideur principal.
  const contactIds: string[] = [];
  const contactCount = faker.number.int({ min: 1, max: 3 });
  for (let index = 0; index < contactCount; index += 1) {
    const contactId = id(`contact:${index}`);
    contactIds.push(contactId);
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    plan.contacts.push({
      id: contactId,
      twentyId: `${STAGING_TWENTY_PREFIX}person-${contactId}`,
      companyId,
      firstName,
      lastName,
      email: `${slugify(firstName)}.${slugify(lastName)}@${domain}`,
      phone: mobile(faker),
      jobTitle: faker.helpers.arrayElement(JOB_TITLES),
      roles:
        index === 0
          ? ["decision", "signatory"]
          : [faker.helpers.arrayElement(["technical", "billing"] as const)],
      isPrimary: index === 0,
      createdAt: at(firstContact),
    });
  }
  const mainContact = contactIds[0] ?? null;

  addActivity(ctx, {
    companyId,
    contactId: mainContact,
    opportunityId: null,
    offset: firstContact,
    kind: "call",
    ownerId: owner.id,
    index: 0,
  });
  if (status === "partner") {
    addActivity(ctx, {
      companyId,
      contactId: mainContact,
      opportunityId: null,
      offset: firstContact + 20,
      kind: "meeting",
      ownerId: owner.id,
      index: 1,
    });
    return;
  }

  // --- Affaire principale ---
  const offer = faker.helpers.arrayElement(trade.offers);
  const stage: OpportunityStage =
    status === "prospect"
      ? faker.helpers.weightedArrayElement([
          { weight: 20, value: "NEW" as const },
          { weight: 25, value: "QUALIFIED" as const },
          { weight: 25, value: "QUOTE_SENT" as const },
          { weight: 15, value: "NEGOTIATION" as const },
          { weight: 15, value: "LOST" as const },
        ])
      : "WON";
  const opportunityStart = Math.min(-2, firstContact + faker.number.int({ min: 0, max: 10 }));
  const main = ctx.catalog[MAIN_OFFER[offer]];
  if (!main) throw new Error(`Offre absente du catalogue : ${offer}`);
  const amountCents = roundTo(main.priceCents * faker.number.float({ min: 0.85, max: 1.35 }), 5000);

  const reachedQuote =
    stage === "QUOTE_SENT" ||
    stage === "NEGOTIATION" ||
    stage === "WON" ||
    (stage === "LOST" && faker.datatype.boolean());
  const quoteSentOffset = Math.min(-1, opportunityStart + faker.number.int({ min: 7, max: 20 }));
  const closeOffset =
    stage === "WON" || stage === "LOST"
      ? Math.min(-1, quoteSentOffset + faker.number.int({ min: 7, max: 30 }))
      : null;

  const opportunityId = id("opportunity");
  plan.opportunities.push({
    id: opportunityId,
    twentyId: `${STAGING_TWENTY_PREFIX}opportunity-${opportunityId}`,
    companyId,
    contactId: mainContact,
    name: `${OFFER_ACTIVITY_LABELS[offer]} · ${name}`,
    stage,
    amountCents,
    expectedCloseOn: day(closeOffset ?? faker.number.int({ min: 10, max: 75 })),
    probability: STAGE_PROBABILITY[stage],
    source: faker.helpers.arrayElement(SOURCES),
    need: faker.helpers.arrayElement([
      "Refonte d'un site vieillissant, peu visible sur mobile.",
      "Premier site : être trouvé sur Google localement.",
      "Vendre en ligne en complément de la boutique.",
      "Outil interne pour remplacer des tableurs.",
      "Page de lancement pour une nouvelle offre.",
    ]),
    budgetEstimateCents: roundTo(amountCents * faker.number.float({ min: 0.7, max: 1.1 }), 10000),
    ownerMemberId: owner.id,
    nextAction:
      stage === "WON" || stage === "LOST" ? null : faker.helpers.arrayElement(NEXT_ACTIONS),
    nextActionOn:
      stage === "WON" || stage === "LOST" ? null : day(faker.number.int({ min: -3, max: 14 })),
    lostReason: stage === "LOST" ? faker.helpers.arrayElement(LOST_REASONS) : null,
    wonAt: stage === "WON" && closeOffset !== null ? at(closeOffset, 15) : null,
    lostAt: stage === "LOST" && closeOffset !== null ? at(closeOffset, 15) : null,
    lastActivityAt: at(closeOffset ?? Math.min(-1, opportunityStart + 15), 11),
    createdAt: at(opportunityStart),
  });

  // Historique des étapes, de la création jusqu'à l'étape actuelle.
  const path: OpportunityStage[] =
    stage === "WON"
      ? [...STAGE_PATH.slice(0, faker.number.int({ min: 3, max: 4 })), "WON"]
      : stage === "LOST"
        ? [...STAGE_PATH.slice(0, reachedQuote ? 3 : faker.number.int({ min: 1, max: 2 })), "LOST"]
        : STAGE_PATH.slice(0, STAGE_PATH.indexOf(stage) + 1);
  const lastStep = closeOffset ?? Math.min(-1, quoteSentOffset);
  path.forEach((toStage, index) => {
    const offset =
      path.length === 1
        ? opportunityStart
        : opportunityStart + ((lastStep - opportunityStart) * index) / (path.length - 1);
    plan.opportunityStageHistory.push({
      id: id(`stage:${index}`),
      opportunityId,
      fromStage: index === 0 ? null : (path[index - 1] ?? null),
      toStage,
      at: at(offset, 10 + index),
    });
  });

  // Échanges commerciaux.
  addActivity(ctx, {
    companyId,
    contactId: mainContact,
    opportunityId,
    offset: opportunityStart + 2,
    kind: "meeting",
    ownerId: owner.id,
    index: 1,
  });
  addActivity(ctx, {
    companyId,
    contactId: mainContact,
    opportunityId,
    offset: opportunityStart + 5,
    kind: "note",
    ownerId: owner.id,
    index: 2,
  });
  if (reachedQuote) {
    addActivity(ctx, {
      companyId,
      contactId: mainContact,
      opportunityId,
      offset: quoteSentOffset,
      kind: "email",
      ownerId: owner.id,
      index: 3,
    });
  }
  if (stage !== "WON" && stage !== "LOST") {
    // Tâche de relance à venir, ou en retard pour une partie des affaires.
    const due = faker.number.int({ min: -4, max: 12 });
    plan.activities.push({
      id: id("activity:followup"),
      kind: "task",
      companyId,
      contactId: mainContact,
      opportunityId,
      subject: faker.helpers.arrayElement(NEXT_ACTIONS),
      dueAt: at(due, 10),
      ownerMemberId: owner.id,
      occurredAt: at(Math.min(-1, due - 7), 10),
    });
  }

  // Rendez-vous de découverte (passé) et prochain rendez-vous commercial (futur).
  addAppointment(ctx, {
    key: "appointment:discovery",
    companyId,
    contactId: mainContact,
    opportunityId,
    projectId: null,
    title: `Découverte · ${name}`,
    kind: "Découverte",
    offset: opportunityStart + 1,
    status: "done",
    memberIds: [owner.id],
    clientVisible: false,
  });
  if (stage === "QUALIFIED" || stage === "QUOTE_SENT" || stage === "NEGOTIATION") {
    addAppointment(ctx, {
      key: "appointment:next",
      companyId,
      contactId: mainContact,
      opportunityId,
      projectId: null,
      title:
        stage === "QUALIFIED"
          ? `Présentation de la proposition · ${name}`
          : `Point sur le devis · ${name}`,
      kind: "Commercial",
      offset: faker.number.int({ min: 1, max: 21 }),
      status: "planned",
      memberIds: [owner.id],
      clientVisible: false,
    });
  }

  // --- Devis ---
  if (!reachedQuote) {
    if (stage === "QUALIFIED" && faker.datatype.boolean({ probability: 0.4 })) {
      buildQuote(ctx, {
        companyId,
        opportunityId,
        offer,
        quoteStatus: "draft",
        sentOffset: null,
        closeOffset: null,
        ownerName: name,
      });
    }
    return;
  }
  const quoteStatus =
    stage === "WON"
      ? "accepted"
      : stage === "LOST"
        ? faker.helpers.arrayElement(["refused", "expired"] as const)
        : stage === "NEGOTIATION"
          ? "negotiation"
          : "sent";
  const quote = buildQuote(ctx, {
    companyId,
    opportunityId,
    offer,
    quoteStatus,
    sentOffset: quoteSentOffset,
    closeOffset,
    ownerName: name,
  });
  if (stage !== "WON" || closeOffset === null || status === "prospect") return;

  buildProject(ctx, {
    companyId,
    opportunityId,
    quote,
    offer,
    companyName: name,
    companyStatus: status,
    signedOffset: closeOffset,
    owner,
    contactId: mainContact,
  });
}

function addActivity(
  ctx: DossierContext,
  input: {
    companyId: string;
    contactId: string | null;
    opportunityId: string | null;
    offset: number;
    kind: "call" | "email" | "meeting" | "note";
    ownerId: string;
    index: number;
  },
): void {
  const { faker, plan, at } = ctx;
  if (input.offset > -1) return;
  const offset = workday(input.offset, at);
  if (offset > -1) return;
  plan.activities.push({
    id: stagingId(`${ctx.key}:activity:${input.index}`),
    kind: input.kind,
    companyId: input.companyId,
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    subject: faker.helpers.arrayElement(ACTIVITY_SUBJECTS[input.kind]),
    body: faker.helpers.arrayElement([
      "Échange cordial, besoin bien identifié.",
      "Le client souhaite un calendrier précis avant de s'engager.",
      "Attentes fortes sur le référencement local.",
      "Demande à voir des exemples de sites livrés.",
    ]),
    completedAt: at(offset, 11),
    ownerMemberId: input.ownerId,
    occurredAt: at(offset, faker.number.int({ min: 9, max: 17 })),
  });
}

function addAppointment(
  ctx: DossierContext,
  input: {
    key: string;
    companyId: string;
    contactId: string | null;
    opportunityId: string | null;
    projectId: string | null;
    title: string;
    kind: string;
    offset: number;
    status: "planned" | "done" | "cancelled";
    memberIds: string[];
    clientVisible: boolean;
  },
): void {
  const { faker, plan, at } = ctx;
  const offset = workday(input.offset, at);
  // Un rendez-vous « fait » ne peut pas être dans le futur, ni « prévu » dans le passé.
  const status =
    input.status === "done" && offset >= 0
      ? "planned"
      : input.status === "planned" && offset < 0
        ? "done"
        : input.status;
  const channel = faker.helpers.arrayElement(["Visio", "Téléphone", "Sur place"]);
  plan.appointments.push({
    id: stagingId(`${ctx.key}:${input.key}`),
    companyId: input.companyId,
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    projectId: input.projectId,
    title: input.title,
    kind: input.kind,
    startsAt: at(
      offset,
      faker.helpers.arrayElement([9, 10, 11, 14, 15, 16]),
      faker.helpers.arrayElement([0, 30]),
    ),
    durationMinutes: faker.helpers.arrayElement([30, 45, 60, 90]),
    channel,
    location: channel === "Sur place" ? "Locaux du client" : null,
    memberIds: [...new Set(input.memberIds)],
    source: "manual",
    status,
    clientVisible: input.clientVisible,
  });
}

interface BuiltQuote {
  id: string;
  versionId: string;
  totalCents: number;
  estimatedMinutes: number;
  depositPercent: number;
  recurringCents: number;
}

function buildQuote(
  ctx: DossierContext,
  input: {
    companyId: string;
    opportunityId: string;
    offer: OfferActivity;
    quoteStatus: "draft" | "sent" | "negotiation" | "accepted" | "refused" | "expired";
    sentOffset: number | null;
    closeOffset: number | null;
    ownerName: string;
  },
): BuiltQuote {
  const { faker, plan, catalog, at, day } = ctx;
  const quoteId = stagingId(`${ctx.key}:quote`);
  const main = catalog[MAIN_OFFER[input.offer]];
  if (!main) throw new Error(`Offre absente du catalogue : ${input.offer}`);
  const options = faker.helpers.arrayElements(
    [
      catalog["seance-photo-professionnelle"],
      catalog["journee-d-accompagnement"],
      catalog["maintenance-mensuelle"],
      catalog["hebergement-manage"],
    ].filter((entry): entry is CatalogEntry => Boolean(entry)),
    { min: 0, max: 3 },
  );
  const versionCount =
    input.quoteStatus === "negotiation" || faker.datatype.boolean({ probability: 0.25 }) ? 2 : 1;
  const depositPercent = faker.helpers.arrayElement([30, 40, 50]);
  const createdOffset = (input.sentOffset ?? -faker.number.int({ min: 1, max: 10 })) - 2;

  let last: BuiltQuote | null = null;
  let firstVersionId: string | null = null;
  for (let version = 1; version <= versionCount; version += 1) {
    const versionId = stagingId(`${ctx.key}:quote-version:${version}`);
    firstVersionId ??= versionId;
    // La seconde version consent une remise, signe d'une négociation.
    const discount = version === 2 ? faker.number.float({ min: 0.88, max: 0.96 }) : 1;
    const lines = [
      {
        entry: main,
        quantity: 1,
        unitPriceCents: roundTo(
          main.priceCents * faker.number.float({ min: 0.9, max: 1.3 }) * discount,
          500,
        ),
        unitLabel: null as string | null,
      },
      ...options.map((entry) =>
        entry.kind === "recurring"
          ? { entry, quantity: 12, unitPriceCents: entry.priceCents, unitLabel: "12 mois" }
          : entry.activity === "accompagnement"
            ? {
                entry,
                quantity: faker.number.int({ min: 1, max: 3 }),
                unitPriceCents: entry.priceCents,
                unitLabel: "jour",
              }
            : { entry, quantity: 1, unitPriceCents: entry.priceCents, unitLabel: null },
      ),
    ];
    let totalCents = 0;
    let costCents = 0;
    let minutes = 0;
    let recurringCents = 0;
    lines.forEach((line, position) => {
      totalCents += line.quantity * line.unitPriceCents;
      costCents += line.quantity * line.entry.costCents;
      minutes += line.quantity * line.entry.minutes;
      if (line.entry.kind === "recurring") recurringCents += line.quantity * line.unitPriceCents;
      plan.quoteLines.push({
        id: stagingId(`${ctx.key}:quote-line:${version}:${position}`),
        quoteVersionId: versionId,
        catalogItemId: line.entry.id,
        label: line.entry.name,
        unitLabel: line.unitLabel,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        estimatedCostCents: line.quantity * line.entry.costCents,
        estimatedMinutes: line.quantity * line.entry.minutes,
        position,
      });
    });
    const versionSent = input.sentOffset === null ? null : input.sentOffset + (version - 1) * 6;
    plan.quoteVersions.push({
      id: versionId,
      quoteId,
      version,
      scope: `${main.name} : conception, réalisation et mise en ligne.`,
      exclusions: "Rédaction des contenus et achat de photos non inclus, sauf mention contraire.",
      conditions: `Acompte de ${depositPercent} % à la commande, solde à la livraison.`,
      validUntil: day((versionSent ?? createdOffset) + 30),
      depositPercent,
      totalCents,
      taxPercent: 20,
      estimatedCostCents: costCents,
      estimatedMinutes: minutes,
      changeNote: version === 2 ? "Remise accordée après échange avec le client." : null,
      sentAt: versionSent === null || versionSent > 0 ? null : at(versionSent, 16),
      createdAt: at((versionSent ?? createdOffset) - 1, 15),
    });
    last = {
      id: quoteId,
      versionId,
      totalCents,
      estimatedMinutes: minutes,
      depositPercent,
      recurringCents,
    };
  }
  if (!last || !firstVersionId) throw new Error("Devis sans version.");

  const accepted = input.quoteStatus === "accepted";
  const closeAt = input.closeOffset === null ? null : at(input.closeOffset, 15);
  const signatureStatus = accepted
    ? "signed"
    : input.quoteStatus === "sent" || input.quoteStatus === "negotiation"
      ? faker.helpers.arrayElement(["pending", "none"] as const)
      : input.quoteStatus === "refused"
        ? faker.helpers.arrayElement(["declined", "none"] as const)
        : "none";
  plan.quotes.push({
    id: quoteId,
    companyId: input.companyId,
    opportunityId: input.opportunityId,
    title: OFFER_ACTIVITY_LABELS[input.offer],
    status: input.quoteStatus,
    issuedByNote: null,
    signatureStatus,
    signedAt: accepted ? closeAt : null,
    sentAt: input.sentOffset === null ? null : at(input.sentOffset, 16),
    acceptedAt: accepted ? closeAt : null,
    refusedAt: input.quoteStatus === "refused" ? closeAt : null,
    lastReminderAt:
      input.quoteStatus === "sent" && input.sentOffset !== null && input.sentOffset < -8
        ? at(input.sentOffset + 7, 10)
        : null,
    createdAt: at(createdOffset, 14),
  });
  plan.quoteVersionLinks.push({
    quoteId,
    currentVersionId: last.versionId,
    acceptedVersionId: accepted ? last.versionId : null,
  });
  return last;
}

function buildProject(
  ctx: DossierContext,
  input: {
    companyId: string;
    opportunityId: string;
    quote: BuiltQuote;
    offer: OfferActivity;
    companyName: string;
    companyStatus: "client" | "subscriber" | "former";
    signedOffset: number;
    owner: Member;
    contactId: string | null;
  },
): void {
  const { faker, plan, members, at, day } = ctx;
  const key = ctx.key;
  const projectId = stagingId(`${key}:project`);
  const start = input.signedOffset + faker.number.int({ min: 5, max: 15 });
  const duration = Math.max(
    20,
    Math.round(input.quote.estimatedMinutes / 120) + faker.number.int({ min: 10, max: 30 }),
  );
  const due = start + duration;
  const progress = (0 - start) / duration;

  let status: ProjectStatus;
  if (input.companyStatus === "former") status = "closed";
  else if (input.companyStatus === "subscriber") status = progress >= 1 ? "delivered" : "active";
  else if (progress < 0) status = "preparation";
  else if (progress < 0.9)
    status = faker.datatype.boolean({ probability: 0.12 }) ? "blocked" : "active";
  else if (progress < 1.1) status = "in_validation";
  else status = faker.datatype.boolean({ probability: 0.7 }) ? "delivered" : "closed";
  const finished = status === "delivered" || status === "closed";
  // Avancement effectif, borné : un projet livré l'est entièrement.
  const effective = finished ? 1 : Math.min(0.95, Math.max(0, progress));
  const deliveredOffset = finished
    ? Math.min(-1, due + faker.number.int({ min: -3, max: 10 }))
    : null;

  const team = [
    input.owner,
    ...faker.helpers.arrayElements(
      members.filter((member) => member.id !== input.owner.id),
      { min: 1, max: 3 },
    ),
  ];

  plan.projects.push({
    id: projectId,
    companyId: input.companyId,
    opportunityId: input.opportunityId,
    quoteId: input.quote.id,
    name: `${OFFER_ACTIVITY_LABELS[input.offer]} ${input.companyName}`,
    activity: input.offer,
    objective: faker.helpers.arrayElement([
      "Gagner en visibilité locale et générer des demandes de contact.",
      "Vendre en ligne sans dépendre des places de marché.",
      "Moderniser l'image de marque et rassurer les nouveaux clients.",
      "Remplacer un outil vieillissant par une solution simple à maintenir.",
    ]),
    scope: `Périmètre du devis accepté (${OFFER_ACTIVITY_LABELS[input.offer]}).`,
    status,
    priority: faker.helpers.weightedArrayElement([
      { weight: 15, value: "low" as const },
      { weight: 60, value: "normal" as const },
      { weight: 20, value: "high" as const },
      { weight: 5, value: "urgent" as const },
    ]),
    ownerMemberId: input.owner.id,
    startOn: day(start),
    dueOn: day(due),
    deliveredOn: deliveredOffset === null ? null : day(deliveredOffset),
    budgetCents: input.quote.totalCents - input.quote.recurringCents,
    estimatedMinutes: input.quote.estimatedMinutes,
    clientStepLabel: finished
      ? "Site en ligne"
      : status === "in_validation"
        ? "Votre validation est attendue"
        : null,
    archivedAt:
      status === "closed" && deliveredOffset !== null
        ? at(Math.min(-1, deliveredOffset + 30))
        : null,
    createdAt: at(input.signedOffset, 16),
  });

  team.forEach((member, index) => {
    plan.projectMembers.push({
      id: stagingId(`${key}:project-member:${member.id}`),
      projectId,
      memberId: member.id,
      role:
        index === 0
          ? "Direction de projet"
          : member.kind === "contractor"
            ? "Prestataire"
            : "Production",
    });
  });

  // Phases et tâches, réparties sur la durée du projet.
  let taskIndex = 0;
  PHASES.forEach((phaseName, phaseIndex) => {
    const phaseStart = start + (duration * phaseIndex) / PHASES.length;
    const phaseEnd = start + (duration * (phaseIndex + 1)) / PHASES.length;
    const phaseProgress = effective * PHASES.length - phaseIndex;
    const phaseStatus = phaseProgress >= 1 ? "done" : phaseProgress > 0 ? "in_progress" : "todo";
    const phaseId = stagingId(`${key}:phase:${phaseIndex}`);
    plan.projectPhases.push({
      id: phaseId,
      projectId,
      name: phaseName,
      position: phaseIndex,
      dueOn: day(phaseEnd),
      status: phaseStatus,
      clientVisible: true,
    });
    const titles = faker.helpers.arrayElements(PHASE_TASKS[phaseName], { min: 2, max: 4 });
    titles.forEach((title, position) => {
      const assignee = faker.helpers.arrayElement(team);
      const taskDue = phaseStart + ((phaseEnd - phaseStart) * (position + 1)) / titles.length;
      const taskStatus =
        phaseStatus === "done"
          ? "done"
          : phaseStatus === "todo"
            ? "todo"
            : position / titles.length < phaseProgress
              ? "done"
              : status === "blocked" && position === titles.length - 1
                ? "blocked"
                : faker.helpers.arrayElement(["todo", "in_progress"] as const);
      const estimated = faker.helpers.arrayElement([60, 120, 180, 240, 360, 480]);
      const taskId = stagingId(`${key}:task:${taskIndex}`);
      taskIndex += 1;
      const completedOffset = taskStatus === "done" ? Math.min(-1, taskDue) : null;
      plan.tasks.push({
        id: taskId,
        projectId,
        phaseId,
        title,
        status: taskStatus,
        priority: faker.helpers.weightedArrayElement([
          { weight: 70, value: "normal" as const },
          { weight: 20, value: "high" as const },
          { weight: 10, value: "low" as const },
        ]),
        assigneeMemberId: assignee.id,
        dueOn: day(taskDue),
        estimatedMinutes: estimated,
        position,
        completedAt: completedOffset === null ? null : at(completedOffset, 17),
        createdAt: at(input.signedOffset + 1, 10),
      });

      // Temps passé : sur les tâches faites ou en cours, toujours dans le passé.
      if (taskStatus === "todo") return;
      const entryCount = faker.number.int({ min: 1, max: 3 });
      for (let entry = 0; entry < entryCount; entry += 1) {
        const workOffset = workday(
          Math.min(
            -1,
            phaseStart +
              faker.number.float({ min: 0, max: Math.max(1, Math.min(0, taskDue) - phaseStart) }),
          ),
          at,
        );
        if (workOffset > -1) continue;
        plan.timeEntries.push({
          id: stagingId(`${key}:time:${taskId}:${entry}`),
          memberId: assignee.id,
          companyId: input.companyId,
          projectId,
          taskId,
          workOn: day(workOffset),
          minutes:
            roundTo(faker.number.int({ min: 30, max: Math.max(45, estimated / entryCount) }), 15) ||
            15,
          category: phaseName === "Recette" && entry > 0 ? "corrections" : "production",
          billable: true,
          hourlyCostCents: assignee.hourlyCostCents,
          note: faker.helpers.maybe(() => "Avancement conforme au planning.", { probability: 0.2 }),
          createdAt: at(workOffset, 18),
        });
      }
    });
  });

  // Rendez-vous de projet, visibles par le client.
  addAppointment(ctx, {
    key: "appointment:kickoff",
    companyId: input.companyId,
    contactId: input.contactId,
    opportunityId: null,
    projectId,
    title: `Lancement du projet · ${input.companyName}`,
    kind: "Lancement",
    offset: start,
    status: start < 0 ? "done" : "planned",
    memberIds: team.slice(0, 2).map((member) => member.id),
    clientVisible: true,
  });
  if (!finished) {
    addAppointment(ctx, {
      key: "appointment:review",
      companyId: input.companyId,
      contactId: input.contactId,
      opportunityId: null,
      projectId,
      title: `Point d'avancement · ${input.companyName}`,
      kind: "Suivi",
      offset: faker.number.int({ min: 1, max: 14 }),
      status: "planned",
      memberIds: [input.owner.id],
      clientVisible: true,
    });
  }

  // Coûts directs : prestataire et licences.
  const contractor = team.find((member) => member.kind === "contractor");
  if (contractor && start < 0) {
    plan.directCosts.push({
      id: stagingId(`${key}:cost:subcontracting`),
      companyId: input.companyId,
      projectId,
      memberId: contractor.id,
      label: `Prestation externe · ${OFFER_ACTIVITY_LABELS[input.offer]}`,
      category: "subcontracting",
      amountCents: roundTo(faker.number.int({ min: 40000, max: 180000 }), 5000),
      incurredOn: day(Math.min(-1, start + duration / 2)),
      nature: finished ? "actual" : "forecast",
    });
  }
  if (input.offer === "ecommerce" && start < 0) {
    plan.directCosts.push({
      id: stagingId(`${key}:cost:license`),
      companyId: input.companyId,
      projectId,
      label: "Licence d'extension de paiement",
      category: "license",
      amountCents: 19900,
      incurredOn: day(Math.min(-1, start + 3)),
      recurringPeriod: "yearly",
      nature: "actual",
    });
  }

  buildBilling(ctx, { ...input, projectId, start, deliveredOffset });
  if (finished || status === "in_validation")
    buildTickets(ctx, { ...input, projectId, deliveredOffset: deliveredOffset ?? -5, team });
}

function buildBilling(
  ctx: DossierContext,
  input: {
    companyId: string;
    quote: BuiltQuote;
    owner: Member;
    projectId: string;
    signedOffset: number;
    start: number;
    deliveredOffset: number | null;
    companyStatus: "client" | "subscriber" | "former";
  },
): void {
  const { faker, plan, day, at } = ctx;
  const key = ctx.key;
  const projectAmount = input.quote.totalCents - input.quote.recurringCents;
  const deposit = roundTo((projectAmount * input.quote.depositPercent) / 100, 100);
  const items = [
    {
      slug: "deposit",
      label: `Acompte ${input.quote.depositPercent} %`,
      amount: deposit,
      issueOffset: input.signedOffset + 1,
    },
    {
      slug: "balance",
      label: "Solde à la livraison",
      amount: projectAmount - deposit,
      issueOffset: input.deliveredOffset,
    },
  ];
  items.forEach((item, index) => {
    const scheduleId = stagingId(`${key}:schedule:${item.slug}`);
    const issueOffset = item.issueOffset !== null && item.issueOffset < 0 ? item.issueOffset : null;
    const dueOffset = issueOffset === null ? null : issueOffset + 30;
    // Factures échues depuis longtemps : payées ; les plus récentes, et quelques soldes, en attente.
    const paid =
      dueOffset !== null &&
      (dueOffset < -20 || faker.datatype.boolean({ probability: 0.6 })) &&
      !(index === 1 && faker.datatype.boolean({ probability: 0.15 }));
    const paidOffset =
      paid && issueOffset !== null
        ? Math.min(-1, issueOffset + faker.number.int({ min: 3, max: 35 }))
        : null;
    plan.paymentScheduleItems.push({
      id: scheduleId,
      companyId: input.companyId,
      projectId: input.projectId,
      quoteId: input.quote.id,
      label: item.label,
      dueOn: day(item.issueOffset ?? input.start + 45),
      amountCents: item.amount,
      status: paid ? "paid" : issueOffset !== null ? "invoiced" : "planned",
      createdAt: at(input.signedOffset, 17),
    });
    if (issueOffset === null || dueOffset === null) return;
    const documentId = stagingId(`${key}:invoice:${item.slug}`);
    plan.financialDocuments.push({
      id: documentId,
      companyId: input.companyId,
      projectId: input.projectId,
      quoteId: input.quote.id,
      scheduleItemId: scheduleId,
      kind: "invoice",
      source: "manual",
      externalRef: `STG-${documentId.slice(0, 8).toUpperCase()}`,
      issuerMemberId: input.owner.id,
      issuedOn: day(issueOffset),
      dueOn: day(dueOffset),
      amountCents: item.amount,
      taxCents: Math.round(item.amount * 0.2),
      status: paid ? "paid" : dueOffset < 0 ? "overdue" : "issued",
      paidOn: paidOffset === null ? null : day(paidOffset),
      clientVisible: true,
      createdAt: at(issueOffset, 11),
    });
    plan.scheduleDocumentLinks.push({
      scheduleItemId: scheduleId,
      financialDocumentId: documentId,
    });
  });

  // Abonnés : facture mensuelle de maintenance et d'hébergement depuis la livraison.
  if (
    input.quote.recurringCents > 0 &&
    input.deliveredOffset !== null &&
    input.companyStatus !== "former"
  ) {
    const monthly = Math.round(input.quote.recurringCents / 12);
    const months = Math.min(6, Math.floor(-input.deliveredOffset / 30));
    for (let month = 0; month < months; month += 1) {
      const issueOffset = input.deliveredOffset + 30 * (month + 1);
      if (issueOffset >= 0) break;
      const documentId = stagingId(`${key}:invoice:recurring:${month}`);
      const paid = issueOffset < -25 || faker.datatype.boolean({ probability: 0.5 });
      plan.financialDocuments.push({
        id: documentId,
        companyId: input.companyId,
        projectId: input.projectId,
        kind: "invoice",
        source: "manual",
        externalRef: `STG-${documentId.slice(0, 8).toUpperCase()}`,
        issuerMemberId: input.owner.id,
        issuedOn: day(issueOffset),
        dueOn: day(issueOffset + 15),
        amountCents: monthly,
        taxCents: Math.round(monthly * 0.2),
        status: paid ? "paid" : issueOffset + 15 < 0 ? "overdue" : "issued",
        paidOn: paid
          ? day(Math.min(-1, issueOffset + faker.number.int({ min: 1, max: 14 })))
          : null,
        clientVisible: true,
        createdAt: at(issueOffset, 8),
      });
    }
  }
}

function buildTickets(
  ctx: DossierContext,
  input: {
    companyId: string;
    projectId: string;
    deliveredOffset: number;
    team: Member[];
    companyName: string;
  },
): void {
  const { faker, plan, at } = ctx;
  const count = faker.number.int({ min: 0, max: 3 });
  for (let index = 0; index < count; index += 1) {
    const ticketId = stagingId(`${ctx.key}:ticket:${index}`);
    const template = faker.helpers.arrayElement(TICKET_SUBJECTS);
    const openedOffset = Math.min(
      -1,
      input.deliveredOffset + faker.number.int({ min: 2, max: 120 }),
    );
    const status = faker.helpers.weightedArrayElement([
      { weight: 15, value: "received" as const },
      { weight: 15, value: "qualified" as const },
      { weight: 20, value: "in_progress" as const },
      { weight: 25, value: "resolved" as const },
      { weight: 25, value: "closed" as const },
    ]);
    const assignee = faker.helpers.arrayElement(input.team);
    const steps = (["received", "qualified", "in_progress", "resolved", "closed"] as const).slice(
      0,
      ["received", "qualified", "in_progress", "resolved", "closed"].indexOf(status) + 1,
    );
    // Chronologie croissante : chaque étape suit la précédente de 0 à 3 jours.
    const offsets: number[] = [];
    steps.forEach((_, step) => {
      offsets.push(
        step === 0
          ? openedOffset
          : (offsets[step - 1] ?? openedOffset) + faker.number.int({ min: 0, max: 3 }),
      );
    });
    const stepOffset = (step: number) => Math.min(-1, offsets[step] ?? openedOffset);
    const resolvedStep = steps.indexOf("resolved");
    const closedStep = steps.indexOf("closed");
    const severity =
      template.category === "incident"
        ? "high"
        : faker.helpers.arrayElement(["low", "medium", "medium", "high"] as const);
    plan.tickets.push({
      id: ticketId,
      companyId: input.companyId,
      projectId: input.projectId,
      subject: template.subject,
      description: `Signalé par le client de ${input.companyName}.`,
      channel: faker.helpers.arrayElement(["portal", "email", "phone"] as const),
      category: template.category,
      severity,
      status,
      assigneeMemberId: status === "received" ? null : assignee.id,
      dueAt: at(openedOffset + (severity === "high" ? 1 : 3), 18),
      firstResponseAt: status === "received" ? null : at(stepOffset(1), 11),
      resolvedAt: resolvedStep >= 0 ? at(stepOffset(resolvedStep), 16) : null,
      closedAt: closedStep >= 0 ? at(stepOffset(closedStep), 17) : null,
      coverage: faker.helpers.arrayElement(["covered", "not_covered", "undetermined"] as const),
      createdAt: at(openedOffset, 9),
    });
    steps.forEach((toStatus, step) => {
      plan.ticketEvents.push({
        id: stagingId(`${ctx.key}:ticket-event:${index}:${step}`),
        ticketId,
        fromStatus: step === 0 ? null : (steps[step - 1] ?? null),
        toStatus,
        at: at(stepOffset(step), 9 + step),
      });
    });
    plan.ticketMessages.push({
      id: stagingId(`${ctx.key}:ticket-message:${index}:0`),
      ticketId,
      body: "Bonjour, pouvez-vous regarder ce point dès que possible ? Merci.",
      internal: false,
      at: at(openedOffset, 9),
    });
    if (status !== "received") {
      plan.ticketMessages.push({
        id: stagingId(`${ctx.key}:ticket-message:${index}:1`),
        ticketId,
        body: faker.helpers.arrayElement([
          "Reproduit sur mobile, correction en cours.",
          "Couvert par le contrat de maintenance.",
          "À chiffrer : hors périmètre initial.",
        ]),
        internal: true,
        at: at(stepOffset(1), 11),
      });
    }
  }
}

// --- Point d'entrée ------------------------------------------------------------------------------

export function emptyPlan(): StagingPlan {
  return {
    teamMembers: [],
    memberAbsences: [],
    catalogItems: [],
    companies: [],
    contacts: [],
    opportunities: [],
    opportunityStageHistory: [],
    activities: [],
    quotes: [],
    quoteVersions: [],
    quoteLines: [],
    quoteVersionLinks: [],
    projects: [],
    projectPhases: [],
    projectMembers: [],
    tasks: [],
    timeEntries: [],
    directCosts: [],
    paymentScheduleItems: [],
    financialDocuments: [],
    scheduleDocumentLinks: [],
    appointments: [],
    tickets: [],
    ticketMessages: [],
    ticketEvents: [],
  };
}

export function generateStagingPlan(options: StagingOptions): StagingPlan {
  if (!Number.isSafeInteger(options.seed) || options.seed < 0) {
    throw new Error("La graine doit être un entier positif.");
  }
  if (
    !Number.isInteger(options.companies) ||
    options.companies < 1 ||
    options.companies > MAX_STAGING_COMPANIES
  ) {
    throw new Error(
      `Le nombre d'entreprises doit être compris entre 1 et ${MAX_STAGING_COMPANIES}.`,
    );
  }
  const plan = emptyPlan();
  const { at, day } = clock(options.referenceDate);
  const members = buildTeam(plan, options.referenceDate);
  const catalog = buildCatalog(plan);
  for (let index = 0; index < options.companies; index += 1) {
    buildDossier({
      faker: createFaker([options.seed, index]),
      seed: options.seed,
      index,
      plan,
      key: `${options.seed}:dossier:${index}`,
      members,
      catalog,
      at,
      day,
    });
  }
  return plan;
}

/** Nombre de lignes par table, pour l'affichage et les tests. */
export function planCounts(plan: StagingPlan): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, rows] of Object.entries(plan)) {
    if (key.endsWith("Links")) continue;
    counts[key] = (rows as unknown[]).length;
  }
  return counts;
}
