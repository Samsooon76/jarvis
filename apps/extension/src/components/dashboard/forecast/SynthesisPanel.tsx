import { ListChecks, type LucideIcon } from "lucide-react";
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

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

export const SynthesisPanel = ({ synthesis }: SynthesisPanelProps) => (
  <>
    <section aria-label="Classement des deals par l'IA" className="jv-synthesis-board">
      {FORECAST_SYNTHESIS_CATEGORY_ORDER.map((category) => {
        const summary = synthesis.categories.find((item) => item.category === category);
        const categoryDeals: ForecastSynthesisDeal[] = synthesis.deals.filter((deal) => deal.category === category);

        return (
          <article className={`jv-synthesis-column ${getSynthesisCategoryTone(category)}`} key={category}>
            <header>
              <span>{summary?.label ?? category}</span>
              <strong>{formatAmount(summary?.amount ?? 0)}</strong>
              <small>
                {categoryDeals.length} deal(s) · {formatAmount(summary?.weightedAmount ?? 0)} pondéré
              </small>
            </header>
            <div className="jv-synthesis-deals">
              {categoryDeals.length > 0 ? (
                categoryDeals.map((deal) => (
                  <div className="jv-synthesis-deal" key={deal.hubspotDealId}>
                    <div className="jv-synthesis-deal-head">
                      <strong>{deal.companyName}</strong>
                      <span>{formatAmount(deal.amount)}</span>
                    </div>
                    <div className="jv-synthesis-deal-meta">
                      <span>{deal.dealName ?? deal.hubspotDealId}</span>
                      <em>{deal.aiProbability === null ? "% IA n/a" : `${deal.aiProbability}% IA`}</em>
                    </div>
                    <p>{deal.reason}</p>
                    {deal.recommendedAction ? (
                      <p className="jv-synthesis-deal-action">→ {deal.recommendedAction}</p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="jv-theme-empty">Aucun deal</p>
              )}
            </div>
          </article>
        );
      })}
    </section>

    <section className="jv-theme-block">
      <SectionLabel icon={ListChecks}>Plan d&apos;action pour atteindre l&apos;objectif</SectionLabel>
      <div className="jv-action-plan">
        {synthesis.actionPlan.length > 0 ? (
          synthesis.actionPlan.map((action, index) => {
            const relatedDeals = action.relatedDealIds
              .map((id) => synthesis.deals.find((deal) => deal.hubspotDealId === id)?.companyName)
              .filter((name): name is string => Boolean(name));

            return (
              <div className="jv-action-plan-item" key={`${action.title}-${index}`}>
                <div className="jv-action-plan-head">
                  <strong>{action.title}</strong>
                  <em className={`jv-risk-pill ${action.priority}`}>{getPriorityLabel(action.priority)}</em>
                </div>
                <p>{action.rationale}</p>
                {relatedDeals.length > 0 ? <small>Deals : {relatedDeals.join(", ")}</small> : null}
              </div>
            );
          })
        ) : (
          <p className="jv-theme-empty">Aucune action proposée par l&apos;IA.</p>
        )}
      </div>
    </section>
  </>
);