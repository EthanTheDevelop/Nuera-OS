import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer, type Server as TlsServer } from "node:tls";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  backupFailedDedupeKey,
  listFailedBackups,
  recordManualBackup,
} from "@/modules/sites/backup.service";
import {
  checkDomainTls,
  createDomain,
  deleteDomain,
  listDomains,
  listExpiringDomains,
  runDomainTlsChecks,
  updateDomain,
} from "@/modules/sites/domain.service";
import { listExpiringDomains as fromMainService } from "@/modules/sites/site.service";
import { BACKUP_TRANSITIONS, canBackupTransition } from "@/modules/sites/site.status";
import {
  checkTlsCertificate,
  classifyCertificate,
  isPrivateAddress,
} from "@/modules/sites/tls-check";
import { BACKUP_STATUSES } from "@/lib/domain-enums";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import { createCompany, createSite } from "../../helpers/factories";

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let member: ServiceContext;
let viewer: ServiceContext;
let contractor: ServiceContext;
let domainCounter = 0;

const nextName = () => {
  domainCounter += 1;
  return `domaine-${domainCounter}.example.fr`;
};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  [admin, member, viewer, contractor] = await Promise.all([
    createTestContext(db, "admin"),
    createTestContext(db, "member"),
    createTestContext(db, "viewer"),
    createTestContext(db, "contractor"),
  ]);
});

afterAll(() => close());

