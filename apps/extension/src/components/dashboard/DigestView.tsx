import { useCallback, useEffect, useMemo, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import {
  fetchManagerDigest,
  type ManagerDigest,
  type ManagerDigestPeriod,
} from "../../services/api";
import { LoadingState } from "./LoadingState";

type DigestViewProps = {
  prospects: QueueProspect[];
  onOpenDealAnalysis: (prospectId: string) => void;
};

type DigestMovementViewModel = {
  id: string | null;
  title: string;
  changeCount: string | null;
  detail: string;
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

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "Haute",
  medium: "Moyenne",
  low: "Faible",
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

const formatDigestMovementDetail = (value: string): string => {
  const [, rawDetail = value] = value.split(" : ");
  const readable = rawDetail
    .replace(/\bprobabilite\b/gi, "Probabilite")
    .replace(/\s*->\s*/g, " -> ");

  return readable.charAt(0).toUpperCase() + readable.slice(1);
};

const toDigestMovementViewModel = (movement: string): DigestMovementViewModel => {
  const [idPart, titlePart, changePart, detailPart] = movement.split(" | ");
  const id = idPart?.startsWith("id=") ? idPart.replace("id=", "") : null;

  return {
    id,
    title: titlePart || "Mouvement HubSpot",
    changeCount: changePart || null,
    detail: formatDigestMovementDetail(detailPart || movement),
  };
};

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

  const riskDealCount = digest?.digest.atRiskDeals.length ?? 0;
  const assistDealCount = digest?.digest.assistDeals.length ?? 0;
  const actionDealCount = riskDealCount + assistDealCount;

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

      {isLoading && !digest ? (
        <LoadingState detail="On agrege les mouvements, risques et coups de main." label="Generation du digest" />
      ) : null}

      {digest ? (
        <>
          <article className="ae-digest-hero">
            <div className="ae-digest-hero-label">
              <span>Brief manager</span>
              <strong>{period === "daily" ? "Aujourd'hui" : "7 derniers jours"}</strong>
            </div>
            <div className="ae-digest-hero-copy">
              <h3>{digest.digest.headline}</h3>
              <p>{digest.digest.teamPulse}</p>
              <small>
                Confiance {CONFIDENCE_LABELS[digest.digest.confidence] ?? digest.digest.confidence}
                {digest.stale ? " - base sur la derniere synthese forecast connue" : ""}
              </small>
            </div>
          </article>

          <section className="ae-digest-metrics" aria-label="Synthese digest">
            <div>
              <span>Mouvements CRM</span>
              <strong>{digest.movementCount}</strong>
              <small>sur la periode</small>
            </div>
            <div>
              <span>Deals a risque</span>
              <strong>{riskDealCount}</strong>
              <small>a surveiller</small>
            </div>
            <div>
              <span>Coups de main</span>
              <strong>{assistDealCount}</strong>
              <small>interventions utiles</small>
            </div>
          </section>

          <section className="ae-digest-action-grid">
            <article className="ae-forecast-panel ae-digest-action-panel risk">
              <div className="ae-panel-heading">
                <div>
                  <span className="ae-digest-chip">Risque</span>
                  <h4>Deals a risque</h4>
                </div>
                <small>Top {riskDealCount} de la periode</small>
              </div>
              <div className="ae-digest-card-list">
                {digest.digest.atRiskDeals.length === 0 ? (
                  <p className="ae-empty">Aucun deal a risque identifie.</p>
                ) : (
                  digest.digest.atRiskDeals.map((deal) => (
                    <div className="ae-digest-deal-card" key={deal.dealId}>
                      {renderDealButton(deal.dealId, deal.dealName)}
                      <p>{deal.reason}</p>
                      <small>Action suggeree: {deal.suggestedAction}</small>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="ae-forecast-panel ae-digest-action-panel assist">
              <div className="ae-panel-heading">
                <div>
                  <span className="ae-digest-chip">Aide</span>
                  <h4>Coup de main</h4>
                </div>
                <small>Deals ou intervenir aide le plus</small>
              </div>
              <div className="ae-digest-card-list">
                {digest.digest.assistDeals.length === 0 ? (
                  <p className="ae-empty">Aucun deal a pousser identifie.</p>
                ) : (
                  digest.digest.assistDeals.map((deal) => (
                    <div className="ae-digest-deal-card" key={deal.dealId}>
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
            <article className="ae-forecast-panel ae-digest-highlights">
              <div className="ae-panel-heading">
                <div>
                  <h4>Faits marquants</h4>
                  <small>{digest.digest.highlights.length} signal{digest.digest.highlights.length > 1 ? "s" : ""} a lire</small>
                </div>
              </div>
              <div className="ae-digest-highlight-grid">
                {digest.digest.highlights.map((highlight, index) => (
                  <div className={`ae-digest-highlight ${highlight.type}`} key={`${highlight.type}-${index}`}>
                    <span>{HIGHLIGHT_LABELS[highlight.type] ?? highlight.type}</span>
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

          <article className="ae-forecast-panel ae-digest-movements">
            <div className="ae-panel-heading">
              <div>
                <h4>Mouvements CRM</h4>
                <small>Changements HubSpot detectes sur la periode</small>
              </div>
              <span className="ae-digest-action-count">{actionDealCount} action{actionDealCount > 1 ? "s" : ""}</span>
              <button className="ae-forecast-link" onClick={() => setMovementsOpen((isOpen) => !isOpen)} type="button">
                {movementsOpen ? "Masquer" : `Voir les details (${digest.movements.length})`}
              </button>
            </div>
            {movementsOpen ? (
              digest.movements.length === 0 ? (
                <p className="ae-empty">Aucun mouvement sur la periode.</p>
              ) : (
                <ul className="ae-digest-movement-list">
                  {digest.movements.map((movement) => {
                    const parsedMovement = toDigestMovementViewModel(movement);

                    return (
                      <li className="ae-digest-movement-item" key={movement}>
                        <div>
                          <strong>{parsedMovement.title}</strong>
                          {parsedMovement.changeCount ? <span>{parsedMovement.changeCount}</span> : null}
                        </div>
                        <p>{parsedMovement.detail}</p>
                        {parsedMovement.id ? <small>HubSpot deal #{parsedMovement.id}</small> : null}
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <p className="ae-digest-movement-preview">
                {digest.movements.length === 0
                  ? "Aucun mouvement CRM sur la periode."
                  : `${digest.movements.length} mouvement${digest.movements.length > 1 ? "s" : ""} CRM detecte${
                      digest.movements.length > 1 ? "s" : ""
                    }. Ouvrez les details pour voir les deals concernes.`}
              </p>
            )}
          </article>
        </>
      ) : null}
    </section>
  );
};
