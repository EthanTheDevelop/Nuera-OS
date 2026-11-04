/**
 * Contrat du port CRM, exécuté à l'identique sur la passerelle réelle (`npm run test:live`) et sur
 * la fausse passerelle (`npm test`) : c'est ce qui garantit que le faux se comporte comme Twenty.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CrmDuplicateError,
  type CrmGateway,
  type CrmPage,
  type CrmPageOptions,
} from "@/integrations/twenty/crm-gateway";
import { NotFoundError, ValidationError } from "@/server/errors";

export type CrmContractHarness = {
  gateway: CrmGateway;
  /** Mémorise un enregistrement à purger après le test (sans effet pour le faux). */
  track: (kind: "company" | "person" | "opportunity" | "note" | "task", id: string) => void;
};

async function collect<T extends { id: string }>(
  fetchPage: (options: CrmPageOptions) => Promise<CrmPage<T>>,
  options: CrmPageOptions,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const result = await fetchPage({ ...options, cursor });
    items.push(...result.items);
    if (!result.nextCursor) return items;
    cursor = result.nextCursor;
  }
  throw new Error("Pagination sans fin");
}

export function describeCrmGatewayContract(
  label: string,
  setup: () => Promise<CrmContractHarness> | CrmContractHarness,
): void {
  describe(`contrat du port CRM : ${label}`, () => {
    let crm: CrmGateway;
    let track: CrmContractHarness["track"];
    const tag = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const domain = (name: string) => `${name}-${tag}.example`;
    const email = (name: string) => `${name}.${tag}@example.com`;

    const newCompany = async (name: string, withDomain = false) => {
      const company = await crm.createCompany({
        name: `Contrat ${name} ${tag}`,
        ...(withDomain ? { domains: { primary: domain(name), additional: [] } } : {}),
      });
      track("company", company.id);
      return company;
    };

    const newPerson = async (name: string, companyId?: string) => {
      const person = await crm.createPerson({
        firstName: "Contrat",
        lastName: name,
        emails: { primary: email(name), additional: [] },
        companyId: companyId ?? null,
      });
      track("person", person.id);
      return person;
    };

    beforeAll(async () => {
      const harness = await setup();
      crm = harness.gateway;
      track = harness.track;
    });

    describe("entreprises", () => {
      it("crée, relit, normalise le domaine et distingue les champs vides", async () => {
        const company = await crm.createCompany({
          name: "Société Générale de Test",
          domains: {
            primary: `https://WWW.${domain("norm").toUpperCase()}/chemin?x=1`,
            additional: [],
          },
          linkedinUrl: "https://www.linkedin.com/company/nuera",
          address: { city: "Lyon", postcode: "69001", country: "France" },
        });
        track("company", company.id);

        expect(company.domains).toEqual({ primary: domain("norm"), additional: [] });
        expect(company.linkedinUrl).toBe("https://www.linkedin.com/company/nuera");
        expect(company.address).toMatchObject({ city: "Lyon", postcode: "69001", street1: null });
        expect(company.deletedAt).toBeNull();
        await expect(crm.getCompany(company.id)).resolves.toEqual(company);
      });

      it("met à jour sans toucher au reste ; l'adresse se fusionne, les domaines se remplacent", async () => {
        const company = await crm.createCompany({
          name: `Partiel ${tag}`,
          domains: { primary: domain("part"), additional: [domain("part-alt")] },
          address: { city: "Lyon", postcode: "69001" },
        });
        track("company", company.id);

        const renamed = await crm.updateCompany(company.id, {
          name: "Renommée",
          address: { city: "Paris" },
        });
        expect(renamed.name).toBe("Renommée");
        expect(renamed.domains.additional).toEqual([domain("part-alt")]);
        expect(renamed.address).toMatchObject({ city: "Paris", postcode: "69001" });
        expect(Date.parse(renamed.updatedAt)).toBeGreaterThan(Date.parse(company.updatedAt));

        const cleared = await crm.updateCompany(company.id, {
          domains: { primary: null, additional: [] },
          linkedinUrl: null,
        });
        expect(cleared.domains).toEqual({ primary: null, additional: [] });
        expect(cleared.linkedinUrl).toBeNull();
      });

      it("détecte un domaine en double, à la création comme à la modification", async () => {
        const first = await newCompany("dup", true);
        const error = await crm
          .createCompany({
            name: "Autre",
            domains: { primary: `http://www.${domain("dup")}/`, additional: [] },
          })
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(CrmDuplicateError);
        expect(error).toMatchObject({
          field: "domain",
          existing: { id: first.id, deleted: false },
        });

        const other = await newCompany("dup-other");
        await expect(
          crm.updateCompany(other.id, { domains: { primary: domain("dup"), additional: [] } }),
        ).rejects.toBeInstanceOf(CrmDuplicateError);
      });

      it("accepte plusieurs entreprises de même nom ou sans domaine", async () => {
        const a = await newCompany("homonyme");
        const b = await crm.createCompany({ name: a.name });
        track("company", b.id);
        expect(b.id).not.toBe(a.id);
      });

      it("refuse un domaine invalide", async () => {
        await expect(
          crm.createCompany({ name: "x", domains: { primary: "pas un domaine", additional: [] } }),
        ).rejects.toBeInstanceOf(ValidationError);
      });

      it("rend une création rejouable grâce à l'identifiant fourni", async () => {
        const id = randomUUID();
        const created = await crm.createCompany({ id, name: `Rejeu ${tag}` });
        track("company", id);
        expect(created.id).toBe(id);
        const replayed = await crm.createCompany({ id, name: "Ignoré au rejeu" });
        expect(replayed.id).toBe(id);
        expect(replayed.name).toBe(`Rejeu ${tag}`);
      });

      it("archive : invisible à la lecture, domaine réservé, restaurable", async () => {
        const company = await newCompany("arch", true);
        await crm.deleteCompany(company.id);

        await expect(crm.getCompany(company.id)).rejects.toBeInstanceOf(NotFoundError);
        await expect(crm.deleteCompany(company.id)).rejects.toBeInstanceOf(NotFoundError);

        const error = await crm
          .createCompany({ name: "x", domains: { primary: domain("arch"), additional: [] } })
          .catch((caught: unknown) => caught);
        expect(error).toMatchObject({
          field: "domain",
          existing: { id: company.id, deleted: true },
        });

        const restored = await crm.restoreCompany(company.id);
        expect(restored.deletedAt).toBeNull();
        await expect(crm.getCompany(company.id)).resolves.toMatchObject({ id: company.id });
      });

      it("n'archive pas en cascade les personnes et opportunités liées", async () => {
        const company = await newCompany("cascade");
        const person = await newPerson("cascade", company.id);
        const opportunity = await crm.createOpportunity({
          name: `Cascade ${tag}`,
          companyId: company.id,
        });
        track("opportunity", opportunity.id);

        await crm.deleteCompany(company.id);
        await expect(crm.getPerson(person.id)).resolves.toMatchObject({
          companyId: company.id,
          deletedAt: null,
        });
        await expect(crm.getOpportunity(opportunity.id)).resolves.toMatchObject({
          companyId: company.id,
          deletedAt: null,
        });
      });

      it("signale un identifiant absent ou mal formé", async () => {
        await expect(crm.getCompany(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
        await expect(crm.updateCompany(randomUUID(), { name: "x" })).rejects.toBeInstanceOf(
          NotFoundError,
        );
        await expect(crm.deleteCompany(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
        await expect(crm.getCompany("pas-un-uuid")).rejects.toBeInstanceOf(ValidationError);
      });

      it("pagine par curseur, trié par date de modification, archivés sur demande", async () => {
        const since = new Date(Date.now() - 2_000).toISOString();
        const created = [];
        for (let index = 0; index < 5; index += 1) {
          created.push(await newCompany(`page-${index}`));
        }
        const archived = created[0]!;
        await crm.deleteCompany(archived.id);

        const live = await collect((options) => crm.listCompanies(options), {
          updatedSince: since,
          limit: 2,
        });
        const liveIds = live.map((company) => company.id);
        expect(liveIds).not.toContain(archived.id);
        for (const company of created.slice(1)) expect(liveIds).toContain(company.id);
        const times = live.map((company) => Date.parse(company.updatedAt));
        expect(times).toEqual([...times].sort((a, b) => a - b));

        const all = await collect((options) => crm.listCompanies(options), {
          updatedSince: since,
          limit: 2,
          includeDeleted: true,
        });
        const seen = all.find((company) => company.id === archived.id);
        expect(seen?.deletedAt).not.toBeNull();
        expect(new Set(all.map((company) => company.id)).size).toBe(all.length);

        const later = await crm.listCompanies({
          updatedSince: new Date(Date.now() + 60_000).toISOString(),
        });
        expect(later).toEqual({ items: [], nextCursor: null });
      });

      it("fusionne : le gagnant garde son identifiant, le perdant disparaît, les liens suivent", async () => {
        const winner = await newCompany("win", true);
        const loser = await crm.createCompany({
          name: `Perdant ${tag}`,
          domains: { primary: domain("lose"), additional: [] },
          address: { city: "Nantes" },
        });
        const person = await newPerson("fusion", loser.id);
        const opportunity = await crm.createOpportunity({
          name: `Fusion ${tag}`,
          companyId: loser.id,
          pointOfContactId: person.id,
        });
        track("opportunity", opportunity.id);
        const note = await crm.createNote({
          title: `Fusion ${tag}`,
          targets: [{ type: "company", id: loser.id }],
        });
        track("note", note.id);

        const { merged, removedIds } = await crm.mergeCompanies({
          winnerId: winner.id,
          loserIds: [loser.id],
        });
        expect(merged.id).toBe(winner.id);
        expect(merged.name).toBe(winner.name);
        expect(merged.domains).toEqual({ primary: domain("win"), additional: [domain("lose")] });
        expect(merged.address.city).toBe("Nantes");
        expect(removedIds).toEqual([loser.id]);

        await expect(crm.getCompany(loser.id)).rejects.toBeInstanceOf(NotFoundError);
        const everything = await collect((options) => crm.listCompanies(options), {
          updatedSince: new Date(Date.now() - 5_000).toISOString(),
          includeDeleted: true,
        });
        expect(everything.map((company) => company.id)).not.toContain(loser.id);

        const movedPerson = await crm.getPerson(person.id);
        expect(movedPerson.companyId).toBe(winner.id);
        expect(Date.parse(movedPerson.updatedAt)).toBeGreaterThan(Date.parse(person.updatedAt));
        await expect(crm.getOpportunity(opportunity.id)).resolves.toMatchObject({
          companyId: winner.id,
        });
        await expect(crm.getNote(note.id)).resolves.toMatchObject({
          targets: [{ type: "company", id: winner.id }],
        });
      });

      it("refuse une fusion incomplète ou portant sur une fiche absente", async () => {
        const company = await newCompany("merge-ko");
        await expect(
          crm.mergeCompanies({ winnerId: company.id, loserIds: [] }),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(
          crm.mergeCompanies({ winnerId: company.id, loserIds: [company.id] }),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(
          crm.mergeCompanies({ winnerId: company.id, loserIds: [randomUUID()] }),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe("personnes", () => {
      it("crée une personne liée à une entreprise, e-mail en minuscules, téléphone international", async () => {
        const company = await newCompany("people");
        const person = await crm.createPerson({
          firstName: "Éa",
          lastName: "Noël",
          emails: {
            primary: email("Mixed.Case").toUpperCase(),
            additional: [email("alt")],
          },
          phones: { primary: "+33612345678", additional: ["+14155552671"] },
          jobTitle: "Directrice",
          companyId: company.id,
        });
        track("person", person.id);

        expect(person).toMatchObject({
          firstName: "Éa",
          lastName: "Noël",
          emails: { primary: email("Mixed.Case").toLowerCase(), additional: [email("alt")] },
          phones: { primary: "+33612345678", additional: ["+14155552671"] },
          jobTitle: "Directrice",
          companyId: company.id,
        });
        await expect(crm.getPerson(person.id)).resolves.toEqual(person);
      });

      it("met à jour : nom partiel, e-mails et téléphones remplacés, entreprise retirée", async () => {
        const company = await newCompany("people-up");
        const person = await crm.createPerson({
          firstName: "Avant",
          lastName: "Conservé",
          emails: { primary: email("up"), additional: [email("up-alt")] },
          phones: { primary: "+33612345678", additional: ["+14155552671"] },
          jobTitle: "Poste",
          companyId: company.id,
        });
        track("person", person.id);

        expect(await crm.updatePerson(person.id, { firstName: "Après" })).toMatchObject({
          firstName: "Après",
          lastName: "Conservé",
          emails: { primary: email("up"), additional: [email("up-alt")] },
        });
        expect(
          await crm.updatePerson(person.id, {
            emails: { primary: email("up-new"), additional: [] },
            phones: { primary: "+33698765432", additional: [] },
            jobTitle: null,
            companyId: null,
          }),
        ).toMatchObject({
          emails: { primary: email("up-new"), additional: [] },
          phones: { primary: "+33698765432", additional: [] },
          jobTitle: null,
          companyId: null,
        });
        expect(
          await crm.updatePerson(person.id, {
            emails: { primary: null, additional: [] },
            phones: { primary: null, additional: [] },
          }),
        ).toMatchObject({
          emails: { primary: null, additional: [] },
          phones: { primary: null, additional: [] },
        });
      });

      it("détecte un e-mail principal en double, sans regarder les e-mails secondaires", async () => {
        const first = await newPerson("dup");
        const error = await crm
          .createPerson({
            firstName: "x",
            lastName: "y",
            emails: { primary: email("dup").toUpperCase(), additional: [] },
          })
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(CrmDuplicateError);
        expect(error).toMatchObject({ field: "email", existing: { id: first.id, deleted: false } });

        const secondary = await crm.createPerson({
          firstName: "x",
          lastName: "y",
          emails: { primary: email("dup-other"), additional: [email("dup")] },
        });
        track("person", secondary.id);

        const sameName = await crm.createPerson({ firstName: "x", lastName: "y" });
        track("person", sameName.id);
        expect(sameName.emails).toEqual({ primary: null, additional: [] });
      });

      it("refuse e-mail et téléphone invalides, et une entreprise inexistante", async () => {
        await expect(
          crm.createPerson({
            firstName: "x",
            lastName: "y",
            emails: { primary: "pas-un-email", additional: [] },
          }),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(
          crm.createPerson({
            firstName: "x",
            lastName: "y",
            phones: { primary: "0612345678", additional: [] },
          }),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(
          crm.createPerson({ firstName: "x", lastName: "y", companyId: randomUUID() }),
        ).rejects.toBeInstanceOf(ValidationError);
      });

      it("archive en gardant l'e-mail réservé, puis restaure", async () => {
        const person = await newPerson("arch");
        await crm.deletePerson(person.id);
        await expect(crm.getPerson(person.id)).rejects.toBeInstanceOf(NotFoundError);
        await expect(
          crm.createPerson({
            firstName: "x",
            lastName: "y",
            emails: { primary: email("arch"), additional: [] },
          }),
        ).rejects.toMatchObject({ field: "email", existing: { id: person.id, deleted: true } });
        await expect(crm.restorePerson(person.id)).resolves.toMatchObject({ deletedAt: null });
      });

      it("liste depuis un curseur et fusionne les e-mails sur le gagnant", async () => {
        const since = new Date(Date.now() - 2_000).toISOString();
        const winner = await newPerson("win");
        const loser = await crm.createPerson({
          firstName: "Perdant",
          lastName: "Fusion",
          emails: { primary: email("lose"), additional: [] },
          jobTitle: "CTO",
          phones: { primary: "+33612345678", additional: [] },
        });

        const listed = await collect((options) => crm.listPeople(options), { updatedSince: since });
        expect(listed.map((person) => person.id)).toEqual(
          expect.arrayContaining([winner.id, loser.id]),
        );

        const { merged, removedIds } = await crm.mergePeople({
          winnerId: winner.id,
          loserIds: [loser.id],
        });
        expect(merged).toMatchObject({
          id: winner.id,
          lastName: winner.lastName,
          emails: { primary: email("win"), additional: [email("lose")] },
          jobTitle: "CTO",
          phones: { primary: "+33612345678", additional: [] },
        });
        expect(removedIds).toEqual([loser.id]);
        await expect(crm.getPerson(loser.id)).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe("opportunités", () => {
      it("crée avec montant en centimes, étape, date, entreprise et contact", async () => {
        const company = await newCompany("opp");
        const person = await newPerson("opp", company.id);
        const opportunity = await crm.createOpportunity({
          name: `Refonte ${tag}`,
          stage: "QUOTE_SENT",
          amount: { cents: 1_234_567, currency: "EUR" },
          closeDate: "2027-03-15",
          companyId: company.id,
          pointOfContactId: person.id,
        });
        track("opportunity", opportunity.id);

        expect(opportunity).toMatchObject({
          stage: "QUOTE_SENT",
          amount: { cents: 1_234_567, currency: "EUR" },
          closeDate: "2027-03-15",
          companyId: company.id,
          pointOfContactId: person.id,
        });
        await expect(crm.getOpportunity(opportunity.id)).resolves.toEqual(opportunity);
      });

      it("applique les valeurs par défaut et accepte les six étapes", async () => {
        const opportunity = await crm.createOpportunity({ name: `Défauts ${tag}` });
        track("opportunity", opportunity.id);
        expect(opportunity).toMatchObject({
          stage: "NEW",
          amount: null,
          closeDate: null,
          companyId: null,
          pointOfContactId: null,
        });
        for (const stage of [
          "QUALIFIED",
          "QUOTE_SENT",
          "NEGOTIATION",
          "WON",
          "LOST",
          "NEW",
        ] as const) {
          const updated = await crm.updateOpportunity(opportunity.id, { stage });
          expect(updated.stage).toBe(stage);
        }
      });

      it("met à jour et efface montant, date, entreprise et contact", async () => {
        const company = await newCompany("opp-up");
        const opportunity = await crm.createOpportunity({
          name: `Maj ${tag}`,
          amount: { cents: 100, currency: "EUR" },
          closeDate: "2027-01-01",
          companyId: company.id,
        });
        track("opportunity", opportunity.id);

        expect(
          await crm.updateOpportunity(opportunity.id, {
            amount: { cents: 99_999, currency: "EUR" },
          }),
        ).toMatchObject({ amount: { cents: 99_999, currency: "EUR" }, closeDate: "2027-01-01" });
        expect(
          await crm.updateOpportunity(opportunity.id, {
            amount: null,
            closeDate: null,
            companyId: null,
          }),
        ).toMatchObject({ amount: null, closeDate: null, companyId: null });
      });

      it("refuse un montant ou une date invalides sans appeler le CRM", async () => {
        await expect(
          crm.createOpportunity({ name: "x", amount: { cents: 1.5, currency: "EUR" } }),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(
          crm.createOpportunity({ name: "x", amount: { cents: -1, currency: "EUR" } }),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(
          crm.createOpportunity({ name: "x", closeDate: "15/03/2027" }),
        ).rejects.toBeInstanceOf(ValidationError);
      });

      it("liste depuis un curseur, archive et restaure", async () => {
        const since = new Date(Date.now() - 2_000).toISOString();
        const opportunity = await crm.createOpportunity({ name: `Liste ${tag}` });
        track("opportunity", opportunity.id);
        const listed = await collect((options) => crm.listOpportunities(options), {
          updatedSince: since,
        });
        expect(listed.map((item) => item.id)).toContain(opportunity.id);

        await crm.deleteOpportunity(opportunity.id);
        await expect(crm.getOpportunity(opportunity.id)).rejects.toBeInstanceOf(NotFoundError);
        const withDeleted = await collect((options) => crm.listOpportunities(options), {
          updatedSince: since,
          includeDeleted: true,
        });
        expect(withDeleted.find((item) => item.id === opportunity.id)?.deletedAt).not.toBeNull();

        await expect(crm.restoreOpportunity(opportunity.id)).resolves.toMatchObject({
          deletedAt: null,
        });
      });
    });

    describe("notes", () => {
      it("exige une cible et refuse une cible inexistante sans laisser d'orpheline", async () => {
        await expect(crm.createNote({ title: "x", targets: [] })).rejects.toBeInstanceOf(
          ValidationError,
        );
        const before = new Date(Date.now() - 1_000).toISOString();
        const title = `Orpheline ${tag}`;
        await expect(
          crm.createNote({ title, targets: [{ type: "company", id: randomUUID() }] }),
        ).rejects.toBeInstanceOf(ValidationError);
        const notes = await collect((options) => crm.listNotes(options), { updatedSince: before });
        expect(notes.map((note) => note.title)).not.toContain(title);
      });

      it("lie une note à une entreprise, une personne et une opportunité", async () => {
        const company = await newCompany("note");
        const person = await newPerson("note", company.id);
        const opportunity = await crm.createOpportunity({ name: `Note ${tag}` });
        track("opportunity", opportunity.id);

        const note = await crm.createNote({
          title: `Compte rendu ${tag}`,
          bodyMarkdown: "# Titre\n\nCorps **gras**",
          targets: [
            { type: "company", id: company.id },
            { type: "person", id: person.id },
            { type: "opportunity", id: opportunity.id },
            { type: "company", id: company.id },
          ],
        });
        track("note", note.id);

        expect(note.bodyMarkdown).toBe("# Titre\n\nCorps **gras**");
        expect(note.targets).toHaveLength(3);
        const reread = await crm.getNote(note.id);
        expect(reread.targets).toEqual(expect.arrayContaining(note.targets));
        expect(reread.targets).toHaveLength(3);
      });

      it("modifie le texte et remplace les cibles en signalant la modification", async () => {
        const company = await newCompany("note-up");
        const person = await newPerson("note-up");
        const note = await crm.createNote({
          title: `Maj ${tag}`,
          targets: [{ type: "company", id: company.id }],
        });
        track("note", note.id);
        expect(note.bodyMarkdown).toBeNull();

        const body = await crm.updateNote(note.id, { title: "Nouveau", bodyMarkdown: "Texte" });
        expect(body).toMatchObject({
          title: "Nouveau",
          bodyMarkdown: "Texte",
          targets: [{ type: "company", id: company.id }],
        });

        const moved = await crm.updateNote(note.id, {
          targets: [{ type: "person", id: person.id }],
        });
        expect(moved.targets).toEqual([{ type: "person", id: person.id }]);
        expect(Date.parse(moved.updatedAt)).toBeGreaterThan(Date.parse(body.updatedAt));

        const back = await crm.updateNote(note.id, {
          targets: [
            { type: "company", id: company.id },
            { type: "person", id: person.id },
          ],
        });
        expect(back.targets).toHaveLength(2);

        await expect(crm.updateNote(note.id, { targets: [] })).rejects.toBeInstanceOf(
          ValidationError,
        );
        await expect(
          crm.updateNote(randomUUID(), { targets: [{ type: "person", id: person.id }] }),
        ).rejects.toBeInstanceOf(NotFoundError);
      });

      it("rejoue une création en complétant les liens manquants", async () => {
        const company = await newCompany("note-replay");
        const person = await newPerson("note-replay");
        const id = randomUUID();
        await crm.createNote({
          id,
          title: `Rejeu ${tag}`,
          targets: [{ type: "company", id: company.id }],
        });
        track("note", id);

        const replayed = await crm.createNote({
          id,
          title: "Ignoré",
          targets: [
            { type: "company", id: company.id },
            { type: "person", id: person.id },
          ],
        });
        expect(replayed.title).toBe(`Rejeu ${tag}`);
        expect(replayed.targets).toHaveLength(2);
      });

      it("archive une note avec ses liens et expose les changements de liens", async () => {
        const since = new Date(Date.now() - 2_000).toISOString();
        const company = await newCompany("note-del");
        const note = await crm.createNote({
          title: `Archive ${tag}`,
          targets: [{ type: "company", id: company.id }],
        });
        track("note", note.id);

        const listLinks = () =>
          collect((options) => crm.listActivityLinks({ ...options, activityType: "note" }), {
            updatedSince: since,
            includeDeleted: true,
          });
        const links = (await listLinks()).filter((link) => link.activityId === note.id);
        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({
          activityType: "note",
          deletedAt: null,
          target: { type: "company", id: company.id },
        });

        await crm.deleteNote(note.id);
        await expect(crm.getNote(note.id)).rejects.toBeInstanceOf(NotFoundError);

        const archivedLinks = (await listLinks()).filter((link) => link.activityId === note.id);
        expect(archivedLinks[0]?.deletedAt).not.toBeNull();

        const notes = await collect((options) => crm.listNotes(options), {
          updatedSince: since,
          includeDeleted: true,
        });
        const archived = notes.find((item) => item.id === note.id);
        expect(archived?.deletedAt).not.toBeNull();
        expect(archived?.targets).toEqual([]);
      });
    });

    describe("tâches", () => {
      it("crée, modifie, termine et liste une tâche liée", async () => {
        const since = new Date(Date.now() - 2_000).toISOString();
        const company = await newCompany("task");
        const opportunity = await crm.createOpportunity({ name: `Tâche ${tag}` });
        track("opportunity", opportunity.id);

        const task = await crm.createTask({
          title: `Relancer ${tag}`,
          bodyMarkdown: "Appeler",
          dueAt: "2027-01-02T10:00:00.000Z",
          targets: [
            { type: "company", id: company.id },
            { type: "opportunity", id: opportunity.id },
          ],
        });
        track("task", task.id);
        expect(task).toMatchObject({
          status: "TODO",
          bodyMarkdown: "Appeler",
          dueAt: "2027-01-02T10:00:00.000Z",
        });
        expect(task.targets).toHaveLength(2);

        const started = await crm.updateTask(task.id, { status: "IN_PROGRESS", dueAt: null });
        expect(started).toMatchObject({ status: "IN_PROGRESS", dueAt: null });
        expect(started.targets).toHaveLength(2);

        const done = await crm.completeTask(task.id);
        expect(done.status).toBe("DONE");
        expect(done.targets).toHaveLength(2);
        await expect(crm.getTask(task.id)).resolves.toMatchObject({ status: "DONE" });

        const moved = await crm.updateTask(task.id, {
          targets: [{ type: "company", id: company.id }],
        });
        expect(moved.targets).toEqual([{ type: "company", id: company.id }]);

        const links = await collect(
          (options) => crm.listActivityLinks({ ...options, activityType: "task" }),
          { updatedSince: since, includeDeleted: true },
        );
        const own = links.filter((link) => link.activityId === task.id);
        expect(own).toHaveLength(2);
        expect(own.filter((link) => link.deletedAt !== null)).toHaveLength(1);

        const listed = await collect((options) => crm.listTasks(options), { updatedSince: since });
        expect(listed.find((item) => item.id === task.id)?.targets).toEqual([
          { type: "company", id: company.id },
        ]);

        await crm.deleteTask(task.id);
        await expect(crm.getTask(task.id)).rejects.toBeInstanceOf(NotFoundError);
        await expect(crm.completeTask(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
      });

      it("exige une cible", async () => {
        await expect(crm.createTask({ title: "x", targets: [] })).rejects.toBeInstanceOf(
          ValidationError,
        );
      });
    });

    it("décrit son état", async () => {
      expect(crm.isConfigured).toBe(true);
      const health = await crm.health();
      expect(health.reachable).toBe(true);
      expect(health.authenticated).toBe(true);
      expect(health.version).toEqual(expect.any(String));
    });
  });
}
