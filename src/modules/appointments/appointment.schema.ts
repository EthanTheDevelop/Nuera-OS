import { APPOINTMENT_STATUSES } from "@/lib/domain-enums";
import { z } from "@/lib/zod";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().trim().max(max).optional(),
  );

const optionalUuid = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.uuid().optional(),
);

const appointmentFields = {
  title: z.string().trim().min(1, "Donnez un titre au rendez-vous.").max(200),
  kind: optionalText(80),
  startsAt: z.coerce
    .date({ error: "Choisissez une date et une heure." })
    .min(new Date("2000-01-01T00:00:00Z"), "Cette date n'est pas valable.")
    .max(new Date("2100-01-01T00:00:00Z"), "Cette date n'est pas valable."),
  durationMinutes: z.coerce
    .number({ error: "Indiquez une durée." })
    .int()
    .min(5, "5 minutes au minimum.")
    .max(1440, "24 heures au maximum."),
  channel: optionalText(80),
  location: optionalText(300),
  companyId: optionalUuid,
  contactId: optionalUuid,
  projectId: optionalUuid,
  opportunityId: optionalUuid,
  memberIds: z.array(z.uuid()).max(20).default([]),
  /** Case du formulaire : absente, elle vaut « non ». */
  clientVisible: z
    .unknown()
    .optional()
    .transform((value) => value === true || value === "on" || value === "true"),
};

export const createAppointmentSchema = z.object({
  ...appointmentFields,
  /** Identifiant généré par le navigateur : un double envoi ne crée qu'un rendez-vous. */
  clientRequestId: optionalUuid,
});
export type CreateAppointmentInput = z.input<typeof createAppointmentSchema>;

export const updateAppointmentSchema = z.object(appointmentFields);
export type UpdateAppointmentInput = z.input<typeof updateAppointmentSchema>;

export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);

export const APPOINTMENT_SCOPES = ["upcoming", "past", "cancelled"] as const;
export type AppointmentScope = (typeof APPOINTMENT_SCOPES)[number];

/** Lecture tolérante de l'URL : une valeur inconnue vaut « À venir ». */
export function parseAppointmentScope(value: string | undefined): AppointmentScope {
  return APPOINTMENT_SCOPES.find((scope) => scope === value) ?? "upcoming";
}

/** Filtre lu dans l'URL : un identifiant mal formé ne filtre rien, ce n'est pas une erreur. */
export function parseLinkParam(value: string | undefined): string | undefined {
  return z.uuid().safeParse(value).success ? value : undefined;
}

/**
 * Enveloppe d'un webhook Cal.com / Cal.diy (documentation officielle, version 2021-10-20) :
 * `triggerEvent`, `createdAt`, `payload`. Les champs inutilisés sont ignorés.
 */
export const calWebhookSchema = z.object({
  triggerEvent: z.string(),
  createdAt: z.string().optional(),
  payload: z
    .object({
      uid: z.string().min(1).optional(),
      title: z.string().optional(),
      startTime: z.iso.datetime({ offset: true }).optional(),
      endTime: z.iso.datetime({ offset: true }).optional(),
      location: z.string().nullish(),
      rescheduleUid: z.string().nullish(),
      organizer: z.object({ email: z.string().optional() }).loose().nullish(),
      attendees: z
        .array(z.object({ email: z.string().optional(), name: z.string().optional() }).loose())
        .nullish(),
    })
    .loose(),
});
export type CalWebhookEvent = z.output<typeof calWebhookSchema>;
