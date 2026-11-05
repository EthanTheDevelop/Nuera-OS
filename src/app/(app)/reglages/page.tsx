import { redirect } from "next/navigation";
import { canAny } from "@/server/auth/permissions";
import { requireInternalActor } from "@/server/auth/session";
import { ForbiddenState } from "@/components/states/states";

export default async function SettingsIndexPage() {
  const actor = await requireInternalActor();
  if (!canAny(actor, ["integrations:read"])) return <ForbiddenState />;
  redirect("/reglages/connexions");
}
