import type { Metadata } from "next";
import { PortalCard } from "@/components/portal/portal-card";
import { Icon } from "@/components/ui/icon";
import { paramValue } from "@/lib/url-state";
import { listDocumentsForPortal } from "@/modules/documents/document.service";
import { listPortalConversation } from "@/modules/messaging/message.service";
import { MessagesPanel } from "@/modules/portal/components/messages-panel";
import { SharedFilesDrop } from "@/modules/portal/components/shared-files";
import { loadPortalHome, requirePortalPage } from "@/modules/portal/portal.page";

export const metadata: Metadata = { title: "Messages" };

/** Écran C4. Un `brouillon` dans l'URL préremplit la saisie : rien ne part sans le client. */
export default async function PortalMessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePortalPage();
  const [data, conversation, files, query] = await Promise.all([
    loadPortalHome(),
    listPortalConversation(ctx),
    listDocumentsForPortal(ctx, {}, { page: 1, pageSize: 8 }),
    searchParams,
  ]);
  const home = data.home;
  const interlocutors = home?.project.interlocutors ?? [];
  const projectId = home?.project.id ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1016fr)_minmax(0,320fr)]">
      <MessagesPanel
        messages={conversation.messages}
        hasMore={conversation.hasMore}
        unread={conversation.unread}
        interlocutors={interlocutors}
        interlocutorNames={home?.interlocutorNames ?? "Nuera Studio"}
        draft={paramValue(query, "brouillon")?.slice(0, 500)}
        projectId={projectId}
      />
      <PortalCard title="Fichiers partagés" className="lg:h-[952px]">
        {files.items.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {files.items.map((file) => (
              <li key={file.id}>
                <a
                  href={file.downloadHref}
                  className="flex items-center gap-2 text-sm text-ink underline-offset-4 hover:underline"
                >
                  <Icon name="devis" size={16} className="shrink-0 text-accent" />
                  <span className="min-w-0 truncate">{file.filename ?? file.title}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Aucun fichier pour l&apos;instant.</p>
        )}
        <SharedFilesDrop projectId={projectId} />
      </PortalCard>
    </div>
  );
}
