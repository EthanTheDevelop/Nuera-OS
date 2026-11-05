import type { PortalContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { getCompanyRef } from "./company.lookup";
import * as repository from "./contact.repository";

export interface PortalIdentity {
  companyName: string;
  firstName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

/**
 * Identité du client connecté, depuis la projection locale : son contact et le nom de son
 * entreprise, rien d'autre (ni notes, ni rôles, ni statut commercial).
 */
export async function getPortalIdentity(
  ctx: Pick<PortalContext, "db" | "companyId" | "contactId">,
): Promise<PortalIdentity> {
  const [contact, company] = await Promise.all([
    repository.findContactById(ctx.db, ctx.contactId),
    getCompanyRef(ctx.db, ctx.companyId),
  ]);
  if (!contact || contact.companyId !== ctx.companyId || !company) throw new NotFoundError();
  return {
    companyName: company.name,
    firstName: contact.firstName,
    fullName: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    email: contact.email,
    phone: contact.phone,
  };
}
