import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonExternalLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { CMS_KIND_LABELS, SITE_KIND_LABELS } from "@/lib/domain-enums";
import { formatPercent, formatRelativeTime } from "@/lib/format";
import { isStale, SAMPLE_STALE_AFTER_MS, siteHealthBadge } from "../site.health";
import type { SiteSummary } from "../site.service";

function siteUrl(site: SiteSummary): string | null {
  if (site.productionUrl) return site.productionUrl;
  if (site.stagingUrl) return site.stagingUrl;
  return site.primaryDomain ? `https://${site.primaryDomain}` : null;
}

export function uptimeLabel(site: SiteSummary, now: Date): string {
  if (site.uptimeRatio === null) return "—";
  const value = formatPercent(site.uptimeRatio * 100, 2);
  return isStale(site.lastSampleAt, now, SAMPLE_STALE_AFTER_MS)
    ? `${value} · ${formatRelativeTime(site.lastSampleAt, now)}`
    : value;
}

/** Carte de l'écran 10. Sans capture réelle, pas de bandeau d'aperçu : le domaine est le titre. */
export function SiteCard({ site, now }: { site: SiteSummary; now: Date }) {
  const label = site.primaryDomain ?? site.name;
  const badge = siteHealthBadge(site, now);
  const url = siteUrl(site);
  const details = [
    site.companyName,
    site.cmsKind && site.cmsKind !== "none"
      ? CMS_KIND_LABELS[site.cmsKind]
      : site.kind
        ? SITE_KIND_LABELS[site.kind]
        : null,
  ].filter(Boolean);

  return (
    <article className="anim-content relative flex min-w-0 flex-col gap-4 rounded-xl bg-surface p-6 shadow-soft transition-shadow duration-(--dur-fast) hover:shadow-float">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-ink">
            <Link
              href={`/sites/${site.id}`}
              className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
            >
              {label}
            </Link>
          </h2>
          <p className="truncate text-row-secondary text-muted">{details.join(" · ")}</p>
        </div>
        <Badge tone={badge.tone} className="shrink-0">
          {badge.label}
        </Badge>
      </div>
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-row-secondary text-muted">
        <span className="flex items-center gap-2">
          <Icon name="server" size={14} />
          Disponibilité {uptimeLabel(site, now)}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <Icon name="link" size={14} />
          <span className="truncate">
            {site.hostedByNuera
              ? (site.hostingLabel ?? "Hébergé par nous")
              : (site.hostingLabel ?? "Hébergement externe")}
          </span>
        </span>
      </p>
      {site.cmsAdminUrl || url ? (
        <div className="relative z-10 mt-auto flex flex-wrap gap-2 pt-1">
          {site.cmsAdminUrl ? (
            <ButtonExternalLink href={site.cmsAdminUrl}>Ouvrir le CMS</ButtonExternalLink>
          ) : null}
          {url ? <ButtonExternalLink href={url}>Voir le site</ButtonExternalLink> : null}
        </div>
      ) : null}
    </article>
  );
}
