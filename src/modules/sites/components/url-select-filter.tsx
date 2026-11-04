"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/form";
import { PAGE_PARAM } from "@/components/ui/data-table";
import { hrefWith } from "@/lib/url-state";

/** Filtre à valeurs nombreuses du registre : l'URL porte l'état, la requête reste côté serveur. */
export function UrlSelectFilter({
  param,
  label,
  allLabel,
  options,
}: {
  param: string;
  label: string;
  allLabel: string;
  options: readonly { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      aria-label={label}
      aria-busy={pending || undefined}
      className="h-9 w-full text-sm sm:w-[190px] pointer-coarse:h-11"
      value={searchParams.get(param) ?? ""}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(() => {
          router.replace(hrefWith(pathname, searchParams, { [param]: next, [PAGE_PARAM]: null }), {
            scroll: false,
          });
        });
      }}
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
