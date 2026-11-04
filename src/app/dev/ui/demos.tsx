"use client";

import { useActionState, useState, type ReactNode } from "react";
import { ComparedBars } from "@/components/charts/compared-bars";
import { AreaLine, StepLine } from "@/components/charts/line-charts";
import { WonLostBars } from "@/components/charts/won-lost-bars";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommentComposer, CommentThread, type ThreadComment } from "@/components/ui/comment-thread";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";
import {
  Checkbox,
  DateField,
  FormAlert,
  SelectField,
  TextareaField,
  TextField,
} from "@/components/ui/form";
import { DurationField, MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Gauge, SegmentedGauge } from "@/components/ui/gauge";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Menu, Popover } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { KpiTabs, Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { demoSave } from "./actions";
import { COMMENTS, COMPARED, LOST, MARGIN, MEMBERS, MONTHS, MRR, WON } from "./fixtures";

const EUR = { style: "currency", currency: "EUR", maximumFractionDigits: 0 } as const;

function MeasureBlock({
  title,
  value,
  tone,
  ratio,
  note,
  index,
}: {
  title: string;
  value: string;
  tone: "success" | "accent" | "warn";
  ratio: number;
  note: string;
  index: number;
}) {
  return (
    <ModalRow className="flex flex-col gap-2 p-4">
      <div className="flex items-start gap-2 font-medium text-text">
        <p className="min-w-0 flex-1 text-base">{title}</p>
        <p className="font-mono text-sm">{value}</p>
      </div>
      <SegmentedGauge value={ratio} tone={tone} label={title} valueText={value} index={index} />
      <p className="text-xs text-muted">{note}</p>
    </ModalRow>
  );
}

export function SiteHealthModal({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Santé du site (M3)</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        icon="server"
        title="Santé du site"
        description="kine-rive-gauche.fr · 30 derniers jours · données d’exemple"
        width={560}
        footer={
          <div className="flex justify-end">
            <Button>Ouvrir dans Uptime Kuma</Button>
          </div>
        }
      >
        <MeasureBlock
          title="Disponibilité"
          value="100 %"
          tone="success"
          ratio={100}
          note="Aucune coupure en 30 jours"
          index={0}
        />
        <MeasureBlock
          title="Temps de réponse moyen"
          value="240 ms"
          tone="accent"
          ratio={12}
          note="Échelle de 0 à 2 s · une lenteur de 4 min il y a 18 jours"
          index={8}
        />
        <MeasureBlock
          title="Erreurs serveur"
          value="0,1 %"
          tone="warn"
          ratio={0.1}
          note="Pendant la mise à jour Payload annulée ; le site est resté en ligne"
          index={16}
        />
        <MeasureBlock
          title="Sauvegardes"
          value="7 / 7"
          tone="success"
          ratio={100}
          note="Une chaque nuit à 3:00 · copie hors serveur à configurer (S3)"
          index={24}
        />
      </Modal>
    </>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <p className="w-[100px] shrink-0 text-sm text-muted sm:w-[140px]">{label}</p>
      {children}
    </div>
  );
}

export function TaskModal({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [comments, setComments] = useState<ThreadComment[]>(COMMENTS);
  const names = MEMBERS.map((member) => member.name);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Tâche et commentaires (M4)</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Intégrer la page Galerie"
        description="Atelier Lune · Site vitrine · P-2026-007"
        width={640}
      >
        <ModalRow className="flex flex-col gap-2">
          <FieldRow label="Responsable">
            <span className="flex items-center gap-2 text-base text-text">
              <Avatar name="Ethan Ngo" size={28} />
              Ethan
            </span>
          </FieldRow>
          <FieldRow label="Échéance">
            <p className="text-base text-text">10 nov.</p>
          </FieldRow>
          <FieldRow label="Statut">
            <Badge tone="warn">Bloquée</Badge>
          </FieldRow>
          <FieldRow label="Dépend de">
            <p className="text-base text-text">Photos client · attendues depuis le 31 oct.</p>
          </FieldRow>
        </ModalRow>
        <ModalRow>
          <Tabs
            label="Détail de la tâche"
            defaultValue="comments"
            items={[
              {
                id: "description",
                label: "Description",
                content: (
                  <p className="text-sm text-muted">Page Galerie, grille de 6 compositions.</p>
                ),
              },
              {
                id: "comments",
                label: `Commentaires · ${comments.length}`,
                content: (
                  <div className="flex flex-col gap-4">
                    <CommentThread comments={comments} mentionNames={names} />
                    <CommentComposer
                      author="Nezar"
                      authorInitials="NZ"
                      formId="task-comment"
                      showSubmit={false}
                      members={MEMBERS}
                      onSubmit={({ body }) =>
                        setComments((current) => [
                          ...current,
                          {
                            id: String(current.length + 1),
                            author: "Nezar",
                            authorInitials: "NZ",
                            date: "à l’instant",
                            body,
                          },
                        ])
                      }
                    />
                  </div>
                ),
              },
              {
                id: "history",
                label: "Historique",
                content: <p className="text-sm text-muted">Créée le 12 oct.</p>,
              },
            ]}
          />
        </ModalRow>
        <ModalRow className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">Associés</p>
          <AvatarStack size={28} people={[{ name: "Ethan Ngo" }, { name: "Nezar Zakaria" }]} />
          <div className="flex-1" />
          <Button onClick={() => setOpen(false)}>Annuler</Button>
          <Button type="submit" form="task-comment" variant="accent">
            Enregistrer
          </Button>
        </ModalRow>
      </Modal>
    </>
  );
}

export function DeployConfirm() {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <>
      <Button variant="accent" icon="rocket" onClick={() => setOpen(true)}>
        Déployer en production
      </Button>
      <ConfirmDialog
        open={open}
        title="Déployer en production ?"
        description="kine-rive-gauche.fr sera mis à jour avec la branche main. Le site peut être indisponible quelques secondes."
        confirmLabel="Déployer"
        tone="danger"
        requireWord="PRODUCTION"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          await new Promise((resolve) => setTimeout(resolve, 600));
          setOpen(false);
          toast({ message: "Déploiement lancé." });
        }}
      />
    </>
  );
}

