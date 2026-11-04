/**
 * Jeu de données de DÉVELOPPEMENT : agence et clients fictifs, sur tous les domaines.
 *
 * Jamais importé depuis `src/`. Idempotent : chaque ligne a un identifiant déterministe et s'insère
 * en `ON CONFLICT DO NOTHING`, un second passage n'ajoute ni ne modifie rien, et préserve ce qui a
 * été modifié à la main depuis. Les dates sont calculées au premier passage, autour de `now`.
 *
 * Les lignes CRM n'existent pas dans Twenty : leur `twenty_id` porte le préfixe
 * `SEED_TWENTY_ID_PREFIX`. Le seed n'appelle aucun service externe.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { recordAudit } from "@/modules/audit/audit.service";
import { sequenceYear, type SequenceScope } from "@/modules/platform/sequences";
import { createUserAccount } from "@/modules/users/user.service";
import type { Auth } from "@/server/auth/auth";
import type { Role } from "@/server/auth/roles";
import * as s from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/** Reconnaît une ligne CRM de démonstration, sans enregistrement réel dans Twenty. */
export const SEED_TWENTY_ID_PREFIX = "seed-";

const SEED_EMAIL_DOMAIN = "seed.nuera.test";

/** UUID stable, dérivé d'une clé lisible : la base d'idempotence du seed. */
export function seedId(key: string): string {
  const hash = createHash("sha256").update(`nuera-seed:${key}`).digest("hex");
  const variant = ((parseInt(hash.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `${variant}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

/**
 * Refuse tout environnement qui n'est pas clairement local : production, ou base distante sans
 * demande explicite. Renvoie le motif du refus, ou `null`.
 */
export function seedRefusalReason(
  env: { NODE_ENV?: string; DATABASE_URL?: string },
  options: { allowRemote?: boolean } = {},
): string | null {
  if (env.NODE_ENV === "production")
    return "NODE_ENV=production : le seed est réservé au développement.";
  if (options.allowRemote) return null;
  const host = env.DATABASE_URL ? new URL(env.DATABASE_URL).hostname : "";
  const local = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"];
  if (host && !local.includes(host)) {
    return `Base distante (${host}) : ajouter --allow-remote si c'est bien une base de développement.`;
  }
  return null;
}

export interface SeedAccount {
  key: string;
  email: string;
  role: Role;
  /** Présent seulement au premier passage : à afficher une fois. */
  password: string | null;
  created: boolean;
}

export interface SeedOptions {
  /** Mot de passe commun ; à défaut, un par compte, généré puis affiché une seule fois. */
  password?: string;
  now?: Date;
}

const ACCOUNTS: readonly { key: string; name: string; role: Exclude<Role, "client"> | "client" }[] =
  [
    { key: "camille", name: "Camille Renaud", role: "admin" },
    { key: "malik", name: "Malik Benali", role: "admin" },
    { key: "hugo", name: "Hugo Lefèvre", role: "member" },
    { key: "ines", name: "Inès Moreau", role: "contractor" },
    { key: "lea", name: "Léa Garnier", role: "viewer" },
    { key: "claire", name: "Claire Martin", role: "client" },
    { key: "marc", name: "Marc Delorme", role: "client" },
  ];

const seedEmail = (key: string) => `${key}@${SEED_EMAIL_DOMAIN}`;

function generatePassword(): string {
  return `seed-${randomBytes(12).toString("base64url")}`;
}

async function ensureAccounts(
  db: Database,
  auth: Auth,
  options: SeedOptions,
): Promise<{ accounts: SeedAccount[]; userIds: Record<string, string> }> {
  const accounts: SeedAccount[] = [];
  const userIds: Record<string, string> = {};
  for (const { key, name, role } of ACCOUNTS) {
    const email = seedEmail(key);
    const [existing] = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.email, email));
    if (existing) {
      userIds[key] = existing.id;
      accounts.push({ key, email, role, password: null, created: false });
      continue;
    }
    const password = options.password ?? generatePassword();
    const user = await createUserAccount(
      { db, auth },
      { email, name, role, password },
      { actorId: null, via: "cli" },
    );
    // Adresse réputée vérifiée : un premier lien de connexion n'efface pas le mot de passe de test.
    await db.update(s.users).set({ emailVerified: true }).where(eq(s.users.id, user.id));
    userIds[key] = user.id;
    accounts.push({ key, email, role, password, created: true });
  }
  return { accounts, userIds };
}

