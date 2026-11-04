import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { StackedBars } from "@/components/charts/stacked-bars";
import { UptimeBars } from "@/components/charts/uptime-bars";
import { NotificationBell } from "@/components/layout/notifications";
import { PageHeader } from "@/components/layout/page-header";
import { Reveal } from "@/components/motion/reveal";
import { RollingNumber } from "@/components/motion/rolling-number";
import { Stagger } from "@/components/motion/stagger";
import { ClientCapsule } from "@/components/portal/ClientCapsule";
import {
  ConnectionRequired,
  EmptyState,
  ErrorState,
  ForbiddenState,
  KpiSkeleton,
  StaleData,
  TableSkeleton,
  TileSkeleton,
} from "@/components/states/states";
import { ActivityList } from "@/components/ui/activity-list";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { CompactButton, CompactLink } from "@/components/ui/compact-button";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { Icon, ICON_NAMES } from "@/components/ui/icon";
import { InfoCard } from "@/components/ui/info-card";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { ProgressRing } from "@/components/ui/progress-ring";
import { StepTimeline } from "@/components/ui/step-timeline";
import {
  AddTile,
  Tile,
  TileFigure,
  TileGrid,
  TileRemoveButton,
  TileResizeHandle,
} from "@/components/ui/tile";
import {
  DeployConfirm,
  FormDemo,
  GaugesDemo,
  KpiTabsDemo,
  MenuDemo,
  SiteHealthModal,
  TabsDemo,
  TaskModal,
  ToastDemo,
} from "./demos";
import {
  ACTIVITY,
  CLIENT_STEPS,
  CLIENTS,
  LONG_TABLE_TOTAL,
  MILESTONES,
  MONTHS,
  NOTIFICATIONS,
  REVENUE,
  UPTIME,
  type ClientRow,
} from "./fixtures";
import { KanbanDemo } from "./kanban-demo";
import { DevShell } from "./shell";

export const metadata = { title: "Galerie d'interface" };

const EUR = { style: "currency", currency: "EUR", maximumFractionDigits: 0 } as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      data-section={id}
      className="flex scroll-mt-20 flex-col gap-4 border-t border-border py-8"
    >
      <h2 className="font-mono text-eyebrow text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

const CLIENT_COLUMNS: DataTableColumn<ClientRow>[] = [
  {
    key: "client",
    header: "CLIENT",
    sortable: true,
    cell: (row) => <CellIdentity name={row.name} title={row.name} subtitle={row.contact} />,
  },
  {
    key: "statut",
    header: "STATUT",
    width: 140,
    sortable: true,
    cell: (row) => (
      <StatusBadge
        kind={row.status === "quote_sent" ? "opportunity" : "company"}
        status={row.status}
      />
    ),
  },
  { key: "projet", header: "PROJET", width: 170, cell: (row) => row.project },
  { key: "montant", header: "MONTANT", width: 130, sortable: true, cell: (row) => row.amount },
  {
    key: "origine",
    header: "ORIGINE",
    width: 120,
    hideWhenCollapsed: true,
    cell: (row) => row.source,
  },
  {
    key: "associe",
    header: "ASSOCIÉ",
    width: 80,
    hideWhenCollapsed: true,
    cell: (row) => row.owner,
  },
];

