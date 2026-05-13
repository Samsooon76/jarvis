import { createHash, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseHubSpotWebhookEvents,
  verifyHubSpotWebhookSignature,
} from "./hubspot-webhook.service.js";

test("validates legacy HubSpot webhook signatures against the raw body", () => {
  const appSecret = "secret";
  const rawBody = JSON.stringify([{ portalId: 123, subscriptionType: "object.creation" }]);
  const signature = createHash("sha256").update(`${appSecret}${rawBody}`, "utf8").digest("hex");

  assert.equal(
    verifyHubSpotWebhookSignature({
      appSecret,
      headers: {
        "x-hubspot-signature": signature,
      },
      method: "POST",
      requestUri: "https://api.example.com/api/webhooks/hubspot",
      rawBody,
    }),
    true,
  );
});

test("validates v3 HubSpot webhook signatures with the decoded request URI", () => {
  const appSecret = "secret";
  const rawBody = JSON.stringify([{ portalId: 123, subscriptionType: "object.creation" }]);
  const timestamp = String(Date.now());
  const requestUri = "https://api.example.com/api/webhooks/hubspot?next=a%2Fb";
  const decodedRequestUri = "https://api.example.com/api/webhooks/hubspot?next=a/b";
  const source = `POST${decodedRequestUri}${rawBody}${timestamp}`;
  const signature = createHmac("sha256", appSecret).update(source, "utf8").digest("base64");

  assert.equal(
    verifyHubSpotWebhookSignature({
      appSecret,
      headers: {
        "x-hubspot-signature-v3": signature,
        "x-hubspot-request-timestamp": timestamp,
      },
      method: "POST",
      requestUri,
      rawBody,
    }),
    true,
  );
});

test("normalizes batched events and ignores attemptNumber in the dedupe fingerprint", () => {
  const baseEvent = {
    portalId: 123,
    appId: 456,
    subscriptionId: 789,
    subscriptionType: "object.creation",
    objectTypeId: "0-48",
    objectId: 1001,
    occurredAt: 1760000000000,
    attemptNumber: 0,
  };
  const [firstEvent, retriedEvent] = parseHubSpotWebhookEvents([
    baseEvent,
    {
      ...baseEvent,
      attemptNumber: 1,
    },
  ]);

  assert.ok(firstEvent);
  assert.ok(retriedEvent);
  assert.equal(firstEvent.portalId, "123");
  assert.equal(firstEvent.objectTypeId, "0-48");
  assert.equal(firstEvent.eventFingerprint, retriedEvent.eventFingerprint);
});
