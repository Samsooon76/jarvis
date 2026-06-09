import type { FastifyInstance } from "fastify";
import type { ApiResponse, AppUserRole, OrgUser } from "@jarvis/shared";
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

  app.get<{ Reply: ApiResponse<OrgUser[]> }>(
    "/api/auth/users",
    async (request, reply) => {
      try {
        const authUser = await getAuthenticatedAuthUser(request);
        const profile = await loadAppUserProfile(authUser);

        if (profile.role !== "admin" && profile.role !== "manager") {
          return reply.code(403).send({
            success: false,
            error: "Accès refusé. Réservé aux administrateurs et managers.",
          });
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("users")
          .select("id, name, email, role, hubspot_owner_id, auth_user_id, created_at")
          .eq("org_id", profile.orgId)
          .order("name", { ascending: true });

        if (error) {
          throw new Error(`Impossible de charger les utilisateurs de l'organisation: ${error.message}`);
        }

        const mappedUsers: OrgUser[] = (data || []).map((row: any) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role as AppUserRole,
          hubspotOwnerId: row.hubspot_owner_id,
          authUserId: row.auth_user_id,
          createdAt: row.created_at,
        }));

        return reply.send({
          success: true,
          data: mappedUsers,
        });
      } catch (error) {
        request.log.error({ error }, "Impossible de récupérer les utilisateurs.");
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue.",
        });
      }
    }
  );

  app.put<{ Params: { userId: string }; Body: { role: string }; Reply: ApiResponse<{ id: string; role: AppUserRole }> }>(
    "/api/auth/users/:userId/role",
    async (request, reply) => {
      try {
        const authUser = await getAuthenticatedAuthUser(request);
        const profile = await loadAppUserProfile(authUser);

        if (profile.role !== "admin" && profile.role !== "manager") {
          return reply.code(403).send({
            success: false,
            error: "Accès refusé. Réservé aux administrateurs et managers.",
          });
        }

        const { userId } = request.params;
        const { role } = request.body;

        if (role !== "sales" && role !== "manager" && role !== "admin") {
          return reply.code(400).send({
            success: false,
            error: "Rôle invalide. Les rôles possibles sont 'sales', 'manager', et 'admin'.",
          });
        }

        const supabase = getSupabaseAdmin();

        // 1. Fetch user to confirm they belong to the same organization
        const { data: targetUser, error: fetchError } = await supabase
          .from("users")
          .select("id, org_id, auth_user_id, role")
          .eq("id", userId)
          .maybeSingle();

        if (fetchError || !targetUser) {
          return reply.code(404).send({
            success: false,
            error: fetchError ? fetchError.message : "Utilisateur introuvable.",
          });
        }

        if (targetUser.org_id !== profile.orgId) {
          return reply.code(403).send({
            success: false,
            error: "Vous ne pouvez pas modifier un utilisateur d'une autre organisation.",
          });
        }

        // Prevent self-demotion or self-change if it might leave the organization with no admins.
        if (targetUser.role === "admin" && role !== "admin") {
          const { count, error: countError } = await supabase
            .from("users")
            .select("id", { count: "exact", head: true })
            .eq("org_id", profile.orgId)
            .eq("role", "admin");

          if (!countError && count !== null && count <= 1) {
            return reply.code(400).send({
              success: false,
              error: "Impossible de modifier le rôle du dernier administrateur de l'organisation.",
            });
          }
        }

        // 2. Update user role in public.users table
        const { error: updateError } = await supabase
          .from("users")
          .update({ role })
          .eq("id", userId);

        if (updateError) {
          throw new Error(`Impossible de mettre à jour le rôle de l'utilisateur: ${updateError.message}`);
        }

        // 3. Update Supabase Auth app_metadata if target user has signed up
        if (targetUser.auth_user_id) {
          const { data: authRecord, error: authGetUserError } = await supabase.auth.admin.getUserById(targetUser.auth_user_id);
          
          if (!authGetUserError && authRecord?.user) {
            await upsertAuthUserAppMetadata(authRecord.user, { role });
          }
        }

        return reply.send({
          success: true,
          data: { id: userId, role: role as AppUserRole },
        });
      } catch (error) {
        request.log.error({ error }, "Impossible de modifier le rôle de l'utilisateur.");
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue.",
        });
      }
    }
  );
};
