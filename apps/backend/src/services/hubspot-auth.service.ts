import { getSupabaseAdmin } from "../db/client.js";
import { hubSpotService } from "./hubspot.service.js";

type IntegrationTokenPayload = {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number;
};

type HubSpotIntegrationAuthPayload = {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
};

type HubSpotIntegrationAuthRpcPayload = {
  hubspot_access_token: string | null;
  hubspot_refresh_token: string | null;
  hubspot_token_expires_at: string | null;
};

const HUBSPOT_TOKEN_REFRESH_BUFFER_MS = 60_000;
const hubSpotRefreshPromises = new Map<string, Promise<string>>();

const formatOperationError = (message: string, detail: string): string => `${message}: ${detail}`;

const loadIntegrationAuth = async (orgId: string): Promise<HubSpotIntegrationAuthPayload | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("get_hubspot_integration_auth", {
    target_org_id: orgId,
  });

  if (error) {
    throw new Error(formatOperationError("Impossible de charger l'integration HubSpot", error.message));
  }

  const authPayload = Array.isArray(data)
    ? (data[0] as HubSpotIntegrationAuthRpcPayload | undefined)
    : (data as HubSpotIntegrationAuthRpcPayload | null);

  if (!authPayload?.hubspot_access_token) {
    return null;
  }

  return {
    accessToken: authPayload.hubspot_access_token,
    refreshToken: authPayload.hubspot_refresh_token,
    tokenExpiresAt: authPayload.hubspot_token_expires_at,
  };
};

export const upsertHubSpotIntegration = async (
  orgId: string,
  { accessToken, refreshToken, expiresIn }: IntegrationTokenPayload,
): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const hubspotTokenExpiresAt =
    typeof expiresIn === "number" ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

  const { error } = await supabase.rpc("set_hubspot_integration", {
    target_org_id: orgId,
    target_access_token: accessToken,
    target_refresh_token: refreshToken ?? null,
    target_token_expires_at: hubspotTokenExpiresAt,
  });

  if (error) {
    throw new Error(formatOperationError("Impossible d'enregistrer l'integration HubSpot", error.message));
  }
};

export const getHubSpotAccessToken = async (orgId: string): Promise<string> => {
  const integrationAuth = await loadIntegrationAuth(orgId);

  if (!integrationAuth?.accessToken) {
    throw new Error("Aucun token HubSpot trouve pour cette organisation.");
  }

  const expiresAtMs = integrationAuth.tokenExpiresAt ? new Date(integrationAuth.tokenExpiresAt).getTime() : null;
  const tokenIsFresh =
    typeof expiresAtMs === "number" &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > Date.now() + HUBSPOT_TOKEN_REFRESH_BUFFER_MS;

  if (tokenIsFresh || !integrationAuth.refreshToken) {
    return integrationAuth.accessToken;
  }

  const existingRefreshPromise = hubSpotRefreshPromises.get(orgId);

  if (existingRefreshPromise) {
    return existingRefreshPromise;
  }

  const refreshPromise = refreshHubSpotAccessToken(orgId, integrationAuth);
  hubSpotRefreshPromises.set(orgId, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    hubSpotRefreshPromises.delete(orgId);
  }
};

const refreshHubSpotAccessToken = async (
  orgId: string,
  integrationAuth: HubSpotIntegrationAuthPayload,
): Promise<string> => {
  if (!integrationAuth.refreshToken) {
    return integrationAuth.accessToken;
  }

  try {
    const refreshedToken = await hubSpotService.refreshAccessToken(integrationAuth.refreshToken);

    await upsertHubSpotIntegration(orgId, {
      accessToken: refreshedToken.access_token,
      refreshToken: refreshedToken.refresh_token ?? integrationAuth.refreshToken,
      expiresIn: refreshedToken.expires_in,
    });

    return refreshedToken.access_token;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Impossible de rafraichir la connexion HubSpot: ${error.message}`
        : "Impossible de rafraichir la connexion HubSpot.",
    );
  }
};
