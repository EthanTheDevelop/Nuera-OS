import { z } from "@/lib/zod";
import { INTERNAL_ROLES } from "@/server/auth/roles";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

/** Paramètre d'URL : une valeur illisible vaut la première page, elle ne fait pas tomber l'écran. */
const pageParam = z.coerce.number().int().min(1).catch(1);

export const inviteUserSchema = z.object({
  name: z.string().trim().min(2, "Le nom doit comporter au moins 2 caractères.").max(120),
  email: z
    .email("Adresse e-mail invalide.")
    .trim()
    .transform((value) => value.toLowerCase()),
  role: z.enum(INTERNAL_ROLES, { error: "Choisissez un rôle." }),
});

export const changeRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(INTERNAL_ROLES, { error: "Choisissez un rôle." }),
});

export const userQuerySchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  role: z.preprocess(
    emptyToUndefined,
    z.enum(["admin", "member", "contractor", "viewer", "client"]).optional(),
  ),
  page: pageParam,
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const auditQuerySchema = z.object({
  action: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  group: z.preprocess(emptyToUndefined, z.string().max(40).optional()),
  actorId: z.preprocess(emptyToUndefined, z.uuid().optional()),
  from: z.preprocess(emptyToUndefined, z.iso.date().optional()).catch(undefined),
  to: z.preprocess(emptyToUndefined, z.iso.date().optional()).catch(undefined),
  page: pageParam,
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const profileSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  accent: z.enum(["blue", "ink", "chatgpt", "warn", "danger"]),
  density: z.enum(["comfortable", "compact"]),
  homePath: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\/(?!\/)[a-z/-]*$/, "Page d'accueil invalide.")
      .max(100)
      .optional(),
  ),
  dailyDigest: z.boolean(),
  preferences: z
    .array(z.object({ kind: z.string().min(1).max(60), inApp: z.boolean(), email: z.boolean() }))
    .max(100),
});
