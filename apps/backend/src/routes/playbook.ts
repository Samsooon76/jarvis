import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  ApiResponse,
  Playbook,
  PlaybookAdherenceResult,
  PlaybookDetail,
  PlaybookDistribution,
  PlaybookPlay,
  PlaybookPlayCategory,
  PlaybookPlayInput,
  PlaybookDriftRunResult,
  PlaybookSuggestion,
  PlaybookBootstrapReadiness,
  PlaybookBootstrapResult,
  PlaybookOverviewResult,
  PlaybookSuggestionGenerationResult,
  PlaybookStatus,
} from "@jarvis/shared";
import { assertManagerOrAdmin, assertOrgAccess, assertOwnerScope } from "../services/app-auth.service.js";
import {
  createPlay,
  createPlaybook,
  getPlaybookDetail,
  listPlaybooks,
  reorderPlays,
  updatePlay,
  updatePlaybook,
} from "../services/playbook/playbook.service.js";
import {
  getPlaybookDistributionAccessContext,
  getRelevantPlaybookPlays,
} from "../services/playbook/distribution.js";
import {
  acceptSuggestion,
  generateSuggestions,
  listSuggestions,
  rejectSuggestion,
} from "../services/playbook/suggestions.js";
import { bootstrapPlaybookFromWonDeals, getPlaybookBootstrapReadiness } from "../services/playbook/bootstrap.js";
import { synthesizePlaybookOverview } from "../services/playbook/overview.js";
import { runPlaybookDrift } from "../services/playbook/drift.js";
import { measurePlaybookAdherenceForCall } from "../services/playbook/adherence.js";
import type { UpdatePlayInput } from "../services/playbook/types.js";
import { isPlayCategory } from "../services/playbook/shared.js";
import { getErrorMessage, getErrorStatusCode } from "../lib/errors.js";

type OrgQuery = {
  orgId?: string;
};

type PlaybookParams = {
  playbookId: string;
};

type PlaybookCallParams = PlaybookParams & {
  callId: string;
};

type PlayParams = PlaybookParams & {
  playId: string;
};

type CreatePlaybookBody = OrgQuery & {
  name?: string;
  description?: string | null;
};

type UpdatePlaybookBody = OrgQuery & {
  name?: string;
  description?: string | null;
  status?: PlaybookStatus;
};

type CreatePlayBody = OrgQuery & Partial<PlaybookPlayInput>;

type UpdatePlayBody = OrgQuery & UpdatePlayInput;

type ReorderBody = OrgQuery & {
  orderedPlayIds?: string[];
};

type SuggestionParams = PlaybookParams & {
  suggestionId: string;
};

type GenerateSuggestionsBody = OrgQuery & {
  lookbackDays?: number;
};

type BootstrapPlaybookBody = OrgQuery & {
  dealCount?: number;
  lookbackDays?: number;
};

type RunDriftBody = OrgQuery & {
  lookbackDays?: number;
  minEvidence?: number;
  cooldownDays?: number;
};

type RunAdherenceBody = OrgQuery;

type ResolveSuggestionBody = OrgQuery & {
  play?: PlaybookPlayInput;
};

