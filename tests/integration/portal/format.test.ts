import { describe, expect, it } from "vitest";
import { buildInvitationEmail } from "@/modules/portal/portal.email";
import {
  buildAppointmentIcs,
  clientTicketStatus,
  clientTicketTimeline,
  daysUntil,
  deliveryPromise,
  describeDevice,
  formatDayMonth,
  joinNames,
} from "@/modules/portal/portal.format";

describe("fonctions pures du portail", () => {
  it("assemble les noms sans figer deux personnes", () => {
    expect(joinNames([])).toBe("Nuera Studio");
    expect(joinNames(["Hugo"])).toBe("Hugo");
    expect(joinNames(["Hugo", "Camille"])).toBe("Hugo et Camille");
    expect(joinNames(["Hugo", "Camille", "Léa"])).toBe("Hugo, Camille et Léa");
  });

  it("compte les jours à l'heure de Paris", () => {
    const now = new Date("2026-11-03T23:30:00Z"); // déjà le 4 à Paris
    expect(daysUntil("2026-11-18", now)).toBe(14);
    expect(deliveryPromise("2026-11-18", now)).toEqual({
      label: "Dans 14 jours · dans les temps",
      onTime: true,
    });
    expect(deliveryPromise("2026-11-01", now).onTime).toBe(false);
    expect(formatDayMonth("2026-11-18")).toBe("18 novembre");
  });

  it("garde les états internes pour l'agence", () => {
    expect(clientTicketStatus("qualified").label).toBe("Reçue");
    expect(clientTicketStatus("resolved").label).toBe("Faite");
    const at = new Date();
    expect(
      clientTicketTimeline([
        { status: "received", at },
        { status: "qualified", at },
        { status: "in_progress", at },
      ]).map((row) => row.label),
    ).toEqual(["Reçue", "En cours"]);
  });

  it("nomme un appareil", () => {
    expect(describeDevice(null)).toBe("Appareil inconnu");
    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone · Safari");
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0",
      ),
    ).toBe("PC · Edge");
  });

  it("échappe le texte d'un fichier agenda", () => {
    const ics = buildAppointmentIcs({
      id: "abc",
      title: "Revue; galerie, v2\nsuite",
      startsAt: new Date("2026-11-20T09:00:00Z"),
      durationMinutes: 30,
      location: null,
      now: new Date("2026-11-01T00:00:00Z"),
    });
    expect(ics).toContain("SUMMARY:Revue\\; galerie\\, v2\\nsuite");
    expect(ics).not.toContain("LOCATION");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("échappe ce qui vient de la base dans l'e-mail C1", () => {
    const mail = buildInvitationEmail({
      firstName: "<script>",
      projectName: "A&B",
      interlocutors: "Hugo et Camille",
      url: "http://x/?a=1&b=2",
      host: "app.test",
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("A&amp;B");
    expect(mail.html).toContain("a=1&amp;b=2");
    expect(mail.text).toContain("http://x/?a=1&b=2");
    expect(mail.subject).toBe("Votre espace projet Nuera est prêt");
  });
});
