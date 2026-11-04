import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  DocusealGateway,
  DocusealSubmissionStatus,
} from "@/integrations/docuseal/docuseal.client";
import { docusealNotConfigured } from "@/integrations/docuseal/docuseal.client";
import {
  refreshContractSignature,
  renderContractHtml,
  requestContractSignature,
} from "@/modules/contracts/contract-signature.service";
import type { ServiceContext } from "@/server/context";
import * as s from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
} from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContact,
  createContract as insertContract,
} from "../../helpers/factories";

/** Faux DocuSeal, en mémoire : compte les appels et renvoie l'état demandé. */
class FakeDocuseal implements DocusealGateway {
  readonly isConfigured = true;
  created: string[] = [];
  archived: string[] = [];
  status: DocusealSubmissionStatus = "pending";
  failOnCreate = false;
  failOnRead = false;

  private submission(id: string) {
    return { id, status: this.status, completedAt: null, submitters: [] };
  }

  async createSubmission(input: { name: string }) {
    if (this.failOnCreate) throw docusealNotConfigured();
    this.created.push(input.name);
    return this.submission(`sub-${this.created.length}`);
  }

  async getSubmission(id: string) {
    if (this.failOnRead)
      throw new ServiceUnavailableError("DocuSeal", "unreachable", "DocuSeal ne répond pas.");
    return this.submission(id);
  }

  async archiveSubmission(id: string) {
    this.archived.push(id);
  }

  async getSubmissionDocuments() {
    return [];
  }
}

const UNCONFIGURED: DocusealGateway = {
  isConfigured: false,
  createSubmission: () => Promise.reject(docusealNotConfigured()),
  getSubmission: () => Promise.reject(docusealNotConfigured()),
  archiveSubmission: () => Promise.reject(docusealNotConfigured()),
  getSubmissionDocuments: () => Promise.reject(docusealNotConfigured()),
};

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let viewer: ServiceContext;

beforeAll(async () => {
  const database = await createTestDatabase();
  db = database.db;
  close = database.close;
  admin = await createTestContext(db, "admin");
  viewer = await createTestContext(db, "viewer");
});

afterAll(async () => {
  await close();
});

async function contractWithSigner(overrides: Partial<typeof s.contracts.$inferInsert> = {}) {
  const company = await createCompany(db);
  const contact = await createContact(db, {
    companyId: company.id,
    email: `signe-${crypto.randomUUID()}@exemple.test`,
  });
  const contract = await insertContract(db, {
    companyId: company.id,
    status: "active",
    startOn: "2026-01-01",
    ...overrides,
  });
  return { contract, contact, company };
}

const read = async (id: string) =>
  (await db.select().from(s.contracts).where(eq(s.contracts.id, id)))[0];