type PlaybookDistributionBody = OrgQuery & {
  playbookId?: string | null;
  prospectId?: string | null;
  hubspotDealId?: string | null;
  stage?: string | null;
  dealText?: string | null;
  prospectText?: string | null;
  categories?: string[];
  limit?: number;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

const sendError = (
  reply: FastifyReply,
  error: unknown,
  fallbackStatusCode: number,
  fallbackMessage: string,
) =>
  reply.code(getErrorStatusCode(error, fallbackStatusCode)).send({
    success: false,
    error: getErrorMessage(error, fallbackMessage),
  });

const parsePlayCategories = (categories: string[] | undefined): PlaybookPlayCategory[] => {
  if (!Array.isArray(categories)) {
    return [];
  }

  return Array.from(
    new Set(
      categories.map((category) => category.trim()).filter((category): category is PlaybookPlayCategory => isPlayCategory(category)),
    ),
  );
};

export const registerPlaybookRoutes = async (app: FastifyInstance): Promise<void> => {
  // Lecture: ouverte a tous les membres de l'org (les sales consultent le playbook).
  app.get<{ Querystring: OrgQuery; Reply: ApiResponse<Playbook[]> }>("/api/playbook", async (request, reply) => {
    const orgId = request.query.orgId;

    if (!isValidOrgId(orgId)) {
      return reply.code(400).send({ success: false, error: "Le parametre orgId doit etre un UUID Jarvis valide." });
    }

    try {
      assertOrgAccess(request, orgId);
      const playbooks = await listPlaybooks(orgId);

      return reply.send({ success: true, data: playbooks });
    } catch (error) {
      request.log.error({ error, orgId }, "Impossible de charger les playbooks.");

      return sendError(reply, error, 500, "Erreur inconnue pendant le chargement des playbooks.");
    }
  });

  app.post<{ Body: PlaybookDistributionBody; Reply: ApiResponse<PlaybookDistribution> }>(
    "/api/playbook/distribution",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        const auth = assertOrgAccess(request, orgId);
        const input = {
          orgId,
          playbookId: request.body.playbookId ?? null,
          prospectId: request.body.prospectId ?? null,
          hubspotDealId: request.body.hubspotDealId ?? null,
          stage: request.body.stage ?? null,
          dealText: request.body.dealText ?? null,
          prospectText: request.body.prospectText ?? null,
          categories: parsePlayCategories(request.body.categories),
          limit: request.body.limit,
        };
        const accessContext = await getPlaybookDistributionAccessContext(input);

        if (auth.role === "sales") {
          if (accessContext.hubspotOwnerId) {
            assertOwnerScope(request, accessContext.hubspotOwnerId);
          } else if (accessContext.ownerUserId && accessContext.ownerUserId !== auth.appUserId) {
            return reply.code(403).send({
              success: false,
              error: "Un commercial ne peut charger que ses propres plays avant appel.",
            });
          }
        }

        const distribution = await getRelevantPlaybookPlays(input);

        return reply.send({ success: true, data: distribution });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de distribuer les plays avant appel.");

        return sendError(reply, error, 400, "Erreur inconnue pendant la distribution des plays.");
      }
    },
  );

  app.get<{ Params: PlaybookParams; Querystring: OrgQuery; Reply: ApiResponse<PlaybookDetail> }>(
    "/api/playbook/:playbookId",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le parametre orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        const detail = await getPlaybookDetail(orgId, request.params.playbookId);

        return reply.send({ success: true, data: detail });
      } catch (error) {
        request.log.error({ error, orgId, playbookId: request.params.playbookId }, "Impossible de charger le playbook.");

        return sendError(reply, error, 404, "Playbook introuvable.");
      }
    },
  );

  // Ecriture: reservee aux managers/admins.
  app.get<{ Querystring: OrgQuery; Reply: ApiResponse<PlaybookBootstrapReadiness> }>(
    "/api/playbook/bootstrap/readiness",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le parametre orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        const readiness = await getPlaybookBootstrapReadiness(orgId);

        return reply.send({ success: true, data: readiness });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de charger la disponibilite du bootstrap playbook.");

        return sendError(reply, error, 500, "Erreur inconnue pendant le chargement de la disponibilite.");
      }
    },
  );

  app.post<{ Body: BootstrapPlaybookBody; Reply: ApiResponse<PlaybookBootstrapResult> }>(
    "/api/playbook/bootstrap",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        const auth = assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const result = await bootstrapPlaybookFromWonDeals({
          orgId,
          createdBy: auth.appUserId,
          dealCount: request.body.dealCount,
          lookbackDays: request.body.lookbackDays,
        });

        return reply.code(201).send({ success: true, data: result });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de generer le playbook depuis les deals gagnes.");

        return sendError(reply, error, 400, "Erreur inconnue pendant la generation du playbook.");
      }
    },
  );

  app.post<{ Params: PlaybookParams; Body: OrgQuery; Reply: ApiResponse<PlaybookOverviewResult> }>(
    "/api/playbook/:playbookId/synthesize",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const result = await synthesizePlaybookOverview(orgId, request.params.playbookId);

        return reply.send({ success: true, data: result });
      } catch (error) {
        request.log.error({ error, orgId, playbookId: request.params.playbookId }, "Impossible de synthetiser le playbook global.");

        return sendError(reply, error, 400, "Erreur inconnue pendant la synthese du playbook global.");
      }
    },
  );

  app.post<{ Body: CreatePlaybookBody; Reply: ApiResponse<Playbook> }>("/api/playbook", async (request, reply) => {
    const orgId = request.body.orgId;

    if (!isValidOrgId(orgId)) {
      return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
    }

    try {
      const auth = assertOrgAccess(request, orgId);
      assertManagerOrAdmin(request);
      const playbook = await createPlaybook({
        orgId,
        name: request.body.name ?? "",
        description: request.body.description ?? null,
        createdBy: auth.appUserId,
      });

      return reply.code(201).send({ success: true, data: playbook });
    } catch (error) {
      request.log.error({ error, orgId }, "Impossible de creer le playbook.");

      return sendError(reply, error, 400, "Erreur inconnue pendant la creation du playbook.");
    }
  });

  app.patch<{ Params: PlaybookParams; Body: UpdatePlaybookBody; Reply: ApiResponse<Playbook> }>(
    "/api/playbook/:playbookId",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const playbook = await updatePlaybook(orgId, request.params.playbookId, {
          name: request.body.name,
          description: request.body.description,
          status: request.body.status,
        });

        return reply.send({ success: true, data: playbook });
      } catch (error) {
        request.log.error({ error, orgId, playbookId: request.params.playbookId }, "Impossible de mettre a jour le playbook.");

        return sendError(reply, error, 400, "Erreur inconnue pendant la mise a jour du playbook.");
      }
    },
  );

  app.post<{ Params: PlaybookParams; Body: CreatePlayBody; Reply: ApiResponse<PlaybookPlay> }>(
    "/api/playbook/:playbookId/plays",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const play = await createPlay(orgId, request.params.playbookId, {
          category: request.body.category as PlaybookPlayInput["category"],
          title: request.body.title ?? "",
          triggerDescription: request.body.triggerDescription ?? "",
          recommendedResponse: request.body.recommendedResponse ?? "",
          status: request.body.status,
          evidence: request.body.evidence,
        });

        return reply.code(201).send({ success: true, data: play });
      } catch (error) {
        request.log.error({ error, orgId, playbookId: request.params.playbookId }, "Impossible de creer le play.");

        return sendError(reply, error, 400, "Erreur inconnue pendant la creation du play.");
      }
    },
  );

  app.patch<{ Params: PlayParams; Body: UpdatePlayBody; Reply: ApiResponse<PlaybookPlay> }>(
    "/api/playbook/:playbookId/plays/:playId",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const play = await updatePlay(orgId, request.params.playbookId, request.params.playId, {
          category: request.body.category,
          title: request.body.title,
          triggerDescription: request.body.triggerDescription,
          recommendedResponse: request.body.recommendedResponse,
          status: request.body.status,
          evidence: request.body.evidence,
        });

        return reply.send({ success: true, data: play });
      } catch (error) {
        request.log.error({ error, orgId, playId: request.params.playId }, "Impossible de mettre a jour le play.");

        return sendError(reply, error, 400, "Erreur inconnue pendant la mise a jour du play.");
      }
    },
  );

  app.post<{ Params: PlaybookParams; Body: ReorderBody; Reply: ApiResponse<{ reordered: boolean }> }>(
    "/api/playbook/:playbookId/plays/reorder",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        await reorderPlays(orgId, request.params.playbookId, request.body.orderedPlayIds ?? []);

        return reply.send({ success: true, data: { reordered: true } });
      } catch (error) {
        request.log.error({ error, orgId, playbookId: request.params.playbookId }, "Impossible de reordonner les plays.");

        return sendError(reply, error, 400, "Erreur inconnue pendant le reordonnancement des plays.");
      }
    },
  );

  app.get<{ Params: PlaybookParams; Querystring: OrgQuery; Reply: ApiResponse<PlaybookSuggestion[]> }>(
    "/api/playbook/:playbookId/suggestions",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le parametre orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const suggestions = await listSuggestions(orgId, request.params.playbookId);

        return reply.send({ success: true, data: suggestions });
      } catch (error) {
        request.log.error({ error, orgId, playbookId: request.params.playbookId }, "Impossible de charger les suggestions playbook.");

        return sendError(reply, error, 500, "Erreur inconnue pendant le chargement des suggestions.");
      }
    },
  );

  app.post<{ Params: PlaybookParams; Body: GenerateSuggestionsBody; Reply: ApiResponse<PlaybookSuggestionGenerationResult> }>(
    "/api/playbook/:playbookId/suggestions/generate",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const result = await generateSuggestions(orgId, request.params.playbookId, request.body.lookbackDays);

        return reply.send({ success: true, data: result });
      } catch (error) {
        request.log.error({ error, orgId, playbookId: request.params.playbookId }, "Impossible de generer les suggestions playbook.");

        return sendError(reply, error, 400, "Erreur inconnue pendant la generation des suggestions.");
      }
    },
  );

  app.post<{ Params: PlaybookParams; Body: RunDriftBody; Reply: ApiResponse<PlaybookDriftRunResult> }>(
    "/api/playbook/:playbookId/drift/run",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const result = await runPlaybookDrift(orgId, request.params.playbookId, {
          lookbackDays: request.body.lookbackDays,
          minEvidence: request.body.minEvidence,
          cooldownDays: request.body.cooldownDays,
        });

        return reply.send({ success: true, data: result });
      } catch (error) {
        request.log.error({ error, orgId, playbookId: request.params.playbookId }, "Impossible d'executer le drift playbook.");

        return sendError(reply, error, 400, "Erreur inconnue pendant l'execution du drift playbook.");
      }
    },
  );

  app.post<{ Params: PlaybookCallParams; Body: RunAdherenceBody; Reply: ApiResponse<PlaybookAdherenceResult> }>(
    "/api/playbook/:playbookId/adherence/calls/:callId",
    async (request, reply) => {
      let logOrgId: string | null = null;

      try {
        const body = request.body ?? {};
        const auth = assertOrgAccess(request, body.orgId ?? request.auth?.orgId ?? null);
        const orgId = body.orgId ?? auth.orgId;
        logOrgId = orgId;

        if (!orgId || !isValidOrgId(orgId)) {
          return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
        }

        const result = await measurePlaybookAdherenceForCall(orgId, request.params.playbookId, request.params.callId, auth);

        return reply.send({ success: true, data: result });
      } catch (error) {
        request.log.error(
          { error, orgId: logOrgId, playbookId: request.params.playbookId, callId: request.params.callId },
          "Impossible de mesurer l'adherence playbook du call.",
        );

        return sendError(reply, error, 400, "Erreur inconnue pendant la mesure d'adherence playbook.");
      }
    },
  );

  app.post<{ Params: SuggestionParams; Body: ResolveSuggestionBody; Reply: ApiResponse<PlaybookPlay> }>(
    "/api/playbook/:playbookId/suggestions/:suggestionId/accept",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        const auth = assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const result = await acceptSuggestion(
          orgId,
          request.params.playbookId,
          request.params.suggestionId,
          auth.appUserId,
          request.body.play,
        );

        if (!result.play) {
          return reply.code(400).send({ success: false, error: "Cette suggestion ne produit pas de play publiable." });
        }

        return reply.send({ success: true, data: result.play });
      } catch (error) {
        request.log.error(
          { error, orgId, playbookId: request.params.playbookId, suggestionId: request.params.suggestionId },
          "Impossible d'accepter la suggestion playbook.",
        );

        return sendError(reply, error, 400, "Erreur inconnue pendant l'acceptation de la suggestion.");
      }
    },
  );

  app.post<{ Params: SuggestionParams; Body: OrgQuery; Reply: ApiResponse<PlaybookSuggestion> }>(
    "/api/playbook/:playbookId/suggestions/:suggestionId/reject",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        const auth = assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const result = await rejectSuggestion(orgId, request.params.playbookId, request.params.suggestionId, auth.appUserId);

        return reply.send({ success: true, data: result.suggestion });
      } catch (error) {
        request.log.error(
          { error, orgId, playbookId: request.params.playbookId, suggestionId: request.params.suggestionId },
          "Impossible de rejeter la suggestion playbook.",
        );

        return sendError(reply, error, 400, "Erreur inconnue pendant le rejet de la suggestion.");
      }
    },
  );
};
