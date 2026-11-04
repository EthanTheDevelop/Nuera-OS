import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/feedback";
import { InfoCard } from "@/components/ui/info-card";
import { KNOWLEDGE_KIND_LABELS } from "@/lib/domain-enums";
import { formatDateShort } from "@/lib/format";
import {
  ArticleHeaderActions,
  RestoreVersionButton,
} from "@/modules/documents/components/knowledge-controls";
import { firstName } from "@/modules/documents/document.format";
import { getKnowledgeArticle } from "@/modules/documents/knowledge.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

async function loadArticle(ctx: Awaited<ReturnType<typeof getServiceContext>>, id: string) {
  try {
    return await getKnowledgeArticle(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export default async function ArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "knowledge:read")) return <ForbiddenState />;

  const { id } = await params;
  const { article, versions } = await loadArticle(ctx, id);
  const canManage = can(ctx.actor, "knowledge:manage");
  const archived = Boolean(article.archivedAt);

  const requested = Number((await searchParams).version);
  const viewed = versions.find((version) => version.version === requested);
  const isOldVersion = viewed !== undefined && viewed.version !== article.version;
  const body = isOldVersion ? viewed.body : article.body;

  return (
    <>
      <PageHeader
        title={article.title}
        subtitle={`${KNOWLEDGE_KIND_LABELS[article.kind]} · ${firstName(article.authorName)} · version ${article.version}`}
        breadcrumbs={[
          { label: "Documents", href: "/documents" },
          { label: "Connaissances", href: "/documents/connaissances" },
          { label: article.title },
        ]}
        badges={archived ? <Badge tone="warn">Archivé</Badge> : undefined}
        actions={canManage ? <ArticleHeaderActions article={article} /> : undefined}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,728fr)_minmax(0,380fr)]">
        <InfoCard
          icon="book"
          title={isOldVersion ? `Contenu · version ${viewed.version}` : "Contenu"}
          className="h-fit"
        >
          {isOldVersion ? (
            <Alert tone="warn">
              Ancienne version.{" "}
              <Link href={`/documents/connaissances/${article.id}`} className="underline">
                Revenir à la version {article.version}
              </Link>
              .
            </Alert>
          ) : null}
          <p className="text-sm leading-[1.6] break-words whitespace-pre-wrap text-text">{body}</p>
          {isOldVersion && canManage && !archived ? (
            <div>
              <RestoreVersionButton articleId={article.id} version={viewed.version} />
            </div>
          ) : null}
        </InfoCard>

        <div className="flex min-w-0 flex-col gap-6">
          {article.projectId || article.siteId ? (
            <InfoCard
              icon="link"
              title="Rattachement"
              className="h-fit"
              rows={[
                ...(article.projectId
                  ? [
                      {
                        key: "projet",
                        label: "Projet",
                        value: (
                          <Link
                            href={`/projets/${article.projectId}`}
                            className="text-accent hover:underline"
                          >
                            {article.projectNumber}
                          </Link>
                        ),
                      },
                    ]
                  : []),
                ...(article.siteId
                  ? [
                      {
                        key: "site",
                        label: "Site",
                        value: (
                          <Link
                            href={`/sites/${article.siteId}`}
                            className="text-accent hover:underline"
                          >
                            {article.siteName}
                          </Link>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          ) : null}
          <InfoCard
            icon="clock"
            title="Historique"
            className="h-fit"
            rows={versions.map((version) => ({
              key: version.id,
              label: (
                <Link
                  href={`/documents/connaissances/${article.id}?version=${version.version}`}
                  className="text-accent hover:underline"
                >
                  v{version.version}
                  {version.version === article.version ? " · référence" : ""}
                </Link>
              ),
              value: `${formatDateShort(version.at)} · ${firstName(version.authorName)}`,
            }))}
          />
        </div>
      </div>
    </>
  );
}
