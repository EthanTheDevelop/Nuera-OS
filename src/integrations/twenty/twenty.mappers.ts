/**
 * Conversions entre les formes de Twenty et le vocabulaire du port CRM.
 * Fonctions pures, partagées par la passerelle et le webhook.
 */
import { IntegrationError, ValidationError } from "@/server/errors";
import {
  OPPORTUNITY_STAGES,
  TASK_STATUSES,
  type CrmActivityLink,
  type CrmActivityTarget,
  type CrmAddress,
  type CrmCompany,
  type CrmMultiValue,
  type CrmNote,
  type CrmOpportunity,
  type CrmPerson,
  type CrmTask,
  type OpportunityStage,
  type TaskStatus,
} from "./crm-gateway";
import type {
  TwentyCompany,
  TwentyNote,
  TwentyNoteTarget,
  TwentyOpportunity,
  TwentyPerson,
  TwentyTask,
  TwentyTaskTarget,
} from "./twenty.types";

const MICROS_PER_CENT = 10_000;
const E164 = /^\+[1-9]\d{4,14}$/;

/** Twenty stocke une valeur vide en chaîne vide. */
function orNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

function meta(record: {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}) {
  return {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt ?? null,
  };
}

// --- Vers le port --------------------------------------------------------------------------------

export function toCrmCompany(record: TwentyCompany): CrmCompany {
  return {
    ...meta(record),
    name: record.name ?? "",
    domains: {
      primary: orNull(record.domainName?.primaryLinkUrl),
      additional: (record.domainName?.secondaryLinks ?? []).flatMap((link) =>
        link.url ? [link.url] : [],
      ),
    },
    linkedinUrl: orNull(record.linkedinLink?.primaryLinkUrl),
    address: {
      street1: orNull(record.address?.addressStreet1),
      street2: orNull(record.address?.addressStreet2),
      city: orNull(record.address?.addressCity),
      postcode: orNull(record.address?.addressPostcode),
      state: orNull(record.address?.addressState),
      country: orNull(record.address?.addressCountry),
    },
  };
}

function joinPhone(
  callingCode: string | null | undefined,
  number: string | null | undefined,
): string | null {
  if (!number) return null;
  return `${callingCode ?? ""}${number}`;
}

export function toCrmPerson(record: TwentyPerson): CrmPerson {
  return {
    ...meta(record),
    firstName: record.name?.firstName ?? "",
    lastName: record.name?.lastName ?? "",
    emails: {
      primary: orNull(record.emails?.primaryEmail),
      additional: record.emails?.additionalEmails ?? [],
    },
    phones: {
      primary: joinPhone(record.phones?.primaryPhoneCallingCode, record.phones?.primaryPhoneNumber),
      additional: (record.phones?.additionalPhones ?? []).flatMap((phone) => {
        const joined = joinPhone(phone.callingCode, phone.number);
        return joined ? [joined] : [];
      }),
    },
    jobTitle: orNull(record.jobTitle),
    companyId: record.companyId ?? null,
  };
}

function toStage(value: string): OpportunityStage {
  const stage = OPPORTUNITY_STAGES.find((candidate) => candidate === value);
  if (!stage) {
    throw new IntegrationError(
      "twenty",
      "Les étapes d'opportunité du CRM ne sont pas celles de Nuera : lancer `npm run twenty:bootstrap`.",
    );
  }
  return stage;
}

export function toCrmOpportunity(record: TwentyOpportunity): CrmOpportunity {
  const { amountMicros, currencyCode } = record.amount ?? {};
  return {
    ...meta(record),
    name: record.name ?? "",
    stage: toStage(record.stage),
    amount:
      amountMicros === null || amountMicros === undefined
        ? null
        : { cents: Math.round(amountMicros / MICROS_PER_CENT), currency: currencyCode ?? "EUR" },
    closeDate: record.closeDate ? record.closeDate.slice(0, 10) : null,
    companyId: record.companyId ?? null,
    pointOfContactId: record.pointOfContactId ?? null,
  };
}

function toTarget(link: {
  targetCompanyId?: string | null;
  targetPersonId?: string | null;
  targetOpportunityId?: string | null;
}): CrmActivityTarget | null {
  if (link.targetCompanyId) return { type: "company", id: link.targetCompanyId };
  if (link.targetPersonId) return { type: "person", id: link.targetPersonId };
  if (link.targetOpportunityId) return { type: "opportunity", id: link.targetOpportunityId };
  return null;
}

function toTargets(links: Parameters<typeof toTarget>[0][] | null | undefined) {
  return (links ?? []).flatMap((link) => {
    const target = toTarget(link);
    return target ? [target] : [];
  });
}

