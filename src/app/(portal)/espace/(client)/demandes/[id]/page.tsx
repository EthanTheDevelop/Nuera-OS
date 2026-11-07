import type { Metadata } from "next";
import {
  PORTAL_FILL,
  PORTAL_PAGE,
  PORTAL_ROW,
  PORTAL_SCROLL,
  PortalCard,
  PortalPageHeader,
} from "@/components/portal/portal-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CompactLink } from "@/components/ui/compact-button";
import { Icon } from "@/components/ui/icon";
import { TICKET_CATEGORY_LABELS } from "@/lib/domain-enums";
import { formatDateShort, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { listDocumentsForPortal } from "@/modules/documents/document.service";
import { TicketReplyForm } from "@/modules/portal/components/ticket-forms";
import { clientTicketStatus, clientTicketTimeline } from "@/modules/portal/portal.format";
import { loadPortalTicket, requirePortalPage } from "@/modules/portal/portal.page";

export const metadata: Metadata = { title: "Ma demande" };

/** Fiche d'une demande : état, réponses, fichiers. La demande d'un autre client répond 404. */
export default async function PortalTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePortalPage();
  const { id } = await params;
  const ticket = await loadPortalTicket(id);
  const files = await listDocumentsForPortal(
    ctx,
    { ticketId: ticket.id },
    { page: 1, pageSize: 20 },
  );
  const status = clientTicketStatus(ticket.status);
  const timeline = clientTicketTimeline(ticket.timeline);

  return (
    <div className={PORTAL_PAGE}>
      <div>
        <CompactLink variant="quiet" href="/espace/demandes">
          Toutes mes demandes
        </CompactLink>
      </div>
      <PortalPageHeader
        title={ticket.subject}
        subtitle={[ticket.number, TICKET_CATEGORY_LABELS[ticket.category], ticket.siteName]
          .filter(Boolean)
          .join(" · ")}
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      <div className={`${PORTAL_ROW} lg:grid-cols-[minmax(0,856fr)_minmax(0,480fr)]`}>
        <PortalCard title="Échanges" className="gap-4">
          <div className={`flex flex-col gap-4 ${PORTAL_SCROLL}`}>
            {ticket.description ? (
              <p className="text-sm whitespace-pre-wrap text-muted">{ticket.description}</p>
            ) : null}
            {ticket.messages.length > 0 ? (
              <ul className="flex flex-col gap-4">
                {ticket.messages.map((message) => (
                  <li
                    key={message.id}
                    className={cn(
                      "flex items-start gap-2.5",
                      message.fromClient ? "justify-end" : "justify-start",
                    )}
                  >
                    {message.fromClient ? null : <Avatar name={message.authorName} size={36} />}
                    <div
                      className={cn(
                        "flex max-w-[85%] flex-col gap-1.5 rounded-lg px-4 py-3 text-sm leading-[1.3]",
                        message.fromClient
                          ? "bg-accent text-on-accent"
                          : "border border-border bg-surface text-ink",
                      )}
                    >
                      <p className="whitespace-pre-wrap">{message.body}</p>
                      <p
                        className={cn(
                          "text-xs",
                          message.fromClient ? "text-on-accent/80" : "text-muted",
                        )}
                      >
                        {message.fromClient ? "Vous" : message.authorName} ·{" "}
                        {formatDateTime(message.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Pas encore de réponse : nous revenons vers vous.</p>
            )}
          </div>
          {ticket.status === "closed" ? (
            <p className="text-sm text-muted">
              Cette demande est clôturée. Pour la suite, ouvrez une nouvelle demande.
            </p>
          ) : (
            <TicketReplyForm ticketId={ticket.id} />
          )}
        </PortalCard>
        <div className="flex min-w-0 flex-col gap-6">
          <PortalCard title="Où en est-on" className="gap-3 lg:shrink-0 lg:only:flex-1">
            <ol className="flex flex-col gap-2">
              {timeline.map((step) => (
                <li
                  key={`${step.label}-${step.at.toISOString()}`}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-ink">{step.label}</span>
                  <span className="text-muted">{formatDateShort(step.at)}</span>
                </li>
              ))}
              {timeline.length === 0 ? (
                <li className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink">Reçue</span>
                  <span className="text-muted">{formatDateShort(ticket.createdAt)}</span>
                </li>
              ) : null}
            </ol>
          </PortalCard>
          {files.items.length > 0 ? (
            <PortalCard title="Fichiers" className={`gap-3 ${PORTAL_FILL}`}>
              <ul className={`flex flex-col gap-2 ${PORTAL_SCROLL}`}>
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
            </PortalCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
