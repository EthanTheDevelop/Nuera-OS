import type { IconName } from "@/components/ui/icon";
import { documentLinkLabel } from "@/modules/documents/document.format";
import { searchDocuments } from "@/modules/documents/document.service";
import { resolveProjectScope } from "@/modules/projects/project.access";
import { getMemberIdForUser } from "@/modules/team/team.lookup";
import { can, canAny } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { logger } from "@/server/logger";
import { parseInput } from "@/server/validation";
import { SEARCH_MIN_LENGTH, searchQuerySchema } from "./dashboard.schema";
import * as repository from "./search.repository";

export interface SearchItem {
  id: string;
  label: string;
  detail?: string;
  href: string;
  icon: IconName;
}

export interface SearchGroup {
  label: string;
  items: SearchItem[];
}

const LIMIT_PER_SOURCE = 5;

type Source = {
  label: string;
  icon: IconName;
  href: (row: repository.SearchRow) => string;
  read: (pattern: string) => Promise<repository.SearchRow[]>;
};

/**
 * Recherche globale (⌘K). Chaque source vérifie son droit, le périmètre d'un prestataire s'applique
 * dans la requête, chaque source plafonne à 5 lignes. Une source qui échoue n'efface pas les autres.
 * Les documents passent par le service du module : factures réservées à `finance:read` comprises.
 */
export async function globalSearch(ctx: ServiceContext, rawQuery: unknown): Promise<SearchGroup[]> {
  const query = parseInput(searchQuerySchema, rawQuery);
  // Que de la ponctuation : rien à chercher, et le plein texte des documents lèverait son filtre.
  if (query.length < SEARCH_MIN_LENGTH || !/[\p{L}\p{N}]/u.test(query)) return [];
  const { actor, db } = ctx;
  const sources: Source[] = [];

  if (can(actor, "crm:read")) {
    sources.push(
      {
        label: "Clients",
        icon: "clients",
        href: ({ id }) => `/clients/${id}`,
        read: (pattern) => repository.searchCompanies(db, pattern, LIMIT_PER_SOURCE),
      },
      {
        label: "Contacts",
        icon: "clients",
        href: ({ id }) => `/clients/contacts/${id}`,
        read: (pattern) => repository.searchContacts(db, pattern, LIMIT_PER_SOURCE),
      },
    );
  }
  if (can(actor, "sales:read")) {
    sources.push({
      label: "Affaires",
      icon: "pipeline",
      href: ({ id }) => `/pipeline/${id}`,
      read: (pattern) => repository.searchOpportunities(db, pattern, LIMIT_PER_SOURCE),
    });
  }
  if (can(actor, "quotes:read")) {
    sources.push({
      label: "Devis",
      icon: "devis",
      href: ({ id }) => `/devis/${id}`,
      read: (pattern) => repository.searchQuotes(db, pattern, LIMIT_PER_SOURCE),
    });
  }
  if (canAny(actor, ["projects:read", "projects:read_assigned"])) {
    const scope = await resolveProjectScope(ctx);
    sources.push({
      label: "Projets",
      icon: "projets",
      href: ({ id }) => `/projets/${id}`,
      read: (pattern) => repository.searchProjects(db, pattern, LIMIT_PER_SOURCE, scope),
    });
    if (canAny(actor, ["tasks:read", "tasks:read_assigned"])) {
      sources.push({
        label: "Tâches",
        icon: "check",
        href: ({ id, parentId }) => `/projets/${parentId}?tache=${id}`,
        read: (pattern) => repository.searchTasks(db, pattern, LIMIT_PER_SOURCE, scope),
      });
    }
  }
  if (can(actor, "sites:read")) {
    sources.push({
      label: "Sites",
      icon: "sites",
      href: ({ id }) => `/sites/${id}`,
      read: (pattern) => repository.searchSites(db, pattern, LIMIT_PER_SOURCE),
    });
  }
  if (can(actor, "contracts:read")) {
    sources.push({
      label: "Contrats",
      icon: "contrat",
      href: ({ id }) => `/contrats/${id}`,
      read: (pattern) => repository.searchContracts(db, pattern, LIMIT_PER_SOURCE),
    });
  }
  if (canAny(actor, ["support:read", "support:read_assigned"])) {
    const assignedOnly = !can(actor, "support:read");
    const assigneeMemberId = assignedOnly ? await getMemberIdForUser(db, actor.userId) : null;
    sources.push({
      label: "Demandes",
      icon: "support",
      href: ({ id }) => `/support/${id}`,
      read: (pattern) =>
        repository.searchTickets(db, pattern, LIMIT_PER_SOURCE, { assignedOnly, assigneeMemberId }),
    });
  }
  if (canAny(actor, ["documents:read", "documents:read_assigned"])) {
    sources.push({
      label: "Documents",
      icon: "book",
      href: ({ id }) => `/documents/${id}`,
      read: async () => {
        const page = await searchDocuments(
          ctx,
          { search: query },
          { page: 1, pageSize: LIMIT_PER_SOURCE },
        );
        return page.items.map((row) => ({
          id: row.id,
          label: row.title,
          detail: documentLinkLabel(row),
        }));
      },
    });
  }

  const pattern = repository.likePattern(query);
  const results = await Promise.allSettled(sources.map((source) => source.read(pattern)));
  return sources.flatMap((source, index) => {
    const result = results[index];
    if (!result || result.status === "rejected") {
      logger.error("search.source_failed", { source: source.label, error: result?.reason });
      return [];
    }
    if (result.value.length === 0) return [];
    return [
      {
        label: source.label,
        items: result.value.map((row) => ({
          id: `${source.label}-${row.id}`,
          label: row.label,
          detail: row.detail ?? undefined,
          href: source.href(row),
          icon: source.icon,
        })),
      },
    ];
  });
}
