import type { ForecastOverviewResult } from "../../../services/api";
import { formatAmount } from "../../../utils/dashboard/formatters";

type MonthlyProjectionCardsProps = {
  months: ForecastOverviewResult["monthlyProjection"];
};

export const MonthlyProjectionCards = ({ months }: MonthlyProjectionCardsProps) => (
  <section aria-label="Détail par mois" className="jv-month-grid">
    {months.map((month) => {
      const toFill = month.objectiveAmount === null ? null : Math.max(0, month.objectiveAmount - month.landingAmount);

      return (
        <article className="jv-month-card" key={month.month}>
          <header>
            <strong>{month.label}</strong>
            <span>{month.dealCount} deal(s)</span>
          </header>
          <dl>
            <div>
              <dt>Déjà signé</dt>
              <dd>
                {formatAmount(month.signedAmount)}
                <small>{month.signedDealCount} deal(s) à 100%</small>
              </dd>
            </div>
            <div>
              <dt>Reste à closer (pondéré)</dt>
              <dd>
                {formatAmount(month.openForecastAmount)}
                <small>
                  {month.openDealCount} ouvert(s) · {formatAmount(month.openPipelineAmount)} brut
                </small>
              </dd>
            </div>
            <div className="highlight">
              <dt>Atterrissage</dt>
              <dd>{formatAmount(month.landingAmount)}</dd>
            </div>
            <div>
              <dt>Objectif</dt>
              <dd>{month.objectiveAmount === null ? "—" : formatAmount(month.objectiveAmount)}</dd>
            </div>
            <div className={toFill === null ? "" : toFill > 0 ? "negative" : "positive"}>
              <dt>Gap objectif</dt>
              <dd>
                {toFill === null ? "—" : toFill > 0 ? formatAmount(toFill) : "Couvert"}
                {toFill !== null ? <small>{toFill > 0 ? "à combler" : "objectif atteint"}</small> : null}
              </dd>
            </div>
          </dl>
        </article>
      );
    })}
  </section>
);