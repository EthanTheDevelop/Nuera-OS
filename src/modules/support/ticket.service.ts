import type { Ticket } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export interface OpenIncidentTicketInput {
  siteId: string;
  title: string;
  /** Origine de l'alerte : `uptime_kuma`, `coolify`… */
  source: string;
}

/**
 * Ouvre un ticket d'incident pour un site. Idempotent par incident ouvert (index unique partiel
 * `tickets_open_incident_unique`) : une panne qui se répète renvoie le ticket déjà ouvert.
 */
export async function openIncidentTicket(
  _tx: Database,
  _input: OpenIncidentTicketInput,
): Promise<Ticket> {
  throw new Error("openIncidentTicket n'est pas implémenté : à livrer par le lot Support.");
}