export async function runSeed(
  deps: { db: Database; auth: Auth },
  options: SeedOptions = {},
): Promise<{ accounts: SeedAccount[] }> {
  const { db, auth } = deps;
  const now = options.now ?? new Date();
  const year = sequenceYear(now);
  const { accounts, userIds } = await ensureAccounts(db, auth, options);

  const uid = (key: string) => {
    const value = userIds[key];
    if (!value) throw new Error(`Compte de démonstration inconnu : ${key}`);
    return value;
  };
  const day = (offset: number) =>
    new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const at = (offsetDays: number, hour = 10) => {
    const date = new Date(now.getTime() + offsetDays * 86_400_000);
    date.setUTCHours(hour, 0, 0, 0);
    return date;
  };
  const twenty = (kind: string, key: string) => `${SEED_TWENTY_ID_PREFIX}${kind}-${key}`;
  const number = (prefix: string, value: number) =>
    `${prefix}-${year}-${String(value).padStart(3, "0")}`;

  const company = {
    lune: seedId("company:lune"),
    kine: seedId("company:kine"),
    verdier: seedId("company:verdier"),
    tournesol: seedId("company:tournesol"),
    faure: seedId("company:faure"),
    sables: seedId("company:sables"),
  };
  const contact = {
    claire: seedId("contact:claire"),
    marc: seedId("contact:marc"),
    sophie: seedId("contact:sophie"),
    paul: seedId("contact:paul"),
    anne: seedId("contact:anne"),
    jules: seedId("contact:jules"),
    nora: seedId("contact:nora"),
  };
  const member = {
    camille: seedId("member:camille"),
    malik: seedId("member:malik"),
    hugo: seedId("member:hugo"),
    ines: seedId("member:ines"),
    lea: seedId("member:lea"),
  };
  const opportunity = {
    tournesol: seedId("opportunity:tournesol"),
    faure: seedId("opportunity:faure"),
    verdier: seedId("opportunity:verdier"),
    lune: seedId("opportunity:lune"),
    kine: seedId("opportunity:kine"),
    sables: seedId("opportunity:sables"),
    faureAudit: seedId("opportunity:faure-audit"),
    verdierSeo: seedId("opportunity:verdier-seo"),
  };
  const catalog = {
    vitrine: seedId("catalog:vitrine"),
    landing: seedId("catalog:landing"),
    ecommerce: seedId("catalog:ecommerce"),
    surMesure: seedId("catalog:sur-mesure"),
    maintenance: seedId("catalog:maintenance"),
    hebergement: seedId("catalog:hebergement"),
    accompagnement: seedId("catalog:accompagnement"),
    audit: seedId("catalog:audit"),
    photos: seedId("catalog:option-photos"),
  };
  const quote = {
    lune: seedId("quote:lune"),
    kine: seedId("quote:kine"),
    verdier: seedId("quote:verdier"),
    tournesol: seedId("quote:tournesol"),
    faure: seedId("quote:faure"),
    sables: seedId("quote:sables"),
    avenant: seedId("quote:avenant"),
  };
  const version = {
    lune1: seedId("quote-version:lune-1"),
    lune2: seedId("quote-version:lune-2"),
    kine1: seedId("quote-version:kine-1"),
    verdier1: seedId("quote-version:verdier-1"),
    tournesol1: seedId("quote-version:tournesol-1"),
    faure1: seedId("quote-version:faure-1"),
    sables1: seedId("quote-version:sables-1"),
    avenant1: seedId("quote-version:avenant-1"),
  };
  const project = {
    lune: seedId("project:lune"),
    kine: seedId("project:kine"),
    verdier: seedId("project:verdier"),
  };
  const site = {
    lune: seedId("site:lune"),
    kine: seedId("site:kine"),
    verdier: seedId("site:verdier"),
    sables: seedId("site:sables"),
  };
  const contract = {
    lune: seedId("contract:lune"),
    kine: seedId("contract:kine"),
    verdier: seedId("contract:verdier"),
    sables: seedId("contract:sables"),
  };
  const plan = {
    essentiel: seedId("plan:essentiel"),
    serenite: seedId("plan:serenite"),
    hebergement: seedId("plan:hebergement"),
  };
  const ticket = {
    kineForm: seedId("ticket:kine-form"),
    kineSlow: seedId("ticket:kine-slow"),
    kinePage: seedId("ticket:kine-page"),
    verdierDown: seedId("ticket:verdier-down"),
    verdierQuestion: seedId("ticket:verdier-question"),
    luneChange: seedId("ticket:lune-change"),
  };
  const changeRequest = {
    lune: seedId("change-request:lune"),
    kine: seedId("change-request:kine"),
  };
  const document = {
    briefLune: seedId("document:brief-lune"),
    maquetteLune: seedId("document:maquette-lune"),
    devisLune: seedId("document:devis-lune"),
    photosLune: seedId("document:photos-lune"),
    contratKine: seedId("document:contrat-kine"),
    factureKine: seedId("document:facture-kine"),
    procedure: seedId("document:procedure"),
  };
  const conversation = {
    lune: seedId("conversation:lune"),
    kine: seedId("conversation:kine"),
    verdier: seedId("conversation:verdier"),
  };
  const message = {
    lune1: seedId("message:lune-1"),
    lune2: seedId("message:lune-2"),
    lune3: seedId("message:lune-3"),
    kine1: seedId("message:kine-1"),
    kine2: seedId("message:kine-2"),
    verdier1: seedId("message:verdier-1"),
  };

  await db.transaction(async (tx) => {
    // --- Équipe -------------------------------------------------------------------------------
    await tx
      .insert(s.teamMembers)
      .values([
        {
          id: member.camille,
          userId: uid("camille"),
          kind: "partner",
          fullName: "Camille Renaud",
          email: seedEmail("camille"),
          phone: "+33600000001",
          title: "Associée · direction de projet",
          skills: ["Direction de projet", "Commercial", "Design"],
          weeklyCapacityMinutes: 2100,
          hourlyCostCents: 5000,
          dayRateCents: 65000,
        },
        {
          id: member.malik,
          userId: uid("malik"),
          kind: "partner",
          fullName: "Malik Benali",
          email: seedEmail("malik"),
          phone: "+33600000002",
          title: "Associé · technique",
          skills: ["Next.js", "Payload", "Infrastructure"],
          weeklyCapacityMinutes: 2100,
          hourlyCostCents: 5000,
          dayRateCents: 65000,
        },
        {
          id: member.hugo,
          userId: uid("hugo"),
          kind: "employee",
          fullName: "Hugo Lefèvre",
          email: seedEmail("hugo"),
          title: "Développeur",
          skills: ["Next.js", "Intégration"],
          weeklyCapacityMinutes: 2100,
          hourlyCostCents: 3500,
        },
        {
          id: member.ines,
          userId: uid("ines"),
          kind: "contractor",
          fullName: "Inès Moreau",
          email: seedEmail("ines"),
          title: "Graphiste indépendante",
          skills: ["Direction artistique", "Illustration"],
          weeklyCapacityMinutes: 840,
          hourlyCostCents: 6000,
          dayRateCents: 45000,
          conditions: "Facturation à la journée, 30 jours fin de mois.",
          specialty: "Identité visuelle",
        },
        {
          id: member.lea,
          userId: uid("lea"),
          kind: "employee",
          fullName: "Léa Garnier",
          email: seedEmail("lea"),
          title: "Assistante administrative",
          skills: ["Administratif"],
          weeklyCapacityMinutes: 1260,
          hourlyCostCents: 2500,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.memberAbsences)
      .values([
        {
          id: seedId("absence:hugo"),
          memberId: member.hugo,
          startOn: day(12),
          endOn: day(16),
          reason: "Congés",
        },
        {
          id: seedId("absence:camille"),
          memberId: member.camille,
          startOn: day(30),
          endOn: day(30),
          reason: "Salon professionnel",
        },
      ])
      .onConflictDoNothing();

    // --- CRM ----------------------------------------------------------------------------------
    await tx
      .insert(s.companies)
      .values([
        {
          id: company.lune,
          twentyId: twenty("company", "lune"),
          name: "Atelier Lune",
          domain: "atelier-lune.example",
          addressLine: "12 rue des Fleurs",
          city: "Rouen",
          postalCode: "76000",
          country: "France",
          status: "client",
          activity: "Fleuriste",
          siren: "900000001",
          phone: "+33235000001",
          source: "Réseau",
          tags: ["vitrine", "commerce-local"],
          ownerMemberId: member.camille,
          notes: "Sensible aux délais : prévenir tôt en cas de retard.",
        },
        {
          id: company.kine,
          twentyId: twenty("company", "kine"),
          name: "Kiné Rive Gauche",
          domain: "kine-rive-gauche.example",
          addressLine: "3 quai de la Monnaie",
          city: "Bordeaux",
          postalCode: "33000",
          country: "France",
          status: "subscriber",
          activity: "Cabinet de kinésithérapie",
          siren: "900000002",
          phone: "+33556000002",
          source: "Site",
          tags: ["vitrine", "santé"],
          ownerMemberId: member.malik,
        },
        {
          id: company.verdier,
          twentyId: twenty("company", "verdier"),
          name: "Maison Verdier",
          domain: "maison-verdier.example",
          addressLine: "48 cours Lafayette",
          city: "Lyon",
          postalCode: "69003",
          country: "France",
          status: "client",
          activity: "Épicerie fine",
          siren: "900000003",
          source: "Prescripteur",
          tags: ["e-commerce"],
          ownerMemberId: member.camille,
        },
        {
          id: company.tournesol,
          twentyId: twenty("company", "tournesol"),
          name: "Boulangerie Tournesol",
          domain: "boulangerie-tournesol.example",
          city: "Nantes",
          postalCode: "44000",
          country: "France",
          status: "prospect",
          activity: "Boulangerie",
          source: "Mini-audit",
          tags: ["landing"],
          ownerMemberId: member.malik,
        },
        {
          id: company.faure,
          twentyId: twenty("company", "faure"),
          name: "Cabinet Faure Avocats",
          domain: "faure-avocats.example",
          city: "Paris",
          postalCode: "75008",
          country: "France",
          status: "prospect",
          activity: "Cabinet d'avocats",
          siren: "900000005",
          source: "Réseau",
          ownerMemberId: member.camille,
        },
        {
          id: company.sables,
          twentyId: twenty("company", "sables"),
          name: "Domaine des Sables",
          domain: "domaine-sables.example",
          city: "Sancerre",
          postalCode: "18300",
          country: "France",
          status: "former",
          activity: "Vigneron",
          source: "Réseau",
          ownerMemberId: member.camille,
        },
      ])
      .onConflictDoNothing();

    const contactRows: (typeof s.contacts.$inferInsert)[] = [
      {
        id: contact.claire,
        twentyId: twenty("contact", "claire"),
        companyId: company.lune,
        firstName: "Claire",
        lastName: "Martin",
        email: seedEmail("claire"),
        phone: "+33600000011",
        jobTitle: "Gérante",
        roles: ["decision", "signatory", "billing"],
        isPrimary: true,
      },
      {
        id: contact.marc,
        twentyId: twenty("contact", "marc"),
        companyId: company.kine,
        firstName: "Marc",
        lastName: "Delorme",
        email: seedEmail("marc"),
        phone: "+33600000012",
        jobTitle: "Kinésithérapeute",
        roles: ["decision", "signatory"],
        isPrimary: true,
      },
      {
        id: contact.sophie,
        twentyId: twenty("contact", "sophie"),
        companyId: company.verdier,
        firstName: "Sophie",
        lastName: "Verdier",
        email: "sophie@maison-verdier.example",
        jobTitle: "Dirigeante",
        roles: ["decision", "signatory"],
        isPrimary: true,
      },
      {
        id: contact.paul,
        twentyId: twenty("contact", "paul"),
        companyId: company.verdier,
        firstName: "Paul",
        lastName: "Roche",
        email: "paul@maison-verdier.example",
        jobTitle: "Responsable boutique en ligne",
        roles: ["technical"],
      },
      {
        id: contact.anne,
        twentyId: twenty("contact", "anne"),
        companyId: company.tournesol,
        firstName: "Anne",
        lastName: "Lambert",
        email: "anne@boulangerie-tournesol.example",
        jobTitle: "Gérante",
        roles: ["decision"],
        isPrimary: true,
      },
      {
        id: contact.jules,
        twentyId: twenty("contact", "jules"),
        companyId: company.faure,
        firstName: "Jules",
        lastName: "Faure",
        email: "jules@faure-avocats.example",
        jobTitle: "Associé",
        roles: ["decision", "signatory"],
        isPrimary: true,
      },
      {
        id: contact.nora,
        twentyId: twenty("contact", "nora"),
        companyId: company.sables,
        firstName: "Nora",
        lastName: "Petit",
        email: "nora@domaine-sables.example",
        jobTitle: "Vigneronne",
        roles: ["decision", "billing"],
        isPrimary: true,
      },
    ];
    await tx.insert(s.contacts).values(contactRows).onConflictDoNothing();

    const opportunityRows: (typeof s.opportunities.$inferInsert)[] = [
      {
        id: opportunity.tournesol,
        twentyId: twenty("opportunity", "tournesol"),
        companyId: company.tournesol,
        contactId: contact.anne,
        name: "Landing page de commande",
        stage: "NEW",
        amountCents: 180000,
        expectedCloseOn: day(45),
        probability: 20,
        source: "Mini-audit",
        need: "Commandes de gâteaux en ligne",
        ownerMemberId: member.malik,
        nextAction: "Appeler pour qualifier le besoin",
        nextActionOn: day(1),
        lastActivityAt: at(-2),
      },
      {
        id: opportunity.faureAudit,
        twentyId: twenty("opportunity", "faure-audit"),
        companyId: company.faure,
        contactId: contact.jules,
        name: "Audit du site actuel",
        stage: "QUALIFIED",
        amountCents: 90000,
        expectedCloseOn: day(20),
        probability: 50,
        source: "Réseau",
        budgetEstimateCents: 100000,
        ownerMemberId: member.camille,
        nextAction: "Préparer le devis d'audit",
        nextActionOn: day(3),
        lastActivityAt: at(-5),
      },
      {
        id: opportunity.verdierSeo,
        twentyId: twenty("opportunity", "verdier-seo"),
        companyId: company.verdier,
        contactId: contact.sophie,
        name: "Accompagnement référencement",
        stage: "QUOTE_SENT",
        amountCents: 420000,
        expectedCloseOn: day(10),
        probability: 60,
        source: "Prescripteur",
        ownerMemberId: member.camille,
        nextAction: "Relancer à J+7",
        nextActionOn: day(4),
        lastActivityAt: at(-3),
      },
      {
        id: opportunity.faure,
        twentyId: twenty("opportunity", "faure"),
        companyId: company.faure,
        contactId: contact.jules,
        name: "Refonte du site du cabinet",
        stage: "NEGOTIATION",
        amountCents: 950000,
        expectedCloseOn: day(15),
        probability: 70,
        source: "Réseau",
        need: "Site bilingue, prise de rendez-vous",
        budgetEstimateCents: 1000000,
        ownerMemberId: member.camille,
        nextAction: "Rendez-vous de cadrage",
        nextActionOn: day(2),
        lastActivityAt: at(-1),
      },
      {
        id: opportunity.lune,
        twentyId: twenty("opportunity", "lune"),
        companyId: company.lune,
        contactId: contact.claire,
        name: "Site vitrine Atelier Lune",
        stage: "WON",
        amountCents: 780000,
        expectedCloseOn: day(-40),
        probability: 100,
        source: "Réseau",
        ownerMemberId: member.camille,
        wonAt: at(-40),
        lastActivityAt: at(-40),
      },
      {
        id: opportunity.kine,
        twentyId: twenty("opportunity", "kine"),
        companyId: company.kine,
        contactId: contact.marc,
        name: "Site vitrine et prise de rendez-vous",
        stage: "WON",
        amountCents: 650000,
        expectedCloseOn: day(-180),
        probability: 100,
        source: "Site",
        ownerMemberId: member.malik,
        wonAt: at(-180),
        lastActivityAt: at(-180),
      },
      {
        id: opportunity.verdier,
        twentyId: twenty("opportunity", "verdier"),
        companyId: company.verdier,
        contactId: contact.sophie,
        name: "Boutique en ligne",
        stage: "WON",
        amountCents: 1450000,
        expectedCloseOn: day(-20),
        probability: 100,
        source: "Prescripteur",
        ownerMemberId: member.camille,
        wonAt: at(-20),
        lastActivityAt: at(-20),
      },
      {
        id: opportunity.sables,
        twentyId: twenty("opportunity", "sables"),
        companyId: company.sables,
        contactId: contact.nora,
        name: "Refonte du domaine",
        stage: "LOST",
        amountCents: 520000,
        expectedCloseOn: day(-90),
        probability: 0,
        source: "Réseau",
        ownerMemberId: member.camille,
        lostReason: "Budget",
        lostAt: at(-90),
        lastActivityAt: at(-90),
      },
    ];
    await tx.insert(s.opportunities).values(opportunityRows).onConflictDoNothing();

    await tx
      .insert(s.opportunityStageHistory)
      .values([
        {
          id: seedId("stage:lune-1"),
          opportunityId: opportunity.lune,
          fromStage: null,
          toStage: "NEW",
          actorId: uid("camille"),
          at: at(-70),
        },
        {
          id: seedId("stage:lune-2"),
          opportunityId: opportunity.lune,
          fromStage: "NEW",
          toStage: "QUALIFIED",
          actorId: uid("camille"),
          at: at(-65),
        },
        {
          id: seedId("stage:lune-3"),
          opportunityId: opportunity.lune,
          fromStage: "QUALIFIED",
          toStage: "QUOTE_SENT",
          actorId: uid("camille"),
          at: at(-55),
        },
        {
          id: seedId("stage:lune-4"),
          opportunityId: opportunity.lune,
          fromStage: "QUOTE_SENT",
          toStage: "WON",
          actorId: uid("camille"),
          at: at(-40),
        },
        {
          id: seedId("stage:sables-1"),
          opportunityId: opportunity.sables,
          fromStage: "QUALIFIED",
          toStage: "LOST",
          actorId: uid("camille"),
          at: at(-90),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.activities)
      .values([
        {
          id: seedId("activity:note-lune"),
          twentyId: twenty("note", "lune"),
          kind: "note",
          companyId: company.lune,
          contactId: contact.claire,
          opportunityId: opportunity.lune,
          subject: "Préférences graphiques",
          body: "Aime les tons pastel, refuse les photos de banque d'images.",
          ownerMemberId: member.camille,
          occurredAt: at(-60),
        },
        {
          id: seedId("activity:call-faure"),
          kind: "call",
          companyId: company.faure,
          contactId: contact.jules,
          opportunityId: opportunity.faure,
          subject: "Appel de découverte",
          body: "Besoin d'une version anglaise, délai souple.",
          ownerMemberId: member.camille,
          occurredAt: at(-8),
        },
        {
          id: seedId("activity:meeting-verdier"),
          kind: "meeting",
          companyId: company.verdier,
          contactId: contact.sophie,
          subject: "Réunion de lancement",
          ownerMemberId: member.camille,
          occurredAt: at(-18),
          completedAt: at(-18),
        },
        {
          id: seedId("activity:task-tournesol"),
          twentyId: twenty("task", "tournesol"),
          kind: "task",
          companyId: company.tournesol,
          contactId: contact.anne,
          opportunityId: opportunity.tournesol,
          subject: "Rappeler Anne Lambert",
          dueAt: at(1),
          ownerMemberId: member.malik,
          occurredAt: at(-2),
        },
        {
          id: seedId("activity:email-kine"),
          kind: "email",
          companyId: company.kine,
          contactId: contact.marc,
          subject: "Bilan semestriel envoyé",
          ownerMemberId: member.malik,
          occurredAt: at(-12),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.crmSyncState)
      .values([
        { id: seedId("crm-sync:company"), object: "company" },
        { id: seedId("crm-sync:person"), object: "person" },
        { id: seedId("crm-sync:opportunity"), object: "opportunity" },
      ])
      .onConflictDoNothing();

    // --- Offres -------------------------------------------------------------------------------
    await tx
      .insert(s.catalogItems)
      .values([
        {
          id: catalog.vitrine,
          kind: "project",
          activity: "vitrine",
          name: "Site vitrine",
          description: "Site sur mesure de 5 à 10 pages.",
          priceCents: 650000,
          estimatedCostCents: 240000,
          estimatedMinutes: 5040,
          scope: "Maquettes, intégration, CMS, mise en ligne.",
          exclusions: "Photos et rédaction.",
          conditions: "Deux tours de retours inclus par étape.",
          validityDays: 30,
          depositPercent: 30,
        },
        {
          id: catalog.landing,
          kind: "project",
          activity: "landing",
          name: "Landing page",
          priceCents: 180000,
          estimatedCostCents: 70000,
          estimatedMinutes: 1260,
          validityDays: 30,
          depositPercent: 30,
        },
        {
          id: catalog.ecommerce,
          kind: "project",
          activity: "ecommerce",
          name: "Boutique en ligne",
          description: "Catalogue de quelques dizaines de produits.",
          priceCents: 1450000,
          estimatedCostCents: 620000,
          estimatedMinutes: 12600,
          validityDays: 30,
          depositPercent: 30,
        },
        {
          id: catalog.surMesure,
          kind: "project",
          activity: "sur_mesure",
          name: "Développement sur mesure",
          priceCents: 2000000,
          estimatedCostCents: 900000,
          estimatedMinutes: 18900,
          validityDays: 30,
          depositPercent: 40,
        },
        {
          id: catalog.maintenance,
          kind: "recurring",
          activity: "maintenance",
          name: "Maintenance",
          priceCents: 9000,
          estimatedCostCents: 2000,
          estimatedMinutes: 60,
        },
        {
          id: catalog.hebergement,
          kind: "recurring",
          activity: "hebergement",
          name: "Hébergement",
          priceCents: 4900,
          estimatedCostCents: 900,
          estimatedMinutes: 10,
        },
        {
          id: catalog.accompagnement,
          kind: "recurring",
          activity: "accompagnement",
          name: "Accompagnement mensuel",
          priceCents: 130000,
          estimatedCostCents: 60000,
          estimatedMinutes: 840,
        },
        {
          id: catalog.audit,
          kind: "project",
          activity: "audit",
          name: "Audit de site",
          priceCents: 90000,
          estimatedCostCents: 35000,
          estimatedMinutes: 630,
          validityDays: 15,
        },
        {
          id: catalog.photos,
          kind: "option",
          activity: "vitrine",
          name: "Reportage photo",
          priceCents: 60000,
          estimatedCostCents: 40000,
          estimatedMinutes: 240,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.quotes)
      .values([
        {
          id: quote.lune,
          number: number("D", 12),
          companyId: company.lune,
          opportunityId: opportunity.lune,
          title: "Site vitrine",
          status: "accepted",
          issuedByNote: "Émis par Camille Renaud et Malik Benali, en co-traitance",
          indyReference: "INDY-D-0012",
          signatureStatus: "signed",
          docusealSubmissionId: "seed-docuseal-1",
          sentAt: at(-55),
          signedAt: at(-40),
          acceptedAt: at(-40),
        },
        {
          id: quote.kine,
          number: number("D", 13),
          companyId: company.kine,
          opportunityId: opportunity.kine,
          title: "Site vitrine et prise de rendez-vous",
          status: "accepted",
          issuedByNote: "Émis par Malik Benali",
          signatureStatus: "signed",
          sentAt: at(-190),
          signedAt: at(-180),
          acceptedAt: at(-180),
        },
        {
          id: quote.verdier,
          number: number("D", 14),
          companyId: company.verdier,
          opportunityId: opportunity.verdierSeo,
          title: "Accompagnement référencement",
          status: "sent",
          signatureStatus: "pending",
          docusealSubmissionId: "seed-docuseal-2",
          sentAt: at(-3),
          lastReminderAt: at(-1),
        },
        {
          id: quote.tournesol,
          number: number("D", 15),
          companyId: company.tournesol,
          opportunityId: opportunity.tournesol,
          title: "Landing page de commande",
          status: "draft",
        },
        {
          id: quote.faure,
          number: number("D", 16),
          companyId: company.faure,
          opportunityId: opportunity.faure,
          title: "Refonte du site du cabinet",
          status: "negotiation",
          signatureStatus: "none",
          sentAt: at(-6),
        },
        {
          id: quote.sables,
          number: number("D", 11),
          companyId: company.sables,
          opportunityId: opportunity.sables,
          title: "Refonte du domaine",
          status: "refused",
          sentAt: at(-100),
          refusedAt: at(-90),
        },
        {
          id: quote.avenant,
          number: number("D", 17),
          companyId: company.lune,
          parentQuoteId: quote.lune,
          title: "Avenant · page Galerie",
          status: "draft",
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.quoteVersions)
      .values([
        {
          id: version.lune1,
          quoteId: quote.lune,
          version: 1,
          scope: "5 pages.",
          exclusions: "Photos et rédaction.",
          validUntil: day(-25),
          depositPercent: 30,
          totalCents: 650000,
          estimatedCostCents: 240000,
          estimatedMinutes: 5040,
          changeNote: "Première proposition",
          sentAt: at(-55),
          createdBy: uid("camille"),
        },
        {
          id: version.lune2,
          quoteId: quote.lune,
          version: 2,
          scope: "5 pages, version anglaise.",
          exclusions: "Photos et rédaction.",
          validUntil: day(-20),
          depositPercent: 30,
          totalCents: 780000,
          estimatedCostCents: 300000,
          estimatedMinutes: 6300,
          changeNote: "Ajout de la version anglaise",
          sentAt: at(-45),
          createdBy: uid("camille"),
        },
        {
          id: version.kine1,
          quoteId: quote.kine,
          version: 1,
          depositPercent: 30,
          totalCents: 650000,
          estimatedCostCents: 240000,
          estimatedMinutes: 5040,
          sentAt: at(-190),
          createdBy: uid("malik"),
        },
        {
          id: version.verdier1,
          quoteId: quote.verdier,
          version: 1,
          validUntil: day(27),
          depositPercent: 0,
          totalCents: 420000,
          estimatedCostCents: 180000,
          estimatedMinutes: 2520,
          sentAt: at(-3),
          createdBy: uid("camille"),
        },
        {
          id: version.tournesol1,
          quoteId: quote.tournesol,
          version: 1,
          depositPercent: 30,
          totalCents: 180000,
          estimatedCostCents: 70000,
          estimatedMinutes: 1260,
          createdBy: uid("malik"),
        },
        {
          id: version.faure1,
          quoteId: quote.faure,
          version: 1,
          validUntil: day(24),
          depositPercent: 30,
          totalCents: 950000,
          estimatedCostCents: 410000,
          estimatedMinutes: 7560,
          sentAt: at(-6),
          createdBy: uid("camille"),
        },
        {
          id: version.sables1,
          quoteId: quote.sables,
          version: 1,
          depositPercent: 30,
          totalCents: 520000,
          estimatedCostCents: 220000,
          estimatedMinutes: 4200,
          sentAt: at(-100),
          createdBy: uid("camille"),
        },
        {
          id: version.avenant1,
          quoteId: quote.avenant,
          version: 1,
          depositPercent: 0,
          totalCents: 60000,
          estimatedCostCents: 21000,
          estimatedMinutes: 420,
          createdBy: uid("camille"),
        },
      ])
      .onConflictDoNothing();

    for (const [quoteId, currentVersionId, acceptedVersionId] of [
      [quote.lune, version.lune2, version.lune2],
      [quote.kine, version.kine1, version.kine1],
      [quote.verdier, version.verdier1, null],
      [quote.tournesol, version.tournesol1, null],
      [quote.faure, version.faure1, null],
      [quote.sables, version.sables1, null],
      [quote.avenant, version.avenant1, null],
    ] as const) {
      await tx
        .update(s.quotes)
        .set({ currentVersionId, acceptedVersionId })
        .where(eq(s.quotes.id, quoteId));
    }

    await tx
      .insert(s.quoteLines)
      .values([
        {
          id: seedId("line:lune-1"),
          quoteVersionId: version.lune2,
          catalogItemId: catalog.vitrine,
          label: "Site vitrine 5 pages",
          unitLabel: "12 j",
          unitPriceCents: 650000,
          estimatedCostCents: 240000,
          estimatedMinutes: 5040,
          position: 1,
        },
        {
          id: seedId("line:lune-2"),
          quoteVersionId: version.lune2,
          label: "Version anglaise",
          unitLabel: "3 j",
          unitPriceCents: 130000,
          estimatedCostCents: 60000,
          estimatedMinutes: 1260,
          position: 2,
        },
        {
          id: seedId("line:lune-v1"),
          quoteVersionId: version.lune1,
          catalogItemId: catalog.vitrine,
          label: "Site vitrine 5 pages",
          unitLabel: "12 j",
          unitPriceCents: 650000,
          estimatedCostCents: 240000,
          estimatedMinutes: 5040,
          position: 1,
        },
        {
          id: seedId("line:kine-1"),
          quoteVersionId: version.kine1,
          catalogItemId: catalog.vitrine,
          label: "Site vitrine",
          unitPriceCents: 650000,
          estimatedCostCents: 240000,
          estimatedMinutes: 5040,
          position: 1,
        },
        {
          id: seedId("line:verdier-1"),
          quoteVersionId: version.verdier1,
          catalogItemId: catalog.accompagnement,
          label: "Accompagnement référencement",
          unitLabel: "3 mois",
          quantity: 3,
          unitPriceCents: 140000,
          estimatedCostCents: 180000,
          estimatedMinutes: 2520,
          position: 1,
        },
        {
          id: seedId("line:tournesol-1"),
          quoteVersionId: version.tournesol1,
          catalogItemId: catalog.landing,
          label: "Landing page de commande",
          unitPriceCents: 180000,
          estimatedCostCents: 70000,
          estimatedMinutes: 1260,
          position: 1,
        },
        {
          id: seedId("line:faure-1"),
          quoteVersionId: version.faure1,
          catalogItemId: catalog.surMesure,
          label: "Refonte bilingue",
          unitPriceCents: 950000,
          estimatedCostCents: 410000,
          estimatedMinutes: 7560,
          position: 1,
        },
        {
          id: seedId("line:sables-1"),
          quoteVersionId: version.sables1,
          catalogItemId: catalog.vitrine,
          label: "Refonte du domaine",
          unitPriceCents: 520000,
          estimatedCostCents: 220000,
          estimatedMinutes: 4200,
          position: 1,
        },
        {
          id: seedId("line:avenant-1"),
          quoteVersionId: version.avenant1,
          label: "Page Galerie",
          unitLabel: "1 j",
          unitPriceCents: 60000,
          estimatedCostCents: 21000,
          estimatedMinutes: 420,
          position: 1,
        },
      ])
      .onConflictDoNothing();

    // --- Contrats (avant les sites : `sites.contract_id` en dépend) ----------------------------
    await tx
      .insert(s.maintenancePlans)
      .values([
        {
          id: plan.essentiel,
          name: "Essentiel",
          description: "Mises à jour et sauvegardes.",
          priceCents: 4900,
          period: "monthly",
          includedMinutes: 60,
          includedTickets: 1,
          scope: "Mises à jour de sécurité, sauvegardes.",
          exclusions: "Évolutions, contenus.",
          responseHours: 48,
          resolutionHours: 120,
        },
        {
          id: plan.serenite,
          name: "Sérénité",
          description: "Maintenance et petites modifications.",
          priceCents: 12900,
          period: "monthly",
          includedMinutes: 180,
          includedTickets: 3,
          scope: "Essentiel, plus modifications de contenu.",
          exclusions: "Nouvelles fonctionnalités.",
          responseHours: 24,
          resolutionHours: 72,
        },
        {
          id: plan.hebergement,
          name: "Hébergement seul",
          priceCents: 49000,
          period: "yearly",
          includedMinutes: 0,
          includedTickets: 0,
          scope: "Hébergement et certificat.",
          responseHours: 48,
          resolutionHours: 120,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.contracts)
      .values([
        {
          id: contract.lune,
          number: number("C", 4),
          companyId: company.lune,
          planId: plan.essentiel,
          quoteId: quote.lune,
          name: "Hébergement Atelier Lune",
          kind: "hosting",
          status: "to_start",
          autoRenew: true,
          priceCents: 4900,
          period: "monthly",
          monthlyCostCents: 900,
          includedMinutes: 60,
          includedTickets: 1,
          responseHours: 48,
          resolutionHours: 120,
          signatureStatus: "signed",
        },
        {
          id: contract.kine,
          number: number("C", 1),
          companyId: company.kine,
          planId: plan.serenite,
          quoteId: quote.kine,
          name: "Maintenance Kiné Rive Gauche",
          kind: "maintenance",
          status: "active",
          startOn: day(-150),
          renewsOn: day(25),
          autoRenew: true,
          priceCents: 12900,
          period: "monthly",
          monthlyCostCents: 3000,
          includedMinutes: 180,
          includedTickets: 3,
          scope: "Mises à jour, sauvegardes, modifications de contenu.",
          exclusions: "Nouvelles fonctionnalités.",
          conditions: "Sortie sans frais au bilan de 6 mois.",
          responseHours: 24,
          resolutionHours: 72,
          signatureStatus: "signed",
        },
        {
          id: contract.verdier,
          number: number("C", 2),
          companyId: company.verdier,
          planId: plan.hebergement,
          name: "Hébergement Maison Verdier",
          kind: "hosting",
          status: "to_review",
          startOn: day(-340),
          renewsOn: day(25),
          priceCents: 49000,
          period: "yearly",
          monthlyCostCents: 1500,
          includedMinutes: 0,
          includedTickets: 0,
          responseHours: 48,
          resolutionHours: 120,
        },
        {
          id: contract.sables,
          number: number("C", 3),
          companyId: company.sables,
          planId: plan.essentiel,
          name: "Maintenance Domaine des Sables",
          kind: "maintenance",
          status: "terminated",
          startOn: day(-500),
          endOn: day(-60),
          priceCents: 4900,
          period: "monthly",
          includedMinutes: 60,
          includedTickets: 1,
          terminatedAt: at(-60),
          terminationNote: "Site transféré à un autre prestataire.",
        },
      ])
      .onConflictDoNothing();

    // --- Production ---------------------------------------------------------------------------
    await tx
      .insert(s.projects)
      .values([
        {
          id: project.lune,
          number: number("P", 7),
          companyId: company.lune,
          opportunityId: opportunity.lune,
          quoteId: quote.lune,
          name: "Atelier Lune · Site vitrine",
          activity: "vitrine",
          objective: "Présenter les créations et capter les commandes de mariage.",
          scope: "5 pages, version anglaise.",
          status: "blocked",
          priority: "high",
          ownerMemberId: member.camille,
          startOn: day(-35),
          dueOn: day(15),
          budgetCents: 780000,
          estimatedMinutes: 6300,
          clientStepLabel: "On démarre le projet",
        },
        {
          id: project.kine,
          number: number("P", 3),
          companyId: company.kine,
          opportunityId: opportunity.kine,
          quoteId: quote.kine,
          name: "Kiné Rive Gauche · Site vitrine",
          activity: "vitrine",
          objective: "Réduire les appels pour la prise de rendez-vous.",
          status: "delivered",
          ownerMemberId: member.malik,
          startOn: day(-175),
          dueOn: day(-150),
          deliveredOn: day(-150),
          budgetCents: 650000,
          estimatedMinutes: 5040,
          clientStepLabel: "Livraison et suivi",
        },
        {
          id: project.verdier,
          number: number("P", 8),
          companyId: company.verdier,
          opportunityId: opportunity.verdier,
          name: "Maison Verdier · Boutique en ligne",
          activity: "ecommerce",
          status: "active",
          ownerMemberId: member.malik,
          startOn: day(-15),
          dueOn: day(60),
          budgetCents: 1450000,
          estimatedMinutes: 12600,
          clientStepLabel: "Retours et ajustements",
        },
      ])
      .onConflictDoNothing();

    const phaseNames = ["Cadrage", "Design", "Développement", "Recette", "Mise en ligne"];
    const phaseStatus = (key: "lune" | "kine" | "verdier", index: number) => {
      if (key === "kine") return "done" as const;
      const current = key === "lune" ? 1 : 2;
      if (index < current) return "done" as const;
      return index === current ? ("in_progress" as const) : ("todo" as const);
    };
    const phaseId = (key: string, index: number) => seedId(`phase:${key}-${index}`);
    await tx
      .insert(s.projectPhases)
      .values(
        (["lune", "kine", "verdier"] as const).flatMap((key) =>
          phaseNames.map((name, index) => ({
            id: phaseId(key, index),
            projectId: project[key],
            name,
            position: index + 1,
            dueOn: day((key === "kine" ? -170 : -10) + index * 7),
            status: phaseStatus(key, index),
          })),
        ),
      )
      .onConflictDoNothing();

    const task = (key: string) => seedId(`task:${key}`);
    const taskRows: (typeof s.tasks.$inferInsert)[] = [
      {
        id: task("charte"),
        number: number("TA", 21),
        projectId: project.lune,
        phaseId: phaseId("lune", 1),
        title: "Direction artistique",
        status: "done",
        assigneeMemberId: member.ines,
        dueOn: day(-14),
        estimatedMinutes: 840,
        position: 1,
        completedAt: at(-13),
      },
      {
        id: task("maquettes"),
        number: number("TA", 22),
        projectId: project.lune,
        phaseId: phaseId("lune", 1),
        title: "Maquette accueil et galerie",
        status: "in_progress",
        assigneeMemberId: member.ines,
        dueOn: day(4),
        estimatedMinutes: 1260,
        position: 2,
      },
      {
        id: task("photos"),
        number: number("TA", 23),
        projectId: project.lune,
        phaseId: phaseId("lune", 2),
        title: "Récupérer les photos du client",
        status: "blocked",
        assigneeMemberId: member.camille,
        dueOn: day(-2),
        estimatedMinutes: 60,
        position: 3,
      },
      {
        id: task("galerie"),
        number: number("TA", 24),
        projectId: project.lune,
        phaseId: phaseId("lune", 2),
        title: "Intégrer la page Galerie",
        status: "todo",
        assigneeMemberId: member.hugo,
        dueOn: day(9),
        estimatedMinutes: 480,
        position: 4,
      },
      {
        id: task("cms"),
        number: number("TA", 25),
        projectId: project.lune,
        phaseId: phaseId("lune", 2),
        title: "Configurer Payload",
        status: "todo",
        assigneeMemberId: member.hugo,
        dueOn: day(11),
        estimatedMinutes: 420,
        position: 5,
      },
      {
        id: task("galerie-mobile"),
        number: number("TA", 26),
        projectId: project.lune,
        phaseId: phaseId("lune", 2),
        parentTaskId: task("galerie"),
        title: "Adapter la galerie au mobile",
        status: "todo",
        assigneeMemberId: member.hugo,
        dueOn: day(10),
        estimatedMinutes: 120,
        position: 6,
      },
      {
        id: task("kine-mise-en-ligne"),
        number: number("TA", 7),
        projectId: project.kine,
        phaseId: phaseId("kine", 4),
        title: "Mise en production",
        status: "done",
        assigneeMemberId: member.malik,
        dueOn: day(-150),
        estimatedMinutes: 120,
        position: 1,
        completedAt: at(-150),
      },
      {
        id: task("verdier-catalogue"),
        number: number("TA", 31),
        projectId: project.verdier,
        phaseId: phaseId("verdier", 2),
        title: "Importer le catalogue produits",
        status: "in_progress",
        assigneeMemberId: member.hugo,
        dueOn: day(7),
        estimatedMinutes: 960,
        position: 1,
      },
      {
        id: task("verdier-paiement"),
        number: number("TA", 32),
        projectId: project.verdier,
        phaseId: phaseId("verdier", 2),
        title: "Brancher le paiement",
        status: "todo",
        assigneeMemberId: member.malik,
        dueOn: day(20),
        estimatedMinutes: 720,
        position: 2,
      },
    ];
    await tx.insert(s.tasks).values(taskRows).onConflictDoNothing();

    await tx
      .insert(s.taskDependencies)
      .values([
        {
          id: seedId("dependency:galerie-maquettes"),
          taskId: task("galerie"),
          dependsOnTaskId: task("maquettes"),
        },
        {
          id: seedId("dependency:galerie-photos"),
          taskId: task("galerie"),
          dependsOnTaskId: task("photos"),
        },
        {
          id: seedId("dependency:paiement-catalogue"),
          taskId: task("verdier-paiement"),
          dependsOnTaskId: task("verdier-catalogue"),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.projectMembers)
      .values([
        {
          id: seedId("pm:lune-camille"),
          projectId: project.lune,
          memberId: member.camille,
          role: "Direction de projet",
        },
        {
          id: seedId("pm:lune-ines"),
          projectId: project.lune,
          memberId: member.ines,
          role: "Graphiste",
        },
        {
          id: seedId("pm:lune-hugo"),
          projectId: project.lune,
          memberId: member.hugo,
          role: "Développeur",
        },
        {
          id: seedId("pm:kine-malik"),
          projectId: project.kine,
          memberId: member.malik,
          role: "Technique",
        },
        {
          id: seedId("pm:verdier-malik"),
          projectId: project.verdier,
          memberId: member.malik,
          role: "Technique",
        },
        {
          id: seedId("pm:verdier-hugo"),
          projectId: project.verdier,
          memberId: member.hugo,
          role: "Développeur",
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.projectBlockers)
      .values([
        {
          id: seedId("blocker:lune"),
          projectId: project.lune,
          title: "Contenus attendus",
          consequence: "La mise en ligne recule d'autant.",
          decision: "Relance du client, date revue si rien sous 5 jours.",
          raisedAt: at(-2),
        },
      ])
      .onConflictDoNothing();

    // --- Sites --------------------------------------------------------------------------------
    await tx
      .insert(s.sites)
      .values([
        {
          id: site.lune,
          companyId: company.lune,
          projectId: project.lune,
          contractId: contract.lune,
          name: "Atelier Lune",
          primaryDomain: "atelier-lune.example",
          kind: "vitrine",
          status: "staging",
          technology: "Next.js",
          cmsKind: "payload",
          cmsAdminUrl: "https://cms.atelier-lune.example/admin",
          repoUrl: "https://git.example/nuera/atelier-lune",
          repoBranch: "main",
          hostingLabel: "Coolify",
          serverLabel: "SEED-PROD-01",
          ownerMemberId: member.camille,
          coolifyProjectUuid: "seed-coolify-lune",
        },
        {
          id: site.kine,
          companyId: company.kine,
          projectId: project.kine,
          contractId: contract.kine,
          name: "Kiné Rive Gauche",
          primaryDomain: "kine-rive-gauche.example",
          kind: "vitrine",
          status: "live",
          technology: "Next.js",
          cmsKind: "payload",
          cmsAdminUrl: "https://cms.kine-rive-gauche.example/admin",
          repoUrl: "https://git.example/nuera/kine-rive-gauche",
          repoBranch: "main",
          hostingLabel: "Coolify",
          serverLabel: "SEED-PROD-01",
          ownerMemberId: member.malik,
          liveOn: day(-150),
          coolifyProjectUuid: "seed-coolify-kine",
          monitorId: "seed-monitor-kine",
        },
        {
          id: site.verdier,
          companyId: company.verdier,
          projectId: project.verdier,
          contractId: contract.verdier,
          name: "Maison Verdier",
          primaryDomain: "maison-verdier.example",
          kind: "ecommerce",
          status: "live",
          technology: "WordPress",
          cmsKind: "wordpress",
          cmsAdminUrl: "https://maison-verdier.example/wp-admin",
          hostingLabel: "Coolify",
          serverLabel: "SEED-PROD-02",
          ownerMemberId: member.malik,
          liveOn: day(-330),
          coolifyProjectUuid: "seed-coolify-verdier",
          monitorId: "seed-monitor-verdier",
        },
        {
          id: site.sables,
          companyId: company.sables,
          contractId: contract.sables,
          name: "Domaine des Sables",
          primaryDomain: "domaine-sables.example",
          kind: "vitrine",
          status: "paused",
          cmsKind: "none",
          hostingLabel: "Hébergeur du client",
          hostedByNuera: false,
          ownerMemberId: member.camille,
          liveOn: day(-700),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.contractSites)
      .values([
        {
          id: seedId("cs:lune"),
          contractId: contract.lune,
          siteId: site.lune,
          companyId: company.lune,
        },
        {
          id: seedId("cs:kine"),
          contractId: contract.kine,
          siteId: site.kine,
          companyId: company.kine,
        },
        {
          id: seedId("cs:verdier"),
          contractId: contract.verdier,
          siteId: site.verdier,
          companyId: company.verdier,
        },
        {
          id: seedId("cs:sables"),
          contractId: contract.sables,
          siteId: site.sables,
          companyId: company.sables,
        },
      ])
      .onConflictDoNothing();

    const environmentId = (key: string, kind: string) => seedId(`environment:${key}-${kind}`);
    await tx
      .insert(s.siteEnvironments)
      .values([
        {
          id: environmentId("lune", "staging"),
          siteId: site.lune,
          kind: "staging",
          url: "https://lune.staging.nuera.example",
          coolifyAppUuid: "seed-app-lune-staging",
          status: "running",
          statusCheckedAt: at(-1),
        },
        {
          id: environmentId("kine", "staging"),
          siteId: site.kine,
          kind: "staging",
          url: "https://kine.staging.nuera.example",
          coolifyAppUuid: "seed-app-kine-staging",
          status: "stopped",
          statusCheckedAt: at(-1),
        },
        {
          id: environmentId("kine", "production"),
          siteId: site.kine,
          kind: "production",
          url: "https://kine-rive-gauche.example",
          coolifyAppUuid: "seed-app-kine-production",
          status: "running",
          statusCheckedAt: at(-1),
        },
        {
          id: environmentId("verdier", "development"),
          siteId: site.verdier,
          kind: "development",
          url: "https://verdier.dev.nuera.example",
          status: "unknown",
        },
        {
          id: environmentId("verdier", "production"),
          siteId: site.verdier,
          kind: "production",
          url: "https://maison-verdier.example",
          coolifyAppUuid: "seed-app-verdier-production",
          status: "error",
          statusCheckedAt: at(-1),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.deployments)
      .values([
        {
          id: seedId("deployment:kine-1"),
          environmentId: environmentId("kine", "production"),
          externalId: "seed-deployment-1",
          status: "succeeded",
          commitSha: "a3f9c12",
          commitMessage: "feat: formulaire de rendez-vous",
          triggeredByUserId: uid("malik"),
          startedAt: at(-20),
          finishedAt: at(-20),
          durationSeconds: 94,
          source: "nuera",
        },
        {
          id: seedId("deployment:kine-2"),
          environmentId: environmentId("kine", "production"),
          externalId: "seed-deployment-2",
          status: "succeeded",
          commitSha: "b81ee04",
          commitMessage: "fix: horaires du samedi",
          startedAt: at(-5),
          finishedAt: at(-5),
          durationSeconds: 87,
          source: "coolify",
        },
        {
          id: seedId("deployment:lune-1"),
          environmentId: environmentId("lune", "staging"),
          externalId: "seed-deployment-3",
          status: "failed",
          commitSha: "c02ad77",
          commitMessage: "feat: page Galerie",
          triggeredByUserId: uid("hugo"),
          startedAt: at(-2),
          finishedAt: at(-2),
          durationSeconds: 41,
          source: "nuera",
        },
        {
          id: seedId("deployment:lune-2"),
          environmentId: environmentId("lune", "staging"),
          externalId: "seed-deployment-4",
          status: "succeeded",
          commitSha: "d11fe90",
          commitMessage: "fix: dépendance de la galerie",
          triggeredByUserId: uid("hugo"),
          startedAt: at(-1),
          finishedAt: at(-1),
          durationSeconds: 102,
          source: "nuera",
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.domains)
      .values([
        {
          id: seedId("domain:lune"),
          companyId: company.lune,
          siteId: site.lune,
          name: "atelier-lune.example",
          registrar: "OVH",
          expiresOn: day(200),
          autoRenew: true,
          tlsStatus: "unknown",
        },
        {
          id: seedId("domain:kine"),
          companyId: company.kine,
          siteId: site.kine,
          name: "kine-rive-gauche.example",
          registrar: "OVH",
          expiresOn: day(40),
          autoRenew: false,
          tlsStatus: "valid",
          tlsExpiresOn: day(60),
          checkedAt: at(-1),
        },
        {
          id: seedId("domain:verdier"),
          companyId: company.verdier,
          siteId: site.verdier,
          name: "maison-verdier.example",
          registrar: "Gandi",
          expiresOn: day(300),
          autoRenew: true,
          tlsStatus: "expiring",
          tlsExpiresOn: day(9),
          checkedAt: at(-1),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.siteUptimeSamples)
      .values(
        (["kine", "verdier"] as const).flatMap((key) =>
          Array.from({ length: 30 }, (_, index) => ({
            id: seedId(`uptime:${key}-${index}`),
            siteId: site[key],
            day: day(-index - 1),
            uptimeRatio: key === "verdier" && index === 3 ? 0.982 : 0.9998,
            avgResponseMs: key === "verdier" && index === 3 ? 1450 : 180 + (index % 7) * 10,
            serverErrors: key === "verdier" && index === 3 ? 14 : 0,
            checkedAt: at(-index),
          })),
        ),
      )
      .onConflictDoNothing();

    await tx
      .insert(s.siteBackups)
      .values(
        [
          { key: "kine", offset: -1, status: "succeeded" as const, offSite: false },
          { key: "kine", offset: -2, status: "succeeded" as const, offSite: false },
          { key: "verdier", offset: -1, status: "failed" as const, offSite: false },
          { key: "verdier", offset: -2, status: "succeeded" as const, offSite: true },
        ].map(({ key, offset, status, offSite }) => ({
          id: seedId(`backup:${key}${offset}`),
          siteId: site[key as "kine" | "verdier"],
          environmentId: environmentId(key, "production"),
          externalId: `seed-backup-${key}${offset}`,
          status,
          takenAt: at(offset, 3),
          sizeBytes: 524_288_000,
          offSite,
          source: "coolify",
        })),
      )
      .onConflictDoNothing();

    // --- Support ------------------------------------------------------------------------------
    await tx
      .insert(s.changeRequests)
      .values([
        {
          id: changeRequest.lune,
          companyId: company.lune,
          projectId: project.lune,
          title: "Page Galerie supplémentaire",
          description: "Hors périmètre du devis initial.",
          status: "converted",
          estimatedMinutes: 420,
          amountCents: 60000,
          quoteId: quote.avenant,
        },
        {
          id: changeRequest.kine,
          companyId: company.kine,
          title: "Prise de rendez-vous en anglais",
          status: "open",
          estimatedMinutes: 630,
          amountCents: 90000,
        },
      ])
      .onConflictDoNothing();

    const ticketRows: (typeof s.tickets.$inferInsert)[] = [
      {
        id: ticket.kineForm,
        number: number("T", 31),
        companyId: company.kine,
        siteId: site.kine,
        contractId: contract.kine,
        subject: "Le formulaire n'envoie plus",
        description: "Depuis ce matin, aucun message reçu.",
        channel: "portal",
        category: "bug",
        severity: "high",
        status: "in_progress",
        assigneeMemberId: member.hugo,
        dueAt: at(1),
        firstResponseAt: at(-1),
        coverage: "covered",
        openedByUserId: uid("marc"),
      },
      {
        id: ticket.kineSlow,
        number: number("T", 29),
        companyId: company.kine,
        siteId: site.kine,
        contractId: contract.kine,
        subject: "Site lent le soir",
        channel: "email",
        category: "assistance",
        severity: "low",
        status: "closed",
        assigneeMemberId: member.malik,
        firstResponseAt: at(-30),
        resolvedAt: at(-28),
        closedAt: at(-27),
        coverage: "covered",
      },
      {
        id: ticket.kinePage,
        number: number("T", 32),
        companyId: company.kine,
        siteId: site.kine,
        contractId: contract.kine,
        subject: "Ajouter une page Tarifs en anglais",
        channel: "portal",
        category: "change",
        severity: "low",
        status: "qualified",
        coverage: "not_covered",
        openedByUserId: uid("marc"),
        changeRequestId: changeRequest.kine,
      },
      {
        id: ticket.verdierDown,
        number: number("T", 33),
        companyId: company.verdier,
        siteId: site.verdier,
        contractId: contract.verdier,
        subject: "Site indisponible",
        description: "Alerte de surveillance.",
        channel: "monitoring",
        category: "incident",
        severity: "critical",
        status: "received",
        assigneeMemberId: member.malik,
        dueAt: at(0, 14),
        coverage: "undetermined",
        isIncident: true,
      },
      {
        id: ticket.verdierQuestion,
        number: number("T", 30),
        companyId: company.verdier,
        channel: "phone",
        category: "question",
        subject: "Comment ajouter un produit ?",
        severity: "low",
        status: "resolved",
        assigneeMemberId: member.hugo,
        firstResponseAt: at(-10),
        resolvedAt: at(-9),
        coverage: "overage",
      },
      {
        id: ticket.luneChange,
        number: number("T", 34),
        companyId: company.lune,
        siteId: site.lune,
        projectId: project.lune,
        subject: "Changer la photo d'accueil",
        channel: "portal",
        category: "change",
        severity: "medium",
        status: "received",
        coverage: "undetermined",
        openedByUserId: uid("claire"),
      },
    ];
    await tx.insert(s.tickets).values(ticketRows).onConflictDoNothing();

    await tx
      .insert(s.ticketMessages)
      .values([
        {
          id: seedId("ticket-message:form-1"),
          ticketId: ticket.kineForm,
          authorUserId: uid("marc"),
          body: "Bonjour, le formulaire de contact ne fonctionne plus.",
          at: at(-1, 8),
        },
        {
          id: seedId("ticket-message:form-2"),
          ticketId: ticket.kineForm,
          authorUserId: uid("hugo"),
          body: "Bien reçu, nous regardons cela ce matin.",
          at: at(-1, 9),
        },
        {
          id: seedId("ticket-message:form-3"),
          ticketId: ticket.kineForm,
          authorUserId: uid("hugo"),
          body: "Clé SMTP expirée côté hébergeur, à renouveler.",
          internal: true,
          at: at(-1, 10),
        },
        {
          id: seedId("ticket-message:lune-1"),
          ticketId: ticket.luneChange,
          authorUserId: uid("claire"),
          body: "Pouvez-vous mettre la photo des pivoines en accueil ?",
          at: at(-1, 11),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.ticketEvents)
      .values([
        {
          id: seedId("ticket-event:form-1"),
          ticketId: ticket.kineForm,
          fromStatus: null,
          toStatus: "received",
          actorId: uid("marc"),
          at: at(-1, 8),
        },
        {
          id: seedId("ticket-event:form-2"),
          ticketId: ticket.kineForm,
          fromStatus: "received",
          toStatus: "qualified",
          actorId: uid("hugo"),
          at: at(-1, 9),
        },
        {
          id: seedId("ticket-event:form-3"),
          ticketId: ticket.kineForm,
          fromStatus: "qualified",
          toStatus: "in_progress",
          actorId: uid("hugo"),
          note: "Prise en charge",
          at: at(-1, 10),
        },
        {
          id: seedId("ticket-event:down-1"),
          ticketId: ticket.verdierDown,
          fromStatus: null,
          toStatus: "received",
          at: at(0, 7),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.contractEvents)
      .values([
        {
          id: seedId("contract-event:kine-created"),
          contractId: contract.kine,
          kind: "created",
          actorId: uid("malik"),
          at: at(-150),
        },
        {
          id: seedId("contract-event:kine-price"),
          contractId: contract.kine,
          kind: "price_change",
          fromPriceCents: 9900,
          toPriceCents: 12900,
          note: "Passage à la formule Sérénité",
          actorId: uid("camille"),
          at: at(-60),
        },
        {
          id: seedId("contract-event:verdier-note"),
          contractId: contract.verdier,
          kind: "note",
          note: "Tarif à réévaluer avant le renouvellement.",
          actorId: uid("camille"),
          at: at(-7),
        },
        {
          id: seedId("contract-event:sables-terminated"),
          contractId: contract.sables,
          kind: "terminated",
          note: "Résiliation à la demande du client.",
          actorId: uid("camille"),
          at: at(-60),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.maintenanceInterventions)
      .values([
        {
          id: seedId("intervention:kine-maj"),
          companyId: company.kine,
          contractId: contract.kine,
          siteId: site.kine,
          title: "Mises à jour mensuelles",
          plannedOn: day(-15),
          doneOn: day(-15),
          result: "Mises à jour appliquées, sauvegarde vérifiée.",
          minutes: 45,
          memberId: member.hugo,
        },
        {
          id: seedId("intervention:kine-form"),
          companyId: company.kine,
          contractId: contract.kine,
          siteId: site.kine,
          ticketId: ticket.kineForm,
          title: "Correction du formulaire",
          plannedOn: day(0),
          minutes: 60,
          memberId: member.hugo,
        },
        {
          id: seedId("intervention:kine-next"),
          companyId: company.kine,
          contractId: contract.kine,
          siteId: site.kine,
          title: "Mises à jour mensuelles",
          plannedOn: day(15),
          memberId: member.hugo,
        },
      ])
      .onConflictDoNothing();

    // --- Temps --------------------------------------------------------------------------------
    await tx
      .insert(s.missions)
      .values([
        {
          id: seedId("mission:ines-da"),
          memberId: member.ines,
          companyId: company.lune,
          projectId: project.lune,
          taskId: task("charte"),
          title: "Direction artistique",
          deliverableLabel: "Planche de style",
          deliverableReceivedOn: day(-13),
          dueOn: day(-14),
          status: "delivered",
          plannedCostCents: 90000,
          committedCostCents: 90000,
        },
        {
          id: seedId("mission:ines-maquettes"),
          memberId: member.ines,
          companyId: company.lune,
          projectId: project.lune,
          taskId: task("maquettes"),
          title: "Maquettes accueil et galerie",
          deliverableLabel: "Maquettes Figma",
          dueOn: day(4),
          status: "in_progress",
          plannedCostCents: 135000,
          committedCostCents: 135000,
        },
        {
          id: seedId("mission:hugo-form"),
          memberId: member.hugo,
          companyId: company.kine,
          ticketId: ticket.kineForm,
          title: "Corriger le formulaire",
          dueOn: day(1),
          status: "in_progress",
        },
      ])
      .onConflictDoNothing();

    const hourly = { camille: 5000, malik: 5000, hugo: 3500, ines: 6000, lea: 2500 };
    const timeRows: (typeof s.timeEntries.$inferInsert)[] = [];
    for (const offset of [-1, -2, -3, -4, -5, -8, -9, -10]) {
      timeRows.push({
        id: seedId(`time:ines-maquettes${offset}`),
        memberId: member.ines,
        companyId: company.lune,
        projectId: project.lune,
        taskId: task("maquettes"),
        workOn: day(offset),
        minutes: 240,
        category: "production",
        hourlyCostCents: hourly.ines,
        createdBy: uid("ines"),
      });
      timeRows.push({
        id: seedId(`time:hugo-verdier${offset}`),
        memberId: member.hugo,
        companyId: company.verdier,
        projectId: project.verdier,
        taskId: task("verdier-catalogue"),
        workOn: day(offset),
        minutes: 300,
        category: "production",
        hourlyCostCents: hourly.hugo,
        createdBy: uid("hugo"),
      });
    }
    timeRows.push(
      {
        id: seedId("time:hugo-kine-form"),
        memberId: member.hugo,
        companyId: company.kine,
        ticketId: ticket.kineForm,
        contractId: contract.kine,
        workOn: day(-1),
        minutes: 75,
        category: "support",
        hourlyCostCents: hourly.hugo,
        note: "Diagnostic du formulaire",
        createdBy: uid("hugo"),
      },
      {
        id: seedId("time:hugo-kine-maj"),
        memberId: member.hugo,
        companyId: company.kine,
        contractId: contract.kine,
        workOn: day(-15),
        minutes: 45,
        category: "support",
        hourlyCostCents: hourly.hugo,
        createdBy: uid("hugo"),
      },
      {
        id: seedId("time:malik-kine-history"),
        memberId: member.malik,
        companyId: company.kine,
        projectId: project.kine,
        workOn: day(-160),
        minutes: 4800,
        category: "production",
        hourlyCostCents: hourly.malik,
        createdBy: uid("malik"),
      },
      {
        id: seedId("time:hugo-kine-corrections"),
        memberId: member.hugo,
        companyId: company.kine,
        projectId: project.kine,
        workOn: day(-152),
        minutes: 300,
        category: "corrections",
        billable: false,
        hourlyCostCents: hourly.hugo,
        createdBy: uid("hugo"),
      },
      {
        id: seedId("time:camille-prospection"),
        memberId: member.camille,
        workOn: day(-3),
        minutes: 120,
        category: "prospecting",
        billable: false,
        hourlyCostCents: hourly.camille,
        note: "Rendez-vous réseau",
        createdBy: uid("camille"),
      },
      {
        id: seedId("time:lea-admin"),
        memberId: member.lea,
        workOn: day(-2),
        minutes: 180,
        category: "admin",
        billable: false,
        hourlyCostCents: hourly.lea,
        createdBy: uid("lea"),
      },
    );
    await tx.insert(s.timeEntries).values(timeRows).onConflictDoNothing();

    // --- Documents ----------------------------------------------------------------------------
    const docRows: (typeof s.documents.$inferInsert)[] = [
      {
        id: document.briefLune,
        companyId: company.lune,
        projectId: project.lune,
        title: "Brief Atelier Lune",
        kind: "brief",
        visibility: "internal",
        status: "final",
      },
      {
        id: document.maquetteLune,
        companyId: company.lune,
        projectId: project.lune,
        title: "Maquette accueil",
        kind: "mockup",
        visibility: "client",
        status: "to_validate",
      },
      {
        id: document.devisLune,
        companyId: company.lune,
        quoteId: quote.lune,
        title: "Devis signé",
        kind: "quote",
        visibility: "client",
        status: "signed",
      },
      {
        id: document.photosLune,
        companyId: company.lune,
        projectId: project.lune,
        title: "Photos de la boutique",
        kind: "client_file",
        visibility: "client",
        status: "final",
        uploadedByClient: true,
      },
      {
        id: document.contratKine,
        companyId: company.kine,
        contractId: contract.kine,
        title: "Contrat de maintenance",
        kind: "contract",
        visibility: "client",
        status: "signed",
      },
      {
        id: document.factureKine,
        companyId: company.kine,
        contractId: contract.kine,
        title: "Facture de maintenance",
        kind: "invoice",
        visibility: "client",
        status: "final",
      },
      {
        id: document.procedure,
        title: "Procédure de mise en ligne",
        kind: "other",
        visibility: "internal",
        status: "final",
      },
    ];
    await tx.insert(s.documents).values(docRows).onConflictDoNothing();

    await tx
      .insert(s.documentVersions)
      .values(
        docRows.map((row, index) => ({
          id: seedId(`document-version:${row.id}`),
          documentId: row.id as string,
          version: 1,
          // Clé de démonstration : aucun fichier réel ne lui correspond dans le stockage.
          storageKey: `seed/${row.id}/v1.pdf`,
          filename: `document-${index + 1}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 204800,
          sha256: createHash("sha256").update(String(row.id)).digest("hex"),
          uploadedByUserId: row.uploadedByClient ? uid("claire") : uid("camille"),
          note: "Version initiale",
        })),
      )
      .onConflictDoNothing();
    for (const row of docRows) {
      await tx
        .update(s.documents)
        .set({ currentVersionId: seedId(`document-version:${row.id}`) })
        .where(eq(s.documents.id, row.id as string));
    }

    await tx
      .insert(s.knowledgeArticles)
      .values([
        {
          id: seedId("article:mise-en-ligne"),
          kind: "internal",
          title: "Mettre un site en ligne",
          body: "1. Vérifier la recette. 2. Sauvegarder. 3. Déployer depuis Coolify. 4. Contrôler le certificat.",
          authorUserId: uid("malik"),
          version: 2,
        },
        {
          id: seedId("article:restauration"),
          kind: "technical",
          title: "Restaurer une sauvegarde",
          body: "Depuis Coolify, choisir la sauvegarde, restaurer sur staging, contrôler, puis basculer.",
          siteId: site.kine,
          authorUserId: uid("malik"),
        },
        {
          id: seedId("article:formulaire"),
          kind: "faq",
          title: "Le formulaire n'envoie plus",
          body: "Vérifier la clé SMTP du site et les journaux de l'application.",
          authorUserId: uid("hugo"),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.knowledgeArticleVersions)
      .values([
        {
          id: seedId("article-version:mise-en-ligne-1"),
          articleId: seedId("article:mise-en-ligne"),
          version: 1,
          body: "1. Déployer depuis Coolify.",
          authorUserId: uid("malik"),
          at: at(-90),
        },
        {
          id: seedId("article-version:mise-en-ligne-2"),
          articleId: seedId("article:mise-en-ligne"),
          version: 2,
          body: "1. Vérifier la recette. 2. Sauvegarder. 3. Déployer depuis Coolify. 4. Contrôler le certificat.",
          authorUserId: uid("malik"),
          at: at(-30),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.templates)
      .values([
        {
          id: seedId("template:brief-vitrine"),
          kind: "brief",
          activity: "vitrine",
          name: "Brief site vitrine",
          body: "Objectifs, cibles, pages, références, contenus disponibles.",
        },
        {
          id: seedId("template:recette"),
          kind: "checklist",
          name: "Recette avant mise en ligne",
          items: [
            "Formulaires testés",
            "Certificat valide",
            "Sauvegarde vérifiée",
            "Mentions légales",
          ],
        },
        {
          id: seedId("template:relance"),
          kind: "message",
          name: "Relance de contenus",
          body: "Bonjour, il nous manque encore vos contenus pour tenir la date de mise en ligne.",
        },
        {
          id: seedId("template:plan-vitrine"),
          kind: "project_plan",
          activity: "vitrine",
          name: "Plan de projet vitrine",
          items: phaseNames,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.deliverables)
      .values([
        {
          id: seedId("deliverable:da"),
          projectId: project.lune,
          phaseId: phaseId("lune", 1),
          title: "Direction artistique",
          status: "validated",
          requiresClientValidation: true,
          feedbackRoundsIncluded: 2,
        },
        {
          id: seedId("deliverable:maquette"),
          projectId: project.lune,
          phaseId: phaseId("lune", 1),
          title: "Maquette accueil",
          status: "to_validate",
          version: 2,
          documentId: document.maquetteLune,
          requiresClientValidation: true,
          feedbackRoundsIncluded: 2,
        },
        {
          id: seedId("deliverable:galerie"),
          projectId: project.lune,
          phaseId: phaseId("lune", 1),
          title: "Maquette galerie",
          status: "draft",
          requiresClientValidation: true,
          feedbackRoundsIncluded: 2,
        },
        {
          id: seedId("deliverable:kine-site"),
          projectId: project.kine,
          phaseId: phaseId("kine", 3),
          title: "Site en préproduction",
          status: "validated",
          requiresClientValidation: true,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.deliverableReviews)
      .values([
        {
          id: seedId("review:da"),
          deliverableId: seedId("deliverable:da"),
          version: 1,
          decision: "validated",
          comment: "Parfait, on continue.",
          reviewerUserId: uid("claire"),
          at: at(-13),
        },
        {
          id: seedId("review:maquette-1"),
          deliverableId: seedId("deliverable:maquette"),
          version: 1,
          decision: "changes_requested",
          comment: "Le titre est trop grand, et je préfère la photo des pivoines.",
          reviewerUserId: uid("claire"),
          at: at(-5),
        },
        {
          id: seedId("review:kine"),
          deliverableId: seedId("deliverable:kine-site"),
          version: 1,
          decision: "validated",
          reviewerUserId: uid("marc"),
          at: at(-152),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.clientRequirements)
      .values([
        {
          id: seedId("requirement:photos"),
          projectId: project.lune,
          label: "Déposer les photos",
          status: "received",
          dueOn: day(-3),
          receivedAt: at(-3),
          documentId: document.photosLune,
        },
        {
          id: seedId("requirement:textes"),
          projectId: project.lune,
          label: "Compléter les textes des pages",
          status: "expected",
          dueOn: day(2),
        },
        {
          id: seedId("requirement:horaires"),
          projectId: project.lune,
          label: "Confirmer les horaires",
          status: "expected",
          dueOn: day(5),
        },
        {
          id: seedId("requirement:verdier"),
          projectId: project.verdier,
          label: "Fournir le catalogue produits",
          status: "received",
          dueOn: day(-10),
          receivedAt: at(-11),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.handoverChecklistItems)
      .values([
        {
          id: seedId("handover:recette"),
          projectId: project.kine,
          label: "Recette validée",
          doneAt: at(-152),
          position: 1,
        },
        {
          id: seedId("handover:domaine"),
          projectId: project.kine,
          label: "Domaine pointé",
          doneAt: at(-150),
          position: 2,
        },
        {
          id: seedId("handover:acces"),
          projectId: project.kine,
          label: "Accès remis au client",
          doneAt: at(-150),
          position: 3,
        },
        {
          id: seedId("handover:contrat"),
          projectId: project.kine,
          label: "Contrat de maintenance signé",
          doneAt: at(-150),
          position: 4,
        },
        {
          id: seedId("handover:lune-recette"),
          projectId: project.lune,
          label: "Recette validée",
          position: 1,
        },
        {
          id: seedId("handover:lune-domaine"),
          projectId: project.lune,
          label: "Domaine pointé",
          position: 2,
        },
      ])
      .onConflictDoNothing();

    // --- Finances -----------------------------------------------------------------------------
    const scheduleId = (key: string) => seedId(`schedule:${key}`);
    await tx
      .insert(s.paymentScheduleItems)
      .values([
        {
          id: scheduleId("lune-acompte"),
          companyId: company.lune,
          projectId: project.lune,
          quoteId: quote.lune,
          label: "Acompte 30 %",
          dueOn: day(-38),
          amountCents: 234000,
          status: "paid",
        },
        {
          id: scheduleId("lune-solde"),
          companyId: company.lune,
          projectId: project.lune,
          quoteId: quote.lune,
          label: "Solde à la mise en ligne",
          dueOn: day(15),
          amountCents: 546000,
          status: "planned",
        },
        {
          id: scheduleId("kine-solde"),
          companyId: company.kine,
          projectId: project.kine,
          quoteId: quote.kine,
          label: "Solde",
          dueOn: day(-150),
          amountCents: 455000,
          status: "paid",
        },
        {
          id: scheduleId("kine-maintenance"),
          companyId: company.kine,
          contractId: contract.kine,
          label: "Maintenance du mois",
          dueOn: day(-3),
          amountCents: 12900,
          status: "invoiced",
        },
        {
          id: scheduleId("verdier-acompte"),
          companyId: company.verdier,
          projectId: project.verdier,
          label: "Acompte 30 %",
          dueOn: day(-14),
          amountCents: 435000,
          status: "invoiced",
        },
      ])
      .onConflictDoNothing();

    const financeId = (key: string) => seedId(`finance:${key}`);
    await tx
      .insert(s.financialDocuments)
      .values([
        // Co-traitance : l'acompte produit deux factures, une par associé.
        {
          id: financeId("lune-acompte-camille"),
          companyId: company.lune,
          projectId: project.lune,
          quoteId: quote.lune,
          scheduleItemId: scheduleId("lune-acompte"),
          source: "indy_csv",
          externalRef: `INDY-${year}-0101`,
          issuerMemberId: member.camille,
          issuedOn: day(-38),
          dueOn: day(-30),
          amountCents: 117000,
          taxCents: 23400,
          status: "paid",
          paidOn: day(-34),
          clientVisible: true,
          importedAt: at(-30),
        },
        {
          id: financeId("lune-acompte-malik"),
          companyId: company.lune,
          projectId: project.lune,
          quoteId: quote.lune,
          scheduleItemId: scheduleId("lune-acompte"),
          source: "indy_csv",
          externalRef: `INDY-${year}-0102`,
          issuerMemberId: member.malik,
          issuedOn: day(-38),
          dueOn: day(-30),
          amountCents: 117000,
          taxCents: 23400,
          status: "paid",
          paidOn: day(-33),
          clientVisible: true,
          importedAt: at(-30),
        },
        {
          id: financeId("kine-solde"),
          companyId: company.kine,
          projectId: project.kine,
          quoteId: quote.kine,
          scheduleItemId: scheduleId("kine-solde"),
          source: "manual",
          externalRef: `INDY-${year}-0044`,
          issuerMemberId: member.malik,
          issuedOn: day(-150),
          dueOn: day(-120),
          amountCents: 455000,
          taxCents: 91000,
          status: "paid",
          paidOn: day(-125),
          clientVisible: true,
        },
        {
          id: financeId("kine-maintenance"),
          companyId: company.kine,
          contractId: contract.kine,
          scheduleItemId: scheduleId("kine-maintenance"),
          source: "indy_csv",
          externalRef: `INDY-${year}-0133`,
          issuerMemberId: member.malik,
          issuedOn: day(-3),
          dueOn: day(27),
          amountCents: 12900,
          taxCents: 2580,
          status: "issued",
          documentId: document.factureKine,
          clientVisible: true,
          importedAt: at(-2),
        },
        {
          id: financeId("verdier-acompte"),
          companyId: company.verdier,
          projectId: project.verdier,
          scheduleItemId: scheduleId("verdier-acompte"),
          source: "indy_csv",
          externalRef: `INDY-${year}-0120`,
          issuerMemberId: member.camille,
          issuedOn: day(-14),
          dueOn: day(-4),
          amountCents: 435000,
          taxCents: 87000,
          status: "overdue",
          clientVisible: false,
          importedAt: at(-2),
        },
      ])
      .onConflictDoNothing();

    for (const [key, document] of [
      ["lune-acompte", "lune-acompte-camille"],
      ["kine-solde", "kine-solde"],
      ["kine-maintenance", "kine-maintenance"],
      ["verdier-acompte", "verdier-acompte"],
    ] as const) {
      await tx
        .update(s.paymentScheduleItems)
        .set({ financialDocumentId: financeId(document) })
        .where(eq(s.paymentScheduleItems.id, scheduleId(key)));
    }

    await tx
      .insert(s.directCosts)
      .values([
        {
          id: seedId("cost:ines-da"),
          companyId: company.lune,
          projectId: project.lune,
          memberId: member.ines,
          label: "Direction artistique",
          category: "subcontracting",
          amountCents: 90000,
          incurredOn: day(-13),
          nature: "actual",
        },
        {
          id: seedId("cost:ines-maquettes"),
          companyId: company.lune,
          projectId: project.lune,
          memberId: member.ines,
          label: "Maquettes",
          category: "subcontracting",
          amountCents: 135000,
          incurredOn: day(4),
          nature: "forecast",
        },
        {
          id: seedId("cost:licence"),
          companyId: company.verdier,
          projectId: project.verdier,
          label: "Licence extension paiement",
          category: "license",
          amountCents: 15000,
          incurredOn: day(-5),
          recurringPeriod: "yearly",
          nature: "actual",
        },
        {
          id: seedId("cost:hebergement-kine"),
          companyId: company.kine,
          siteId: site.kine,
          contractId: contract.kine,
          label: "Part de serveur",
          category: "hosting",
          amountCents: 1500,
          incurredOn: day(-30),
          recurringPeriod: "monthly",
          nature: "actual",
        },
        {
          id: seedId("cost:serveurs"),
          label: "Serveurs de l'agence",
          category: "hosting",
          amountCents: 16700,
          incurredOn: day(-30),
          recurringPeriod: "monthly",
          nature: "actual",
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.financeImports)
      .values([
        {
          id: seedId("finance-import:1"),
          source: "indy_csv",
          filename: "factures-indy.csv",
          rowsTotal: 5,
          rowsCreated: 4,
          rowsUpdated: 0,
          rowsRejected: 1,
          errors: [{ line: 5, message: "Client introuvable" }],
          actorId: uid("camille"),
          at: at(-2),
        },
      ])
      .onConflictDoNothing();

    // --- Échanges -----------------------------------------------------------------------------
    await tx
      .insert(s.conversations)
      .values([
        {
          id: conversation.lune,
          companyId: company.lune,
          projectId: project.lune,
          contactId: contact.claire,
          subject: "Site vitrine",
          lastMessageAt: at(-1, 15),
          unreadInternal: 1,
        },
        {
          id: conversation.kine,
          companyId: company.kine,
          contactId: contact.marc,
          subject: "Maintenance",
          lastMessageAt: at(-4),
          unreadClient: 1,
        },
        {
          id: conversation.verdier,
          companyId: company.verdier,
          projectId: project.verdier,
          contactId: contact.sophie,
          subject: "Boutique en ligne",
          lastMessageAt: at(-6),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.messages)
      .values([
        {
          id: message.lune1,
          companyId: company.lune,
          conversationId: conversation.lune,
          authorUserId: uid("camille"),
          direction: "outbound",
          body: "Bonjour Claire, la maquette d'accueil est prête, elle vous attend dans votre espace.",
          documentId: document.maquetteLune,
          at: at(-2, 9),
        },
        {
          id: message.lune2,
          companyId: company.lune,
          conversationId: conversation.lune,
          authorUserId: uid("camille"),
          direction: "internal",
          body: "À relancer pour les textes si rien d'ici demain.",
          mentions: [uid("malik")],
          at: at(-2, 10),
        },
        {
          id: message.lune3,
          companyId: company.lune,
          conversationId: conversation.lune,
          authorUserId: uid("claire"),
          authorContactId: contact.claire,
          direction: "inbound",
          body: "Merci ! Je regarde ce soir. Les textes arrivent en fin de semaine.",
          at: at(-1, 15),
        },
        {
          id: message.kine1,
          companyId: company.kine,
          conversationId: conversation.kine,
          authorUserId: uid("marc"),
          authorContactId: contact.marc,
          direction: "inbound",
          body: "Pouvez-vous m'envoyer le bilan du semestre ?",
          at: at(-5),
        },
        {
          id: message.kine2,
          companyId: company.kine,
          conversationId: conversation.kine,
          authorUserId: uid("malik"),
          direction: "outbound",
          body: "Bien sûr, le voici en pièce jointe.",
          documentId: document.contratKine,
          at: at(-4),
        },
        {
          id: message.verdier1,
          companyId: company.verdier,
          conversationId: conversation.verdier,
          authorContactId: contact.sophie,
          direction: "inbound",
          body: "Le catalogue est prêt, je vous l'envoie.",
          at: at(-6),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.replySuggestions)
      .values([
        {
          id: seedId("suggestion:lune"),
          conversationId: conversation.lune,
          messageId: message.lune3,
          body: "Merci Claire, nous attendons vos textes pour fin de semaine et bloquons la relecture lundi.",
          status: "ready",
          tone: "Chaleureux",
          contextSummary: "Planning du projet, contenus attendus.",
          requestedBy: uid("camille"),
        },
        {
          id: seedId("suggestion:verdier"),
          conversationId: conversation.verdier,
          messageId: message.verdier1,
          status: "failed",
          error: "Connexion requise : aucune clé OpenAI configurée.",
          requestedBy: uid("camille"),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.comments)
      .values([
        {
          id: seedId("comment:galerie-1"),
          companyId: company.lune,
          entityType: "task",
          entityId: task("galerie"),
          authorUserId: uid("hugo"),
          body: "Il me faut les photos avant de commencer.",
        },
        {
          id: seedId("comment:galerie-2"),
          companyId: company.lune,
          entityType: "task",
          entityId: task("galerie"),
          parentId: seedId("comment:galerie-1"),
          authorUserId: uid("camille"),
          body: "Relance partie, je te préviens dès réception.",
          mentions: [uid("hugo")],
        },
        {
          id: seedId("comment:form"),
          companyId: company.kine,
          entityType: "ticket",
          entityId: ticket.kineForm,
          authorUserId: uid("hugo"),
          body: "Cause trouvée : clé SMTP expirée.",
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.appointments)
      .values([
        {
          id: seedId("appointment:lune"),
          companyId: company.lune,
          contactId: contact.claire,
          projectId: project.lune,
          title: "Point maquettes",
          kind: "Suivi",
          startsAt: at(2, 9),
          durationMinutes: 30,
          channel: "Visio",
          memberIds: [member.camille],
          source: "manual",
        },
        {
          id: seedId("appointment:faure"),
          companyId: company.faure,
          contactId: contact.jules,
          opportunityId: opportunity.faure,
          title: "Rendez-vous de cadrage",
          kind: "Découverte",
          startsAt: at(2, 14),
          durationMinutes: 60,
          channel: "Sur place",
          location: "8 avenue de l'Opéra, Paris",
          memberIds: [member.camille, member.malik],
          source: "cal",
          externalId: "seed-cal-1",
        },
        {
          id: seedId("appointment:kine"),
          companyId: company.kine,
          contactId: contact.marc,
          title: "Bilan de 6 mois",
          kind: "Suivi",
          startsAt: at(-12),
          durationMinutes: 45,
          channel: "Téléphone",
          memberIds: [member.malik],
          status: "done",
        },
      ])
      .onConflictDoNothing();

    // --- Portail ------------------------------------------------------------------------------
    await tx
      .insert(s.portalMemberships)
      .values([
        {
          id: seedId("membership:claire"),
          userId: uid("claire"),
          companyId: company.lune,
          contactId: contact.claire,
          status: "active",
          invitedBy: uid("camille"),
          invitedAt: at(-30),
          lastSeenAt: at(-1),
        },
        {
          id: seedId("membership:marc"),
          userId: uid("marc"),
          companyId: company.kine,
          contactId: contact.marc,
          status: "active",
          invitedBy: uid("malik"),
          invitedAt: at(-150),
          lastSeenAt: at(-4),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.portalPreferences)
      .values([
        { id: seedId("portal-pref:claire"), userId: uid("claire") },
        { id: seedId("portal-pref:marc"), userId: uid("marc"), notifyReport: false },
      ])
      .onConflictDoNothing();

    // --- Automatisations et administration ----------------------------------------------------
    // Un événement déjà marqué comme traité : le moteur d'automatisation ne doit pas le rejouer.
    const event = (key: string) => seedId(`event:${key}`);
    await tx
      .insert(s.domainEvents)
      .values([
        {
          id: event("quote-accepted"),
          type: "quote.accepted",
          entityType: "quote",
          entityId: quote.lune,
          companyId: company.lune,
          payload: {
            number: number("D", 12),
            versionId: version.lune2,
            opportunityId: opportunity.lune,
            totalCents: 780000,
          },
          actorId: uid("camille"),
          dedupeKey: `seed:quote.accepted:${quote.lune}`,
          occurredAt: at(-40),
          dispatchedAt: at(-40),
        },
        {
          id: event("project-created"),
          type: "project.created",
          entityType: "project",
          entityId: project.lune,
          companyId: company.lune,
          payload: {
            number: number("P", 7),
            name: "Atelier Lune · Site vitrine",
            quoteId: quote.lune,
          },
          actorId: uid("camille"),
          occurredAt: at(-40),
          dispatchedAt: at(-40),
        },
        {
          id: event("site-down"),
          type: "site.down",
          entityType: "site",
          entityId: site.verdier,
          companyId: company.verdier,
          payload: {
            name: "Maison Verdier",
            primaryDomain: "maison-verdier.example",
            source: "uptime_kuma",
          },
          occurredAt: at(0, 7),
          dispatchedAt: at(0, 7),
        },
        {
          id: event("invoice-overdue"),
          type: "invoice.overdue",
          entityType: "financial_document",
          entityId: financeId("verdier-acompte"),
          companyId: company.verdier,
          payload: { externalRef: `INDY-${year}-0120`, amountCents: 435000, dueOn: day(-4) },
          occurredAt: at(-3),
          dispatchedAt: at(-3),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.automationRules)
      .values([
        {
          id: seedId("rule:quote-reminder"),
          key: "quote_reminder_7d",
          name: "Relance de devis",
          triggerLabel: "Un devis n'est pas signé après 7 jours",
          actionLabel: "Relancer le client par e-mail",
          toolLabel: "DocuSeal",
          config: { delayDays: 7 },
        },
        {
          id: seedId("rule:project-from-quote"),
          key: "project_from_quote",
          name: "Projet après signature",
          triggerLabel: "Un devis est signé",
          actionLabel: "Créer le projet, ouvrir l'espace client",
          toolLabel: "Nuera OS",
        },
        {
          id: seedId("rule:site-down"),
          key: "site_down_alert",
          name: "Alerte de panne",
          triggerLabel: "Un site ne répond plus",
          actionLabel: "Ouvrir un incident, alerter les associés",
          toolLabel: "Uptime Kuma",
        },
        {
          id: seedId("rule:invoice-paid"),
          key: "invoice_paid_unlock",
          name: "Facture payée",
          triggerLabel: "Une facture est payée sur Indy",
          actionLabel: "Débloquer la mise en ligne",
          toolLabel: "n8n",
          enabled: false,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.automationRuns)
      .values([
        {
          id: seedId("run:project"),
          ruleKey: "project_from_quote",
          eventId: event("quote-accepted"),
          status: "succeeded",
          startedAt: at(-40),
          finishedAt: at(-40),
          result: { projectId: project.lune },
        },
        {
          id: seedId("run:site-down"),
          ruleKey: "site_down_alert",
          eventId: event("site-down"),
          status: "succeeded",
          startedAt: at(0, 7),
          finishedAt: at(0, 7),
          result: { ticketId: ticket.verdierDown },
        },
        {
          id: seedId("run:invoice"),
          ruleKey: "invoice_paid_unlock",
          eventId: event("invoice-overdue"),
          status: "skipped",
          startedAt: at(-3),
          finishedAt: at(-3),
        },
        {
          id: seedId("run:reminder-failed"),
          ruleKey: "quote_reminder_7d",
          status: "failed",
          attempts: 2,
          error: "Connexion requise : SMTP non configuré.",
          startedAt: at(-1),
          finishedAt: at(-1),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.notifications)
      .values([
        {
          id: seedId("notification:down"),
          userId: uid("malik"),
          kind: "site.down",
          severity: "danger",
          title: "maison-verdier.example ne répond plus",
          body: "Incident ouvert automatiquement.",
          entityType: "site",
          entityId: site.verdier,
          href: `/sites/${site.verdier}`,
          dedupeKey: `seed:site.down:${site.verdier}`,
        },
        {
          id: seedId("notification:overdue"),
          userId: uid("camille"),
          kind: "invoice.overdue",
          severity: "warning",
          title: "Facture en retard · Maison Verdier",
          entityType: "financial_document",
          entityId: financeId("verdier-acompte"),
          href: "/finances",
          dedupeKey: `seed:invoice.overdue:${financeId("verdier-acompte")}`,
        },
        {
          id: seedId("notification:message"),
          userId: uid("camille"),
          kind: "message.received",
          severity: "info",
          title: "Claire Martin vous a écrit",
          entityType: "conversation",
          entityId: conversation.lune,
          href: `/messages/${conversation.lune}`,
          dedupeKey: `seed:message:${message.lune3}`,
          readAt: at(-1, 16),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.notificationPreferences)
      .values([
        {
          id: seedId("notif-pref:camille-message"),
          userId: uid("camille"),
          kind: "message.received",
          inApp: true,
          email: true,
        },
        {
          id: seedId("notif-pref:malik-down"),
          userId: uid("malik"),
          kind: "site.down",
          inApp: true,
          email: true,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.userPreferences)
      .values([
        {
          id: seedId("user-pref:camille"),
          userId: uid("camille"),
          theme: "light",
          homePath: "/",
          density: "comfortable",
          dailyDigest: true,
        },
        {
          id: seedId("user-pref:malik"),
          userId: uid("malik"),
          theme: "dark",
          homePath: "/sites",
          density: "compact",
        },
      ])
      .onConflictDoNothing();

    // État des intégrations : aucune n'est déclarée connectée, le seed n'en contacte aucune.
    await tx
      .insert(s.integrationConnections)
      .values(
        s.INTEGRATION_SERVICES.map((service) => ({
          id: seedId(`integration:${service}`),
          service,
          status: service === "indy" ? ("to_verify" as const) : ("not_configured" as const),
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(s.syncRuns)
      .values([
        {
          id: seedId("sync:twenty"),
          service: "twenty",
          scope: "company",
          status: "failed",
          startedAt: at(-1),
          finishedAt: at(-1),
          items: 0,
          error: "Connexion requise.",
        },
        {
          id: seedId("sync:indy"),
          service: "indy",
          scope: "csv",
          status: "succeeded",
          startedAt: at(-2),
          finishedAt: at(-2),
          items: 4,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.webhookReceipts)
      .values([
        {
          id: seedId("webhook:docuseal"),
          service: "docuseal",
          externalId: "seed-webhook-1",
          receivedAt: at(-40),
          status: "processed",
        },
      ])
      .onConflictDoNothing();

    // Jamais `pending` : un futur adaptateur SMTP n'expédiera pas ces lignes de démonstration.
    await tx
      .insert(s.emailOutbox)
      .values([
        {
          id: seedId("email:invitation"),
          toAddress: seedEmail("claire"),
          subject: "Votre espace projet Nuera est prêt",
          text: "Message de démonstration, sans lien de connexion.",
          template: "portal_invitation",
          status: "not_configured",
          attempts: 1,
          lastError: "SMTP non configuré.",
          dedupeKey: "seed:invitation:claire",
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.appSettings)
      .values([
        {
          id: seedId("setting:agency"),
          key: "agency.identity",
          value: { name: "Agence de démonstration", email: `contact@${SEED_EMAIL_DOMAIN}` },
          updatedBy: uid("camille"),
        },
        {
          id: seedId("setting:thresholds"),
          key: "thresholds",
          value: { loadWarnPercent: 90, loadDangerPercent: 100, budgetAlertPercent: 80 },
          updatedBy: uid("camille"),
        },
      ])
      .onConflictDoNothing();

    // Compteurs alignés sur les numéros ci-dessus : le prochain document ne les heurte pas.
    const counters: Record<SequenceScope, number> = {
      quote: 17,
      project: 8,
      ticket: 34,
      contract: 4,
      task: 32,
    };
    for (const [scope, value] of Object.entries(counters)) {
      await tx
        .insert(s.sequences)
        .values({ scope, year, value })
        .onConflictDoUpdate({
          target: [s.sequences.scope, s.sequences.year],
          set: { value: sql`greatest(${s.sequences.value}, ${value})` },
        });
    }

    await recordAudit(tx, {
      actorId: null,
      action: "app_setting.updated",
      entityType: "app_setting",
      entityId: "seed",
      metadata: { via: "seed" },
    });
  });

  return { accounts };
}
