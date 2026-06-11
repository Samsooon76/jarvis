import type { ForecastSynthesis, ForecastSynthesisDeal } from "../../../services/api";
import { formatAmount } from "../../../utils/dashboard/formatters";
import {
  FORECAST_SYNTHESIS_CATEGORY_ORDER,
  getPriorityLabel,
  getSynthesisCategoryTone,
} from "../../../utils/dashboard/forecast";

type SynthesisPanelProps = {
  synthesis: ForecastSynthesis;
};

export const SynthesisPanel = ({ synthesis }: SynthesisPanelProps) => (
  <>
    <section className="ae-forecast-synthesis-board" aria-label="Classement des deals par l'IA">
      {FORECAST_SYNTHESIS_CATEGORY_ORDER.map((category) => {
        const summary = synthesis.categories.find((item) => item.category === category);
        const categoryDeals: ForecastSynthesisDeal[] = synthesis.deals.filter((deal) => deal.category === category);

        return (
          <article className={`ae-forecast-synthesis-column ${getSynthesisCategoryTone(category)}`} key={category}>
            <header>
              <span>{summary?.label ?? category}</span>
              <strong>{formatAmount(summary?.amount ?? 0)}</strong>
              <small>{categoryDeals.length} deal(s) · {formatAmount(summary?.weightedAmount ?? 0)} pondere</small>
            </header>
            <div className="ae-forecast-synthesis-deals">
              {categoryDeals.length > 0 ? (
                categoryDeals.map((deal) => (
                  <div className="ae-forecast-synthesis-deal" key={deal.hubspotDealId}>
                    <div className="ae-forecast-synthesis-deal-head">
                      <strong>{deal.companyName}</strong>
                      <span>{formatAmount(deal.amount)}</span>
                    </div>
                    <div className="ae-forecast-synthesis-deal-meta">
                      <span>{deal.dealName ?? deal.hubspotDealId}</span>
                      <em>{deal.aiProbability === null ? "% IA n/a" : `${deal.aiProbability}% IA`}</em>
                    </div>
                    <p>{deal.reason}</p>
                    {deal.recommendedAction ? (
                      <p className="ae-forecast-synthesis-deal-action">→ {deal.recommendedAction}</p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="ae-empty">Aucun deal</p>
              )}
            </div>
          </article>
        );
      })}
    </section>

    <article className="ae-forecast-panel">
      <div className="ae-panel-heading">
        <span>Plan d'action pour atteindre l'objectif</span>
        <strong>{synthesis.actionPlan.length}</strong>
      </div>
      <div className="ae-forecast-synthesis-plan">
        {synthesis.actionPlan.length > 0 ? (
          synthesis.actionPlan.map((action, index) => {
            const relatedDeals = action.relatedDealIds
              .map((id) => synthesis.deals.find((deal) => deal.hubspotDealId === id)?.companyName)
              .filter((name): name is string => Boolean(name));

            return (
              <div className="ae-forecast-synthesis-plan-item" key={`${action.title}-${index}`}>
                <div className="ae-forecast-synthesis-plan-head">
                  <strong>{action.title}</strong>
                  <em className={`ae-forecast-risk-pill ${action.priority}`}>{getPriorityLabel(action.priority)}</em>
                </div>
                <p>{action.rationale}</p>
                {relatedDeals.length > 0 ? <small>Deals : {relatedDeals.join(", ")}</small> : null}
              </div>
            );
          })
        ) : (
          <p className="ae-empty">Aucune action proposee par l'IA.</p>
        )}
      </div>
    </article>
  </>
);
