import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { assertManagerOrAdmin, assertOrgAccess, assertOwnerScope, type AuthContext } from "./app-auth.service.js";
import { ForbiddenError } from "../lib/errors.js";

const buildRequest = (auth: AuthContext): FastifyRequest =>
  ({
    auth,
    log: {
      warn: () => undefined,
    },
  }) as unknown as FastifyRequest;

const baseAuth: AuthContext = {
  authUserId: "auth-user-1",
  appUserId: "app-user-1",
  orgId: "00000000-0000-4000-8000-000000000001",
  role: "manager",
  hubspotOwnerId: "owner-1",
  email: "manager@example.com",
};

test("assertOrgAccess allows the authenticated organization", () => {
  const request = buildRequest(baseAuth);

  assert.equal(assertOrgAccess(request, baseAuth.orgId).orgId, baseAuth.orgId);
});

test("assertOrgAccess rejects a different organization", () => {
  const request = buildRequest(baseAuth);

  assert.throws(
    () => assertOrgAccess(request, "00000000-0000-4000-8000-000000000002"),
    ForbiddenError,
  );
});

test("assertManagerOrAdmin rejects sales users", () => {
  const request = buildRequest({
    ...baseAuth,
    role: "sales",
  });

  assert.throws(() => assertManagerOrAdmin(request), ForbiddenError);
});

test("assertOwnerScope restricts sales users to their own HubSpot owner", () => {
  const request = buildRequest({
    ...baseAuth,
    role: "sales",
  });

  assert.equal(assertOwnerScope(request, "owner-1").hubspotOwnerId, "owner-1");
  assert.throws(() => assertOwnerScope(request, "owner-2"), ForbiddenError);
});
