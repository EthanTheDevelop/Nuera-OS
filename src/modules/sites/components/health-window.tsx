"use client";

import { useState, type ReactNode } from "react";
import { ButtonExternalLink } from "@/components/ui/button";
import { SegmentedGauge, type GaugeTone } from "@/components/ui/gauge";
import { Modal, ModalRow } from "@/components/ui/modal";
import { formatNumber, formatPercent } from "@/lib/format";
import { DOWN_DAY_BELOW_RATIO, SLOW_DAY_ABOVE_MS } from "../site.health";

export interface HealthWindowData {
  label: string;
  measuredDays: number;
  uptimeRatio: number | null;
  avgResponseMs: number | null;
  serverErrors: number | null;
  daysWithServerErrors: number;
  backups: { total: number; succeeded: number; offSite: number };
  incidents: number;
  monitorUrl: string | null;
}

const UNAVAILABLE = "indisponible";
const RESPONSE_SCALE_MS = 2000;
const SEGMENTS = 40;

function Measure({
  title,
  value,
  gauge,
  tone,
  max,
  index,
  valueText,
  children,
}: {
  title: string;
  value: string;
  gauge: number;
  tone: GaugeTone;
  max: number;
  index: number;
  valueText: string;
  children: ReactNode;
}) {
  return (
    <ModalRow className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-medium text-ink">{title}</h3>
        <span className="font-mono text-sm text-ink">{value === UNAVAILABLE ? "—" : value}</span>
      </div>
      <SegmentedGauge
        value={gauge}
        max={max}
        tone={tone}
        label={title}
        valueText={valueText}
        index={index}
        segments={SEGMENTS}
      />
      <p className="text-xs text-muted">{children}</p>
    </ModalRow>
  );
}

/**
 * Fenêtre « Santé du site » (M3), ouverte par « Détails ». Chaque mesure vient d'échantillons réels ;
 * sans donnée, elle affiche « indisponible » et sa jauge reste vide, jamais pleine.
 */
export function HealthWindow({ data }: { data: HealthWindowData }) {
  const [open, setOpen] = useState(false);
  const { backups } = data;
  const uptimePercent = data.uptimeRatio === null ? null : data.uptimeRatio * 100;
  const uptimeTone: GaugeTone =
    data.uptimeRatio !== null && data.uptimeRatio < DOWN_DAY_BELOW_RATIO ? "warn" : "success";
  const responseTone: GaugeTone =
    data.avgResponseMs !== null && data.avgResponseMs > SLOW_DAY_ABOVE_MS ? "warn" : "accent";
  const backupsFailed = backups.total - backups.succeeded;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hit-44 text-sm font-medium text-accent hover:underline hover:underline-offset-4"
      >
        Détails
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Santé du site"
        icon="server"
        width={560}
        description={`${data.label} · 30 derniers jours`}
        footer={
          data.monitorUrl ? (
            <div className="flex justify-end">
              <ButtonExternalLink href={data.monitorUrl}>
                Ouvrir dans Uptime Kuma
              </ButtonExternalLink>
            </div>
          ) : undefined
        }
      >
        <Measure
          title="Disponibilité"
          value={uptimePercent === null ? UNAVAILABLE : formatPercent(uptimePercent, 2)}
          gauge={uptimePercent ?? 0}
          max={100}
          tone={uptimeTone}
          index={0}
          valueText={uptimePercent === null ? UNAVAILABLE : formatPercent(uptimePercent, 2)}
        >
          {uptimePercent === null
            ? "Aucune mesure sur 30 jours."
            : `Moyenne de ${data.measuredDays} jour${data.measuredDays > 1 ? "s" : ""} mesuré${data.measuredDays > 1 ? "s" : ""} sur 30 · ${data.incidents === 0 ? "aucun incident" : `${data.incidents} incident${data.incidents > 1 ? "s" : ""}`}`}
        </Measure>

        <Measure
          title="Temps de réponse moyen"
          value={
            data.avgResponseMs === null ? UNAVAILABLE : `${formatNumber(data.avgResponseMs)} ms`
          }
          gauge={data.avgResponseMs ?? 0}
          max={RESPONSE_SCALE_MS}
          tone={responseTone}
          index={SEGMENTS}
          valueText={data.avgResponseMs === null ? UNAVAILABLE : `${data.avgResponseMs} ms`}
        >
          {data.avgResponseMs === null ? "Aucune mesure sur 30 jours." : "Échelle de 0 à 2 s."}
        </Measure>

        <Measure
          title="Erreurs serveur"
          value={data.serverErrors === null ? UNAVAILABLE : formatNumber(data.serverErrors)}
          gauge={data.daysWithServerErrors}
          max={Math.max(1, data.measuredDays)}
          tone="warn"
          index={SEGMENTS * 2}
          valueText={data.serverErrors === null ? UNAVAILABLE : `${data.serverErrors} erreurs`}
        >
          {data.serverErrors === null
            ? "Uptime Kuma ne fournit pas cette mesure sur sa page de statut."
            : data.daysWithServerErrors === 0
              ? "Aucune erreur sur les jours mesurés."
              : `Sur ${data.daysWithServerErrors} jour${data.daysWithServerErrors > 1 ? "s" : ""} parmi les jours mesurés.`}
        </Measure>

        <Measure
          title="Sauvegardes"
          value={backups.total === 0 ? UNAVAILABLE : `${backups.succeeded} / ${backups.total}`}
          gauge={backups.succeeded}
          max={Math.max(1, backups.total)}
          tone={backupsFailed > 0 ? "warn" : "success"}
          index={SEGMENTS * 3}
          valueText={
            backups.total === 0 ? UNAVAILABLE : `${backups.succeeded} réussies sur ${backups.total}`
          }
        >
          {backups.total === 0
            ? "Aucune sauvegarde enregistrée sur 30 jours."
            : backups.offSite > 0
              ? `${backups.offSite} copie${backups.offSite > 1 ? "s" : ""} hors serveur sur 30 jours.`
              : "Aucune copie hors serveur constatée sur 30 jours."}
        </Measure>
      </Modal>
    </>
  );
}
