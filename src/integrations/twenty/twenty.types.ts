/**
 * Formes de l'API REST de Twenty v2.55.0, vérifiées sur une instance réelle.
 * Internes à l'adaptateur : ne jamais les exposer hors de `src/integrations/twenty`.
 */
import { z } from "@/lib/zod";

const text = z.string().nullish();

const recordMeta = {
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullish(),
};

const links = z
  .looseObject({
    primaryLinkUrl: text,
    secondaryLinks: z.array(z.looseObject({ url: text })).nullish(),
  })
  .nullish();

export const twentyCompanySchema = z.looseObject({
  ...recordMeta,
  name: text,
  domainName: links,
  linkedinLink: links,
  address: z
    .looseObject({
      addressStreet1: text,
      addressStreet2: text,
      addressCity: text,
      addressPostcode: text,
      addressState: text,
      addressCountry: text,
    })
    .nullish(),
});
export type TwentyCompany = z.infer<typeof twentyCompanySchema>;

export const twentyPersonSchema = z.looseObject({
  ...recordMeta,
  name: z.looseObject({ firstName: text, lastName: text }).nullish(),
  emails: z
    .looseObject({ primaryEmail: text, additionalEmails: z.array(z.string()).nullish() })
    .nullish(),
  phones: z
    .looseObject({
      primaryPhoneNumber: text,
      primaryPhoneCallingCode: text,
      additionalPhones: z.array(z.looseObject({ number: text, callingCode: text })).nullish(),
    })
    .nullish(),
  jobTitle: text,
  companyId: text,
});
export type TwentyPerson = z.infer<typeof twentyPersonSchema>;

export const twentyOpportunitySchema = z.looseObject({
  ...recordMeta,
  name: text,
  stage: z.string(),
  amount: z.looseObject({ amountMicros: z.number().nullish(), currencyCode: text }).nullish(),
  closeDate: text,
  companyId: text,
  pointOfContactId: text,
});
export type TwentyOpportunity = z.infer<typeof twentyOpportunitySchema>;

const linkTargets = {
  targetCompanyId: text,
  targetPersonId: text,
  targetOpportunityId: text,
};

export const twentyNoteTargetSchema = z.looseObject({
  ...recordMeta,
  ...linkTargets,
  noteId: text,
});
export type TwentyNoteTarget = z.infer<typeof twentyNoteTargetSchema>;

export const twentyTaskTargetSchema = z.looseObject({
  ...recordMeta,
  ...linkTargets,
  taskId: text,
});
export type TwentyTaskTarget = z.infer<typeof twentyTaskTargetSchema>;

const body = z.looseObject({ markdown: text }).nullish();

export const twentyNoteSchema = z.looseObject({
  ...recordMeta,
  title: text,
  bodyV2: body,
  noteTargets: z.array(twentyNoteTargetSchema).nullish(),
});
export type TwentyNote = z.infer<typeof twentyNoteSchema>;

export const twentyTaskSchema = z.looseObject({
  ...recordMeta,
  title: text,
  bodyV2: body,
  dueAt: text,
  status: z.string().nullish(),
  taskTargets: z.array(twentyTaskTargetSchema).nullish(),
});
export type TwentyTask = z.infer<typeof twentyTaskSchema>;

export const twentyPageInfoSchema = z.looseObject({
  endCursor: z.string().nullish(),
  hasNextPage: z.boolean(),
});

/** Corps d'une livraison de webhook (distinct de la documentation : `eventName` et `record`). */
export const twentyWebhookPayloadSchema = z.looseObject({
  eventName: z.string(),
  objectMetadata: z.looseObject({ nameSingular: z.string() }),
  workspaceId: z.string(),
  webhookId: z.string(),
  eventDate: z.string(),
  record: z.looseObject({ id: z.string() }),
  updatedFields: z.array(z.string()).optional(),
});
export type TwentyWebhookPayload = z.infer<typeof twentyWebhookPayloadSchema>;
