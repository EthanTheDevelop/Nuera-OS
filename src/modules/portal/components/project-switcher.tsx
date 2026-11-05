"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { selectProjectAction } from "../portal.actions";

/** Absent du dessin (figma-map §8) : un client à plusieurs projets choisit celui qu'il consulte. */
export function ProjectSwitcher({
  projects,
  selectedId,
}: {
  projects: readonly { id: string; name: string }[];
  selectedId: string;
}) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(projectId: string) {
    setError(null);
    startTransition(async () => {
      const result = await selectProjectAction(projectId);
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        Projet affiché
      </label>
      <Select
        id={id}
        value={selectedId}
        disabled={pending}
        onChange={(event) => change(event.target.value)}
        className="w-auto max-w-full"
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </Select>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
