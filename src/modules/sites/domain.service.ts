import { getCompanyRef } from "@/modules/crm/company.lookup";
import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Domain } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { PageParams, Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import { addDays, EXPIRY_WARNING_DAYS, parisDay } from "./site.health";
import * as repository from "./site.repository";
import {
  domainIdSchema,
  domainListQuerySchema,
  domainSchema,
  updateDomainSchema,
} from "./site.schema";
import {
  checkTlsCertificate,
  tlsFailureMessage,
  type TlsCheckOptions,
  type TlsCheckResult,
} from "./tls-check";

export type { DomainRow } from "./site.repository";

/**
 * Domaines : registre manuel (aucune API de registrar disponible) et contrôle réel du certificat.
 * Un domaine n'a pas d'`archived_at` : le retirer est tracé dans le journal.
 */

export async function listDomains(
  ctx: ServiceContext,
  rawQuery: unknown,
  params: PageParams,
  now: Date = new Date(),
): Promise<Paginated<repository.DomainRow>> {
  assertCan(ctx.actor, "sites:read");
  const query = parseInput(domainListQuerySchema, rawQuery);
  return repository.listDomains(
    ctx.db,
    {
      search: query.search,
      expiringBefore:
        query.filter === "expiring" ? addDays(parisDay(now), EXPIRY_WARNING_DAYS) : undefined,
      tlsProblems: query.filter === "tls" ? true : undefined,
    },
    params,
  );
}

async function assertSiteOfCompany(
  db: Database,
  siteId: string | null,
  companyId: string,
): Promise<void> {
  if (!siteId) return;
  const site = await repository.findSiteById(db, siteId);
  if (!site || site.companyId !== companyId) {
    throw new ValidationError("Certaines informations sont invalides.", {
      siteId: ["Ce site n'appartient pas à ce client."],
    });
  }
  if (site.archivedAt) {
    throw new ConflictError("Ce site est archivé.", { siteId: ["Ce site est archivé."] });
  }
}

export async function createDomain(ctx: ServiceContext, input: unknown): Promise<Domain> {
  assertCan(ctx.actor, "sites:update");
  const values = parseInput(domainSchema, input);

  const company = await getCompanyRef(ctx.db, values.companyId);
  if (!company || company.archivedAt || company.mergedIntoId) {
    throw new ValidationError("Certaines informations sont invalides.", {
      companyId: ["Ce client n'existe pas ou n'est plus actif."],
    });
  }
  await assertSiteOfCompany(ctx.db, values.siteId, values.companyId);
  if (await repository.findDomainByName(ctx.db, values.name)) {
    throw new ConflictError("Ce domaine est déjà enregistré.", {
      name: ["Ce domaine est déjà enregistré."],
    });
  }

  return ctx.db.transaction(async (tx) => {
    const domain = await repository.insertDomain(tx, values);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "domain.created",
      entityType: "domain",
      entityId: domain.id,
      metadata: { name: domain.name, companyId: domain.companyId, siteId: domain.siteId },
    });
    return domain;
  });
}

export async function updateDomain(ctx: ServiceContext, input: unknown): Promise<Domain> {
  assertCan(ctx.actor, "sites:update");
  const { id, ...values } = parseInput(updateDomainSchema, input);

  const current = await repository.findDomainById(ctx.db, id);
  if (!current) throw new NotFoundError("Domaine introuvable.");
  if (values.siteId !== current.siteId) {
    await assertSiteOfCompany(ctx.db, values.siteId, current.companyId);
  }

  return ctx.db.transaction(async (tx) => {
    const domain = await repository.updateDomain(tx, id, values);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "domain.updated",
      entityType: "domain",
      entityId: id,
      metadata: { name: domain.name, expiresOn: domain.expiresOn, autoRenew: domain.autoRenew },
    });
    return domain;
  });
}

export async function deleteDomain(ctx: ServiceContext, input: unknown): Promise<void> {
  assertCan(ctx.actor, "sites:archive");
  const { id } = parseInput(domainIdSchema, input);

  const domain = await repository.findDomainById(ctx.db, id);
  if (!domain) throw new NotFoundError("Domaine introuvable.");

  await ctx.db.transaction(async (tx) => {
    await repository.deleteDomain(tx, id);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "domain.deleted",
      entityType: "domain",
      entityId: id,
      metadata: { name: domain.name, companyId: domain.companyId, siteId: domain.siteId },
    });
  });
}

