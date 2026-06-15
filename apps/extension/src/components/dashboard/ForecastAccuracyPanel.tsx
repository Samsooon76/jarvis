import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw, Users, type LucideIcon } from "lucide-react";
import { fetchForecastAccuracy, type ForecastAccuracyOverview } from "../../services/api";

const PERIOD_OPTIONS = [
  { days: 90, label: "90 jours" },
  { days: 180, label: "6 mois" },
  { days: 365, label: "12 mois" },
];

const CATEGORY_LABELS: Record<string, string> = {
  commit: "Commit",
  bestCase: "Best case",
  atRisk: "À risque",
  slipping: "Slipping",
};

const formatPct = (value: number | null): string => (value !== null ? `${value}%` : "n/a");

const formatBias = (value: number | null): string => {
  if (value === null) {
    return "n/a";
  }

  return value > 0 ? `+${value}% (sur-commit)` : value < 0 ? `${value}% (sous-commit)` : "0%";
};

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const CalibrationBars = ({
  title,
  buckets,
}: {
  title: string;
  buckets: ForecastAccuracyOverview["calibration"]["crm"];
}) => (
  <article className="jv-theme-block">
    <SectionLabel icon={BarChart3}>{title}</SectionLabel>
    <small className="jv-toolbar-meta">Win rate observé par tranche de probabilité annoncée</small>
    {buckets.length === 0 ? (
      <p className="jv-theme-empty">Pas encore de deals résolus avec cette source.</p>
    ) : (
      <div className="jv-factor-list">
        {buckets.map((bucket) => {
          const ideal = bucket.bucket + 5;
          const observed = bucket.observedWinRate ?? 0;

          return (
            <div className="jv-factor-item" key={bucket.bucket}>
              <div className="jv-factor-item-head">
                <strong>
                  {bucket.bucket}-{bucket.bucket + 10}% annoncé
                </strong>
                <em>{formatPct(bucket.observedWinRate)}</em>
              </div>
              <div className="jv-factor-bar">
                <span style={{ width: `${observed}%`, background: observed >= bucket.bucket ? "var(--jv-success)" : "var(--jv-warning)" }} />
              </div>
              <small>
                {bucket.dealCount} deal{bucket.dealCount > 1 ? "s" : ""} · idéal ~{ideal}%
              </small>
            </div>
          );
        })}
      </div>
    )}
  </article>
);

export const ForecastAccuracyPanel = () => {
  const [periodDays, setPeriodDays] = useState(90);
  const [overview, setOverview] = useState<ForecastAccuracyOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((days: number, forceRefresh = false, signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);

    fetchForecastAccuracy({ periodDays: days, forceRefresh, signal })
      .then((result) => {
        setOverview(result);
        setIsLoading(false);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger la fiabilité forecast.");
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    load(periodDays, false, abortController.signal);

    return () => abortController.abort();
  }, [load, periodDays]);

  return (
    <>
      <div className="jv-toolbar">
        <span className="jv-toolbar-meta">
          {overview
            ? `Fiabilité mesurée sur ${overview.resolvedDealCount} deal${overview.resolvedDealCount > 1 ? "s" : ""} résolu${overview.resolvedDealCount > 1 ? "s" : ""} (${overview.dateFrom} au ${overview.dateTo}).`
            : "Forecast vs réalité"}
        </span>
        <div className="jv-toolbar-actions">
          <div aria-label="Période fiabilité" className="jv-filter-pills" role="group">
            {PERIOD_OPTIONS.map((option) => (
              <button
                className={periodDays === option.days ? "active" : ""}
                key={option.days}
                onClick={() => setPeriodDays(option.days)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="jv-btn-ghost" disabled={isLoading} onClick={() => load(periodDays, true)} type="button">
            <RefreshCw aria-hidden="true" className={isLoading ? "jv-spin" : undefined} size={14} strokeWidth={1.5} />
            Actualiser
          </button>
        </div>
      </div>

      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}
      {isLoading && !overview ? <p className="jv-list-empty">Calcul de la fiabilité…</p> : null}

      {overview ? (
        <>
          {overview.resolvedDealCount === 0 ? (
            <p className="jv-theme-empty">
              Pas encore de deals résolus sur la période : la capture quotidienne des snapshots vient de démarrer, la
              valeur apparaît après quelques semaines de données.
            </p>
          ) : null}

          {overview.lowConfidence && overview.resolvedDealCount > 0 ? (
            <p className="jv-banner jv-banner-success">
              Moins de 10 deals résolus sur la période : les pourcentages sont indicatifs, pas significatifs.
            </p>
          ) : null}

          <section aria-label="Indicateurs fiabilité" className="jv-stat-strip cols-4">
            <div className="jv-stat">
              <span className="jv-stat-label">Commit accuracy</span>
              <span className="jv-stat-value">{formatPct(overview.overallCommitAccuracy)}</span>
              <small className="jv-stat-caption">montant commit ~J-30 effectivement signé</small>
            </div>
            <div className="jv-stat">
              <span className="jv-stat-label">Biais global</span>
              <span className="jv-stat-value">{formatBias(overview.overallBiasPct)}</span>
              <small className="jv-stat-caption">commit vs réalisé</small>
            </div>
            <div className="jv-stat">
              <span className="jv-stat-label">Deals résolus</span>
              <span className="jv-stat-value">{overview.resolvedDealCount}</span>
              <small className="jv-stat-caption">{overview.snapshotCount} snapshots sur la période</small>
            </div>
            <div className="jv-stat">
              <span className="jv-stat-label">Période</span>
              <span className="jv-stat-value">{periodDays}j</span>
              <small className="jv-stat-caption">
                {overview.dateFrom} → {overview.dateTo}
              </small>
            </div>
          </section>

          <section className="jv-themes-row">
            <article className="jv-theme-block">
              <SectionLabel icon={Users}>Fiabilité par commercial</SectionLabel>
              {overview.reps.length === 0 ? (
                <p className="jv-theme-empty">Aucun commercial avec des deals suivis sur la période.</p>
              ) : (
                <ul className="jv-theme-list">
                  {overview.reps.map((rep) => (
                    <li key={rep.userId ?? "none"}>
                      <span>
                        {rep.repName}
                        {rep.lowConfidence ? " (volume faible)" : ""}
                      </span>
                      <em>{formatPct(rep.commitAccuracy)}</em>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="jv-theme-block">
              <SectionLabel icon={BarChart3}>Taux de close réel par verdict IA</SectionLabel>
              {overview.categories.every((category) => category.resolvedCount === 0) ? (
                <p className="jv-theme-empty">Pas encore de deals résolus avec un verdict IA.</p>
              ) : (
                <ul className="jv-theme-list">
                  {overview.categories
                    .filter((category) => category.resolvedCount > 0)
                    .map((category) => (
                      <li key={category.category}>
                        <span>{CATEGORY_LABELS[category.category] ?? category.category}</span>
                        <em>
                          {formatPct(category.closeRate)} ({category.wonCount}/{category.resolvedCount})
                        </em>
                      </li>
                    ))}
                </ul>
              )}
            </article>
          </section>

          <section className="jv-themes-row">
            <CalibrationBars buckets={overview.calibration.crm} title="Calibration CRM" />
            <CalibrationBars buckets={overview.calibration.ai} title="Calibration IA" />
          </section>
        </>
      ) : null}
    </>
  );
};