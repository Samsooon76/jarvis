import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPulseChange,
  mapDealPropertyToPulseEventType,
  parsePulsePreferencesInput,
} from "./pulse.service.js";

test("mappe les proprietes HubSpot deal vers les types d'evenements Pulse", () => {
  assert.equal(mapDealPropertyToPulseEventType("hs_deal_stage_probability"), "probability");
  assert.equal(mapDealPropertyToPulseEventType("probabilite_de__closing"), "probability");
  assert.equal(mapDealPropertyToPulseEventType("amount"), "amount");
  assert.equal(mapDealPropertyToPulseEventType("dealstage"), "stage");
  assert.equal(mapDealPropertyToPulseEventType("closedate"), "close_date");
  assert.equal(mapDealPropertyToPulseEventType("hubspot_owner_id"), "owner");
  assert.equal(mapDealPropertyToPulseEventType("pipeline"), "pipeline");
});

test("ignore les proprietes deal non suivies par Pulse", () => {
  assert.equal(mapDealPropertyToPulseEventType("dealname"), null);
  assert.equal(mapDealPropertyToPulseEventType(null), null);
});

test("construit un message Pulse avec transition avant -> apres", () => {
  const change = buildPulseChange({
    eventType: "probability",
    dealName: "Deal Acme",
    hubspotDealId: "123",
    previousValue: "40%",
    newValue: "60%",
  });

  assert.ok(change);
  assert.equal(change.title, "Probabilite de closing mise a jour");
  assert.equal(change.message, "Deal Acme : probabilite 40% -> 60%");
  assert.equal(change.previousValue, "40%");
  assert.equal(change.newValue, "60%");
});

test("retombe sur l'identifiant HubSpot quand le nom du deal est absent", () => {
  const change = buildPulseChange({
    eventType: "amount",
    dealName: null,
    hubspotDealId: "987",
    previousValue: null,
    newValue: "12 000 \u20ac",
  });

  assert.ok(change);
  assert.ok(change.message.startsWith("Deal HubSpot 987"));
  assert.ok(change.message.includes("non renseigne ->"));
});

test("ne genere rien quand la valeur ne change pas reellement", () => {
  const change = buildPulseChange({
    eventType: "stage",
    dealName: "Deal Acme",
    hubspotDealId: "123",
    previousValue: "Negociation",
    newValue: "Negociation",
  });

  assert.equal(change, null);
});

test("valide des preferences Pulse completes", () => {
  const preferences = parsePulsePreferencesInput({
    pulseEnabled: true,
    events: {
      probability: true,
      amount: false,
      stage: true,
      close_date: true,
      owner: false,
      pipeline: true,
    },
  });

  assert.ok(preferences);
  assert.equal(preferences.pulseEnabled, true);
  assert.equal(preferences.events.amount, false);
  assert.equal(preferences.events.stage, true);
});

test("rejette des preferences Pulse incompletes ou invalides", () => {
  assert.equal(parsePulsePreferencesInput(null), null);
  assert.equal(parsePulsePreferencesInput({ pulseEnabled: true }), null);
  assert.equal(
    parsePulsePreferencesInput({
      pulseEnabled: "yes",
      events: {
        probability: true,
        amount: true,
        stage: true,
        close_date: true,
        owner: true,
        pipeline: true,
      },
    }),
    null,
  );
  assert.equal(
    parsePulsePreferencesInput({
      pulseEnabled: true,
      events: {
        probability: true,
        amount: true,
        stage: true,
        close_date: true,
        owner: true,
        pipeline: true,
        unknown_event: true,
      },
    }),
    null,
  );
  assert.equal(
    parsePulsePreferencesInput({
      pulseEnabled: true,
      events: {
        probability: true,
        amount: true,
        stage: true,
        close_date: true,
        owner: true,
      },
    }),
    null,
  );
});
