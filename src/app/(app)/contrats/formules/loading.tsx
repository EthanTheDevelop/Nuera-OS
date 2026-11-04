import { TableSkeleton } from "@/components/states/states";

export default function PlansLoading() {
  return <TableSkeleton rows={4} columns={6} rowHeight="lg" label="Chargement des formules" />;
}
