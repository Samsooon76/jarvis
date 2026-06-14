import type { ForecastOverviewResult } from "../../../services/api";
import { formatAmount } from "../../../utils/dashboard/formatters";
import { formatPeriod } from "../../../utils/dashboard/forecast";

type ForecastKpiCardsProps = {
  analyzedRatio: number;
  dateFrom: string;
  dateTo: string;
  forecastShare: number;
  gapToFill: number | null;
  landingAmount: number;
  objectiveAmount: number | null;
  overview: ForecastOverviewResult | null;
  trendClassName: string;
};

const getScenarioAmount = (overview: ForecastOverviewResult | null, id: "commit" | "likely" | "upside"): number | null => {
  const scenario = overview?.scenarios.find((item) => item.id === id);

  return scenario?.amount ?? null;
};

export const ForecastKpiCards = ({
  analyzedRatio,
  dateFrom,
  dateTo,
  forecastShare,
  gapToFill,
  landingAmount,
  objectiveAmount,
  overview,
  trendClassName,
}: ForecastKpiCardsProps) => {
  const trendCaptionClass =
    trendClassName === "positive" ? "up" : trendClassName === "negative" ? "down" : "flat";

  return (
  <>
    <section aria-label="Indicateurs forecast" className="jv-stat-strip cols-4">
      <div className="jv-stat" style={{ animationDelay: "0ms" }}>
        <span className="jv-stat-label">Commit</span>
        <span className="jv-stat-value">{overview ? formatAmount(getScenarioAmount(overview, "commit") ?? 0) : "—"}</span>
        <small className="jv-stat-caption">
          {overview ? `${overview.signedDealCount} deal(s) signé(s)` : "Chargement…"}
        </small>
      </div>
      <div className="jv-stat" style={{ animationDelay: "60ms" }}>
        <span className="jv-stat-label">Best case</span>
        <span className="jv-stat-value">{overview ? formatAmount(getScenarioAmount(overview, "upside") ?? 0) : "—"}</span>
        <small className="jv-stat-caption">
          {overview
            ? `Probabilité ${overview.scenarios.find((item) => item.id === "upside")?.probability ?? 0}%`
            : "Chargement…"}
        </small>
      </div>
      <div className="jv-stat" style={{ animationDelay: "120ms" }}>
        <span className="jv-stat-label">Pipeline</span>
        <span className="jv-stat-value">{overview ? formatAmount(overview.pipelineAmount) : "—"}</span>
        <small className="jv-stat-caption">
          {overview ? `${overview.openDealCount} deal(s) ouvert(s)` : "Chargement…"}
        </small>
      </div>
      <div className="jv-stat" style={{ animationDelay: "180ms" }}>
        <span className="jv-stat-label">Couverture</span>
        <span className="jv-stat-value">{overview ? `${analyzedRatio}%` : "—"}</span>
        <small className="jv-stat-caption">
          {overview ? `${overview.analyzedDealCount}/${overview.openDealCount} analysés par l'IA` : "Chargement…"}
        </small>
      </div>
    </section>

    <section aria-label="Indicateurs atterrissage" className="jv-stat-strip cols-6">
      <div className="jv-stat" style={{ animationDelay: "0ms" }}>
        <span className="jv-stat-label">Déjà signé</span>
        <span className="jv-stat-value">{overview ? formatAmount(overview.signedAmount) : "—"}</span>
        <small className="jv-stat-caption">{overview ? `${overview.signedDealCount} deal(s) à 100%` : "HubSpot"}</small>
      </div>
      <div className="jv-stat" style={{ animationDelay: "60ms" }}>
        <span className="jv-stat-label">Paiement pending</span>
        <span className="jv-stat-value">{overview ? formatAmount(overview.signedPaymentPendingAmount) : "—"}</span>
        <small className="jv-stat-caption">{overview ? `${overview.signedPaymentPendingDealCount} deal(s)` : "HubSpot"}</small>
      </div>
      <div className="jv-stat" style={{ animationDelay: "120ms" }}>
        <span className="jv-stat-label">Paiement reçu</span>
        <span className="jv-stat-value">{overview ? formatAmount(overview.paymentReceivedAmount) : "—"}</span>
        <small className="jv-stat-caption">{overview ? `${overview.paymentReceivedDealCount} deal(s) payé(s)` : "HubSpot"}</small>
      </div>
      <div className="jv-stat" style={{ animationDelay: "180ms" }}>
        <span className="jv-stat-label">Atterrissage</span>
        <span className="jv-stat-value">{overview ? formatAmount(landingAmount) : "—"}</span>
        <small className={`jv-stat-caption ${trendCaptionClass}`}>
          {overview ? `${forecastShare}% du pipeline ouvert pondéré` : "Supabase"}
        </small>
      </div>
      <div className="jv-stat" style={{ animationDelay: "240ms" }}>
        <span className="jv-stat-label">Objectif</span>
        <span className="jv-stat-value">
          {!overview ? "—" : objectiveAmount === null ? "Non défini" : formatAmount(objectiveAmount)}
        </span>
        <small className="jv-stat-caption">{formatPeriod(dateFrom, dateTo)}</small>
      </div>
      <div className="jv-stat" style={{ animationDelay: "300ms" }}>
        <span className="jv-stat-label">Gap objectif</span>
        <span className="jv-stat-value">
          {!overview || objectiveAmount === null ? "—" : formatAmount(gapToFill ?? 0)}
        </span>
        <small className={`jv-stat-caption ${gapToFill && gapToFill > 0 ? "down" : "up"}`}>
          {objectiveAmount === null ? "Objectif non défini" : gapToFill && gapToFill > 0 ? "À combler" : "Objectif couvert"}
        </small>
      </div>
    </section>
  </>
  );
};