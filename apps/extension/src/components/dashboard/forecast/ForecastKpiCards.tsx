import type { ForecastOverviewResult } from "../../../services/api";
import { formatAmount } from "../../../utils/dashboard/formatters";
import { formatPeriod } from "../../../utils/dashboard/forecast";

type ForecastKpiCardsProps = {
  dateFrom: string;
  dateTo: string;
  forecastShare: number;
  gapToFill: number | null;
  landingAmount: number;
  objectiveAmount: number | null;
  overview: ForecastOverviewResult | null;
  trendClassName: string;
};

export const ForecastKpiCards = ({
  dateFrom,
  dateTo,
  forecastShare,
  gapToFill,
  landingAmount,
  objectiveAmount,
  overview,
  trendClassName,
}: ForecastKpiCardsProps) => (
  <section className="ae-forecast-kpis">
    <article>
      <span>Deja signe</span>
      <strong>{overview ? formatAmount(overview.signedAmount) : "--"}</strong>
      <small>{overview ? `${overview.signedDealCount} deal(s) a 100%` : "HubSpot"}</small>
    </article>
    <article>
      <span>Paiement pending</span>
      <strong>{overview ? formatAmount(overview.signedPaymentPendingAmount) : "--"}</strong>
      <small>{overview ? `${overview.signedPaymentPendingDealCount} deal(s) signe(s)` : "HubSpot"}</small>
    </article>
    <article>
      <span>Paiement recu</span>
      <strong>{overview ? formatAmount(overview.paymentReceivedAmount) : "--"}</strong>
      <small>{overview ? `${overview.paymentReceivedDealCount} deal(s) paye(s)` : "HubSpot"}</small>
    </article>
    <article>
      <span>Atterrissage</span>
      <strong>{overview ? formatAmount(landingAmount) : "--"}</strong>
      <small className={trendClassName}>{overview ? `${forecastShare}% du pipeline ouvert pondere` : "Supabase"}</small>
    </article>
    <article>
      <span>Objectif</span>
      <strong>{!overview ? "--" : objectiveAmount === null ? "Non defini" : formatAmount(objectiveAmount)}</strong>
      <small>{formatPeriod(dateFrom, dateTo)}</small>
    </article>
    <article>
      <span>Gap objectif</span>
      <strong>{!overview || objectiveAmount === null ? "--" : formatAmount(gapToFill ?? 0)}</strong>
      <small className={gapToFill && gapToFill > 0 ? "negative" : "positive"}>
        {objectiveAmount === null ? "Objectif non defini" : gapToFill && gapToFill > 0 ? "A combler" : "Objectif couvert"}
      </small>
    </article>
  </section>
);
