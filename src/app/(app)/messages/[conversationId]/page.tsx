import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ForbiddenState } from "@/components/states/states";
import { MessagesScreen } from "@/modules/messaging/components/messages-screen";
import { getConversation } from "@/modules/messaging/message.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

export const metadata: Metadata = { title: "Messages" };

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "messages:read")) return <ForbiddenState />;

  const { conversationId } = await params;
  try {
    await getConversation(ctx, conversationId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return (
    <MessagesScreen ctx={ctx} conversationId={conversationId} searchParams={await searchParams} />
  );
}
