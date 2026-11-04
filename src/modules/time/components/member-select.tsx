"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/form";
import { PAGE_PARAM } from "@/components/ui/data-table";
import { hrefWith } from "@/lib/url-state";

/** Choisit le membre affiché : le filtre vit dans l'URL, la requête reste côté serveur. */
export function MemberSelect({
  members,
  value,
  param = "membre",
  allLabel,
  label = "Membre",
}: {
  members: readonly { id: string; fullName: string }[];
  value?: string;
  param?: string;
  /** Présent : ajoute un choix « tout le monde » sans filtre. */
  allLabel?: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      aria-label={label}
      value={value ?? ""}
      aria-busy={pending || undefined}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(() => {
          router.replace(
            hrefWith(pathname, searchParams, { [param]: next || null, [PAGE_PARAM]: null }),
            { scroll: false },
          );
        });
      }}
      className="h-9 min-w-[180px] pl-3 text-sm pointer-coarse:h-11"
    >
      {allLabel ? <option value="">{allLabel}</option> : null}
      {members.map((member) => (
        <option key={member.id} value={member.id}>
          {member.fullName}
        </option>
      ))}
    </Select>
  );
}
