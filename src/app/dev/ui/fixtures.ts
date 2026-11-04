/**
 * Données FICTIVES de la galerie `/dev/ui`, reprises des maquettes. Ne jamais importer ailleurs :
 * aucun composant livré ne dépend de ce fichier.
 */
import type { ChartPoint } from "@/components/charts/chart-shell";
import type { UptimeDay } from "@/components/charts/uptime-bars";
import type { CommandGroup } from "@/components/layout/command-palette";
import type { NotificationEntry } from "@/components/layout/notifications";
import type { ActivityEntry } from "@/components/ui/activity-list";
import type { MentionCandidate, ThreadComment } from "@/components/ui/comment-thread";
import type { KanbanColumnDef } from "@/components/ui/kanban";
import type { TimelineStep } from "@/components/ui/step-timeline";

export const PEOPLE = [{ name: "Ethan Ngo" }, { name: "Nezar Zakaria" }];

export const USER = { name: "Nezar Zakaria", email: "nezar@nuera.studio", roleLabel: "Associé" };

export const COUNTERS = { messages: 4, support: 2 } as const;

export const NOTIFICATIONS: NotificationEntry[] = [
  {
    id: "1",
    title: "Devis signé",
    body: "Atelier Lune · Vitrine",
    severity: "info",
    date: "2 h",
    href: "/dev/ui",
    unread: true,
  },
  {
    id: "2",
    title: "Site injoignable",
    body: "kine-rive-gauche.fr, 4 min",
    severity: "danger",
    date: "hier",
    unread: true,
  },
  { id: "3", title: "Contenus attendus à J+3", severity: "warning", date: "lun." },
];

export const MONTHS: ChartPoint[] = [
  { label: "Juin", tooltipLabel: "JUIN 2026" },
  { label: "Juil.", tooltipLabel: "JUIL. 2026" },
  { label: "Août", tooltipLabel: "AOÛT 2026" },
  { label: "Sept.", tooltipLabel: "SEPT. 2026" },
  {
    label: "Oct.",
    tooltipLabel: "OCT. 2026",
    note: "+1 300 € vs sept. · accompagnement signé",
    noteTone: "success",
  },
  { label: "Nov.", tooltipLabel: "NOV. 2026" },
];

export const REVENUE = {
  projects: [3900, 6100, 7600, 8600, 9100, 10350],
  recurring: [150, 150, 200, 500, 1000, 1349],
};

export const COMPARED = {
  current: { label: "2026", values: [4050, 6250, 7800, 9100, 10100, 11700] },
  previous: { label: "2025 · même période", values: [3100, 4100, 6200, 5900, 7400, 8200] },
};

export const MRR = [49, 49, 98, 98, 1349, 1349];
export const MARGIN = [52, 52, 58, 61, 61, 63];
export const WON = [1, 2, 1, 3, 2, 3];
export const LOST = [1, 0, 2, 1, 1, 0];

export const UPTIME: UptimeDay[] = Array.from({ length: 30 }, (_, index) => ({
  label: `${index + 1}`,
  tooltipLabel: `${index + 1} OCT. 2026`,
  state: index === 11 ? "slow" : "up",
  ratio: index === 11 ? 99.6 : 100,
  note: index === 11 ? "Lenteur de 4 min" : undefined,
  noteTone: index === 11 ? "warn" : undefined,
}));

const client = (
  id: string,
  name: string,
  contact: string,
  status: string,
  project: string,
  amount: string,
  source: string,
  owner: string,
) => ({ id, name, contact, status, project, amount, source, owner });

export const CLIENTS = [
  client(
    "al",
    "Atelier Lune",
    "Claire Martin · fleuriste",
    "client",
    "Vitrine",
    "7 800 €",
    "Réseau",
    "EN",
  ),
  client(
    "kr",
    "Kiné Rive Gauche",
    "Karim Benali",
    "client",
    "Vitrine",
    "7 800 €",
    "Prescripteur",
    "NZ",
  ),
  client(
    "bp",
    "Bistrot du Port",
    "Sophie Bernard",
    "subscriber",
    "Accompagnement",
    "1 300 €/mois",
    "Réseau",
    "EN",
  ),
  client(
    "rc",
    "Roux Conseil",
    "Nathalie Roux",
    "quote_sent",
    "Landing",
    "2 600 €",
    "Mini-audit",
    "NZ",
  ),
  client(
    "md",
    "Menuiserie Dupré",
    "Julien Dupré",
    "prospect",
    "Vitrine + multilingue",
    "9 750 €",
    "Réseau",
    "NZ",
  ),
  client(
    "bl",
    "Boulangerie Lefèvre",
    "Marc Lefèvre",
    "prospect",
    "Landing",
    "2 600 €",
    "Mini-audit",
    "EN",
  ),
  client("gm", "Garage Martin", "Paul Martin", "prospect", "Reprise", "3 250 €", "Site", "NZ"),
  client(
    "cm",
    "Cabinet Morel",
    "Inès Morel",
    "prospect",
    "Audit de l’existant",
    "5 200 €",
    "Prescripteur",
    "EN",
  ),
];

export type ClientRow = (typeof CLIENTS)[number];

