import { describe, expect, it } from "vitest";
import { describeCrmGatewayContract } from "../../../tests/helpers/crm-gateway.contract";
import { FakeCrmGateway } from "../../../tests/helpers/fake-crm-gateway";
import { IntegrationUnavailableError } from "./crm-gateway";

describeCrmGatewayContract("fausse passerelle", () => ({
  gateway: new FakeCrmGateway(),
  track: () => undefined,
}));

describe("FakeCrmGateway.simulateOutage", () => {
  it("lève la même erreur qu'une vraie panne sur chaque méthode, puis reprend", async () => {
    const crm = new FakeCrmGateway();
    const company = await crm.createCompany({ name: "Avant la panne" });

    crm.simulateOutage();
    await expect(crm.getCompany(company.id)).rejects.toBeInstanceOf(IntegrationUnavailableError);
    await expect(crm.createCompany({ name: "x" })).rejects.toMatchObject({ reason: "unreachable" });
    await expect(crm.listTasks()).rejects.toBeInstanceOf(IntegrationUnavailableError);
    await expect(crm.completeTask(company.id)).rejects.toBeInstanceOf(IntegrationUnavailableError);
    await expect(crm.health()).rejects.toBeInstanceOf(IntegrationUnavailableError);

    crm.simulateOutage("rate_limited");
    await expect(crm.listPeople()).rejects.toMatchObject({ reason: "rate_limited" });

    crm.endOutage();
    await expect(crm.getCompany(company.id)).resolves.toMatchObject({ name: "Avant la panne" });
  });
});