export function ToastDemo() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <CompactButton icon="check" onClick={() => toast({ message: "Modifications enregistrées." })}>
        Succès
      </CompactButton>
      <CompactButton
        variant="secondary"
        onClick={() => toast({ tone: "danger", message: "Coolify ne répond pas." })}
      >
        Erreur
      </CompactButton>
    </div>
  );
}

export function MenuDemo() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Menu
        label="Actions"
        trigger={(props) => (
          <CompactButton {...props} variant="secondary" icon="reglages">
            Actions
          </CompactButton>
        )}
        items={[
          { key: "edit", label: "Modifier", icon: "edit", onSelect: () => {} },
          { key: "dup", label: "Télécharger", icon: "download", onSelect: () => {} },
          {
            key: "del",
            label: "Archiver",
            icon: "minus",
            danger: true,
            separatorBefore: true,
            onSelect: () => {},
          },
        ]}
      />
      <Popover
        label="Aide"
        trigger={(props) => (
          <CompactButton {...props} variant="quiet" icon="alert">
            Popover
          </CompactButton>
        )}
      >
        <p className="w-60 p-4 text-sm text-muted">
          Un panneau libre, fermé par Échap ou un clic extérieur.
        </p>
      </Popover>
    </div>
  );
}

export function TabsDemo() {
  return (
    <Tabs
      label="Onglets de démonstration"
      items={[
        {
          id: "a",
          label: "Description",
          content: <p className="text-sm text-muted">Premier panneau.</p>,
        },
        {
          id: "b",
          label: "Commentaires · 2",
          content: <p className="text-sm text-muted">Deuxième panneau.</p>,
        },
        {
          id: "c",
          label: "Historique",
          content: <p className="text-sm text-muted">Troisième panneau.</p>,
        },
      ]}
    />
  );
}

