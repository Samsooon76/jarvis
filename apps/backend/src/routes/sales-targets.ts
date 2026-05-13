import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import {
  listMonthlySalesTargets,
  normalizeTargetMonth,
  upsertMonthlySalesTargets,
  type MonthlySalesTarget,
  type MonthlySalesTargetInput,
} from "../services/sales-targets.service.js";

type ListTargetsQuery = {
  orgId?: string;
  year?: string;
};

type UpsertTargetsBody = {
  orgId?: string;
  targets?: Array<{
    hubspotOwnerId?: string;
    ownerName?: string;
    targetMonth?: string;
    objectiveAmount?: number;
  }>;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

const parseYear = (value: string | undefined): number | null => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 2020 || parsed > 2100) {
    return null;
  }

  return parsed;
};

const parseTargets = (targets: UpsertTargetsBody["targets"]): MonthlySalesTargetInput[] | null => {
  if (!Array.isArray(targets)) {
    return null;
  }

  const parsedTargets: MonthlySalesTargetInput[] = [];

  for (const target of targets) {
    const hubspotOwnerId = target.hubspotOwnerId?.trim();
    const ownerName = target.ownerName?.trim();
    const targetMonth = target.targetMonth ? normalizeTargetMonth(target.targetMonth) : null;
    const objectiveAmount = target.objectiveAmount;

    if (!hubspotOwnerId || !ownerName || !targetMonth || typeof objectiveAmount !== "number" || !Number.isFinite(objectiveAmount)) {
      return null;
    }

    parsedTargets.push({
      hubspotOwnerId,
      ownerName,
      targetMonth,
      objectiveAmount: Math.max(0, Math.round(objectiveAmount * 100) / 100),
    });
  }

  return parsedTargets;
};

export const registerSalesTargetRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: ListTargetsQuery; Reply: ApiResponse<MonthlySalesTarget[]> }>(
    "/api/forecast/targets",
    async (request, reply) => {
      const orgId = request.query.orgId;
      const year = parseYear(request.query.year);

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      if (!year) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre year doit etre une annee valide.",
        });
      }

      try {
        const result = await listMonthlySalesTargets(orgId, year);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, orgId, year }, "Impossible de charger les objectifs forecast.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement des objectifs.",
        });
      }
    },
  );

  app.post<{ Body: UpsertTargetsBody; Reply: ApiResponse<MonthlySalesTarget[]> }>(
    "/api/forecast/targets",
    async (request, reply) => {
      const orgId = request.body.orgId;
      const targets = parseTargets(request.body.targets);

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      if (!targets) {
        return reply.code(400).send({
          success: false,
          error: "Les objectifs mensuels sont invalides.",
        });
      }

      try {
        const result = await upsertMonthlySalesTargets(orgId, targets);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible d'enregistrer les objectifs forecast.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant l'enregistrement des objectifs.",
        });
      }
    },
  );
};
