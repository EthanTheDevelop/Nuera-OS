import { and, eq } from "drizzle-orm";
import { createCompany } from "@/modules/crm/company.service";
import { createContact } from "@/modules/crm/contact.service";
import {
  acceptQuoteManually,
  markQuoteSentManually,
} from "@/modules/quotes/quote-signature.service";
import { createQuote, saveQuoteContent } from "@/modules/quotes/quote.service";
import type { ServiceContext } from "@/server/context";
import * as s from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestContext, createTestDatabase } from "../helpers/db";
import { createMemberContext } from "../helpers/factories";
import { FakeCrmGateway } from "../helpers/fake-crm-gateway";
import { content, UNCONFIGURED_DEPS } from "../integration/quotes/helpers";

/**
 * Monde d'un parcours : une base PGlite avec les vraies migrations, une équipe par rôle. Les seuls
 * faux sont les services externes (`FakeCrmGateway`, bouchons HTTP) : chaque module est le vrai.
 */
export interface JourneyWorld {
  db: Database;
  crm: FakeCrmGateway;
  admin: ServiceContext;
  member: ServiceContext;
  viewer: ServiceContext;
  contractor: ServiceContext;
  close: () => Promise<void>;
}

export async function createJourneyWorld(): Promise<JourneyWorld> {
  const { db, close } = await createTestDatabase();
  const crm = new FakeCrmGateway();
  const admin = await createMemberContext(db, "admin");
  const member = await createMemberContext(db, "member");
  const contractor = await createMemberContext(db, "contractor");
  const viewer = await createTestContext(db, "viewer", { crm });
  return {
    db,
    crm,
    admin: { ...admin, crm },
    member: { ...member, crm },
    contractor: { ...contractor, crm },
    viewer,
    close,
  };
}

/** Un client et son projet vendu, par les vrais services : point de départ des parcours suivants. */
export async function sellProject(
  world: JourneyWorld,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  const { db, member, admin } = world;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const created = await createCompany(member, {
    name,
    domain: `${slug}.example`,
    status: "client",
  });
  const contact = await createContact(member, {
    companyId: created.id,
    firstName: "Contact",
    lastName: name,
    email: `contact@${slug}.example`,
  });
  const quote = await createQuote(member, { companyId: created.id, title: `Site ${name}` });
  await saveQuoteContent(
    member,
    quote.id,
    content({ title: `Site ${name}`, ...overrides }),
    UNCONFIGURED_DEPS,
  );
  await markQuoteSentManually(member, quote.id);
  await acceptQuoteManually(
    admin,
    quote.id,
    { signedOn: "2026-11-02", indyReference: `INDY-${slug}` },
    UNCONFIGURED_DEPS,
  );
  const [project] = await db.select().from(s.projects).where(eq(s.projects.quoteId, quote.id));
  const [company] = await db.select().from(s.companies).where(eq(s.companies.id, created.id));
  if (!project || !company) throw new Error("Projet du parcours non créé");
  return { company, contact, quote, project };
}

export function notificationsOf(db: Database, userId: string) {
  return db.select().from(s.notifications).where(eq(s.notifications.userId, userId));
}

export function eventsOf(db: Database, type: string, entityId: string) {
  return db
    .select()
    .from(s.domainEvents)
    .where(and(eq(s.domainEvents.type, type), eq(s.domainEvents.entityId, entityId)));
}
