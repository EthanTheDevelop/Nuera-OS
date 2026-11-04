import type { Metadata } from "next";
import { DevisScreen } from "../_screen";

export const metadata: Metadata = { title: "Devis" };

export default async function DevisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DevisScreen searchParams={await searchParams} />;
}
