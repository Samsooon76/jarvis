import { useCallback, useEffect, useMemo, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import {
  AlertTriangle,
  HandHelping,
  History,
  Newspaper,
  RefreshCw,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react";
import {
  fetchManagerDigest,
  type ManagerDigest,
  type ManagerDigestPeriod,
} from "../../services/api";
import { LoadingState } from "./LoadingState";
import "../styles/digest.css";

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

const CONFIDENCE_SCORES: Record<string, number> = {
  high: 85,
  medium: 55,
  low: 25,
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

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

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

  const renderDealTitle = (dealId: string | null, dealName: string) => {
    const prospectId = dealId ? prospectIdByDealId.get(dealId) : undefined;

    if (!prospectId) {
      return <strong>{dealName}</strong>;
    }

    return (
      <button className="jv-deal-link" onClick={() => openDeal(dealId)} type="button">
        <strong>{dealName}</strong>
      </button>
    );
  };

  const riskDealCount = digest?.digest.atRiskDeals.length ?? 0;
  const assistDealCount = digest?.digest.assistDeals.length ?? 0;
  const confidenceScore = CONFIDENCE_SCORES[digest?.digest.confidence ?? "medium"] ?? 55;

  const stats = [
    {
      caption: "sur la periode",
      label: "Mouvements CRM",
      value: String(digest?.movementCount ?? 0),
    },
    {
      caption: "a surveiller",
      label: "Deals a risque",
      value: String(riskDealCount),
    },
    {
      caption: "interventions utiles",
      label: "Coups de main",
      value: String(assistDealCount),
    },
  ] as const;

  const periodCaption = digest
    ? `Digest du ${formatDate(digest.dateFrom)}${digest.dateFrom === digest.dateTo ? "" : ` au ${formatDate(digest.dateTo)}`} · genere le ${formatDateTime(digest.generatedAt)}`
    : null;

  return (
    <div className="jv-digest-page" aria-label="Digest manager">
      <header className="jv-page-header">
        <Newspaper aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>
          Digest
          <span className="jv-page-kicker">manager</span>
        </h1>
      </header>

      <div className="jv-toolbar">
        <div className="jv-toolbar-filters">
          <div className="jv-filter-pills" role="group" aria-label="Periode digest">
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
          </div>
        </div>
        <div className="jv-toolbar-actions">
          {periodCaption ? <span className="jv-toolbar-meta">{periodCaption}</span> : null}
          <button
            className="jv-btn-ghost"
            disabled={isLoading}
            onClick={() => loadDigest(period, true)}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={isLoading ? "jv-spin" : undefined} size={15} strokeWidth={1.5} />
            Actualiser
          </button>
        </div>
      </div>

      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}

      {isLoading && !digest ? (
        <LoadingState detail="On agrege les mouvements, risques et coups de main." label="Generation du digest" />
      ) : null}

      {digest ? (
        <>
          <section className="jv-score-banner" aria-label="Brief manager">
            <div
              className="jv-score-ring"
              style={{ background: `conic-gradient(#d4714a ${confidenceScore * 3.6}deg, #ece9e3 0)` }}
            >
              <span>{confidenceScore}</span>
            </div>
            <div className="jv-score-copy">
              <strong>{digest.digest.headline}</strong>
              <p>{digest.digest.teamPulse}</p>
              <small>
                Confiance {CONFIDENCE_LABELS[digest.digest.confidence] ?? digest.digest.confidence}
                {digest.stale ? " · base sur la derniere synthese forecast connue" : ""}
              </small>
            </div>
            <span className="jv-score-badge">
              <Sparkles size={11} strokeWidth={1.5} />
              IA
            </span>
          </section>

          <section className="jv-stat-strip cols-3" aria-label="Synthese digest">
            {stats.map((stat, index) => (
              <div className="jv-stat" key={stat.label} style={{ animationDelay: `${index * 60}ms` }}>
                <span className="jv-stat-label">{stat.label}</span>
                <span className="jv-stat-value">{stat.value}</span>
                {stat.caption ? <small className="jv-stat-caption">{stat.caption}</small> : null}
              </div>
            ))}
          </section>

          <section className="jv-themes-row" aria-label="Actions manager">
            <div className="jv-theme-block risk">
              <header className="jv-theme-head">
                <SectionLabel icon={AlertTriangle}>Deals a risque</SectionLabel>
                <small>Top {riskDealCount}</small>
              </header>
              <div className="jv-digest-deals">
                {digest.digest.atRiskDeals.length === 0 ? (
                  <p className="jv-theme-empty">Aucun deal a risque identifie.</p>
                ) : (
                  digest.digest.atRiskDeals.map((deal) => (
                    <div className="jv-digest-deal-card" key={deal.dealId}>
                      {renderDealTitle(deal.dealId, deal.dealName)}
                      <p>{deal.reason}</p>
                      <small>Action suggeree : {deal.suggestedAction}</small>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="jv-theme-block assist">
              <header className="jv-theme-head">
                <SectionLabel icon={HandHelping}>Coup de main</SectionLabel>
                <small>Deals ou intervenir aide le plus</small>
              </header>
              <div className="jv-digest-deals">
                {digest.digest.assistDeals.length === 0 ? (
                  <p className="jv-theme-empty">Aucun deal a pousser identifie.</p>
                ) : (
                  digest.digest.assistDeals.map((deal) => (
                    <div className="jv-digest-deal-card" key={deal.dealId}>
                      {renderDealTitle(deal.dealId, deal.dealName)}
                      <p>{deal.whyHelp}</p>
                      <small>Coaching : {deal.coachingHint}</small>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {digest.digest.highlights.length > 0 ? (
            <section className="jv-theme-block" aria-label="Faits marquants">
              <header className="jv-theme-head">
                <SectionLabel icon={Star}>Faits marquants</SectionLabel>
                <small>
                  {digest.digest.highlights.length} signal{digest.digest.highlights.length > 1 ? "s" : ""} a lire
                </small>
              </header>
              <div className="jv-highlight-grid">
                {digest.digest.highlights.map((highlight, index) => (
                  <div className={`jv-highlight-item ${highlight.type}`} key={`${highlight.type}-${index}`}>
                    <span>{HIGHLIGHT_LABELS[highlight.type] ?? highlight.type}</span>
                    <p>
                      {highlight.text}
                      {highlight.dealId && prospectIdByDealId.has(highlight.dealId) ? (
                        <>
                          {" "}
                          <button className="jv-text-link" onClick={() => openDeal(highlight.dealId)} type="button">
                            Voir le deal
                          </button>
                        </>
                      ) : null}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="jv-list-shell" aria-label="Mouvements CRM">
            <header className="jv-list-head">
              <SectionLabel icon={History}>Mouvements CRM</SectionLabel>
              <div className="jv-list-head-actions">
                <span className="jv-list-count">
                  {digest.movements.length} mouvement{digest.movements.length > 1 ? "s" : ""}
                </span>
                <button
                  className="jv-btn-ghost compact"
                  onClick={() => setMovementsOpen((isOpen) => !isOpen)}
                  type="button"
                >
                  {movementsOpen ? "Masquer" : "Voir les details"}
                </button>
              </div>
            </header>
            <div className="jv-list-body">
              {movementsOpen ? (
                digest.movements.length === 0 ? (
                  <p className="jv-list-empty">Aucun mouvement sur la periode.</p>
                ) : (
                  digest.movements.map((movement) => {
                    const parsedMovement = toDigestMovementViewModel(movement);

                    return (
                      <div className="jv-movement-item" key={movement}>
                        <div>
                          <strong>{parsedMovement.title}</strong>
                          {parsedMovement.changeCount ? <span>{parsedMovement.changeCount}</span> : null}
                        </div>
                        <p>{parsedMovement.detail}</p>
                        {parsedMovement.id ? <small>HubSpot deal #{parsedMovement.id}</small> : null}
                      </div>
                    );
                  })
                )
              ) : (
                <p className="jv-movement-preview">
                  {digest.movements.length === 0
                    ? "Aucun mouvement CRM sur la periode."
                    : `${digest.movements.length} mouvement${digest.movements.length > 1 ? "s" : ""} CRM detecte${
                        digest.movements.length > 1 ? "s" : ""
                      }. Ouvrez les details pour voir les deals concernes.`}
                </p>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
};