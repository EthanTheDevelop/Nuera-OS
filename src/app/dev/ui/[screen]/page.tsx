import { notFound } from "next/navigation";
import { StackedBars } from "@/components/charts/stacked-bars";
import { NotificationBell } from "@/components/layout/notifications";
import { PageHeader } from "@/components/layout/page-header";
import { ClientMotionPreset } from "@/components/motion/motion-provider";
import { RollingNumber } from "@/components/motion/rolling-number";
import { ClientCapsule } from "@/components/portal/ClientCapsule";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { Gauge } from "@/components/ui/gauge";
import { Icon } from "@/components/ui/icon";
import { InfoCard } from "@/components/ui/info-card";
import { StepTimeline } from "@/components/ui/step-timeline";
import { AddTile, Tile, TileFigure, TileGrid, TileResizeHandle } from "@/components/ui/tile";
import { SiteHealthModal, TaskModal } from "../demos";
import {
  CLIENT_STEPS,
  CLIENTS,
  MILESTONES,
  MONTHS,
  NOTIFICATIONS,
  REVENUE,
  TASKS,
  type ClientRow,
  type TaskRow,
} from "../fixtures";
import { DevShell } from "../shell";

const EUR = { style: "currency", currency: "EUR", maximumFractionDigits: 0 } as const;

const CLIENT_COLUMNS: DataTableColumn<ClientRow>[] = [
  {
    key: "client",
    header: "CLIENT",
    cell: (row) => <CellIdentity name={row.name} title={row.name} subtitle={row.contact} />,
  },
  {
    key: "statut",
    header: "STATUT",
    width: 156,
    cell: (row) => (
      <StatusBadge
        kind={row.status === "quote_sent" ? "opportunity" : "company"}
        status={row.status}
      />
    ),
  },
  { key: "projet", header: "PROJET", width: 186, cell: (row) => row.project },
  { key: "montant", header: "MONTANT", width: 146, cell: (row) => row.amount },
  {
    key: "origine",
    header: "ORIGINE",
    width: 136,
    hideWhenCollapsed: true,
    cell: (row) => row.source,
  },
  {
    key: "associe",
    header: "ASSOCIÉ",
    width: 100,
    hideWhenCollapsed: true,
    cell: (row) => row.owner,
  },
];

const TASK_COLUMNS: DataTableColumn<TaskRow>[] = [
  {
    key: "task",
    header: "TÂCHE",
    cell: (row) => <span className="text-row-primary text-ink">{row.title}</span>,
  },
  {
    key: "owner",
    header: "RESPONSABLE",
    width: 126,
    cell: (row) => (
      <span className="flex items-center gap-2 text-text">
        <Avatar name={row.owner === "Ethan" ? "Ethan Ngo" : "Nezar Zakaria"} size={24} />
        {row.owner}
      </span>
    ),
  },
  { key: "due", header: "ÉCHÉANCE", width: 116, cell: (row) => row.due },
  { key: "dep", header: "DÉPEND DE", width: 136, hideWhenCollapsed: true, cell: (row) => row.dep },
  {
    key: "status",
    header: "STATUT",
    width: 150,
    cell: (row) => <StatusBadge kind="task" status={row.status} />,
  },
];

function ClientsScreen() {
  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="12 clients · 4 prospects actifs · 3 abonnés"
        actions={
          <>
            <Button>Importer</Button>
            <Button variant="accent">+ Nouveau client</Button>
          </>
        }
      >
        <FilterBar searchParam="q">
          <FilterChip param="filtre">Tous</FilterChip>
          <FilterChip param="filtre" value="clients">
            Clients
          </FilterChip>
          <FilterChip param="filtre" value="prospects">
            Prospects
          </FilterChip>
          <FilterChip param="filtre" value="abonnes">
            Abonnés
          </FilterChip>
          <FilterChip param="filtre" value="anciens">
            Anciens
          </FilterChip>
        </FilterBar>
      </PageHeader>
      <DataTable
        caption="Clients"
        columns={CLIENT_COLUMNS}
        rows={CLIENTS}
        rowKey={(row) => row.id}
        rowHref={() => "/dev/ui/projet"}
        rowHeight="lg"
      />
    </>
  );
}

