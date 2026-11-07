import { budgetTone, Gauge } from "@/components/ui/gauge";
import { formatQuotaMinutes } from "../contract.format";
import { quotaPercent } from "../contract.rules";
import type { ContractConsumption } from "../contract.types";

interface Line {
  key: string;
  label: string;
  value: string;
  percent: number;
}

/** Une ligne par quota prévu au contrat. Un quota à zéro n'est pas mesurable : il ne s'affiche pas. */
function linesOf(consumption: ContractConsumption, minutesLabel: string, ticketsLabel: string) {
  const lines: Line[] = [];
  const { includedMinutes, consumedMinutes, includedTickets, consumedTickets } = consumption;
  const minutesPercent = quotaPercent(consumedMinutes, includedMinutes);
  if (includedMinutes !== null && minutesPercent !== null) {
    lines.push({
      key: "minutes",
      label: minutesLabel,
      value: formatQuotaMinutes(consumedMinutes, includedMinutes),
      percent: minutesPercent,
    });
  }
  const ticketsPercent = quotaPercent(consumedTickets, includedTickets);
  if (includedTickets !== null && ticketsPercent !== null) {
    lines.push({
      key: "tickets",
      label: ticketsLabel,
      value: `${consumedTickets} / ${includedTickets} ${includedTickets > 1 ? "demandes" : "demande"}`,
      percent: ticketsPercent,
    });
  }
  return lines;
}

/** Libellé, valeur en mono et jauge (écran 20, `100:6177`). `warn` à 80 %, `danger` au-delà de 100 %. */
export function QuotaGauges({
  consumption,
  minutesLabel = "Temps consommé",
  ticketsLabel = "Demandes décomptées",
  index = 0,
}: {
  consumption: ContractConsumption;
  minutesLabel?: string;
  ticketsLabel?: string;
  /** Rang de la première jauge dans la cascade. */
  index?: number;
}) {
  const lines = linesOf(consumption, minutesLabel, ticketsLabel);
  return (
    <>
      {lines.map((line, position) => (
        <div key={line.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm text-text">
            <span className="min-w-0">{line.label}</span>
            <span className="shrink-0 font-mono text-amount-compact text-muted">{line.value}</span>
          </div>
          <Gauge
            value={Math.min(line.percent, 100)}
            tone={budgetTone(line.percent)}
            height={8}
            index={index + position}
            label={line.label}
            valueText={line.value}
          />
        </div>
      ))}
    </>
  );
}

/** Ce contrat a-t-il au moins un quota mesurable à afficher ? */
export function hasMeasurableQuota(consumption: ContractConsumption): boolean {
  return linesOf(consumption, "", "").length > 0;
}
