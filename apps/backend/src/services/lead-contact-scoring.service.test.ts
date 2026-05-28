import assert from "node:assert/strict";
import test from "node:test";
import {
  scoreLeadContactDeterministically,
  scoreLeadContacts,
  type LeadContactScoringContactInput,
  type LeadContactScoringLeadInput,
} from "./lead-contact-scoring.service.js";

const lead: LeadContactScoringLeadInput = {
  orgId: "00000000-0000-0000-0000-000000000001",
  hubspotLeadId: "lead-1",
  name: "ACME",
  companyName: "ACME",
  pipelineLabel: "Pipeline de leads",
  phaseId: "connected",
  phaseLabel: "Connecté",
  hubspotOwnerId: "owner-1",
  lastActivityAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
};

const contact = (overrides: Partial<LeadContactScoringContactInput>): LeadContactScoringContactInput => ({
  hubspotContactId: "contact-1",
  hubspotOwnerId: "owner-1",
  name: "Alex Martin",
  title: "Directeur Commercial",
  email: "alex@example.com",
  phone: "+33123456789",
  lifecycleStage: "salesqualifiedlead",
  leadStatus: "open",
  lastActivityAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  ...overrides,
});

test("scores callable senior contacts above incomplete contacts", () => {
  const senior = scoreLeadContactDeterministically(lead, contact({ hubspotContactId: "senior" }));
  const incomplete = scoreLeadContactDeterministically(
    lead,
    contact({
      hubspotContactId: "incomplete",
      title: null,
      email: null,
      phone: null,
      lastActivityAt: null,
    }),
  );

  assert.equal(senior.priority, "urgent");
  assert.ok(senior.finalScore > incomplete.finalScore);
  assert.match(senior.recommendedAction, /Appeler/);
  assert.match(incomplete.reason, /coordonnees manquantes|donnees CRM limitees/);
});

test("sorts scored contacts by final score descending", () => {
  const ranked = scoreLeadContacts(lead, [
    contact({
      hubspotContactId: "low",
      title: null,
      email: null,
      phone: null,
      lastActivityAt: null,
    }),
    contact({
      hubspotContactId: "high",
      title: "CEO",
      phone: "+33111111111",
    }),
  ]);

  assert.equal(ranked[0]?.hubspotContactId, "high");
  assert.equal(ranked[1]?.hubspotContactId, "low");
});
