import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { InfoCard } from "@/components/ui/info-card";
import { OFFER_ACTIVITY_LABELS, TEMPLATE_KIND_LABELS } from "@/lib/domain-enums";
import { formatDate } from "@/lib/format";
import {
  CopyTextButton,
  TemplateHeaderActions,
} from "@/modules/documents/components/knowledge-controls";
import { getTemplate } from "@/modules/documents/template.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

async function loadTemplate(ctx: Awaited<ReturnType<typeof getServiceContext>>, id: string) {
  try {
    return await getTemplate(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "knowledge:read")) return <ForbiddenState />;

  const { id } = await params;
  const template = await loadTemplate(ctx, id);
  const activity = template.activity
    ? OFFER_ACTIVITY_LABELS[template.activity]
    : "Toutes les prestations";

  return (
    <>
      <PageHeader
        title={template.name}
        subtitle={`${TEMPLATE_KIND_LABELS[template.kind]} · ${activity} · modifié le ${formatDate(template.updatedAt)}`}
        breadcrumbs={[
          { label: "Documents", href: "/documents" },
          { label: "Modèles", href: "/documents/modeles" },
          { label: template.name },
        ]}
        badges={template.active ? undefined : <Badge>Désactivé</Badge>}
        actions={
          can(ctx.actor, "knowledge:manage") ? (
            <TemplateHeaderActions template={template} />
          ) : undefined
        }
      />

      <div className="max-w-[728px]">
        <InfoCard
          icon={template.kind === "checklist" ? "check" : "edit"}
          title={TEMPLATE_KIND_LABELS[template.kind]}
          aside={template.body ? <CopyTextButton text={template.body} /> : undefined}
          className="h-fit"
        >
          {template.body ? (
            <p className="text-sm leading-[1.6] break-words whitespace-pre-wrap text-text">
              {template.body}
            </p>
          ) : null}
          {template.items.length > 0 ? (
            <ul className="flex flex-col gap-2.5">
              {template.items.map((item, index) => (
                <li key={`${index}-${item}`} className="flex items-start gap-2 text-sm text-text">
                  <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0 break-words">{item}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </InfoCard>
      </div>
    </>
  );
}