export function toCrmNote(record: TwentyNote): CrmNote {
  return {
    ...meta(record),
    title: record.title ?? "",
    bodyMarkdown: orNull(record.bodyV2?.markdown),
    targets: toTargets(record.noteTargets),
  };
}

function toTaskStatus(value: string | null | undefined): TaskStatus {
  return TASK_STATUSES.find((status) => status === value) ?? "TODO";
}

export function toCrmTask(record: TwentyTask): CrmTask {
  return {
    ...meta(record),
    title: record.title ?? "",
    bodyMarkdown: orNull(record.bodyV2?.markdown),
    status: toTaskStatus(record.status),
    dueAt: record.dueAt ?? null,
    targets: toTargets(record.taskTargets),
  };
}

export function noteTargetToLink(record: TwentyNoteTarget): CrmActivityLink {
  return {
    ...meta(record),
    activityType: "note",
    activityId: record.noteId ?? "",
    target: toTarget(record),
  };
}

export function taskTargetToLink(record: TwentyTaskTarget): CrmActivityLink {
  return {
    ...meta(record),
    activityType: "task",
    activityId: record.taskId ?? "",
    target: toTarget(record),
  };
}

// --- Vers Twenty ---------------------------------------------------------------------------------

export function fromDomains(domains: CrmMultiValue) {
  return {
    primaryLinkUrl: domains.primary ?? "",
    primaryLinkLabel: "",
    secondaryLinks: domains.additional.map((url) => ({ url, label: "" })),
  };
}

export function fromLinkedin(url: string | null) {
  return { primaryLinkUrl: url ?? "", primaryLinkLabel: "", secondaryLinks: [] };
}

export function fromAddress(address: Partial<CrmAddress>) {
  const entries = [
    ["addressStreet1", address.street1],
    ["addressStreet2", address.street2],
    ["addressCity", address.city],
    ["addressPostcode", address.postcode],
    ["addressState", address.state],
    ["addressCountry", address.country],
  ] as const;
  return Object.fromEntries(
    entries.flatMap(([key, value]) => (value === undefined ? [] : [[key, value ?? ""]])),
  );
}

export function fromEmails(emails: CrmMultiValue) {
  return { primaryEmail: emails.primary ?? "", additionalEmails: emails.additional };
}

function assertInternationalPhone(phone: string): void {
  if (!E164.test(phone)) {
    throw new ValidationError("Numéro de téléphone invalide.", {
      phones: ["Format international attendu, par exemple +33612345678."],
    });
  }
}

/**
 * Twenty déduit l'indicatif du numéro international. Les sous-champs sont vidés explicitement :
 * un ancien indicatif ou un ancien pays ne doit pas survivre à un changement de numéro.
 */
export function fromPhones(phones: CrmMultiValue) {
  if (phones.primary) assertInternationalPhone(phones.primary);
  phones.additional.forEach(assertInternationalPhone);
  return {
    primaryPhoneNumber: phones.primary ?? "",
    primaryPhoneCountryCode: "",
    primaryPhoneCallingCode: "",
    additionalPhones: phones.additional.map((number) => ({
      number,
      countryCode: "",
      callingCode: "",
    })),
  };
}

export function fromAmount(amount: { cents: number; currency: "EUR" } | null) {
  if (amount === null) return { amountMicros: null, currencyCode: "EUR" };
  const isValid =
    Number.isInteger(amount.cents) &&
    amount.cents >= 0 &&
    Number.isSafeInteger(amount.cents * MICROS_PER_CENT);
  if (!isValid) {
    throw new ValidationError("Montant invalide.", {
      amount: ["Le montant doit être un nombre entier positif de centimes."],
    });
  }
  return { amountMicros: amount.cents * MICROS_PER_CENT, currencyCode: amount.currency };
}

export function fromCloseDate(closeDate: string | null): string | null {
  if (closeDate === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closeDate) || Number.isNaN(Date.parse(closeDate))) {
    throw new ValidationError("Date de clôture invalide.", {
      closeDate: ["Format attendu : AAAA-MM-JJ."],
    });
  }
  return `${closeDate}T00:00:00.000Z`;
}

/** Même normalisation que Twenty : minuscules, sans protocole, `www.`, chemin ni paramètres. */
export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "");
}

export function targetToFields(target: CrmActivityTarget) {
  if (target.type === "company") return { targetCompanyId: target.id };
  if (target.type === "person") return { targetPersonId: target.id };
  return { targetOpportunityId: target.id };
}

export function isSameTarget(a: CrmActivityTarget, b: CrmActivityTarget): boolean {
  return a.type === b.type && a.id === b.id;
}
