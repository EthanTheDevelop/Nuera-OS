import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hrefWith } from "@/lib/url-state";

export const metadata: Metadata = { title: "Messages" };

/** Ancien lien (notifications, e-mails) : la conversation s'ouvre sur `/messages?c=…`. */
export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { conversationId } = await params;
  redirect(hrefWith("/messages", await searchParams, { c: conversationId.slice(0, 64) }));
}
