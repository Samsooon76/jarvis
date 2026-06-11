import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { HUBSPOT_OAUTH_BASE_URL, hubSpotFetch } from "./client.js";
import type { HubSpotTokenInfoResponse, HubSpotTokenResponse } from "./types.js";

const toBase64Url = (value: string): string => Buffer.from(value, "utf8").toString("base64url");

const fromBase64Url = (value: string): string => Buffer.from(value, "base64url").toString("utf8");

const HUBSPOT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type SignedOAuthState = {
  payload: Record<string, string>;
  iat: number;
  nonce: string;
  sig: string;
};

const signOAuthState = (payload: Record<string, string>, iat: number, nonce: string): string => {
  if (!env.oauthStateSecret) {
    throw new Error("Configuration OAuth state manquante. Renseigne OAUTH_STATE_SECRET.");
  }

  return createHmac("sha256", env.oauthStateSecret)
    .update(JSON.stringify({ payload, iat, nonce }))
    .digest("base64url");
};

const verifyOAuthStateSignature = (state: SignedOAuthState): boolean => {
  const expectedSignature = signOAuthState(state.payload, state.iat, state.nonce);
  const actualBuffer = Buffer.from(state.sig, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};

const assertHubSpotConfigured = (): void => {
  if (!env.hubspotClientId || !env.hubspotClientSecret || !env.hubspotRedirectUri) {
    throw new Error(
      "Configuration HubSpot incomplete. Renseigne HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET et HUBSPOT_REDIRECT_URI.",
    );
  }
};

export const buildAuthorizationUrl = (statePayload: Record<string, string>): string => {
  assertHubSpotConfigured();
  const iat = Date.now();
  const nonce = randomUUID();
  const signedState: SignedOAuthState = {
    payload: statePayload,
    iat,
    nonce,
    sig: signOAuthState(statePayload, iat, nonce),
  };

  const params = new URLSearchParams({
    client_id: env.hubspotClientId,
    redirect_uri: env.hubspotRedirectUri,
    scope: env.hubspotScopes,
    state: toBase64Url(JSON.stringify(signedState)),
  });

  return `${HUBSPOT_OAUTH_BASE_URL}?${params.toString()}`;
};

export const decodeState = (state: string): Record<string, string> => {
  const decoded = fromBase64Url(state);
  const parsed = JSON.parse(decoded) as Partial<SignedOAuthState>;

  if (
    !parsed.payload ||
    typeof parsed.iat !== "number" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.sig !== "string"
  ) {
    throw new Error("Etat OAuth HubSpot invalide.");
  }

  if (Date.now() - parsed.iat > HUBSPOT_OAUTH_STATE_TTL_MS) {
    throw new Error("Etat OAuth HubSpot expire.");
  }

  if (!verifyOAuthStateSignature(parsed as SignedOAuthState)) {
    throw new Error("Signature OAuth HubSpot invalide.");
  }

  return parsed.payload;
};

export const exchangeCodeForToken = async (code: string): Promise<HubSpotTokenResponse> => {
  assertHubSpotConfigured();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.hubspotClientId,
    client_secret: env.hubspotClientSecret,
    redirect_uri: env.hubspotRedirectUri,
    code,
  });

  return hubSpotFetch<HubSpotTokenResponse>("/oauth/v1/token", {
    method: "POST",
    body,
    maxRetries: 2,
  });
};

export const refreshAccessToken = async (refreshToken: string): Promise<HubSpotTokenResponse> => {
  assertHubSpotConfigured();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.hubspotClientId,
    client_secret: env.hubspotClientSecret,
    refresh_token: refreshToken,
  });

  return hubSpotFetch<HubSpotTokenResponse>("/oauth/v1/token", {
    method: "POST",
    body,
    maxRetries: 2,
  });
};

export const fetchTokenInfo = async (accessToken: string): Promise<HubSpotTokenInfoResponse> =>
  hubSpotFetch<HubSpotTokenInfoResponse>(`/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`, {
    maxRetries: 1,
  });
