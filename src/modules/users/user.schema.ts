import { z } from "@/lib/zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/auth/password-policy";
import { ROLES } from "@/server/auth/roles";

export const createUserSchema = z.object({
  email: z
    .email("Adresse e-mail invalide.")
    .trim()
    .transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2, "Le nom doit comporter au moins 2 caractères.").max(120),
  role: z.enum(ROLES, { error: `Rôle invalide (valeurs : ${ROLES.join(", ")}).` }),
  password: z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      `Le mot de passe doit comporter au moins ${PASSWORD_MIN_LENGTH} caractères.`,
    )
    .max(
      PASSWORD_MAX_LENGTH,
      `Le mot de passe ne peut pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`,
    ),
});

export type CreateUserInput = z.input<typeof createUserSchema>;
