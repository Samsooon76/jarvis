import type { ForecastDealStatus, ForecastDealStatusInput, HubSpotDealRow } from "./types.js";
import { normalizeText } from "./shared.js";

const normalizeStageText = (value: string | null | undefined): string =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const compactStageText = (value: string | null | undefined): string => normalizeStageText(value).replace(/\s+/g, "");

const getDealStageText = (row: ForecastDealStatusInput): string => normalizeStageText(`${row.deal_stage_label ?? ""} ${row.deal_stage ?? ""}`);

const getDealStageCompactText = (row: ForecastDealStatusInput): string => compactStageText(`${row.deal_stage_label ?? ""} ${row.deal_stage ?? ""}`);

const isStage = (row: ForecastDealStatusInput, readableStage: string): boolean => getDealStageCompactText(row).includes(compactStageText(readableStage));

export const isSignedPaymentPendingStage = (row: ForecastDealStatusInput): boolean => {
  const stage = getDealStageCompactText(row);

  return (
    stage.includes(compactStageText("deal signed payment pending")) ||
    stage.includes(compactStageText("deal signe payment pending")) ||
    stage.includes(compactStageText("deal signes payment pending"))
  );
};

export const isPaymentReceivedStage = (row: ForecastDealStatusInput): boolean => isStage(row, "payment received");

const isExplicitOpenForecastStage = (row: ForecastDealStatusInput): boolean => {
  const stage = getDealStageCompactText(row);

  return [
    "discovery",
    "initialproposition",
    "testing",
    "contractsent",
    "negociation",
    "negotiation",
    "contractvalidation",
  ].some((knownStage) => stage.includes(knownStage));
};

export const isSignedDealStatus = (status: ForecastDealStatus): status is "signedPaymentPending" | "paymentReceived" =>
  status === "signedPaymentPending" || status === "paymentReceived";

const isLostDeal = (row: ForecastDealStatusInput): boolean => {
  const stage = getDealStageText(row);

  return row.deal_lifecycle_status === "lost" || stage.includes("closed lost") || stage.includes("lost") || stage.includes("perdu");
};

export const getForecastDealStatus = (row: ForecastDealStatusInput): ForecastDealStatus => {
  if (isSignedPaymentPendingStage(row)) {
    return "signedPaymentPending";
  }

  if (isPaymentReceivedStage(row)) {
    return "paymentReceived";
  }

  if (isLostDeal(row)) {
    return "closedLost";
  }

  if (isExplicitOpenForecastStage(row)) {
    return "openForecast";
  }

  const stage = getDealStageText(row);

  if (row.deal_lifecycle_status === "won" || row.is_closed_deal === true || stage.includes("closed")) {
    return "excluded";
  }

  return "openForecast";
};

export const isForecastableDeal = (row: HubSpotDealRow): boolean => {
  const status = getForecastDealStatus(row);

  return status !== "closedLost" && status !== "excluded";
};
