import { emitEvent } from "@/modules/platform/events";
import type { Contract } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { periodWindow, quotaExceeded, quotaReachedAlert } from "./contract.rules";
import * as repository from "./contract.repository";
import type { ContractConsumption } from "./contract.types";

/**
 * Consommation des forfaits, partagée par les contrats et les interventions.
 * Source unique : `maintenance_interventions` réalisées. Le quota d'un contrat vaut par période de
 * facturation, comptée depuis son début.
 */
type QuotaInput = Pick<
  Contract,
  "id" | "startOn" | "period" | "includedMinutes" | "includedTickets"
>;

export async function readConsumptions<T extends QuotaInput>(
  db: Database,
  contracts: readonly T[],
  day: string,
): Promise<Map<string, ContractConsumption>> {
  const windows = contracts.map((contract) => ({
    contract,
    window: periodWindow(contract, day),
  }));
  const totals = await repository.sumConsumption(
    db,
    windows.map(({ contract, window }) => ({
      contractId: contract.id,
      start: window.start,
      end: window.end,
    })),
  );
  return new Map(
    windows.map(({ contract, window }) => {
      const total = totals.get(contract.id);
      return [
        contract.id,
        {
          periodStart: window.start,
          periodEnd: window.end,
          includedMinutes: contract.includedMinutes,
          consumedMinutes: total?.minutes ?? 0,
          includedTickets: contract.includedTickets,
          consumedTickets: total?.tickets ?? 0,
        },
      ];
    }),
  );
}

export async function readConsumption(
  db: Database,
  contract: QuotaInput,
  day: string,
): Promise<ContractConsumption> {
  const consumption = (await readConsumptions(db, [contract], day)).get(contract.id);
  if (!consumption) throw new Error("Consommation introuvable.");
  return consumption;
}

/**
 * Émet `contract.quota_80` et `contract.quota_exceeded` si le seuil est franchi sur la période de
 * `day`. La clé porte le contrat et la période : chacun ne part qu'une fois par période.
 */
export async function emitQuotaEvents(
  tx: Database,
  contract: QuotaInput & Pick<Contract, "number" | "companyId">,
  day: string,
  actorId: string | null,
): Promise<ContractConsumption> {
  const consumption = await readConsumption(tx, contract, day);
  const payload = {
    number: contract.number,
    consumedMinutes: consumption.consumedMinutes,
    includedMinutes: contract.includedMinutes ?? 0,
    consumedTickets: consumption.consumedTickets,
    includedTickets: contract.includedTickets,
    periodStart: consumption.periodStart,
  };

  if (quotaReachedAlert(consumption)) {
    await emitEvent(tx, {
      type: "contract.quota_80",
      entityType: "contract",
      entityId: contract.id,
      companyId: contract.companyId,
      payload,
      actorId,
      dedupeKey: `contract.quota_80:${contract.id}:${consumption.periodStart}`,
    });
  }
  if (quotaExceeded(consumption)) {
    await emitEvent(tx, {
      type: "contract.quota_exceeded",
      entityType: "contract",
      entityId: contract.id,
      companyId: contract.companyId,
      payload,
      actorId,
      dedupeKey: `contract.quota_exceeded:${contract.id}:${consumption.periodStart}`,
    });
  }
  return consumption;
}
