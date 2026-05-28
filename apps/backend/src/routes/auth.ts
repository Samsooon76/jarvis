import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { getSupabaseAdmin } from "../db/client.js";
import {
  getAuthenticatedAuthUser,
  loadAppUserProfile,
  type AppUserProfile,
  upsertAuthUserAppMetadata,
} from "../services/app-auth.service.js";
import { getHubSpotAccessToken } from "../services/hubspot-auth.service.js";
import { hubSpotService } from "../services/hubspot.service.js";

type AdminOnboardingBody = {
  organizationName?: string;
  fullName?: string;
};

type OrganizationRow = {
  id: string;
  name: string;
};

type HubSpotOwnerMatch = {
  org: OrganizationRow;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
};

const normalizeText = (value: string | undefined): string => value?.trim() ?? "";

const getDisplayNameFromEmail = (email: string): string => {
  const localPart = email.split("@")[0] ?? "";
  const words = localPart
    .split(/[._-]+/)
    .map((word) => word.trim())
    .filter(Boolean);

  return words.length > 0
    ? words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ")
    : "Utilisateur Jarvis";
};

const ensureProfileRow = async (input: {
  authUserId: string;
  email: string;
  name: string;
}): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const existingByAuth = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", input.authUserId)
    .maybeSingle();

  if (existingByAuth.error) {
    throw new Error(`Impossible de charger le profil Jarvis: ${existingByAuth.error.message}`);
  }

  if (existingByAuth.data) {
    return;
  }

  const existingByEmail = await supabase
    .from("users")
    .select("id")
    .eq("email", input.email)
    .maybeSingle();

  if (existingByEmail.error) {
    throw new Error(`Impossible de charger le profil Jarvis par email: ${existingByEmail.error.message}`);
  }

  if (existingByEmail.data) {
    const { error } = await supabase
      .from("users")
      .update({
        auth_user_id: input.authUserId,
        name: input.name,
      })
      .eq("id", (existingByEmail.data as { id: string }).id);

    if (error) {
      throw new Error(`Impossible de rattacher le profil Jarvis existant: ${error.message}`);
    }

    return;
  }

  const { error } = await supabase.from("users").insert({
    auth_user_id: input.authUserId,
    email: input.email,
    name: input.name,
  });

  if (error) {
    throw new Error(`Impossible de preparer le profil Jarvis: ${error.message}`);
  }
};

const findHubSpotOwnerByEmail = async (email: string): Promise<HubSpotOwnerMatch | null> => {
  const supabase = getSupabaseAdmin();
  const { data: orgData, error: orgError } = await supabase
    .from("organizations")
    .select("id, name")
    .order("created_at", { ascending: false })
    .range(0, 499);

  if (orgError) {
    throw new Error(`Impossible de charger les organisations: ${orgError.message}`);
  }

  const organizations = (orgData ?? []) as OrganizationRow[];

  for (const org of organizations) {
    try {
      const accessToken = await getHubSpotAccessToken(org.id);
      const owners = await hubSpotService.fetchOwners(accessToken);
      const owner = owners.find((candidate) => candidate.email?.trim().toLowerCase() === email);

      if (!owner) {
        continue;
      }

      const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();

      return {
        org,
        ownerId: owner.id,
        ownerName: ownerName || owner.email || `Owner ${owner.id}`,
        ownerEmail: owner.email ?? email,
      };
    } catch {
      // Some orgs may not be connected yet; continue scanning connected workspaces.
    }
  }

  return null;
};

