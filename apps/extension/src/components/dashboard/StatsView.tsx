import { useEffect, useMemo, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import { dealStatusLabels, priorityLabels } from "./config";
import { formatAmount, formatDate } from "../../utils/dashboard/formatters";
import { getDealStatus } from "../../utils/dashboard/prospects";
import { ForecastChart } from "./charts/ForecastChart";
import { StageFunnelChart } from "./charts/StageFunnelChart";
import { MetricIcon } from "./MetricIcon";
import { ProbabilityTimelinePanel } from "./ProbabilityTimelinePanel";
import { SalesActivityStatsPanel } from "./SalesActivityStatsPanel";
import type { ForecastChartViewModel, MetricCard, StageChartViewModel } from "./types";
import type { HubSpotOwnerOption } from "../../services/api";

type StatsViewProps = {
  forecastChart: ForecastChartViewModel;
  hideClosedLostStage: boolean;
  metricCards: MetricCard[];
  onHideClosedLostStageChange: (hideClosedLostStage: boolean) => void;
  overdueCloseProspects: QueueProspect[];
  stageChart: StageChartViewModel;
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedOwnerId?: string;
  canViewTeamForecast?: boolean;
};

export const StatsView = ({
  forecastChart,
  hideClosedLostStage,
  metricCards,
  onHideClosedLostStageChange,
  overdueCloseProspects,
  stageChart,
  orgId,
  owners,
  selectedOwnerId,
  canViewTeamForecast = false,
}: StatsViewProps) => {
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const selectedStage = useMemo(
    () => stageChart.points.find((point) => point.id === selectedStageId) ?? null,
    [selectedStageId, stageChart.points],
  );

  useEffect(() => {
    if (selectedStageId && !stageChart.points.some((point) => point.id === selectedStageId)) {
      setSelectedStageId(null);
    }
  }, [selectedStageId, stageChart.points]);

  return (
    <section className="ae-view-panel" aria-label="Statistiques">
      <div className="ae-view-title">
        <p className="ae-eyebrow">Statistiques</p>
        <h2>Dashboards pipeline</h2>
      </div>
      <section className="ae-metrics stats-grid" aria-label="Pipeline statistics">
        {metricCards.map((card) => (
          <div className={`ae-metric-card ${card.tone}`} key={card.id}>
            <MetricIcon name={card.icon} />
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        ))}
      </section>
      <section className="ae-dashboard-grid" aria-label="Dashboard details">
        <article className="ae-dashboard-panel">
          <div className="ae-panel-heading">
            <span>Forecast fermeture</span>
            <strong>{overdueCloseProspects.length} en retard</strong>
          </div>
          <ForecastChart chart={forecastChart} formatAmount={formatAmount} />
        </article>
        <article className="ae-dashboard-panel ae-stage-panel">
          <div className="ae-panel-heading">
            <span>Repartition par stage</span>
            <div className="ae-stage-panel-actions">
              <label className="ae-mini-toggle">
                <input
                  checked={hideClosedLostStage}
                  onChange={(event) => onHideClosedLostStageChange(event.target.checked)}
                  type="checkbox"
                />
                <span aria-hidden="true" />
                Masquer lost
              </label>
              <strong>{stageChart.dealCount} deal(s)</strong>
            </div>
          </div>
          <StageFunnelChart chart={stageChart} onStageSelect={setSelectedStageId} selectedStageId={selectedStageId} />
          {selectedStage ? (
            <div className="ae-stage-deals" aria-live="polite">
              <div className="ae-stage-deals-heading">
                <span>
                  Deals - {selectedStage.label}
                </span>
                <strong>
                  {selectedStage.count} deal(s) · {formatAmount(selectedStage.amount)}
                </strong>
              </div>
              {selectedStage.prospects.length > 0 ? (
                <div className="ae-stage-deal-list">
                  {selectedStage.prospects.map((prospect) => (
                    <article className="ae-stage-deal-row" key={prospect.id}>
                      <div>
                        <strong>{prospect.company}</strong>
                        <span>
                          {prospect.name} · {prospect.nextAction}
                        </span>
                      </div>
                      <dl>
                        <div>
                          <dt>Montant</dt>
                          <dd>{formatAmount(prospect.dealAmount)}</dd>
                        </div>
                        <div>
                          <dt>Proba</dt>
                          <dd>{prospect.closeProbability}%</dd>
                        </div>
                        <div>
                          <dt>Close</dt>
                          <dd>{prospect.closeDate ? formatDate(prospect.closeDate) : "Sans date"}</dd>
                        </div>
                        <div>
                          <dt>Statut</dt>
                          <dd>
                            {dealStatusLabels[getDealStatus(prospect)]} · {priorityLabels[prospect.priority]}
                          </dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="ae-empty">Aucun deal dans ce stage.</p>
              )}
            </div>
          ) : null}
        </article>
      </section>
      <section className="ae-dashboard-grid" aria-label="Probabilite de closing">
        <ProbabilityTimelinePanel
          orgId={orgId}
          owners={owners}
          selectedOwnerId={selectedOwnerId}
          canViewTeamForecast={canViewTeamForecast}
        />
      </section>
      <section className="ae-dashboard-grid" aria-label="Activites commerciales">
        <SalesActivityStatsPanel
          orgId={orgId}
          owners={owners}
          selectedOwnerId={selectedOwnerId}
          canViewTeamForecast={canViewTeamForecast}
        />
      </section>
    </section>
  );
};
