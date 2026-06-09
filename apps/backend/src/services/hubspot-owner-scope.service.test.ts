import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HubSpotOwner } from "./hubspot.service.js";
import { selectRealtimeOwnerIdsFromCrmOwners } from "./hubspot-owner-scope.service.js";

describe("selectRealtimeOwnerIdsFromCrmOwners", () => {
  it("privilegie les owners actifs de l'equipe Sales AE quand HubSpot expose les equipes", () => {
    const owners: HubSpotOwner[] = [
      { id: "hugo", archived: false, teams: [{ id: "team-sales", name: "Sales AE", primary: true }] },
      { id: "ops", archived: false, teams: [{ id: "team-ops", name: "Ops", primary: true }] },
      { id: "old-ae", archived: true, teams: [{ id: "team-sales", name: "Sales AE", primary: true }] },
    ];

    assert.deepEqual(Array.from(selectRealtimeOwnerIdsFromCrmOwners(owners)).sort(), ["hugo"]);
  });

  it("retombe sur tous les owners actifs du CRM si aucune equipe Sales AE n'est identifiable", () => {
    const owners: HubSpotOwner[] = [
      { id: "sofiane", archived: false, teams: [{ id: "team-a", name: "Account Executives", primary: true }] },
      { id: "samy", archived: false },
      { id: "archived", archived: true },
    ];

    assert.deepEqual(Array.from(selectRealtimeOwnerIdsFromCrmOwners(owners)).sort(), ["samy", "sofiane"]);
  });
});
