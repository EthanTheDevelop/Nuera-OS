import { eq } from "drizzle-orm";
import { z } from "@/lib/zod";
import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { appSettings, users } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError } from "@/server/errors";
import { parseInput } from "@/server/validation";

/** Réglages de l'agence (`app_settings`). Aucun secret ici : ils restent dans l'environnement. */
async function readSetting(db: Database, key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value;
}

async function writeSetting(
  tx: Database,
  key: string,
  value: unknown,
  updatedBy: string,
): Promise<void> {
  await tx
    .insert(appSettings)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy } });
}

// --- Double authentification de l'équipe --------------------------------------------------------

const REQUIRE_2FA_KEY = "security.require_two_factor";

/** Sans choix enregistré : exigée en production, pas en développement. */
export function defaultRequireTwoFactor(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production";
}

export async function isTwoFactorRequired(
  db: Database,
  nodeEnv: string | undefined,
): Promise<boolean> {
  const value = await readSetting(db, REQUIRE_2FA_KEY);
  return typeof value === "boolean" ? value : defaultRequireTwoFactor(nodeEnv);
}

export async function setTwoFactorRequired(ctx: ServiceContext, rawInput: unknown): Promise<void> {
  assertCan(ctx.actor, "admin:manage");
  const required = parseInput(z.boolean(), rawInput);
  // Sans ce contrôle, l'auteur serait renvoyé vers son profil et ne pourrait plus revenir sur son choix.
  if (required) {
    const [actor] = await ctx.db
      .select({ enabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, ctx.actor.userId))
      .limit(1);
    if (!actor?.enabled) {
      throw new ConflictError(
        "Activez d'abord votre propre double authentification, depuis votre profil.",
      );
    }
  }
  await ctx.db.transaction(async (tx) => {
    await writeSetting(tx, REQUIRE_2FA_KEY, required, ctx.actor.userId);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "app_setting.updated",
      entityType: "app_setting",
      metadata: { key: REQUIRE_2FA_KEY, required },
    });
  });
}

// --- Fiche de l'agence --------------------------------------------------------------------------

const AGENCY_KEY = "agency.profile";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const agencyProfileSchema = z.object({
  name: z.string().trim().min(1, "Indiquez un nom.").max(120),
  replyTo: z
    .union([z.literal(""), z.email("Adresse e-mail invalide.")])
    .nullish()
    .transform((value) => value || null),
  phone: optionalText(40),
  address: optionalText(240),
  siren: optionalText(20),
});

export type AgencyProfile = z.infer<typeof agencyProfileSchema>;

/** Valeur absente ou illisible : fiche vide, au nom de l'agence. */
export async function getAgencyProfile(db: Database): Promise<AgencyProfile> {
  const parsed = agencyProfileSchema.safeParse(await readSetting(db, AGENCY_KEY));
  return parsed.success
    ? parsed.data
    : { name: "Nuera Studio", replyTo: null, phone: null, address: null, siren: null };
}

export async function updateAgencyProfile(
  ctx: ServiceContext,
  rawInput: unknown,
): Promise<AgencyProfile> {
  assertCan(ctx.actor, "admin:manage");
  const profile = parseInput(agencyProfileSchema, rawInput);
  await ctx.db.transaction(async (tx) => {
    await writeSetting(tx, AGENCY_KEY, profile, ctx.actor.userId);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "app_setting.updated",
      entityType: "app_setting",
      metadata: { key: AGENCY_KEY },
    });
  });
  return profile;
}
