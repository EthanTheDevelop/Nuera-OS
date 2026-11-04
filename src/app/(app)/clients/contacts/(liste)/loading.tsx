import { TableSkeleton } from "@/components/states/states";

export default function ContactsLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <h1 className="text-page-title text-ink">Contacts</h1>
      <TableSkeleton rows={8} columns={4} rowHeight="lg" label="Chargement des contacts" />
    </div>
  );
}
