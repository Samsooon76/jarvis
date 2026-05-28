import type { FastifyRequest } from "fastify";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../db/client.js";

export type AppUserRole = "sales" | "manager" | "admin";

export type AppUserProfile = {
  id: string | null;
  authUserId: string;
  orgId: string | null;
  orgName: string | null;
  email: string;
  name: string;
  role: AppUserRole | null;
  hubspotOwnerId: string | null;
  onboardingRequired: boolean;
  canManageHubSpot: boolean;
};

type AppUserRow = {
  id: string;
  auth_user_id: string | null;
  org_id: string | null;
  email: string;
  name: string;
  role: AppUserRole;
  hubspot_owner_id: string | null;
};

type OrganizationRow = {
  id: string;
  name: string;
};

const getUserEmail = (user: User): string => user.email?.trim().toLowerCase() ?? "";

export const getBearerToken = (request: FastifyRequest): string | null => {
  const authorization = request.headers.authorization;

  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() || null : null;
};

export const getAuthenticatedAuthUser = async (request: FastifyRequest): Promise<User> => {
  const token = getBearerToken(request);

  if (!token) {
    throw new Error("Authentification requise.");
  }

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);

  if (error || !data.user) {
    throw new Error("Session applicative invalide.");
  }

  return data.user;
};

export const loadAppUserProfile = async (authUser: User): Promise<AppUserProfile> => {
  const supabase = getSupabaseAdmin();
  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("id, auth_user_id, org_id, email, name, role, hubspot_owner_id")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  if (userError) {
    throw new Error(`Impossible de charger le profil utilisateur: ${userError.message}`);
  }

  const appUser = userData as AppUserRow | null;
  let orgName: string | null = null;

  if (appUser?.org_id) {
    const { data: orgData, error: orgError } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", appUser.org_id)
      .maybeSingle();

    if (orgError) {
      throw new Error(`Impossible de charger l'organisation: ${orgError.message}`);
    }

    orgName = ((orgData as OrganizationRow | null)?.name ?? null);
  }

  const fallbackName =
    typeof authUser.user_metadata.full_name === "string" && authUser.user_metadata.full_name.trim()
      ? authUser.user_metadata.full_name.trim()
      : getUserEmail(authUser).split("@")[0] || "Utilisateur Jarvis";
  const role = appUser?.role ?? null;

  return {
    id: appUser?.id ?? null,
    authUserId: authUser.id,
    orgId: appUser?.org_id ?? null,
    orgName,
    email: appUser?.email ?? getUserEmail(authUser),
    name: appUser?.name ?? fallbackName,
    role,
    hubspotOwnerId: appUser?.hubspot_owner_id ?? null,
    onboardingRequired: !appUser?.org_id,
    canManageHubSpot: role === "admin" || role === "manager",
  };
};

export const loadAuthenticatedAppUserProfile = async (request: FastifyRequest): Promise<AppUserProfile> => {
  const authUser = await getAuthenticatedAuthUser(request);

  return loadAppUserProfile(authUser);
};

export const loadOptionalAuthenticatedAppUserProfile = async (
  request: FastifyRequest,
): Promise<AppUserProfile | null> => {
  if (!getBearerToken(request)) {
    return null;
  }

  return loadAuthenticatedAppUserProfile(request);
};

export const upsertAuthUserAppMetadata = async (
  authUser: User,
  metadata: Record<string, string>,
): Promise<void> => {
  const nextMetadata = {
    ...authUser.app_metadata,
    ...metadata,
  };
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(authUser.id, {
    app_metadata: nextMetadata,
  });

  if (error) {
    throw new Error(`Impossible de mettre a jour les metadonnees applicatives: ${error.message}`);
  }
};
