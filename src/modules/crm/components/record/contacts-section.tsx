import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/ui/tile";
import { CONTACT_ROLE_LABELS } from "@/lib/domain-enums";
import type { ContactSummary } from "../../contact.service";
import { ContactFormButton } from "../contact-form";
import { PhoneReveal } from "../phone-reveal";

/** Contacts de l'organisation et leurs rôles (écran 04, 02.02), le principal d'abord. */
export function ContactsSection({
  companyId,
  contacts,
  canCreate,
  canUpdate,
  canMerge,
}: {
  companyId: string;
  contacts: readonly ContactSummary[];
  canCreate: boolean;
  canUpdate: boolean;
  canMerge: boolean;
}) {
  return (
    <Tile
      icon="messages"
      title={contacts.length > 1 ? `Contacts · ${contacts.length}` : "Contact"}
      aside={
        canCreate ? (
          <ContactFormButton companyId={companyId} canMerge={canMerge} label="Ajouter" />
        ) : null
      }
      className="rounded-lg p-6"
    >
      {contacts.length === 0 ? (
        <p className="text-sm text-muted">Aucun contact pour ce client.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted">Nom</p>
                  <Link
                    href={`/clients/contacts/${contact.id}`}
                    className="hit-44 block truncate text-sm font-medium text-text hover:underline hover:underline-offset-4"
                  >
                    {contact.fullName || "Sans nom"}
                  </Link>
                  {contact.jobTitle ? (
                    <p className="truncate text-xs text-muted">{contact.jobTitle}</p>
                  ) : null}
                </div>
                {canUpdate ? (
                  <ContactFormButton
                    companyId={companyId}
                    contact={contact}
                    canMerge={canMerge}
                    label="Modifier"
                  />
                ) : null}
              </div>
              {contact.email ? (
                <div className="min-w-0">
                  <p className="text-xs text-muted">E-mail</p>
                  <a
                    href={`mailto:${contact.email}`}
                    className="hit-44 block truncate text-sm font-medium text-text hover:underline hover:underline-offset-4"
                  >
                    {contact.email}
                  </a>
                </div>
              ) : null}
              {contact.phone ? (
                <div>
                  <p className="text-xs text-muted">Téléphone</p>
                  <p className="text-sm font-medium text-text">
                    <PhoneReveal phone={contact.phone} />
                  </p>
                </div>
              ) : null}
              {contact.isPrimary || contact.roles.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {contact.isPrimary ? <Badge tone="accent">Principal</Badge> : null}
                  {contact.roles.map((role) => (
                    <Badge key={role}>{CONTACT_ROLE_LABELS[role]}</Badge>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}
