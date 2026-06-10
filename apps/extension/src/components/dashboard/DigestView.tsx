import { useCallback, useEffect, useMemo, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import {
  fetchManagerDigest,
  type ManagerDigest,
  type ManagerDigestPeriod,
} from "../../services/api";

type DigestViewProps = {
  prospects: QueueProspect[];
  onOpenDealAnalysis: (prospectId: string) => void;
};

const PERIOD_OPTIONS: Array<{ id: ManagerDigestPeriod; label: string }> = [
  { id: "daily", label: "Aujourd'hui" },
  { id: "weekly", label: "7 derniers jours" },
];

const HIGHLIGHT_LABELS: Record<string, string> = {
  win: "Win",
  risk: "Risque",
  movement: "Mouvement",
};

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const DigestView = ({ prospects, onOpenDealAnalysis }: DigestViewProps) => {
  const [period, setPeriod] = useState<ManagerDigestPeriod>("daily");
  const [digest, setDigest] = useState<ManagerDigest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movementsOpen, setMovementsOpen] = useState(false);

  const prospectIdByDealId = useMemo(() => {
    const byDealId = new Map<string, string>();

    for (const prospect of prospects) {
      if (prospect.hubspotDealId) {
        byDealId.set(prospect.hubspotDealId, prospect.id);
      }
    }

    return byDealId;
  }, [prospects]);

  const loadDigest = useCallback(
    (selectedPeriod: ManagerDigestPeriod, forceRefresh = false, signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);

      fetchManagerDigest(selectedPeriod, { forceRefresh, signal })
        .then((result) => {
          setDigest(result);
          setIsLoading(false);
        })
        .catch((fetchError: unknown) => {
          if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
            return;
          }

          setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger le digest.");
          setIsLoading(false);
        });
    },
    [],
  );

  useEffect(() => {
    const abortController = new AbortController();

    loadDigest(period, false, abortController.signal);

    return () => abortController.abort();
  }, [loadDigest, period]);

  const openDeal = (dealId: string | null): void => {
    if (!dealId) {
      return;
    }

    const prospectId = prospectIdByDealId.get(dealId);

    if (prospectId) {
      onOpenDealAnalysis(prospectId);
    }
  };

  const renderDealButton = (dealId: string | null, dealName: string) => {
    const prospectId = dealId ? prospectIdByDealId.get(dealId) : undefined;

    if (!prospectId) {
      return <strong>{dealName}</strong>;
    }

    return (
      <button className="ae-forecast-link" onClick={() => openDeal(dealId)} type="button">
        <strong>{dealName}</strong>
      </button>
    );
  };

  return (
    <section className="ae-view-panel ae-digest-page" aria-label="Digest manager">
      <div className="ae-forecast-header">
        <span className="ae-forecast-last-update">
          {digest
            ? `Digest du ${formatDate(digest.dateFrom)}${digest.dateFrom === digest.dateTo ? "" : ` au ${formatDate(digest.dateTo)}`} - genere le ${formatDateTime(digest.generatedAt)}`
            : "Digest manager"}
        </span>
        <div className="ae-forecast-header-meta">
          <span className="ae-forecast-period-toggle">
            {PERIOD_OPTIONS.map((option) => (
              <button
                className={period === option.id ? "active" : ""}
                key={option.id}
                onClick={() => setPeriod(option.id)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </span>
          <button className="ae-forecast-link" onClick={() => loadDigest(period, true)} type="button">
            Actualiser
          </button>
        </div>
      </div>

      {error ? <p className="ae-admin-feedback error">{error}</p> : null}

      {isLoading && !digest ? <p className="ae-empty">Generation du digest...</p> : null}

      {digest ? (
        <>
          <article className="ae-forecast-banner">
            <div>
              <h3>{digest.digest.headline}</h3>
              <p>{digest.digest.teamPulse}</p>
              <small>
                {digest.movementCount} mouvement{digest.movementCount > 1 ? "s" : ""} sur la periode - confiance{" "}
                {digest.digest.confidence}
                {digest.stale ? " - base sur la derniere synthese forecast connue (perimee)" : ""}
              </small>
            </div>
          </article>

          <section className="ae-forecast-layout">
            <article className="ae-forecast-panel">
              <div className="ae-panel-heading">
                <h4>Deals a risque</h4>
                <small>Top {digest.digest.atRiskDeals.length} de la periode</small>
              </div>
              <div className="ae-forecast-list">
                {digest.digest.atRiskDeals.length === 0 ? (
                  <p className="ae-empty">Aucun deal a risque identifie.</p>
                ) : (
                  digest.digest.atRiskDeals.map((deal) => (
                    <div className="ae-forecast-list-item" key={deal.dealId}>
                      {renderDealButton(deal.dealId, deal.dealName)}
                      <p>{deal.reason}</p>
                      <small>Action suggeree: {deal.suggestedAction}</small>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="ae-forecast-panel">
              <div className="ae-panel-heading">
                <h4>Coup de main</h4>
                <small>Deals ou intervenir aide le plus</small>
              </div>
              <div className="ae-forecast-list">
                {digest.digest.assistDeals.length === 0 ? (
                  <p className="ae-empty">Aucun deal a pousser identifie.</p>
                ) : (
                  digest.digest.assistDeals.map((deal) => (
                    <div className="ae-forecast-list-item" key={deal.dealId}>
                      {renderDealButton(deal.dealId, deal.dealName)}
                      <p>{deal.whyHelp}</p>
                      <small>Coaching: {deal.coachingHint}</small>
                    </div>
                  ))
                )}
              </div>
            </article>
          </section>

          {digest.digest.highlights.length > 0 ? (
            <article className="ae-forecast-panel">
              <div className="ae-panel-heading">
                <h4>Faits marquants</h4>
              </div>
              <div className="ae-forecast-list">
                {digest.digest.highlights.map((highlight, index) => (
                  <div className="ae-forecast-list-item" key={`${highlight.type}-${index}`}>
                    <strong>{HIGHLIGHT_LABELS[highlight.type] ?? highlight.type}</strong>
                    <p>
                      {highlight.text}
                      {highlight.dealId && prospectIdByDealId.has(highlight.dealId) ? (
                        <>
                          {" "}
                          <button className="ae-forecast-link" onClick={() => openDeal(highlight.dealId)} type="button">
                            Voir le deal
                          </button>
                        </>
                      ) : null}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          <article className="ae-forecast-panel">
            <div className="ae-panel-heading">
              <h4>Mouvements bruts</h4>
              <button className="ae-forecast-link" onClick={() => setMovementsOpen((isOpen) => !isOpen)} type="button">
                {movementsOpen ? "Masquer" : `Afficher (${digest.movements.length})`}
              </button>
            </div>
            {movementsOpen ? (
              digest.movements.length === 0 ? (
                <p className="ae-empty">Aucun mouvement sur la periode.</p>
              ) : (
                <ol className="ae-sync-logs">
                  {digest.movements.map((movement) => (
                    <li key={movement}>{movement}</li>
                  ))}
                </ol>
              )
            ) : null}
          </article>
        </>
      ) : null}
    </section>
  );
};
