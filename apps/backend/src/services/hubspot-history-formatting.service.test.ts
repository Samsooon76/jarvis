import assert from "node:assert/strict";
import test from "node:test";
import { formatHubSpotTimelineForPrompt, sanitizeHubSpotHtml } from "./hubspot-history-formatting.service.js";

test("sanitizes HubSpot HTML bodies", () => {
  assert.equal(sanitizeHubSpotHtml("<p>Hello&nbsp;<strong>ACME</strong></p>"), "Hello ACME");
});

test("formats timeline items chronologically for prompts", () => {
  const text = formatHubSpotTimelineForPrompt([
    {
      id: "2",
      type: "note",
      timestamp: "2026-01-02T00:00:00.000Z",
      title: "Second",
      body: "<p>Body</p>",
      metadata: { ownerId: "42" },
    },
    {
      id: "1",
      type: "deal",
      timestamp: "2026-01-01T00:00:00.000Z",
      title: "First",
      body: null,
      metadata: {},
    },
  ]);

  assert.ok(text.indexOf("First") < text.indexOf("Second"));
  assert.match(text, /ownerId: 42/);
});
