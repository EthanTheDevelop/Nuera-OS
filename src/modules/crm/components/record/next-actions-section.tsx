import Link from "next/link";
import { Tile } from "@/components/ui/tile";
import { daysFromNow, formatDateShort } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { MemberOption } from "@/modules/team/team.lookup";
import type { OpportunityView } from "@/modules/sales/opportunity.service";
import type { ActivitySummary } from "../../activity.service";
import {
  ActivityAddButton,
  ActivityEditButton,
  CompleteTaskButton,
  type ActivityLinks,
} from "../activity-form";

function dueClass(date: Date | string | null) {
  const inDays = date ? daysFromNow(date) : null;
  return cn("text-xs", inDays !== null && inDays <= 0 ? "text-warn" : "text-muted");
}

/** Prochaines actions (02.03.03) : tâches ouvertes du client et relances de ses affaires. */
export function NextActionsSection({
  tasks,
  opportunities,
  links,
  members,
  canLog,
}: {
  tasks: readonly ActivitySummary[];
  opportunities: readonly OpportunityView[];
  links: ActivityLinks;
  members: readonly MemberOption[];
  canLog: boolean;
}) {
  const followUps = opportunities.filter(
    (opportunity) =>
      opportunity.nextAction && opportunity.stage !== "WON" && opportunity.stage !== "LOST",
  );
  const empty = tasks.length === 0 && followUps.length === 0;

  return (
    <Tile
      icon="flag"
      title="Prochaines actions"
      aside={
        canLog ? (
          <ActivityAddButton
            links={links}
            members={members}
            defaultKind="task"
            kinds={["task"]}
            label="Ajouter"
            title="Nouvelle tâche"
          />
        ) : null
      }
      className="rounded-lg p-6"
    >
      {empty ? (
        <p className="text-sm text-muted">Rien de prévu pour ce client.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
            >
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate text-sm font-medium text-text">{task.subject}</span>
                <span className={cn("block", dueClass(task.dueAt))}>
                  {[
                    task.dueAt ? `Pour le ${formatDateShort(task.dueAt)}` : "Sans date",
                    task.ownerName,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {canLog ? (
                <span className="flex items-center gap-3">
                  <ActivityEditButton
                    members={members}
                    activity={{
                      id: task.id,
                      kind: task.kind,
                      subject: task.subject,
                      body: task.body,
                      dueOn: task.dueAt ? task.dueAt.toISOString().slice(0, 10) : null,
                      ownerMemberId: task.ownerMemberId,
                    }}
                  />
                  <CompleteTaskButton activityId={task.id} />
                </span>
              ) : null}
            </li>
          ))}
          {followUps.map((opportunity) => (
            <li key={opportunity.id} className="min-w-0">
              <Link
                href={`/pipeline/${opportunity.id}`}
                className="hit-44 block truncate text-sm font-medium text-text hover:underline hover:underline-offset-4"
              >
                {opportunity.nextAction}
              </Link>
              <span className={cn("block", dueClass(opportunity.nextActionOn))}>
                {[
                  opportunity.nextActionOn
                    ? `Pour le ${formatDateShort(opportunity.nextActionOn)}`
                    : "Sans date",
                  opportunity.name,
                  opportunity.ownerName,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}