describe("protection contre le SSRF", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.9",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "2001:db8::1",
    "nimporte quoi",
  ])("%s est refusée", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "%s est publique",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it("refuse un domaine qui résout vers une adresse privée, sans s'y connecter", async () => {
    const result = await checkTlsCertificate("interne.example.fr", {
      lookup: async () => [{ address: "169.254.169.254", family: 4 }],
    });
    expect(result).toEqual({ status: "error", expiresOn: null, reason: "private_address" });
  });

  it("une seule adresse privée parmi plusieurs suffit à refuser", async () => {
    const result = await checkTlsCertificate("mixte.example.fr", {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    });
    expect(result.reason).toBe("private_address");
  });

  it.each(["127.0.0.1", "localhost", "exemple.fr:8443", "http://exemple.fr", "a b.fr", ""])(
    "refuse le nom %j avant toute résolution",
    async (host) => {
      let looked = false;
      const result = await checkTlsCertificate(host, {
        lookup: async () => {
          looked = true;
          return [];
        },
      });
      expect(result.reason).toBe("invalid_host");
      expect(looked).toBe(false);
    },
  );

  it("un nom qui ne résout pas est un échec, pas une exception", async () => {
    const result = await checkTlsCertificate("inconnu.example.fr", {
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(result.reason).toBe("dns");
  });
});

describe("contrôle de certificat, sur le réseau local", () => {
  const local = { lookup: async () => [{ address: "127.0.0.1", family: 4 }] };

  it("délai borné : un serveur qui ne répond jamais ne bloque pas", async () => {
    const accepted: Socket[] = [];
    const server: NetServer = createNetServer((socket) => {
      // Accepte la connexion et ne fait rien : pas de poignée de main.
      socket.on("error", () => undefined);
      accepted.push(socket);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const started = Date.now();
    const result = await checkTlsCertificate("muet.example.fr", {
      ...local,
      port,
      timeoutMs: 200,
      allowPrivateAddresses: true,
    });
    expect(result.reason).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2000);
    // Un socket jamais lu ne voit pas la fermeture du client : sans cela, `close` attend sans fin.
    for (const socket of accepted) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  it("connexion refusée : échec lisible", async () => {
    const result = await checkTlsCertificate("ferme.example.fr", {
      ...local,
      port: 1,
      timeoutMs: 500,
      allowPrivateAddresses: true,
    });
    expect(result.reason).toBe("connection");
  });

  // Vraie poignée de main : certificat généré à la volée, aucune clé dans le dépôt.
  describe("vraie poignée de main TLS", () => {
    let directory: string | null = null;
    let server: TlsServer | null = null;
    let port = 0;
    const HOST = "local-tls.example.fr";

    beforeAll(async () => {
      try {
        directory = mkdtempSync(join(tmpdir(), "nuera-tls-"));
        execFileSync(
          "openssl",
          [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "2",
            "-subj",
            `/CN=${HOST}`,
            "-addext",
            `subjectAltName=DNS:${HOST}`,
            "-keyout",
            join(directory, "key.pem"),
            "-out",
            join(directory, "cert.pem"),
          ],
          { stdio: "ignore" },
        );
        server = createTlsServer({
          key: readFileSync(join(directory, "key.pem")),
          cert: readFileSync(join(directory, "cert.pem")),
        });
        await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
        port = (server.address() as AddressInfo).port;
      } catch {
        server = null; // openssl absent : ces cas sont signalés comme ignorés.
      }
    });

    afterAll(async () => {
      if (server) await new Promise((resolve) => server?.close(resolve));
      if (directory) rmSync(directory, { recursive: true, force: true });
    });

    it("lit l'échéance réelle et voit que l'autorité n'est pas reconnue", async (context) => {
      if (!server) return context.skip();
      const result = await checkTlsCertificate(HOST, {
        ...local,
        port,
        timeoutMs: 2000,
        allowPrivateAddresses: true,
      });
      expect(result.status).toBe("error");
      expect(result.reason).toBe("untrusted");
      expect(result.expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("voit un certificat qui ne correspond pas au nom", async (context) => {
      if (!server) return context.skip();
      const result = await checkTlsCertificate("autre-nom.example.fr", {
        ...local,
        port,
        timeoutMs: 2000,
        allowPrivateAddresses: true,
      });
      expect(result.reason).toBe("hostname_mismatch");
    });

    it("voit un certificat expiré à la date donnée", async (context) => {
      if (!server) return context.skip();
      const result = await checkTlsCertificate(HOST, {
        ...local,
        port,
        timeoutMs: 2000,
        allowPrivateAddresses: true,
        now: new Date(Date.now() + 30 * 86_400_000),
      });
      expect(result.status).toBe("expired");
    });
  });

  it("classe un certificat selon son échéance", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000);
    expect(classifyCertificate(inDays(60), null, false, now).status).toBe("valid");
    expect(classifyCertificate(inDays(10), null, false, now).status).toBe("expiring");
    expect(classifyCertificate(inDays(-1), null, false, now).status).toBe("expired");
    expect(classifyCertificate(inDays(-1), "x", true, now).status).toBe("expired");
    expect(classifyCertificate(inDays(60), "UNABLE", false, now)).toMatchObject({
      status: "error",
      reason: "untrusted",
    });
    expect(classifyCertificate(inDays(60), null, true, now)).toMatchObject({
      status: "error",
      reason: "hostname_mismatch",
    });
  });
});

describe("domaines", () => {
  it("crée, modifie et retire, avec audit", async () => {
    const company = await createCompany(db);
    const domain = await createDomain(member, {
      companyId: company.id,
      name: nextName().toUpperCase(),
      registrar: "OVH",
      expiresOn: "2027-10-14",
      autoRenew: "on",
    });
    expect(domain.name).toBe(domain.name.toLowerCase());
    expect(domain.autoRenew).toBe(true);
    expect(domain.tlsStatus).toBe("unknown");

    const updated = await updateDomain(member, {
      id: domain.id,
      registrar: "Gandi",
      expiresOn: "",
    });
    expect(updated).toMatchObject({ registrar: "Gandi", expiresOn: null, autoRenew: false });

    await deleteDomain(member, { id: domain.id });
    await expect(deleteDomain(member, { id: domain.id })).rejects.toBeInstanceOf(NotFoundError);

    const audits = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, domain.id));
    expect(audits.map((row) => row.action).sort()).toEqual([
      "domain.created",
      "domain.deleted",
      "domain.updated",
    ]);
  });

  it("un domaine déjà enregistré est refusé", async () => {
    const company = await createCompany(db);
    const name = nextName();
    await createDomain(member, { companyId: company.id, name });
    await expect(createDomain(member, { companyId: company.id, name })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("refuse le rattachement au site d'un autre client", async () => {
    const [mine, other] = [await createCompany(db), await createCompany(db)];
    const foreign = await createSite(db, { companyId: other.id });
    await expect(
      createDomain(member, { companyId: mine.id, siteId: foreign.id, name: nextName() }),
    ).rejects.toBeInstanceOf(ValidationError);

    const domain = await createDomain(member, { companyId: mine.id, name: nextName() });
    await expect(
      updateDomain(member, { id: domain.id, siteId: foreign.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it.each([
    ["viewer", () => viewer],
    ["contractor", () => contractor],
  ])("%s ne peut pas écrire", async (_, context) => {
    const company = await createCompany(db);
    await expect(
      createDomain(context(), { companyId: company.id, name: nextName() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("le prestataire ne lit pas la liste", async () => {
    await expect(listDomains(contractor, {}, { page: 1, pageSize: 10 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("listExpiringDomains : domaines et certificats à moins de 30 jours, expirés compris", async () => {
    const { db: own, close: closeOwn } = await createTestDatabase();
    try {
      const company = await createCompany(own);
      const now = new Date("2026-11-04T12:00:00Z");
      await own.insert(schema.domains).values([
        { companyId: company.id, name: "bientot.fr", expiresOn: "2026-11-20" },
        { companyId: company.id, name: "expire.fr", expiresOn: "2026-10-01" },
        {
          companyId: company.id,
          name: "tls.fr",
          expiresOn: "2028-01-01",
          tlsExpiresOn: "2026-11-10",
        },
        { companyId: company.id, name: "loin.fr", expiresOn: "2028-01-01" },
        { companyId: company.id, name: "sans-date.fr" },
      ]);
      const rows = await listExpiringDomains(own, now);
      expect(rows.map((row) => row.name).sort()).toEqual(["bientot.fr", "expire.fr", "tls.fr"]);
      expect(fromMainService).toBe(listExpiringDomains);
    } finally {
      await closeOwn();
    }
  });
});

describe("contrôle HTTPS d'un domaine", () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

  it("écrit le résultat daté, et un échec garde la dernière échéance connue", async () => {
    const company = await createCompany(db);
    const name = nextName();
    const [domain] = await db
      .insert(schema.domains)
      .values({ companyId: company.id, name, tlsStatus: "valid", tlsExpiresOn: "2027-01-01" })
      .returning();
    const now = new Date("2026-11-04T12:00:00Z");

    const { domain: updated, message } = await checkDomainTls(
      member,
      { id: domain?.id },
      {
        now,
        tls: {
          lookup: async () => [{ address: "10.0.0.8", family: 4 }],
        },
      },
    );
    expect(updated).toMatchObject({ tlsStatus: "error", tlsExpiresOn: "2027-01-01" });
    expect(updated.checkedAt).toEqual(now);
    expect(message).toContain("adresse privée");
  });

  it("exige sites:update", async () => {
    const company = await createCompany(db);
    const domain = await createDomain(member, { companyId: company.id, name: nextName() });
    await expect(
      checkDomainTls(viewer, { id: domain.id }, { tls: { lookup: publicLookup } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("domaine inconnu : 404", async () => {
    await expect(checkDomainTls(member, { id: crypto.randomUUID() })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("le contrôle planifié ne repasse pas sur un domaine vérifié récemment", async () => {
    const { db: own, close: closeOwn } = await createTestDatabase();
    try {
      const company = await createCompany(own);
      const now = new Date("2026-11-04T12:00:00Z");
      await own.insert(schema.domains).values([
        { companyId: company.id, name: "jamais.example.fr" },
        { companyId: company.id, name: "ancien.example.fr", checkedAt: new Date("2026-11-01") },
        {
          companyId: company.id,
          name: "recent.example.fr",
          checkedAt: new Date("2026-11-04T11:00:00Z"),
        },
      ]);
      const result = await runDomainTlsChecks(own, {
        now,
        tls: { lookup: async () => [{ address: "10.0.0.8", family: 4 }] },
      });
      expect(result).toEqual({ checked: 2, problems: 2 });
      const [recent] = await own
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.name, "recent.example.fr"));
      expect(recent?.tlsStatus).toBe("unknown");
    } finally {
      await closeOwn();
    }
  });
});

describe("sauvegardes", () => {
  const taken = "2026-11-04T03:00:00.000Z";

  it("déclaration manuelle : source et état hors serveur honnêtes, audit", async () => {
    const site = await createSite(db);
    const backup = await recordManualBackup(member, {
      siteId: site.id,
      status: "succeeded",
      takenAt: taken,
      sizeBytes: "1048576",
    });
    expect(backup).toMatchObject({ source: "manual", offSite: false, sizeBytes: 1048576 });
    const audits = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, backup.id));
    expect(audits.map((row) => row.action)).toEqual(["site_backup.created"]);
  });

  it("une sauvegarde en échec émet backup.failed, une fois", async () => {
    const site = await createSite(db);
    const backup = await recordManualBackup(member, {
      siteId: site.id,
      status: "failed",
      takenAt: taken,
    });
    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.dedupeKey, backupFailedDedupeKey(backup.id)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "backup.failed", companyId: site.companyId });
  });

  it("refuse une date future et l'environnement d'un autre site", async () => {
    const site = await createSite(db);
    await expect(
      recordManualBackup(member, {
        siteId: site.id,
        status: "succeeded",
        takenAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const other = await createSite(db);
    const [foreignEnv] = await db
      .insert(schema.siteEnvironments)
      .values({ siteId: other.id, kind: "production" })
      .returning();
    await expect(
      recordManualBackup(member, {
        siteId: site.id,
        environmentId: foreignEnv?.id,
        status: "succeeded",
        takenAt: taken,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("site inconnu : 404 ; viewer : refusé", async () => {
    await expect(
      recordManualBackup(member, {
        siteId: crypto.randomUUID(),
        status: "succeeded",
        takenAt: taken,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const site = await createSite(db);
    await expect(
      recordManualBackup(viewer, { siteId: site.id, status: "succeeded", takenAt: taken }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("listFailedBackups : échecs récents, hors sites archivés", async () => {
    const { db: own, close: closeOwn } = await createTestDatabase();
    try {
      const now = new Date("2026-11-04T12:00:00Z");
      const site = await createSite(own);
      const archived = await createSite(own, { status: "archived", archivedAt: now });
      await own.insert(schema.siteBackups).values([
        { siteId: site.id, status: "failed", takenAt: new Date("2026-11-03T03:00:00Z") },
        { siteId: site.id, status: "failed", takenAt: new Date("2026-10-01T03:00:00Z") },
        { siteId: site.id, status: "succeeded", takenAt: new Date("2026-11-03T03:00:00Z") },
        { siteId: archived.id, status: "failed", takenAt: new Date("2026-11-03T03:00:00Z") },
      ]);
      const rows = await listFailedBackups(own, now);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ siteId: site.id, companyId: site.companyId });
    } finally {
      await closeOwn();
    }
  });

  it.each(
    BACKUP_STATUSES.flatMap((from) =>
      BACKUP_STATUSES.filter((to) => to !== from).map((to) => [from, to] as const),
    ),
  )("machine des sauvegardes : %s → %s", (from, to) => {
    expect(canBackupTransition(from, to)).toBe(BACKUP_TRANSITIONS[from].includes(to));
  });
});

// `admin` reste utilisé pour vérifier que tous les droits passent par les mêmes services.
describe("admin", () => {
  it("peut tout faire sur un domaine", async () => {
    const company = await createCompany(db);
    await expect(
      createDomain(admin, { companyId: company.id, name: nextName() }),
    ).resolves.toBeTruthy();
  });
});
