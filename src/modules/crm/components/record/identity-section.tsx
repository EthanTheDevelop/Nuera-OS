import { InfoCard } from "@/components/ui/info-card";
import type { CompanyRecord } from "../../company.service";
import { PhoneReveal } from "../phone-reveal";

/** Identité de l'organisation : coordonnées et informations administratives (02.01.01). */
export function IdentitySection({ company }: { company: CompanyRecord["company"] }) {
  const address = [
    company.addressLine,
    [company.postalCode, company.city].filter(Boolean).join(" "),
    company.country,
  ]
    .filter(Boolean)
    .join(", ");

  const rows = [
    { label: "Activité", value: company.activity },
    { label: "SIREN", value: company.siren },
    {
      label: "Site web",
      value: company.domain ? (
        <a
          href={`https://${company.domain}`}
          target="_blank"
          rel="noreferrer"
          className="hit-44 hover:underline hover:underline-offset-4"
        >
          {company.domain}
        </a>
      ) : null,
    },
    { label: "Téléphone", value: company.phone ? <PhoneReveal phone={company.phone} /> : null },
    { label: "Adresse", value: address || null },
  ].filter((row) => row.value);

  return (
    <InfoCard icon="clients" title="Identité" rows={rows}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Aucune coordonnée renseignée.</p>
      ) : null}
    </InfoCard>
  );
}
