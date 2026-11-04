import { describe, expect, it } from "vitest";
import {
  assertContractTransition,
  CONTRACT_STATUSES,
  CONTRACT_TRANSITIONS,
  type ContractStatus,
} from "@/modules/contracts/contract.status";
import {
  assertProjectTransition,
  PROJECT_STATUSES,
  PROJECT_TRANSITIONS,
  type ProjectStatus,
} from "@/modules/projects/project.status";
import {
  assertQuoteTransition,
  QUOTE_STATUSES,
  QUOTE_TRANSITIONS,
  type QuoteStatus,
} from "@/modules/quotes/quote.status";
import {
  assertOpportunityTransition,
  canOpportunityTransition,
  isOpportunityClosed,
  OPPORTUNITY_REOPEN_TRANSITIONS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TRANSITIONS,
} from "@/modules/sales/opportunity.status";
import {
  assertTicketTransition,
  TICKET_STATUSES,
  TICKET_TRANSITIONS,
  type TicketStatus,
} from "@/modules/support/ticket.status";
import { ConflictError } from "@/server/errors";
import { canTransition } from "./status-machine";

/** Chaque paire de la table : acceptée si listée, `ConflictError` sinon. */
function expectMachine<TStatus extends string>(
  statuses: readonly TStatus[],
  table: Readonly<Record<TStatus, readonly TStatus[]>>,
  assert: (from: TStatus, to: TStatus) => void,
) {
  for (const from of statuses) {
    for (const to of statuses) {
      if (table[from].includes(to)) expect(() => assert(from, to)).not.toThrow();
      else expect(() => assert(from, to)).toThrow(ConflictError);
    }
  }
}

describe("machines à états", () => {
  it("devis : conforme au contrat, modifie un envoyé par une version", () => {
    const expected: Record<QuoteStatus, QuoteStatus[]> = {
      draft: ["sent"],
      sent: ["negotiation", "accepted", "refused", "expired"],
      negotiation: ["accepted", "refused"],
      accepted: [],
      refused: [],
      expired: [],
    };
    expect(QUOTE_TRANSITIONS).toEqual(expected);
    expectMachine(QUOTE_STATUSES, QUOTE_TRANSITIONS, assertQuoteTransition);
  });

  it("projet : préparation → en cours ⇄ bloqué ⇄ en validation → livré → clôturé", () => {
    const expected: Record<ProjectStatus, ProjectStatus[]> = {
      preparation: ["active"],
      active: ["blocked", "in_validation"],
      blocked: ["active", "in_validation"],
      in_validation: ["active", "blocked", "delivered"],
      delivered: ["closed"],
      closed: [],
    };
    expect(PROJECT_TRANSITIONS).toEqual(expected);
    expectMachine(PROJECT_STATUSES, PROJECT_TRANSITIONS, assertProjectTransition);
  });

  it("ticket : parcours linéaire et réouverture depuis résolu seulement", () => {
    const expected: Record<TicketStatus, TicketStatus[]> = {
      received: ["qualified"],
      qualified: ["in_progress"],
      in_progress: ["resolved"],
      resolved: ["in_progress", "closed"],
      closed: [],
    };
    expect(TICKET_TRANSITIONS).toEqual(expected);
    expectMachine(TICKET_STATUSES, TICKET_TRANSITIONS, assertTicketTransition);
  });

  it("contrat : à démarrer → actif ⇄ à revoir ; actif → suspendu, résilié, expiré", () => {
    const expected: Record<ContractStatus, ContractStatus[]> = {
      to_start: ["active"],
      active: ["to_review", "suspended", "terminated", "expired"],
      to_review: ["active"],
      suspended: ["active", "terminated"],
      terminated: [],
      expired: [],
    };
    expect(CONTRACT_TRANSITIONS).toEqual(expected);
    expectMachine(CONTRACT_STATUSES, CONTRACT_TRANSITIONS, assertContractTransition);
  });

  it("refuse de rester sur place", () => {
    expect(canTransition(TICKET_TRANSITIONS, "received", "received")).toBe(false);
  });

  it("message en français, avec les libellés", () => {
    expect(() => assertTicketTransition("closed", "received")).toThrow(
      "Passage de « Clôturée » à « Reçue » impossible.",
    );
  });
});

describe("étapes d'opportunité", () => {
  const won = { role: "member", companyId: "c", amountCents: 100 } as const;

  it("avance d'une étape, revient en arrière tant que l'affaire est ouverte", () => {
    expect(() => assertOpportunityTransition("NEW", "QUALIFIED", won)).not.toThrow();
    expect(() => assertOpportunityTransition("NEGOTIATION", "NEW", won)).not.toThrow();
    expect(() => assertOpportunityTransition("NEW", "NEGOTIATION", won)).toThrow(ConflictError);
  });

  it("toute transition listée passe, toute autre lève ConflictError", () => {
    for (const from of OPPORTUNITY_STAGES) {
      for (const to of OPPORTUNITY_STAGES) {
        const context = { ...won, role: "admin" as const, lostReason: "Budget" };
        const allowed =
          OPPORTUNITY_TRANSITIONS[from].includes(to) ||
          OPPORTUNITY_REOPEN_TRANSITIONS[from].includes(to);
        if (allowed) expect(() => assertOpportunityTransition(from, to, context)).not.toThrow();
        else expect(() => assertOpportunityTransition(from, to, context)).toThrow(ConflictError);
      }
    }
  });

  it("LOST exige un motif", () => {
    expect(() => assertOpportunityTransition("QUALIFIED", "LOST", { role: "member" })).toThrow(
      ConflictError,
    );
    expect(() =>
      assertOpportunityTransition("QUALIFIED", "LOST", { role: "member", lostReason: "  " }),
    ).toThrow(ConflictError);
    expect(() =>
      assertOpportunityTransition("QUALIFIED", "LOST", { role: "member", lostReason: "Budget" }),
    ).not.toThrow();
  });

  it("WON exige un client et un montant", () => {
    expect(() =>
      assertOpportunityTransition("NEGOTIATION", "WON", { role: "member", amountCents: 100 }),
    ).toThrow(ConflictError);
    expect(() =>
      assertOpportunityTransition("NEGOTIATION", "WON", { role: "member", companyId: "c" }),
    ).toThrow(ConflictError);
    expect(() =>
      assertOpportunityTransition("NEGOTIATION", "WON", {
        role: "member",
        companyId: "c",
        amountCents: 0,
      }),
    ).toThrow(ConflictError);
    expect(() => assertOpportunityTransition("NEGOTIATION", "WON", won)).not.toThrow();
  });

  it("réserve la réouverture à admin", () => {
    expect(() => assertOpportunityTransition("WON", "NEGOTIATION", { role: "member" })).toThrow(
      /réservée aux associés/,
    );
    expect(() => assertOpportunityTransition("LOST", "NEW", { role: "viewer" })).toThrow(
      ConflictError,
    );
    expect(() => assertOpportunityTransition("LOST", "NEW", { role: "admin" })).not.toThrow();
    expect(canOpportunityTransition("LOST", "NEW", "member")).toBe(false);
    expect(canOpportunityTransition("LOST", "NEW", "admin")).toBe(true);
    expect(canOpportunityTransition("NEW", "QUALIFIED", "viewer")).toBe(true);
  });

  it("ne connaît que WON et LOST comme affaires closes", () => {
    expect(OPPORTUNITY_STAGES.filter(isOpportunityClosed)).toEqual(["WON", "LOST"]);
  });
});