function ProjectScreen({ modal }: { modal?: "tache" | "sante" }) {
  return (
    <>
      <PageHeader
        title="Atelier Lune · Site vitrine"
        subtitle="Projet P-2026-007 · 7 800 € HT · Ethan et Nezar · mise en ligne prévue le 18 nov."
        actions={
          <>
            <Button>Ouvrir l’espace client</Button>
            <Button variant="accent">Ajouter une tâche</Button>
          </>
        }
        badges={
          <>
            <Badge tone="accent">En cours</Badge>
            <Badge tone="warn">Bloqué · contenus attendus</Badge>
            <Badge>Offre D-2026-014 acceptée</Badge>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        <InfoCard
          icon="flag"
          title="Jalons"
          aside={<span className="text-xs text-muted">5 étapes</span>}
        >
          <StepTimeline steps={MILESTONES} label="Jalons du projet" />
        </InfoCard>
        <div className="grid gap-5 xl:grid-cols-[748px_minmax(0,1fr)]">
          <DataTable
            caption="Tâches"
            columns={TASK_COLUMNS}
            rows={TASKS}
            rowKey={(row) => row.id}
            rowHref={() => "/dev/ui/tache"}
          />
          <div className="flex flex-col gap-5">
            <InfoCard
              icon="clock"
              title="Prévu et réalisé"
              rows={[
                { label: "Journées vendues", value: "12 j" },
                { label: "Journées passées", value: "5,5 j" },
                { label: "Prévu à date", value: "5 j" },
              ]}
            >
              <Gauge value={46} height={8} label="Avancement" />
              <p className="text-xs text-warn">
                +0,5 j sur le design : un tour de retours en plus.
              </p>
            </InfoCard>
            <InfoCard icon="alert" title="Blocage" aside={<Badge tone="warn">2 jours</Badge>}>
              <p className="text-sm font-semibold text-ink">Photos des compositions non reçues</p>
              <p className="text-sm leading-[1.45] text-muted">
                Conséquence : la galerie et la recette décalent de 2 jours. Décision : mise en ligne
                repoussée au 20 nov., client prévenu.
              </p>
            </InfoCard>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <TaskModal defaultOpen={modal === "tache"} />
        <SiteHealthModal defaultOpen={modal === "sante"} />
      </div>
    </>
  );
}

const PIPELINE_ROWS = [
  { label: "Prospect", amount: "46 800 €", count: 6, ratio: 100, tone: "accent" },
  { label: "Appel fait", amount: "", count: 4, ratio: 67, tone: "accent" },
  { label: "Devis envoyé", amount: "23 400 €", count: 3, ratio: 50, tone: "accent" },
  { label: "Signé", amount: "15 600 €", count: 2, ratio: 33, tone: "success" },
  { label: "En cours", amount: "", count: 2, ratio: 33, tone: "accent" },
  { label: "Livré", amount: "", count: 1, ratio: 17, tone: "accent" },
  { label: "Abonné", amount: "MRR", count: 3, ratio: 50, tone: "success" },
] as const;

function DashboardScreen() {
  return (
    <>
      <PageHeader
        title="Bonjour Nezar"
        subtitle="Mardi 3 novembre 2026 · l’agence aujourd’hui"
        bell={<NotificationBell items={NOTIFICATIONS} />}
        actions={
          <>
            <Button>Modifier le tableau</Button>
            <Button variant="accent">+ Nouvelle affaire</Button>
          </>
        }
      />
      <TileGrid>
        <Tile
          icon="euro"
          title="Chiffre d’affaires"
          size="4x2"
          aside={<Badge tone="success">+12 % vs octobre</Badge>}
          handle={<TileResizeHandle tileName="Chiffre d’affaires" />}
        >
          <p className="mt-5 text-figure-hero text-ink">
            <RollingNumber value={11700} format={EUR} suffix=" HT" />
          </p>
          <StackedBars
            title="Chiffre d’affaires par mois"
            header={<p className="text-sm text-muted">Novembre 2026 · encaissé et à encaisser</p>}
            points={MONTHS}
            series={[
              { key: "projects", label: "Projets", values: REVENUE.projects },
              { key: "recurring", label: "Récurrent", values: REVENUE.recurring },
            ]}
            valueFormat={{ format: EUR }}
            height={148}
            className="-mt-2.5"
          />
        </Tile>
        <Tile
          icon="pipeline"
          title="Pipeline"
          size="2x2"
          aside={<Badge tone="accent">21 affaires</Badge>}
          handle={<TileResizeHandle tileName="Pipeline" />}
        >
          <div className="flex flex-col gap-2.5">
            {PIPELINE_ROWS.map((row, index) => (
              <div key={row.label} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2 text-sm text-text">
                  <span className="min-w-0 flex-1">{row.label}</span>
                  <span className="font-mono text-amount-compact text-muted">{row.amount}</span>
                  <span className="font-mono text-counter">{row.count}</span>
                </div>
                <Gauge value={row.ratio} tone={row.tone} label={row.label} index={index} />
              </div>
            ))}
          </div>
        </Tile>
        <Tile
          icon="clock"
          title="Charge du mois"
          size="2x1"
          aside={<Badge tone="warn">78 %</Badge>}
          handle={<TileResizeHandle tileName="Charge du mois" />}
        >
          <TileFigure value="14 / 18" unit="journées vendues" className="mt-auto" />
          <Gauge value={78} height={8} label="Charge du mois" valueText="78 %" />
          <p className="text-xs text-muted">Nezar 10 / 14 · Ethan 4 / 4</p>
        </Tile>
        <Tile icon="euro" title="MRR" size="1x1" handle={<TileResizeHandle tileName="MRR" />}>
          <TileFigure
            value={<RollingNumber value={1349} format={EUR} />}
            note="1 accompagnement + 1 hébergement"
          />
        </Tile>
        <Tile
          icon="check"
          title="Encaissé"
          size="1x1"
          handle={<TileResizeHandle tileName="Encaissé" />}
        >
          <TileFigure
            value={<RollingNumber value={7020} format={EUR} />}
            note="2 340 € en attente"
            noteTone="warn"
          />
        </Tile>
        <Tile
          icon="clock"
          title="En retard"
          size="1x1"
          handle={<TileResizeHandle tileName="En retard" />}
        >
          <TileFigure value="1 projet" note="Contenus attendus · Atelier Lune" noteTone="danger" />
        </Tile>
        <Tile
          icon="link"
          title="Frais 50/50"
          size="1x1"
          handle={<TileResizeHandle tileName="Frais" />}
        >
          <TileFigure value="167 €" note="par mois · 83 € chacun" />
        </Tile>
        <Tile icon="support" title="Demandes" size="1x1">
          <TileFigure value="2" note="1 à valider · 1 en cours" />
        </Tile>
        <AddTile href="/dev/ui" label="Ajouter une tuile" />
      </TileGrid>
    </>
  );
}

function ClientScreen() {
  return (
    <ClientMotionPreset>
      <div className="min-h-dvh bg-bg">
        <ClientCapsule
          active="project"
          progress={{
            steps: ["done", "current", "todo", "todo"],
            label: "Maquettes",
            ariaLabel: "Avancement : étape 2 sur 4, maquettes, mise en ligne le 18 novembre",
            hint: "Mise en ligne le 18 novembre",
          }}
          nextAction={{ label: "À vous : déposer les photos", href: "/dev/ui" }}
          messagesCount={2}
          user={{ name: "Claire Martin", email: "claire@example.test" }}
        />
        <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-3 pb-12 sm:px-10">
          <div className="anim-content flex flex-wrap items-end justify-between gap-6 pt-4">
            <div>
              <h1 className="text-client-title text-text">Bonjour Claire</h1>
              <p className="mt-3 max-w-[640px] text-client-lead text-muted">
                Votre site vitrine Atelier Lune avance comme prévu. Nous dessinons les maquettes ;
                il nous manque encore vos photos pour la galerie.
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted">Mise en ligne prévue</p>
              <p className="mt-1 text-client-date text-text">18 novembre</p>
              <p className="mt-1 flex items-center justify-end gap-2 text-sm text-success">
                <span className="size-2 rounded-full bg-success" />
                Dans 15 jours · dans les temps
              </p>
            </div>
          </div>
          <section className="anim-content flex flex-col gap-6 rounded-xl border border-border bg-surface p-7">
            <div className="flex items-center gap-3">
              <h2 className="min-w-0 flex-1 text-client-card-title text-text">
                Le chemin de votre site
              </h2>
              <p className="text-sm font-medium text-muted">Étape 2 sur 4</p>
            </div>
            <StepTimeline steps={CLIENT_STEPS} variant="client" label="Le chemin de votre site" />
          </section>
          <section className="anim-content flex flex-col gap-4 rounded-xl border border-border bg-surface p-7">
            <h2 className="text-client-card-title text-text">À vous de jouer</h2>
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <span className="size-2.5 rounded-full bg-warn-on-dark" />
              <div className="min-w-0 flex-1">
                <p className="text-client-action-title text-text">Photos des compositions</p>
                <p className="text-client-action-detail text-warn">
                  À déposer avant le lundi 10 nov.
                </p>
              </div>
              <CompactButton icon="paperclip">Déposer les photos</CompactButton>
              <CompactButton variant="secondary" icon="edit">
                Compléter
              </CompactButton>
              <CompactButton variant="quiet" icon="edit">
                Déplacer
              </CompactButton>
            </div>
          </section>
          <p className="flex items-center gap-2 text-xs text-muted">
            <Icon name="check" size={14} />
            Préréglage client : fondu de 250 ms, pas de flou ni de compteur.
          </p>
        </div>
      </div>
    </ClientMotionPreset>
  );
}

const SCREENS = ["clients", "projet", "tableau", "tache", "sante", "client"] as const;
type Screen = (typeof SCREENS)[number];

/** Écrans de comparaison avec les PNG Figma, à 1440 px : mêmes données d'exemple. */
export default async function DevScreenPage({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { screen } = await params;
  if (!SCREENS.includes(screen as Screen)) notFound();

  if (screen === "client") return <ClientScreen />;
  return (
    <DevShell>
      {screen === "clients" ? <ClientsScreen /> : null}
      {screen === "projet" ? <ProjectScreen /> : null}
      {screen === "tache" ? <ProjectScreen modal="tache" /> : null}
      {screen === "sante" ? <ProjectScreen modal="sante" /> : null}
      {screen === "tableau" ? <DashboardScreen /> : null}
    </DevShell>
  );
}
