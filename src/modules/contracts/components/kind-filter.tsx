"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/form";
import { PAGE_PARAM } from "@/components/ui/data-table";
import { CONTRACT_KIND_LABELS, CONTRACT_KINDS } from "@/lib/domain-enums";
import { hrefWith } from "@/lib/url-state";

/** Filtre par type, porté par l'URL : la requête reste côté serveur. */
export function KindFilter({ param }: { param: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  return (
    <Select
      aria-label="Filtrer par type de contrat"
      className="h-9 w-full sm:w-[200px]"
      value={searchParams.get(param) ?? ""}
      onChange={(event) => {
        const href = hrefWith(pathname, searchParams, {
          [param]: event.target.value || null,
          [PAGE_PARAM]: null,
        });
        startTransition(() => router.replace(href, { scroll: false }));
      }}
    >
      <option value="">Tous les types</option>
      {CONTRACT_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {CONTRACT_KIND_LABELS[kind]}
        </option>
      ))}
    </Select>
  );
}
