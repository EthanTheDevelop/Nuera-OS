import { MEMBER_KINDS, MEMBER_STATUSES, MISSION_STATUSES } from "@/lib/domain-enums";
import { z } from "@/lib/zod";
import { isCalendarDay } from "@/modules/time/calendar";

const blankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `${max} caractères au plus.`).nullish());

const optionalId = z.preprocess(blankToNull, z.uuid("Choix invalide.").nullish());

const optionalDay = z.preprocess(
  blankToNull,
  z.string().refine(isCalendarDay, { error: "Indiquez une date valide." }).nullish(),
);

const optionalCents = z.preprocess(
  blankToNull,
  z.coerce
    .number({ error: "Saisissez un montant, par exemple 1 234,50." })
    .int()
    .min(0, "Le montant ne peut pas être négatif.")
    .max(100_000_000, "Montant trop élevé.")
    .nullish(),
);

const skills = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(/[,;\n]/)
          .map((skill) => skill.trim())
          .filter(Boolean)
      : value,
  z.array(z.string().trim().min(1).max(60, "60 caractères au plus.")).max(30).default([]),
);

export const memberSchema = z.object({
  kind: z.enum(MEMBER_KINDS, { error: "Choisissez un type de membre." }),
  fullName: z
    .string({ error: "Indiquez un nom." })
    .trim()
    .min(2, "Indiquez un nom.")
    .max(120, "120 caractères au plus."),
  email: z.preprocess(
    blankToNull,
    z.email("Indiquez une adresse e-mail valide.").max(200).nullish(),
  ),
  phone: optionalText(40),
  title: optionalText(120),
  specialty: optionalText(120),
  skills,
  status: z.enum(MEMBER_STATUSES).default("active"),
  weeklyCapacityMinutes: z.coerce
    .number({ error: "Saisissez une capacité, par exemple 35 h." })
    .int()
    .min(0, "La capacité ne peut pas être négative.")
    .max(6720, "Une semaine ne dépasse pas 112 h de capacité."),
  hourlyCostCents: optionalCents,
  dayRateCents: optionalCents,
  conditions: optionalText(2000),
});
export type MemberInput = z.input<typeof memberSchema>;

export const absenceSchema = z
  .object({
    memberId: z.uuid("Membre invalide."),
    startOn: z
      .string({ error: "Indiquez une date." })
      .refine(isCalendarDay, { error: "Indiquez une date valide." }),
    endOn: z
      .string({ error: "Indiquez une date." })
      .refine(isCalendarDay, { error: "Indiquez une date valide." }),
    reason: optionalText(200),
  })
  .refine((value) => value.endOn >= value.startOn, {
    path: ["endOn"],
    error: "La fin ne peut pas précéder le début.",
  });

export const missionSchema = z.object({
  memberId: z.uuid("Choisissez un intervenant."),
  title: z
    .string({ error: "Indiquez un intitulé." })
    .trim()
    .min(2, "Indiquez un intitulé.")
    .max(160, "160 caractères au plus."),
  projectId: optionalId,
  taskId: optionalId,
  ticketId: optionalId,
  deliverableLabel: optionalText(160),
  dueOn: optionalDay,
  plannedCostCents: optionalCents,
  committedCostCents: optionalCents,
});
export type MissionInput = z.input<typeof missionSchema>;

export const missionTransitionSchema = z.object({
  status: z.enum(MISSION_STATUSES, { error: "Statut invalide." }),
  deliverableReceivedOn: optionalDay,
});

export const linkUserSchema = z.object({
  userId: optionalId,
});

/** Un identifiant d'URL malformé n'est pas une erreur serveur : l'objet n'existe simplement pas. */
export function isUuid(value: unknown): value is string {
  return z.uuid().safeParse(value).success;
}
