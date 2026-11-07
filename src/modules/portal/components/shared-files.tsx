"use client";

import { useRouter } from "next/navigation";
import { UploadField } from "@/modules/documents/components/upload-field";

/** Grande zone de dépôt de C4 : le fichier rejoint les documents du client, rien d'autre. */
export function SharedFilesDrop({ projectId }: { projectId: string | null }) {
  const router = useRouter();
  return (
    <UploadField
      label={<span className="sr-only">Déposer des photos</span>}
      dropLabel="Déposer des photos"
      target={projectId ? { projectId } : {}}
      className="lg:[&_label.border-dashed]:min-h-24"
      onUploaded={() => router.refresh()}
    />
  );
}
