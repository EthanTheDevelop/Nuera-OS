import { Tile } from "@/components/ui/tile";
import { formatDateShort } from "@/lib/format";
import type { MemberOption } from "@/modules/team/team.lookup";
import type { ActivitySummary } from "../../activity.service";
import { ActivityAddButton, ActivityEditButton, type ActivityLinks } from "../activity-form";

/** Notes commerciales (02.03.02) : besoins, objections, préférences. Écrites dans Twenty. */
export function NotesSection({
  companyNotes,
  notes,
  links,
  members,
  canLog,
}: {
  /** Texte libre de la fiche, modifié avec son identité. */
  companyNotes: string | null;
  notes: readonly ActivitySummary[];
  links: ActivityLinks;
  members: readonly MemberOption[];
  canLog: boolean;
}) {
  return (
    <Tile
      icon="edit"
      title="Notes"
      aside={
        canLog ? (
          <ActivityAddButton
            links={links}
            members={members}
            defaultKind="note"
            kinds={["note"]}
            label="Ajouter"
            title="Nouvelle note"
          />
        ) : null
      }
      className="rounded-lg p-6"
    >
      {companyNotes ? (
        <p className="text-sm whitespace-pre-line text-text">{companyNotes}</p>
      ) : null}
      {notes.length === 0 && !companyNotes ? (
        <p className="text-sm text-muted">Aucune note.</p>
      ) : null}
      {notes.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <li key={note.id} className="flex flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-medium text-text">{note.subject}</p>
                {canLog ? (
                  <ActivityEditButton
                    members={members}
                    activity={{
                      id: note.id,
                      kind: note.kind,
                      subject: note.subject,
                      body: note.body,
                      dueOn: null,
                      ownerMemberId: note.ownerMemberId,
                    }}
                  />
                ) : null}
              </div>
              {note.body ? (
                <p className="text-sm whitespace-pre-line text-muted">{note.body}</p>
              ) : null}
              <p className="font-mono text-amount-compact text-muted">
                {[formatDateShort(note.occurredAt), note.ownerName].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </Tile>
  );
}
