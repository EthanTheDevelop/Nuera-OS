import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ForbiddenState } from "@/components/states/states";
import { ActivityList } from "@/components/ui/activity-list";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/feedback";
import { InfoCard } from "@/components/ui/info-card";
import { Tile } from "@/components/ui/tile";
import { ACTIVITY_KIND_LABELS, CONTACT_ROLE_LABELS } from "@/lib/domain-enums";
import { formatDateShort } from "@/lib/format";
import { listActivitiesForContact } from "@/modules/crm/activity.service";
import { getCompany, listMemberOptions } from "@/modules/crm/company.service";
import { ActivityAddButton } from "@/modules/crm/components/activity-form";
import {
  ArchiveContactButton,
  RestoreContactButton,
} from "@/modules/crm/components/company-actions";
import { ContactFormButton } from "@/modules/crm/components/contact-form";
import { PhoneReveal } from "@/modules/crm/components/phone-reveal";
import { getContact } from "@/modules/crm/contact.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import type { ServiceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";

export const metadata: Metadata = { title: "Contact" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadContact(ctx: ServiceContext, id: string) {
  if (!UUID.test(id)) notFound();
  try {
    return await getContact(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Fiche d'un contact : coordonnées, rôles et historique relationnel (02.02.03). */
export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "crm:read")) return <ForbiddenState />;

  const { id } = await params;
  const contact = await loadContact(ctx, id);
  const archived = contact.archivedAt !== null;
  const canUpdate = can(ctx.actor, "crm:update");
  const canMerge = can(ctx.actor, "crm:merge");
  const canArchive = can(ctx.actor, "crm:archive");

  const [activities, companyRecord, members] = await Promise.all([
    listActivitiesForContact(ctx, id, { limit: 50 }),
    contact.companyId ? getCompany(ctx, contact.companyId) : null,
    canUpdate ? listMemberOptions(ctx) : Promise.resolve([]),
  ]);

  const company = companyRecord?.company ?? null;
  const title = contact.fullName || contact.email || "Contact";
  const rows = [
    {
      label: "E-mail",
      value: contact.email ? (
        <a
          href={`mailto:${contact.email}`}
          className="hit-44 hover:underline hover:underline-offset-4"
        >
          {contact.email}
        </a>
      ) : (
        "—"
      ),
    },
    { label: "Téléphone", value: contact.phone ? <PhoneReveal phone={contact.phone} /> : "—" },
    { label: "Fonction", value: contact.jobTitle ?? "—" },
    {
      label: "Client",
      value: company ? (
        <Link
          href={`/clients/${company.id}`}
          className="hit-44 hover:underline hover:underline-offset-4"
        >
          {company.name}
        </Link>
      ) : (
        "—"
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        className="mb-0 lg:mb-0"
        breadcrumbs={[
          { label: "Clients", href: "/clients" },
          { label: "Contacts", href: "/clients/contacts" },
          { label: title },
        ]}
        title={title}
        subtitle={[contact.jobTitle, company?.name].filter(Boolean).join(" · ") || undefined}
        badges={
          contact.isPrimary || contact.roles.length > 0 || archived ? (
            <>
              {archived ? <Badge tone="warn">Archivé</Badge> : null}
              {contact.isPrimary ? <Badge tone="accent">Contact principal</Badge> : null}
              {contact.roles.map((role) => (
                <Badge key={role}>{CONTACT_ROLE_LABELS[role]}</Badge>
              ))}
            </>
          ) : undefined
        }
        actions={
          <>
            {canUpdate && !archived ? (
              <ContactFormButton
                companyId={contact.companyId}
                contact={contact}
                companyChoice={{ company: company ? { id: company.id, name: company.name } : null }}
                canMerge={canMerge}
                label="Modifier"
                variant="secondary"
              />
            ) : null}
            {canArchive ? (
              archived ? (
                <RestoreContactButton contactId={id} name={title} />
              ) : (
                <ArchiveContactButton contactId={id} name={title} />
              )
            ) : null}
          </>
        }
      />

      {archived ? (
        <Alert tone="warn">Contact archivé : son historique reste consultable.</Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Tile
          icon="clock"
          title="Historique relationnel"
          aside={
            canUpdate && !archived ? (
              <ActivityAddButton
                links={{ companyId: contact.companyId, contactId: id }}
                members={members}
                label="Consigner"
              />
            ) : null
          }
          className="rounded-lg p-6"
        >
          <ActivityList
            items={activities.map((row) => ({
              id: row.id,
              date: formatDateShort(row.occurredAt),
              dateTime: row.occurredAt.toISOString(),
              title: `${ACTIVITY_KIND_LABELS[row.kind]} · ${row.subject}`,
              detail: row.body,
              actor: row.ownerName ?? undefined,
            }))}
            empty={<p className="text-sm text-muted">Aucun échange consigné avec ce contact.</p>}
          />
        </Tile>
        <div className="flex min-w-0 flex-col gap-5">
          <InfoCard icon="messages" title="Coordonnées" rows={rows} />
          {contact.notes ? (
            <InfoCard icon="edit" title="À retenir">
              <p className="text-sm whitespace-pre-line text-text">{contact.notes}</p>
            </InfoCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