export function KpiTabsDemo() {
  return (
    <KpiTabs
      label="Mesures"
      panelClassName="rounded-xl bg-surface p-6 shadow-soft"
      items={[
        {
          id: "ca",
          label: "Chiffre d’affaires",
          value: "11 700 €",
          note: "+12 % vs octobre",
          noteTone: "success",
          content: (
            <ComparedBars
              title="Comparaison des périodes"
              points={MONTHS}
              current={COMPARED.current}
              previous={COMPARED.previous}
              valueFormat={{ format: EUR }}
            />
          ),
        },
        {
          id: "mrr",
          label: "Revenus récurrents",
          value: "1 349 €",
          note: "+0 € vs octobre",
          content: (
            <AreaLine
              title="Revenus récurrents par mois"
              points={MONTHS}
              values={MRR}
              seriesLabel="Revenus récurrents"
              valueFormat={{ format: EUR, suffix: "/mois" }}
              max={1500}
            />
          ),
        },
        {
          id: "marge",
          label: "Marge estimée",
          value: "63 %",
          note: "+2 pts",
          noteTone: "success",
          content: (
            <StepLine
              title="Marge estimée par mois"
              points={MONTHS}
              values={MARGIN}
              seriesLabel="Marge"
              valueFormat={{ suffix: " %" }}
              max={100}
            />
          ),
        },
        {
          id: "conv",
          label: "Conversion",
          value: "71 %",
          note: "12 gagnées · 5 perdues",
          content: (
            <WonLostBars
              title="Opportunités gagnées et perdues"
              points={MONTHS}
              won={WON}
              lost={LOST}
            />
          ),
        },
      ]}
    />
  );
}

export function FormDemo() {
  const [state, action] = useActionState(demoSave, IDLE_ACTION_STATE);
  return (
    <form action={action} className="flex max-w-xl flex-col gap-4">
      <FormAlert state={state} />
      <TextField
        state={state}
        name="name"
        label="Nom du projet"
        hint="Laisser vide pour voir l’erreur renvoyée par le serveur."
      />
      <TextareaField state={state} name="scope" label="Périmètre" />
      <SelectField state={state} name="activity" label="Activité" defaultValue="vitrine">
        <option value="vitrine">Site vitrine</option>
        <option value="landing">Landing page</option>
      </SelectField>
      <DateField state={state} name="due" label="Échéance" />
      <MoneyField state={state} name="amount" label="Montant HT" defaultCents={780000} />
      <DurationField
        state={state}
        name="duration"
        label="Charge estimée"
        hint="1h30, 90, 0,5 j"
        defaultMinutes={90}
      />
      <Checkbox
        name="client"
        label="Visible par le client"
        description="Apparaît dans l’espace client."
      />
      <Switch name="notify" label="Prévenir le client" defaultChecked />
      <Alert tone="info">
        Le formulaire envoie des centimes et des minutes, jamais le texte saisi.
      </Alert>
      <div className="flex gap-3">
        <SubmitButton>Enregistrer</SubmitButton>
      </div>
    </form>
  );
}

export function GaugesDemo() {
  const [value, setValue] = useState(78);
  return (
    <div className="flex flex-col gap-4">
      <Gauge value={value} height={8} label="Charge du mois" valueText={`${value} %`} />
      <Gauge value={95} tone="warn" label="Charge élevée" />
      <Gauge value={100} tone="success" label="Signé" />
      <Gauge value={60} tone="danger" label="Raisons de perte" />
      <SegmentedGauge value={12} label="Temps de réponse" />
      <div>
        <CompactButton variant="secondary" onClick={() => setValue(value === 78 ? 34 : 78)}>
          Changer la valeur (la barre roule)
        </CompactButton>
      </div>
    </div>
  );
}