export const TASKS = [
  {
    id: "t1",
    title: "Intégrer la page Galerie",
    owner: "Ethan",
    due: "10 nov.",
    dep: "Photos client",
    status: "blocked",
  },
  {
    id: "t2",
    title: "Rédiger les textes SEO",
    owner: "Nezar",
    due: "8 nov.",
    dep: "—",
    status: "in_progress",
  },
  {
    id: "t3",
    title: "Configurer Payload (CMS)",
    owner: "Nezar",
    due: "9 nov.",
    dep: "—",
    status: "done",
  },
  {
    id: "t4",
    title: "Page Contact et formulaire",
    owner: "Ethan",
    due: "11 nov.",
    dep: "—",
    status: "todo",
  },
  {
    id: "t5",
    title: "Recette mobile",
    owner: "Ethan",
    due: "14 nov.",
    dep: "Développement",
    status: "todo",
  },
];

export type TaskRow = (typeof TASKS)[number];

export const MILESTONES: TimelineStep[] = [
  { id: "1", title: "Cadrage", detail: "15 oct. · fait", state: "done" },
  { id: "2", title: "Design", detail: "31 oct. · fait", state: "done" },
  { id: "3", title: "Développement", detail: "10 nov. · en cours", state: "current" },
  { id: "4", title: "Recette", detail: "14 nov. · à venir", state: "todo" },
  { id: "5", title: "Mise en ligne", detail: "18 nov. · à venir", state: "todo" },
];

export const CLIENT_STEPS: TimelineStep[] = [
  { id: "1", title: "On se rencontre", detail: "Fait le 15 oct.", state: "done" },
  { id: "2", title: "On démarre le projet", detail: "En cours · maquettes", state: "current" },
  { id: "3", title: "Retours et ajustements", detail: "À partir du 10 nov.", state: "todo" },
  { id: "4", title: "Livraison et suivi", detail: "Mise en ligne le 18 nov.", state: "todo" },
];

export const KANBAN_COLUMNS: KanbanColumnDef[] = [
  { id: "new", title: "Nouveau", tone: "accent", addHref: "/dev/ui#kanban", addLabel: "Ajouter" },
  {
    id: "qualified",
    title: "Qualifié",
    tone: "accent",
    addHref: "/dev/ui#kanban",
    addLabel: "Ajouter",
  },
  { id: "quote", title: "Devis envoyé", tone: "warn" },
  { id: "won", title: "Gagné", tone: "success" },
];

const deal = (
  id: string,
  columnId: string,
  name: string,
  offer: string,
  amount: string,
  owner: string,
  source: string,
  delay: string,
) => ({ id, columnId, client: name, offer, amount, owner, source, delay });

export const KANBAN_CARDS = [
  deal("c1", "new", "Menuiserie Dupré", "Vitrine", "7 800 €", "Nezar Zakaria", "Réseau", "3 j"),
  deal("c2", "new", "Boulangerie Lefèvre", "Landing", "2 600 €", "Ethan Ngo", "Mini-audit", "5 j"),
  deal("c3", "qualified", "Garage Martin", "Reprise", "3 250 €", "Nezar Zakaria", "Site", "1 j"),
  deal(
    "c4",
    "quote",
    "Roux Conseil",
    "Landing",
    "2 600 €",
    "Nezar Zakaria",
    "Mini-audit",
    "Relance J+3",
  ),
  deal("c5", "won", "Atelier Lune", "Vitrine", "7 800 €", "Ethan Ngo", "Réseau", "Acompte payé"),
];

export const ACTIVITY: ActivityEntry[] = [
  {
    id: "1",
    date: "31 oct.",
    title: "Maquette validée",
    detail: "Accueil, version 2",
    actor: "Claire Martin",
  },
  { id: "2", date: "24 oct.", title: "Acompte encaissé", detail: "2 340 € HT · 2 factures" },
  { id: "3", date: "15 oct.", title: "Devis signé", detail: "D-2026-014 · DocuSeal" },
];

export const MEMBERS: MentionCandidate[] = [
  { id: "ethan", name: "Ethan", initials: "EN", detail: "design et front-end" },
  { id: "nezar", name: "Nezar", initials: "NZ", detail: "business et technique" },
];

export const COMMENTS: ThreadComment[] = [
  {
    id: "1",
    author: "Nezar",
    authorInitials: "NZ",
    date: "hier 17:40",
    body: "J’ai relancé Atelier Lune pour les photos des compositions. Réponse promise jeudi.",
  },
  {
    id: "2",
    author: "Ethan",
    authorInitials: "EN",
    date: "il y a 2 h",
    isReply: true,
    body: "@Nezar je prépare la grille en attendant les photos. Tu peux valider la maquette de la galerie ?",
    attachment: { name: "galerie-grille-v2.fig", detail: "2,4 Mo" },
  },
];

export const SEARCH_RESULTS: CommandGroup[] = [
  {
    label: "Clients",
    items: [
      { id: "al", label: "Atelier Lune", detail: "Client", href: "/dev/ui", icon: "clients" },
      { id: "bp", label: "Bistrot du Port", detail: "Abonné", href: "/dev/ui", icon: "clients" },
    ],
  },
  {
    label: "Projets",
    items: [
      {
        id: "p7",
        label: "Site vitrine · Atelier Lune",
        detail: "P-2026-007",
        href: "/dev/ui",
        icon: "projets",
      },
    ],
  },
];

export const LONG_TABLE_TOTAL = 281;
