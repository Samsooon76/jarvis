import { useEffect, useMemo, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import { BarChart3, Layers, TrendingUp, type LucideIcon } from "lucide-react";
import { dealStatusLabels, priorityLabels } from "./config";
import { formatAmount, formatDate } from "../../utils/dashboard/formatters";
import { getDealStatus } from "../../utils/dashboard/prospects";
import { ForecastChart } from "./charts/ForecastChart";
import { StageFunnelChart } from "./charts/StageFunnelChart";
import { ProbabilityTimelinePanel } from "./ProbabilityTimelinePanel";
import { SalesActivityStatsPanel } from "./SalesActivityStatsPanel";
import type { ForecastChartViewModel, MetricCard, StageChartViewModel } from "./types";
import type { HubSpotOwnerOption } from "../../services/api";
import "../styles/stats.css";

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

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

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
    <div className="jv-stats-page" aria-label="Statistiques">
      <header className="jv-page-header">
        <BarChart3 aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>
          Statistiques
          <span className="jv-page-kicker">pipeline</span>
        </h1>
      </header>

      <section className="jv-stat-strip" aria-label="Indicateurs pipeline">
        {metricCards.map((card, index) => (
          <div className="jv-stat" key={card.id} style={{ animationDelay: `${index * 60}ms` }}>
            <span className="jv-stat-label">{card.label}</span>
            <span className={`jv-stat-value${card.tone === "red" ? " is-risk" : ""}`}>{card.value}</span>
          </div>
        ))}
      </section>

      <section className="jv-theme-block" aria-label="Forecast fermeture">
        <header className="jv-theme-block-head">
          <SectionLabel icon={TrendingUp}>Forecast fermeture</SectionLabel>
          <span className="jv-theme-block-meta">
            {overdueCloseProspects.length} en retard
          </span>
        </header>
        <ForecastChart chart={forecastChart} formatAmount={formatAmount} />
      </section>

      <section className="jv-theme-block" aria-label="Repartition par stage">
        <header className="jv-theme-block-head">
          <SectionLabel icon={Layers}>Repartition par stage</SectionLabel>
          <div className="jv-theme-block-actions">
            <label className="jv-toggle">
              <input
                checked={hideClosedLostStage}
                onChange={(event) => onHideClosedLostStageChange(event.target.checked)}
                type="checkbox"
              />
              <span aria-hidden="true" />
              Masquer lost
            </label>
            <span className="jv-theme-block-meta">{stageChart.dealCount} deal(s)</span>
          </div>
        </header>
        <StageFunnelChart chart={stageChart} onStageSelect={setSelectedStageId} selectedStageId={selectedStageId} />
        {selectedStage ? (
          <div className="jv-stats-stage-deals" aria-live="polite">
            <header className="jv-stats-stage-deals-head">
              <SectionLabel icon={Layers}>{`Deals — ${selectedStage.label}`}</SectionLabel>
              <span className="jv-theme-block-meta">
                {selectedStage.count} deal(s) · {formatAmount(selectedStage.amount)}
              </span>
            </header>
            {selectedStage.prospects.length > 0 ? (
              <div className="jv-list-body">
                {selectedStage.prospects.map((prospect) => (
                  <article className="jv-list-item" key={prospect.id}>
                    <span className="jv-list-main">
                      <strong>{prospect.company}</strong>
                      <small>
                        {prospect.name} · {prospect.nextAction}
                      </small>
                    </span>
                    <dl className="jv-stats-deal-meta">
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
              <p className="jv-theme-empty">Aucun deal dans ce stage.</p>
            )}
          </div>
        ) : null}
      </section>

      <ProbabilityTimelinePanel
        canViewTeamForecast={canViewTeamForecast}
        orgId={orgId}
        owners={owners}
        selectedOwnerId={selectedOwnerId}
      />

      <SalesActivityStatsPanel
        canViewTeamForecast={canViewTeamForecast}
        orgId={orgId}
        owners={owners}
        selectedOwnerId={selectedOwnerId}
      />
    </div>
  );
};