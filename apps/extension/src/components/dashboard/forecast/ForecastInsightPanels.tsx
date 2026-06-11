import type { CSSProperties } from "react";
import type { ForecastOverviewResult } from "../../../services/api";
import { formatAmount } from "../../../utils/dashboard/formatters";
import { getRiskClassName } from "../../../utils/dashboard/forecast";

type ForecastInsightPanelsProps = {
  analyzedRatio: number;
  overview: ForecastOverviewResult | null;
};

export const ForecastInsightPanels = ({ analyzedRatio, overview }: ForecastInsightPanelsProps) => (
  <section className="ae-forecast-layout three">
    <article className="ae-forecast-panel">
      <div className="ae-panel-heading">
        <span>Risques principaux</span>
        <strong>{overview?.risks.length ?? 0}</strong>
      </div>
      <div className="ae-forecast-list">
        {(overview?.risks ?? []).map((risk) => (
          <div key={risk.title}>
            <span>{risk.title}</span>
            <em className={getRiskClassName(risk.severity)}>
              {risk.severity === "high" ? "Eleve" : risk.severity === "medium" ? "Moyen" : "Faible"}
            </em>
          </div>
        ))}
      </div>
    </article>

    <article className="ae-forecast-panel">
      <div className="ae-panel-heading">
        <span>Leviers prioritaires</span>
        <strong>{overview?.levers.length ?? 0}</strong>
      </div>
      <div className="ae-forecast-list">
        {(overview?.levers ?? []).map((lever) => (
          <div key={lever.title}>
            <span>{lever.title}</span>
            <em>{formatAmount(lever.amount)}</em>
          </div>
        ))}
      </div>
    </article>

    <article className="ae-forecast-panel">
      <div className="ae-panel-heading">
        <span>Fiabilite du forecast</span>
        <strong>{overview ? `${overview.confidenceScore}%` : "--"}</strong>
      </div>
      <div className="ae-forecast-confidence-ring" style={{ "--score": `${overview?.confidenceScore ?? 0}%` } as CSSProperties}>
        <strong>{overview ? `${overview.confidenceScore}%` : "--"}</strong>
        <span>{overview ? `${analyzedRatio}% couverture IA` : "Confiance globale"}</span>
      </div>
      <div className="ae-forecast-reliability">
        {(overview?.reliability ?? []).map((item) => (
          <div key={item.id}>
            <span>{item.label}</span>
            <span className="ae-forecast-meter"><i style={{ "--value": `${item.score}%` } as CSSProperties} /></span>
            <strong>{item.score}%</strong>
          </div>
        ))}
      </div>
    </article>
  </section>
);