/** Écrit le résultat. Un échec de connexion garde la dernière échéance connue, jamais effacée. */
async function storeTlsResult(
  db: Database,
  domain: Domain,
  result: TlsCheckResult,
  actorId: string | null,
  now: Date,
): Promise<Domain> {
  return db.transaction(async (tx) => {
    const updated = await repository.updateDomain(tx, domain.id, {
      tlsStatus: result.status,
      tlsExpiresOn: result.expiresOn ?? domain.tlsExpiresOn,
      checkedAt: now,
    });
    // Le journal n'enregistre qu'un changement d'état, pas chaque passage du contrôle planifié.
    if (actorId || domain.tlsStatus !== result.status) {
      await recordAudit(tx, {
        actorId,
        action: "domain.updated",
        entityType: "domain",
        entityId: domain.id,
        metadata: {
          name: domain.name,
          tlsStatus: result.status,
          tlsExpiresOn: updated.tlsExpiresOn,
          reason: result.reason,
        },
      });
    }
    return updated;
  });
}

/** Bouton « Vérifier le HTTPS ». Le motif d'un échec revient à l'écran. */
export async function checkDomainTls(
  ctx: ServiceContext,
  input: unknown,
  deps: { tls?: TlsCheckOptions; now?: Date } = {},
): Promise<{ domain: Domain; message: string | null }> {
  assertCan(ctx.actor, "sites:update");
  const { id } = parseInput(domainIdSchema, input);

  const domain = await repository.findDomainById(ctx.db, id);
  if (!domain) throw new NotFoundError("Domaine introuvable.");

  const now = deps.now ?? new Date();
  const result = await checkTlsCertificate(domain.name, { ...deps.tls, now });
  const updated = await storeTlsResult(ctx.db, domain, result, ctx.actor.userId, now);
  return { domain: updated, message: tlsFailureMessage(result.reason) };
}

const TLS_BATCH_SIZE = 100;
const TLS_BATCH_CONCURRENCY = 5;
const TLS_RECHECK_AFTER_MS = 24 * 3_600_000;

/**
 * Pour une tâche planifiée : contrôle les domaines non vérifiés depuis 24 h, par lots bornés.
 * Le lot suivant reprend les plus anciens.
 */
export async function runDomainTlsChecks(
  db: Database,
  deps: { tls?: TlsCheckOptions; now?: Date } = {},
): Promise<{ checked: number; problems: number }> {
  const now = deps.now ?? new Date();
  const queue = await repository.listDomainsToCheck(
    db,
    new Date(now.getTime() - TLS_RECHECK_AFTER_MS),
    TLS_BATCH_SIZE,
  );

  let problems = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const domain = queue[cursor];
      cursor += 1;
      if (!domain) return;
      const result = await checkTlsCertificate(domain.name, { ...deps.tls, now });
      if (result.status !== "valid") problems += 1;
      try {
        await storeTlsResult(db, domain, result, null, now);
      } catch (error) {
        logger.error("sites.tls_store_failed", { domainId: domain.id, error });
      }
    }
  };
  await Promise.all(Array.from({ length: TLS_BATCH_CONCURRENCY }, worker));
  return { checked: queue.length, problems };
}

export interface ExpiringDomain {
  id: string;
  name: string;
  companyId: string;
  siteId: string | null;
  registrar: string | null;
  expiresOn: string | null;
  autoRenew: boolean;
  tlsStatus: Domain["tlsStatus"];
  tlsExpiresOn: string | null;
}

/**
 * Pour les automatisations : domaines ou certificats expirés ou à moins de 30 jours.
 * Sans contrôle d'accès : l'appelant est une tâche système.
 */
export async function listExpiringDomains(db: Database, now: Date): Promise<ExpiringDomain[]> {
  const rows = await repository.listExpiringDomains(
    db,
    addDays(parisDay(now), EXPIRY_WARNING_DAYS),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    companyId: row.companyId,
    siteId: row.siteId,
    registrar: row.registrar,
    expiresOn: row.expiresOn,
    autoRenew: row.autoRenew,
    tlsStatus: row.tlsStatus,
    tlsExpiresOn: row.tlsExpiresOn,
  }));
}
