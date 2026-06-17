import { AlertTriangle, TrendingUp, type LucideIcon } from "lucide-react";
import type { ForecastOverviewResult } from "../../../services/api";
import { formatAmount } from "../../../utils/dashboard/formatters";
import { getRiskClassName } from "../../../utils/dashboard/forecast";

type ForecastInsightPanelsProps = {
  overview: ForecastOverviewResult | null;
};

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const severityLabels: Record<"low" | "medium" | "high", string> = {
  high: "Élevé",
  medium: "Moyen",
  low: "Faible",
};

export const ForecastInsightPanels = ({ overview }: ForecastInsightPanelsProps) => (
  <section className="jv-themes-row">
    <div className="jv-theme-block">
      <SectionLabel icon={AlertTriangle}>Risques pipe</SectionLabel>
      {(overview?.risks ?? []).length > 0 ? (
        <ul className="jv-theme-list">
          {(overview?.risks ?? []).map((risk) => (
            <li key={risk.title}>
              <span>{risk.title}</span>
              <em className={getRiskClassName(risk.severity)}>{severityLabels[risk.severity]}</em>
            </li>
          ))}
        </ul>
      ) : (
        <p className="jv-theme-empty">Aucun risque identifié sur cette période.</p>
      )}
    </div>

    <div className="jv-theme-block">
      <SectionLabel icon={TrendingUp}>Mouvements clés</SectionLabel>
      {(overview?.levers ?? []).length > 0 ? (
        <ul className="jv-theme-list">
          {(overview?.levers ?? []).map((lever) => (
            <li key={lever.title}>
              <span>{lever.title}</span>
              <em>{formatAmount(lever.amount)}</em>
            </li>
          ))}
        </ul>
      ) : (
        <p className="jv-theme-empty">Aucun levier prioritaire détecté.</p>
      )}
    </div>
  </section>
);