describe("envoi à la signature", () => {
  it("refuse sans connexion, sans rien écrire", async () => {
    const { contract, contact } = await contractWithSigner();
    await expect(
      requestContractSignature(
        admin,
        contract.id,
        { signerContactId: contact.id },
        { docuseal: UNCONFIGURED },
      ),
    ).rejects.toThrow(ServiceUnavailableError);
    expect((await read(contract.id))?.signatureStatus).toBe("none");
  });

  it("envoie une seule fois : répéter ne crée pas de seconde demande", async () => {
    const { contract, contact } = await contractWithSigner();
    const docuseal = new FakeDocuseal();
    const first = await requestContractSignature(
      admin,
      contract.id,
      { signerContactId: contact.id },
      { docuseal },
    );
    expect(first.signatureStatus).toBe("pending");
    expect(first.docusealSubmissionId).toBe("sub-1");

    await requestContractSignature(
      admin,
      contract.id,
      { signerContactId: contact.id },
      { docuseal },
    );
    expect(docuseal.created).toHaveLength(1);
    const events = await db
      .select()
      .from(s.contractEvents)
      .where(eq(s.contractEvents.contractId, contract.id));
    expect(events).toHaveLength(1);
  });

  it("garde le contrat intact si DocuSeal échoue", async () => {
    const { contract, contact } = await contractWithSigner();
    const docuseal = new FakeDocuseal();
    docuseal.failOnCreate = true;
    await expect(
      requestContractSignature(admin, contract.id, { signerContactId: contact.id }, { docuseal }),
    ).rejects.toThrow(ServiceUnavailableError);
    const after = await read(contract.id);
    expect(after?.signatureStatus).toBe("none");
    expect(after?.docusealSubmissionId).toBeNull();
  });

  it("refuse le contact d'un autre client et ne contacte pas DocuSeal", async () => {
    const { contract } = await contractWithSigner();
    const other = await contractWithSigner();
    const docuseal = new FakeDocuseal();
    await expect(
      requestContractSignature(
        admin,
        contract.id,
        { signerContactId: other.contact.id },
        { docuseal },
      ),
    ).rejects.toThrow(NotFoundError);
    expect(docuseal.created).toHaveLength(0);
  });

  it("refuse un contrat déjà signé ou terminé", async () => {
    const signed = await contractWithSigner({ signatureStatus: "signed" });
    const ended = await contractWithSigner({ status: "terminated" });
    const docuseal = new FakeDocuseal();
    await expect(
      requestContractSignature(
        admin,
        signed.contract.id,
        { signerContactId: signed.contact.id },
        { docuseal },
      ),
    ).rejects.toThrow(ConflictError);
    await expect(
      requestContractSignature(
        admin,
        ended.contract.id,
        { signerContactId: ended.contact.id },
        { docuseal },
      ),
    ).rejects.toThrow(ConflictError);
    expect(docuseal.created).toHaveLength(0);
  });

  it("refuse un rôle en lecture seule", async () => {
    const { contract, contact } = await contractWithSigner();
    await expect(
      requestContractSignature(
        viewer,
        contract.id,
        { signerContactId: contact.id },
        { docuseal: new FakeDocuseal() },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("échappe les données du contrat dans le document", async () => {
    const { contract } = await contractWithSigner({ name: "<script>alert(1)</script>" });
    const html = renderContractHtml((await read(contract.id)) as s.Contract, "Client & fils");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Client &amp; fils");
    expect(html).toContain("<signature-field");
  });
});

describe("relecture de la signature", () => {
  it("applique l'état de DocuSeal, puis ne réécrit plus rien", async () => {
    const { contract } = await contractWithSigner({
      signatureStatus: "pending",
      docusealSubmissionId: "sub-9",
    });
    const docuseal = new FakeDocuseal();
    docuseal.status = "completed";
    expect((await refreshContractSignature(admin, contract.id, { docuseal })).signatureStatus).toBe(
      "signed",
    );
    const audits = () => db.select().from(s.auditLog).where(eq(s.auditLog.entityId, contract.id));
    const count = (await audits()).length;
    await refreshContractSignature(admin, contract.id, { docuseal });
    expect(await audits()).toHaveLength(count);
    const events = await db
      .select()
      .from(s.contractEvents)
      .where(eq(s.contractEvents.contractId, contract.id));
    expect(events.map((event) => event.note)).toEqual(["Signature : Signé (DocuSeal)."]);
  });

  it("une demande expirée permet d'en envoyer une nouvelle", async () => {
    const { contract, contact } = await contractWithSigner({
      signatureStatus: "pending",
      docusealSubmissionId: "sub-9",
    });
    const docuseal = new FakeDocuseal();
    docuseal.status = "expired";
    const after = await refreshContractSignature(admin, contract.id, { docuseal });
    expect(after.signatureStatus).toBe("none");
    expect(after.docusealSubmissionId).toBeNull();

    docuseal.status = "pending";
    const again = await requestContractSignature(
      admin,
      contract.id,
      { signerContactId: contact.id },
      { docuseal },
    );
    expect(again.signatureStatus).toBe("pending");
  });

  it("garde l'état connu si DocuSeal ne répond pas ou n'est pas connecté", async () => {
    const { contract } = await contractWithSigner({
      signatureStatus: "pending",
      docusealSubmissionId: "sub-9",
    });
    const docuseal = new FakeDocuseal();
    docuseal.failOnRead = true;
    await expect(refreshContractSignature(admin, contract.id, { docuseal })).rejects.toThrow(
      ServiceUnavailableError,
    );
    await expect(
      refreshContractSignature(admin, contract.id, { docuseal: UNCONFIGURED }),
    ).rejects.toThrow(ServiceUnavailableError);
    expect((await read(contract.id))?.signatureStatus).toBe("pending");
  });

  it("refuse sans demande en cours", async () => {
    const { contract } = await contractWithSigner();
    await expect(
      refreshContractSignature(admin, contract.id, { docuseal: new FakeDocuseal() }),
    ).rejects.toThrow(ConflictError);
  });
});
