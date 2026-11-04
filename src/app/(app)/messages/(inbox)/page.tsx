import type { Metadata } from "next";
import { ForbiddenState } from "@/components/states/states";
import { MessagesScreen } from "@/modules/messaging/components/messages-screen";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "messages:read")) return <ForbiddenState />;
  return <MessagesScreen ctx={ctx} searchParams={await searchParams} />;
}
