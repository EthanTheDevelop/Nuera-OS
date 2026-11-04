import type { Metadata } from "next";
import { DevisScreen } from "../_screen";

export const metadata: Metadata = { title: "Devis" };

export default async function DevisDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return <DevisScreen selectedId={id} searchParams={await searchParams} />;
}
