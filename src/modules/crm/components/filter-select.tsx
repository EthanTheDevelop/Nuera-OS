"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { hrefWith } from "@/lib/url-state";
import { PAGE_PARAM } from "@/components/ui/data-table";

/** Filtre à plusieurs valeurs, porté par l'URL. Complète `FilterChip` quand les valeurs sont nombreuses. */
export function FilterSelect({
  param,
  label,
  allLabel,
  options,
  className,
}: {
  param: string;
  label: string;
  allLabel: string;
  options: readonly { value: string; label: string }[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  if (options.length === 0) return null;
  return (
    <div className={cn("w-52 shrink-0", pending && "opacity-60", className)}>
      <Select
        aria-label={label}
        value={searchParams.get(param) ?? ""}
        className="h-9 pointer-coarse:h-11"
        onChange={(event) => {
          const href = hrefWith(pathname, searchParams, {
            [param]: event.target.value,
            [PAGE_PARAM]: null,
          });
          startTransition(() => router.replace(href, { scroll: false }));
        }}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