export const registerAuthRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Reply: ApiResponse<AppUserProfile> }>("/api/auth/me", async (request, reply) => {
    try {
      const authUser = await getAuthenticatedAuthUser(request);
      const email = authUser.email?.trim().toLowerCase() ?? "";

      if (!email) {
        return reply.code(400).send({
          success: false,
          error: "Le compte Supabase ne contient pas d'email exploitable.",
        });
      }

      await ensureProfileRow({
        authUserId: authUser.id,
        email,
        name: getDisplayNameFromEmail(email),
      });

      return reply.send({
        success: true,
        data: await loadAppUserProfile(authUser),
      });
    } catch (error) {
      return reply.code(401).send({
        success: false,
        error: error instanceof Error ? error.message : "Authentification impossible.",
      });
    }
  });

  app.post<{ Body: AdminOnboardingBody; Reply: ApiResponse<AppUserProfile> }>(
    "/api/auth/onboarding/admin",
    async (request, reply) => {
      try {
        const authUser = await getAuthenticatedAuthUser(request);
        const email = authUser.email?.trim().toLowerCase() ?? "";

        if (!email) {
          return reply.code(400).send({
            success: false,
            error: "Le compte Supabase ne contient pas d'email exploitable.",
          });
        }

        const fullName = normalizeText(request.body?.fullName) || getDisplayNameFromEmail(email);
        const organizationName = normalizeText(request.body?.organizationName);

        if (!organizationName) {
          return reply.code(400).send({
            success: false,
            error: "Le nom de l'organisation est obligatoire.",
          });
        }

        await ensureProfileRow({
          authUserId: authUser.id,
          email,
          name: fullName,
        });

        const existingProfile = await loadAppUserProfile(authUser);

        if (existingProfile.orgId) {
          return reply.send({
            success: true,
            data: existingProfile,
          });
        }

        const { data: orgData, error: orgError } = await getSupabaseAdmin()
          .from("organizations")
          .insert({
            name: organizationName,
            plan: "trial",
          })
          .select("id, name")
          .single();

        if (orgError) {
          throw new Error(`Impossible de creer l'organisation: ${orgError.message}`);
        }

        const org = orgData as OrganizationRow;
        const { error: userError } = await getSupabaseAdmin()
          .from("users")
          .update({
            org_id: org.id,
            name: fullName,
            role: "admin",
          })
          .eq("auth_user_id", authUser.id);

        if (userError) {
          throw new Error(`Impossible de rattacher l'admin a l'organisation: ${userError.message}`);
        }

        await upsertAuthUserAppMetadata(authUser, {
          org_id: org.id,
          role: "admin",
        });

        return reply.send({
          success: true,
          data: await loadAppUserProfile(authUser),
        });
      } catch (error) {
        request.log.error({ error }, "Onboarding admin impossible.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant l'onboarding admin.",
        });
      }
    },
  );

  app.post<{ Reply: ApiResponse<AppUserProfile> }>("/api/auth/onboarding/member", async (request, reply) => {
    try {
      const authUser = await getAuthenticatedAuthUser(request);
      const email = authUser.email?.trim().toLowerCase() ?? "";

      if (!email) {
        return reply.code(400).send({
          success: false,
          error: "Le compte Supabase ne contient pas d'email exploitable.",
        });
      }

      await ensureProfileRow({
        authUserId: authUser.id,
        email,
        name: getDisplayNameFromEmail(email),
      });

      const existingProfile = await loadAppUserProfile(authUser);

      if (existingProfile.orgId) {
        return reply.send({
          success: true,
          data: existingProfile,
        });
      }

      const match = await findHubSpotOwnerByEmail(email);

      if (!match) {
        return reply.code(404).send({
          success: false,
          error: "Aucun owner HubSpot connecte ne correspond a cet email.",
        });
      }

      const { error: userError } = await getSupabaseAdmin()
        .from("users")
        .update({
          org_id: match.org.id,
          name: match.ownerName,
          role: "sales",
          hubspot_owner_id: match.ownerId,
        })
        .eq("auth_user_id", authUser.id);

      if (userError) {
        throw new Error(`Impossible de rattacher le commercial a l'organisation: ${userError.message}`);
      }

      await upsertAuthUserAppMetadata(authUser, {
        org_id: match.org.id,
        role: "sales",
      });

      return reply.send({
        success: true,
        data: await loadAppUserProfile(authUser),
      });
    } catch (error) {
      request.log.error({ error }, "Onboarding sales impossible.");

      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Erreur inconnue pendant l'onboarding sales.",
      });
    }
  });
};
