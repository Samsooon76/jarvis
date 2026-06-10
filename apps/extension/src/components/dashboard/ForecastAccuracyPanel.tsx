import { useCallback, useEffect, useState } from "react";
import { fetchForecastAccuracy, type ForecastAccuracyOverview } from "../../services/api";

const PERIOD_OPTIONS = [
  { days: 90, label: "90 jours" },
  { days: 180, label: "6 mois" },
  { days: 365, label: "12 mois" },
];

const CATEGORY_LABELS: Record<string, string> = {
  commit: "Commit",
  bestCase: "Best case",
  atRisk: "A risque",
  slipping: "Slipping",
};

const formatAmount = (value: number): string =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);

const formatPct = (value: number | null): string => (value !== null ? `${value}%` : "n/a");

const formatBias = (value: number | null): string => {
  if (value === null) {
    return "n/a";
  }

  return value > 0 ? `+${value}% (sur-commit)` : value < 0 ? `${value}% (sous-commit)` : "0%";
};

const CalibrationBars = ({
  title,
  buckets,
}: {
  title: string;
  buckets: ForecastAccuracyOverview["calibration"]["crm"];
}) => (
  <article className="ae-forecast-panel">
    <div className="ae-panel-heading">
      <h4>{title}</h4>
      <small>Win rate observe par tranche de probabilite annoncee</small>
    </div>
    <div className="ae-forecast-list">
      {buckets.length === 0 ? (
        <p className="ae-empty">Pas encore de deals resolus avec cette source.</p>
      ) : (
        buckets.map((bucket) => {
          const ideal = bucket.bucket + 5;

          return (
            <div key={bucket.bucket}>
              <span>
                {bucket.bucket}-{bucket.bucket + 10}% annonce
              </span>
              <div style={{ position: "relative", height: "10px", borderRadius: "5px", background: "rgba(127,127,127,0.15)", overflow: "hidden" }}>
                <i
                  style={{
                    position: "absolute",
                    insetBlock: 0,
                    left: 0,
                    width: `${bucket.observedWinRate ?? 0}%`,
                    background: (bucket.observedWinRate ?? 0) >= bucket.bucket ? "#26be67" : "#ff8a32",
                  }}
                />
                <i
                  style={{ position: "absolute", insetBlock: 0, left: `${ideal}%`, width: "2px", background: "#4f7dce" }}
                  title={`Ideal: ~${ideal}%`}
                />
              </div>
              <small>
                observe {formatPct(bucket.observedWinRate)} sur {bucket.dealCount} deal{bucket.dealCount > 1 ? "s" : ""} (ideal ~{ideal}%)
              </small>
            </div>
          );
        })
      )}
    </div>
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

        setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger la fiabilite forecast.");
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
      <div className="ae-forecast-header">
        <span className="ae-forecast-last-update">
          {overview
            ? `Fiabilite mesuree sur ${overview.resolvedDealCount} deal${overview.resolvedDealCount > 1 ? "s" : ""} resolu${overview.resolvedDealCount > 1 ? "s" : ""} (${overview.dateFrom} au ${overview.dateTo}).`
            : "Forecast vs realite"}
        </span>
        <div className="ae-forecast-header-meta">
          <span className="ae-forecast-period-toggle">
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
          </span>
          <button className="ae-forecast-link" disabled={isLoading} onClick={() => load(periodDays, true)} type="button">
            Actualiser
          </button>
        </div>
      </div>

      {error ? <p className="ae-admin-feedback error">{error}</p> : null}
      {isLoading && !overview ? <p className="ae-empty">Calcul de la fiabilite...</p> : null}

      {overview ? (
        <>
          {overview.resolvedDealCount === 0 ? (
            <p className="ae-empty">
              Pas encore de deals resolus sur la periode: la capture quotidienne des snapshots vient de demarrer, la
              valeur apparait apres quelques semaines de donnees.
            </p>
          ) : null}

          {overview.lowConfidence && overview.resolvedDealCount > 0 ? (
            <p className="ae-admin-feedback">
              Moins de 10 deals resolus sur la periode: les pourcentages sont indicatifs, pas significatifs.
            </p>
          ) : null}

          <section className="ae-forecast-kpis">
            <div>
              <small>Commit accuracy</small>
              <strong>{formatPct(overview.overallCommitAccuracy)}</strong>
              <small>montant commit ~J-30 effectivement signe</small>
            </div>
            <div>
              <small>Biais global</small>
              <strong>{formatBias(overview.overallBiasPct)}</strong>
              <small>commit vs realise</small>
            </div>
            <div>
              <small>Deals resolus</small>
              <strong>{overview.resolvedDealCount}</strong>
              <small>{overview.snapshotCount} snapshots sur la periode</small>
            </div>
          </section>

          <article className="ae-forecast-panel">
            <div className="ae-panel-heading">
              <h4>Fiabilite par commercial</h4>
              <small>Alimente le 1:1 (cf. Coaching IA)</small>
            </div>
            <div className="ae-forecast-list">
              {overview.reps.length === 0 ? (
                <p className="ae-empty">Aucun commercial avec des deals suivis sur la periode.</p>
              ) : (
                overview.reps.map((rep) => (
                  <div key={rep.userId ?? "none"}>
                    <strong>
                      {rep.repName}
                      {rep.lowConfidence ? " (volume faible)" : ""}
                    </strong>
                    <p>
                      Commit {formatAmount(rep.committedAmount)} vs signe {formatAmount(rep.realizedAmount)} - accuracy{" "}
                      {formatPct(rep.commitAccuracy)} - biais {formatBias(rep.biasPct)}
                    </p>
                    <small>
                      Slippage {formatPct(rep.slippageRate)} ({rep.slippedDealCount}/{rep.trackedDealCount} deals suivis) -{" "}
                      {rep.wonCount}/{rep.resolvedCount} deals gagnes
                    </small>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="ae-forecast-panel">
            <div className="ae-panel-heading">
              <h4>Taux de close reel par verdict IA</h4>
              <small>Les deals classes Commit closent-ils vraiment?</small>
            </div>
            <div className="ae-forecast-list">
              {overview.categories.every((category) => category.resolvedCount === 0) ? (
                <p className="ae-empty">Pas encore de deals resolus avec un verdict IA.</p>
              ) : (
                overview.categories
                  .filter((category) => category.resolvedCount > 0)
                  .map((category) => (
                    <div key={category.category}>
                      <strong>{CATEGORY_LABELS[category.category] ?? category.category}</strong>
                      <p>
                        {formatPct(category.closeRate)} de close reel ({category.wonCount}/{category.resolvedCount} deals)
                      </p>
                    </div>
                  ))
              )}
            </div>
          </article>

          <section className="ae-forecast-layout">
            <CalibrationBars buckets={overview.calibration.crm} title="Calibration CRM" />
            <CalibrationBars buckets={overview.calibration.ai} title="Calibration IA" />
          </section>
        </>
      ) : null}
    </>
  );
};
