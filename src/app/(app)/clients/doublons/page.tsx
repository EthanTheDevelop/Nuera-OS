import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/ui/tile";
import { DUPLICATE_REASON_LABELS, listCompanyDuplicates } from "@/modules/crm/company.service";
import { MergeGroupButton } from "@/modules/crm/components/company-actions";
import { listContactDuplicates } from "@/modules/crm/contact.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Doublons" };

/** Qualité des données (02.04) : fiches en double, avec fusion confirmée. */
export default async function DuplicatesPage() {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "crm:read")) return <ForbiddenState />;

  const [companies, contacts] = await Promise.all([
    listCompanyDuplicates(ctx),
    listContactDuplicates(ctx),
  ]);
  const canMerge = can(ctx.actor, "crm:merge");
  const total = companies.length + contacts.length;

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        className="mb-0 lg:mb-0"
        breadcrumbs={[{ label: "Clients", href: "/clients" }, { label: "Doublons" }]}
        title="Doublons"
        subtitle={
          total === 0
            ? "Aucun doublon détecté"
            : `${total} ${total > 1 ? "groupes à examiner" : "groupe à examiner"}${canMerge ? "" : " · fusion réservée aux associés"}`
        }
      />

      {total === 0 ? (
        <EmptyState
          icon="check"
          title="Aucun doublon"
          description="Mêmes domaine, SIREN, nom, e-mail ou téléphone : rien à signaler."
        />
      ) : null}

      {companies.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="duplicate-companies">
          <h2 id="duplicate-companies" className="text-tile-title text-ink">
            Clients
          </h2>
          <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-(--cols-cards)">
            {companies.map((group) => (
              <Tile
                key={`${group.reason}-${group.key}`}
                icon="clients"
                // Pour un nom, la clé est sa forme normalisée (« ateliernlune ») : illisible.
                title={group.reason === "name" ? (group.members[0]?.name ?? group.key) : group.key}
                aside={<Badge tone="warn">{DUPLICATE_REASON_LABELS[group.reason]}</Badge>}
                className="rounded-lg p-6"
              >
                {canMerge ? (
                  <MergeGroupButton
                    entity="company"
                    members={group.members.map((company) => ({
                      id: company.id,
                      name: company.name,
                    }))}
                  />
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {group.members.map((company) => (
                      <li key={company.id}>
                        <Link href={`/clients/${company.id}`} className="hit-44 hover:underline">
                          {company.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Tile>
            ))}
          </div>
        </section>
      ) : null}

      {contacts.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="duplicate-contacts">
          <h2 id="duplicate-contacts" className="text-tile-title text-ink">
            Contacts
          </h2>
          <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-(--cols-cards)">
            {contacts.map((group) => (
              <Tile
                key={`${group.reason}-${group.key}`}
                icon="messages"
                title={
                  group.reason === "name" ? (group.members[0]?.fullName ?? group.key) : group.key
                }
                aside={<Badge tone="warn">{DUPLICATE_REASON_LABELS[group.reason]}</Badge>}
                className="rounded-lg p-6"
              >
                {canMerge ? (
                  <MergeGroupButton
                    entity="contact"
                    members={group.members.map((contact) => ({
                      id: contact.id,
                      name: `${contact.fullName}${contact.companyName ? ` · ${contact.companyName}` : ""}`,
                    }))}
                  />
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {group.members.map((contact) => (
                      <li key={contact.id}>
                        <Link
                          href={`/clients/contacts/${contact.id}`}
                          className="hit-44 hover:underline"
                        >
                          {contact.fullName}
                          {contact.companyName ? ` · ${contact.companyName}` : ""}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Tile>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