export default async function DevUiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Contrôle côté serveur : hors développement, cette route n'existe pas.
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;

  return (
    <DevShell>
      <PageHeader
        title="Galerie d’interface"
        subtitle="Tous les composants et états, avec des données fictives. Développement uniquement."
        bell={<NotificationBell items={NOTIFICATIONS} allHref="/dev/ui" />}
        actions={
          <>
            <Button>Modifier le tableau</Button>
            <Button variant="accent">+ Nouvelle affaire</Button>
          </>
        }
      />

      <Section id="boutons" title="Button · CompactButton">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button variant="accent">Accent</Button>
          <Button loading>Chargement</Button>
          <Button variant="accent" loading>
            Chargement
          </Button>
          <Button disabled>Désactivé</Button>
          <ButtonLink href="/dev/ui" icon="plus" variant="accent">
            Lien
          </ButtonLink>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-near-black p-6">
          <Button variant="on-dark">On dark</Button>
          <Button variant="on-dark" loading>
            Chargement
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <CompactButton icon="check">Valider</CompactButton>
          <CompactButton variant="secondary" icon="edit">
            Compléter
          </CompactButton>
          <CompactButton variant="quiet" icon="edit">
            Déplacer
          </CompactButton>
          <CompactButton loading>Envoi</CompactButton>
          <CompactLink href="/dev/ui" icon="download" variant="secondary">
            Lien
          </CompactLink>
        </div>
      </Section>

      <Section id="badges" title="Badge · Avatar · Icon">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="accent">Abonné</Badge>
          <Badge tone="success">Client · signé</Badge>
          <Badge tone="warn">Relance J+3</Badge>
          <Badge tone="danger">En retard · 2 j</Badge>
          <Badge tone="neutral">Prospect</Badge>
          <Badge tone="chatgpt">ChatGPT</Badge>
          <StatusBadge kind="deployment" status="succeeded" />
          <StatusBadge kind="opportunity" status="WON" />
          <StatusBadge kind="severity" status="high" />
          <StatusBadge kind="project" status="blocked">
            Bloqué · contenus attendus
          </StatusBadge>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {([22, 26, 28, 32, 36, 40, 56, 64] as const).map((size) => (
            <Avatar key={size} name="Camille Durand" size={size} />
          ))}
          <AvatarStack people={[{ name: "Ethan Ngo" }, { name: "Nezar Zakaria" }]} />
          <AvatarStack
            size={28}
            max={2}
            people={[{ name: "Ethan Ngo" }, { name: "Nezar Zakaria" }, { name: "Camille Durand" }]}
          />
        </div>
        <ul className="flex flex-wrap gap-3 text-ink">
          {ICON_NAMES.map((name) => (
            <li
              key={name}
              title={name}
              data-icon={name}
              className="flex size-12 flex-col items-center justify-center gap-1 rounded-sm bg-surface-raised"
            >
              <Icon name={name} size={24} />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="tuiles" title="Tile · TileHeader · AddTile · KpiCard · InfoCard">
        <TileGrid>
          <Tile
            icon="euro"
            title="Chiffre d’affaires"
            size="4x2"
            aside={<Badge tone="success">+12 % vs octobre</Badge>}
            handle={<TileResizeHandle tileName="Chiffre d’affaires" />}
          >
            <div className="mt-auto flex flex-col gap-1">
              <p className="text-figure-hero text-ink">
                <RollingNumber value={11700} format={EUR} suffix=" HT" />
              </p>
              <p className="text-sm text-muted">Novembre 2026 · encaissé et à encaisser</p>
            </div>
            <StackedBars
              title="Chiffre d’affaires par mois"
              points={MONTHS}
              series={[
                { key: "projects", label: "Projets", values: REVENUE.projects },
                { key: "recurring", label: "Récurrent", values: REVENUE.recurring },
              ]}
              valueFormat={{ format: EUR }}
            />
          </Tile>
          <Tile
            icon="pipeline"
            title="Pipeline"
            size="2x2"
            aside={<Badge tone="accent">21 affaires</Badge>}
            href="/dev/ui/clients"
          >
            <p className="text-sm text-muted">La tuile entière mène à l’écran du module.</p>
          </Tile>
          <Tile icon="euro" title="MRR" size="1x1">
            <TileFigure
              value={<RollingNumber value={1349} format={EUR} />}
              note="1 accompagnement + 1 hébergement"
            />
          </Tile>
          <Tile icon="check" title="Encaissé" size="1x1">
            <TileFigure value="7 020 €" note="2 340 € en attente" noteTone="warn" />
          </Tile>
          <Tile
            icon="clock"
            title="En retard"
            size="1x1"
            editing
            removeControl={<TileRemoveButton tileName="En retard" />}
            handle={<TileResizeHandle tileName="En retard" editing />}
          >
            <TileFigure
              value="1 projet"
              note="Contenus attendus · Atelier Lune"
              noteTone="danger"
            />
          </Tile>
          <AddTile href="/dev/ui" label="Ajouter une tuile" />
        </TileGrid>
        <KpiGrid>
          <KpiCard
            label="Disponibilité 30 jours"
            value="100 %"
            note="0 incident"
            noteTone="success"
          />
          <KpiCard label="Dernier déploiement" value="il y a 2 h" note="réussi" href="/dev/ui" />
          <KpiCard
            label="Dernière sauvegarde"
            value="3:00"
            note="à configurer (S3)"
            noteTone="warn"
          />
          <KpiCard label="Domaine" value="14/10/2027" note="au nom du client" />
        </KpiGrid>
        <div className="max-w-[360px]">
          <InfoCard
            icon="clock"
            title="Prévu et réalisé"
            rows={[
              { label: "Journées vendues", value: "12 j" },
              { label: "Journées passées", value: "5,5 j" },
              { label: "Prévu à date", value: "5 j" },
            ]}
          >
            <p className="text-xs text-warn">+0,5 j sur le design : un tour de retours en plus.</p>
          </InfoCard>
        </div>
      </Section>

      <Section id="tableau" title="DataTable · FilterBar · FilterChip · SearchField">
        <FilterBar searchParam="q">
          <FilterChip param="statut">Tous</FilterChip>
          <FilterChip param="statut" value="clients">
            Clients
          </FilterChip>
          <FilterChip param="statut" value="prospects">
            Prospects
          </FilterChip>
          <FilterChip param="statut" value="abonnes" count={3}>
            Abonnés
          </FilterChip>
        </FilterBar>
        <DataTable
          caption="Clients"
          columns={CLIENT_COLUMNS}
          rows={CLIENTS}
          rowKey={(row) => row.id}
          rowHref={(row) => `/dev/ui/clients?id=${row.id}`}
          rowHeight="lg"
          query={{ pathname: "/dev/ui", searchParams: params }}
          pagination={{ page: Number(params.page ?? 1), pageSize: 8, total: LONG_TABLE_TOTAL }}
        />
        <DataTable
          caption="Table vide"
          columns={CLIENT_COLUMNS}
          rows={[]}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              compact
              icon="clients"
              title="Aucun client pour ce filtre"
              description="Modifiez les filtres ou ajoutez un client."
            />
          }
        />
      </Section>

      <Section id="jauges" title="Gauge · SegmentedGauge · ProgressRing · StepTimeline">
        <GaugesDemo />
        <div className="flex items-center gap-4">
          <ProgressRing steps={["done", "current", "todo", "todo"]} label="Étape 2 sur 4" />
          <div className="rounded-sm bg-near-black p-2">
            <ProgressRing
              steps={["done", "done", "current", "todo"]}
              onDark
              label="Étape 3 sur 4"
            />
          </div>
        </div>
        <Tile
          icon="flag"
          title="Jalons"
          aside={<span className="text-xs text-muted">5 étapes</span>}
          className="rounded-lg"
        >
          <StepTimeline steps={MILESTONES} label="Jalons du projet" />
        </Tile>
        <div className="rounded-xl border border-border bg-surface p-7">
          <StepTimeline steps={CLIENT_STEPS} variant="client" label="Le chemin de votre site" />
        </div>
      </Section>

      <Section id="kanban" title="KanbanBoard · KanbanCard (glisser, ou Espace + flèches)">
        <KanbanDemo />
      </Section>

      <Section id="fenetres" title="Modal · ConfirmDialog · Toast · Menu · Popover">
        <div className="flex flex-wrap items-center gap-3">
          <SiteHealthModal />
          <TaskModal />
          <DeployConfirm />
        </div>
        <ToastDemo />
        <MenuDemo />
      </Section>

      <Section id="onglets" title="Tabs · KpiTabs · graphiques comparés">
        <TabsDemo />
        <KpiTabsDemo />
      </Section>

      <Section id="graphiques" title="UptimeBars">
        <Tile
          icon="server"
          title="Disponibilité · 30 jours"
          aside={<Badge tone="success">Uptime Kuma</Badge>}
          className="rounded-lg"
        >
          <UptimeBars
            title="Disponibilité sur 30 jours"
            summary="100 % sauf une lenteur le 12 octobre."
            days={UPTIME}
          />
        </Tile>
      </Section>

      <Section
        id="formulaires"
        title="Field · Input · Textarea · Select · DatePicker · Checkbox · MoneyField · DurationField"
      >
        <FormDemo />
      </Section>

      <Section id="activite" title="ActivityList">
        <div className="max-w-xl">
          <ActivityList items={ACTIVITY} />
        </div>
      </Section>

      <Section
        id="etats"
        title="EmptyState · ErrorState · ForbiddenState · ConnectionRequired · StaleData · LoadingSkeleton"
      >
        <div className="grid gap-(--grid-gap) lg:grid-cols-2">
          <Tile className="rounded-lg">
            <EmptyState
              icon="projets"
              title="Aucun projet en cours"
              description="Un projet se crée dès qu’un devis est signé."
              action={<Button variant="accent">+ Nouveau projet</Button>}
            />
          </Tile>
          <Tile className="rounded-lg">
            <ErrorState reference="4f8a2c91" action={<Button>Réessayer</Button>} />
          </Tile>
          <Tile className="rounded-lg">
            <ForbiddenState />
          </Tile>
          <Tile className="rounded-lg">
            <ConnectionRequired
              service="Coolify"
              missing="La clé d’API n’est pas renseignée. Les déploiements ne peuvent pas être lus."
            />
          </Tile>
          <Tile icon="server" title="État des sites" className="rounded-xl">
            <ConnectionRequired
              compact
              service="Uptime Kuma"
              missing="L’adresse du service n’est pas configurée."
            />
          </Tile>
          <Tile icon="server" title="État des sites" className="rounded-xl">
            <StaleData service="Uptime Kuma" date="4 nov. à 08:12" staleness="il y a 3 h" />
            <p className="text-sm text-muted">La donnée reste visible, avec son âge.</p>
          </Tile>
        </div>
        <div className="grid gap-(--grid-gap) sm:grid-cols-2 lg:grid-cols-4">
          <TileSkeleton />
          <KpiSkeleton />
        </div>
        <TableSkeleton rowHeight="lg" rows={3} columns={5} />
      </Section>

      <Section id="mouvement" title="Stagger · Reveal · RollingNumber">
        <Stagger as="ul" itemAs="li" className="flex flex-col gap-2">
          <p className="rounded-sm bg-surface-raised p-3 text-sm">Premier</p>
          <p className="rounded-sm bg-surface-raised p-3 text-sm">Deuxième</p>
          <p className="rounded-sm bg-surface-raised p-3 text-sm">Troisième</p>
        </Stagger>
        <Reveal>
          <p className="rounded-sm bg-accent-pale p-3 text-sm text-accent">Révélé au défilement.</p>
        </Reveal>
      </Section>

      <Section id="capsule" title="ClientCapsule">
        <div className="-mx-4 overflow-hidden lg:-mx-8">
          <ClientCapsule
            progress={{
              steps: ["done", "current", "todo", "todo"],
              label: "Maquettes",
              ariaLabel: "Avancement : étape 2 sur 4, maquettes, mise en ligne le 18 novembre",
              hint: "Mise en ligne le 18 novembre",
            }}
            nextAction={{ label: "À vous : déposer les photos", href: "/dev/ui" }}
            messagesCount={2}
            user={{ name: "Claire Martin", email: "claire@example.test" }}
            menuItems={[
              { key: "profil", label: "Mon profil", icon: "clients", href: "/dev/ui" },
              {
                key: "ecrire",
                label: "Écrire à Ethan et Nezar",
                icon: "messages",
                href: "/dev/ui",
              },
            ]}
          />
        </div>
      </Section>
    </DevShell>
  );
}
