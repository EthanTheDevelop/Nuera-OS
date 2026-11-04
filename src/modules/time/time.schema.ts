import { TIME_CATEGORIES } from "@/lib/domain-enums";
import { z } from "@/lib/zod";
import { isCalendarDay } from "./calendar";

/** Un jour ne dépasse pas 24 h, pour une saisie comme pour le total d'un membre. */
export const MAX_MINUTES_PER_DAY = 1440;

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

const optionalId = z.preprocess(emptyToUndefined, z.uuid("Choix invalide.").optional());

const workOn = z
  .string({ error: "Indiquez une date." })
  .refine(isCalendarDay, { error: "Indiquez une date valide." });

const note = z.preprocess(
  emptyToUndefined,
  z.string().trim().max(500, "500 caractères au plus.").optional(),
);

const attachment = {
  memberId: optionalId,
  projectId: optionalId,
  taskId: optionalId,
  ticketId: optionalId,
  contractId: optionalId,
  category: z.enum(TIME_CATEGORIES, { error: "Choisissez une catégorie." }),
  billable: z.boolean().optional(),
};

export const timeEntrySchema = z.object({
  ...attachment,
  workOn,
  minutes: z.coerce
    .number({ error: "Saisissez une durée, par exemple 1h30." })
    .int("Saisissez une durée en minutes entières.")
    .min(1, "Saisissez une durée, par exemple 1h30.")
    .max(MAX_MINUTES_PER_DAY, "Une saisie ne dépasse pas 24 h."),
  note,
});
export type TimeEntryInput = z.input<typeof timeEntrySchema>;

/** Une cellule de feuille de temps : `minutes` est le total voulu, 0 pour vider la cellule. */
export const timesheetCellSchema = z.object({
  ...attachment,
  workOn,
  minutes: z
    .number({ error: "Saisissez une durée, par exemple 1h30." })
    .int()
    .min(0)
    .max(MAX_MINUTES_PER_DAY, "Une journée ne dépasse pas 24 h."),
});
export type TimesheetCellInput = z.input<typeof timesheetCellSchema>;

export const simulationSchema = z.object({
  estimatedMinutes: z
    .number({ error: "Saisissez une charge, par exemple 15 j." })
    .int()
    .min(1, "Saisissez une charge, par exemple 15 j.")
    .max(420_000, "Une charge aussi longue ne se planifie pas d'un bloc."),
});

/** Un identifiant d'URL malformé n'est pas une erreur serveur : l'objet n'existe simplement pas. */
export function isUuid(value: unknown): value is string {
  return z.uuid().safeParse(value).success;
}
