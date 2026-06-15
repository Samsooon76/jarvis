import { ChevronRight, History, RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import type { ForecastDeal } from "../../../services/api";
import { formatAmount, formatDate, formatDateTime } from "../../../utils/dashboard/formatters";
import {
  formatDelta,
  getDelta,
  getDeltaClassName,
  getProbabilityLabel,
  getSignedBucketLabel,
} from "../../../utils/dashboard/forecast";

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

type SignedDealsTableProps = {
  getOwnerDisplayName: (deal: ForecastDeal) => string;
  isLoading: boolean;
  signedDeals: ForecastDeal[];
};

export const SignedDealsTable = ({ getOwnerDisplayName, isLoading, signedDeals }: SignedDealsTableProps) => (
  <section aria-label="Deals signés" className="jv-list-shell">
    <header className="jv-list-head">
      <SectionLabel icon={History}>Deals signés</SectionLabel>
      <span className="jv-list-count">
        {signedDeals.length} résultat{signedDeals.length > 1 ? "s" : ""}
      </span>
    </header>
    <div className="jv-list-body">
      {isLoading && signedDeals.length === 0 ? <p className="jv-list-empty">Chargement Supabase…</p> : null}
      {!isLoading && signedDeals.length === 0 ? (
        <p className="jv-list-empty">Aucun deal signé sur cette période.</p>
      ) : null}
      {signedDeals.map((deal) => (
        <div className="jv-list-item static" key={deal.hubspotDealId}>
          <span className="jv-list-main">
            <strong>{deal.dealName ?? deal.hubspotDealId}</strong>
            <small>
              {deal.companyName} · {getOwnerDisplayName(deal)}
            </small>
            <span className="jv-item-meta">
              <span>{getSignedBucketLabel(deal)}</span>
              <span>{deal.closeDate ? formatDate(deal.closeDate) : "Sans date"}</span>
            </span>
          </span>
          <span className="jv-list-side">
            <time>{formatDateTime(deal.syncedAt)}</time>
            <em>{formatAmount(deal.amount)}</em>
          </span>
        </div>
      ))}
    </div>
  </section>
);

type OpenDealsTableProps = {
  activeDealId: string | null;
  getOwnerDisplayName: (deal: ForecastDeal) => string;
  isLoading: boolean;
  onDealSelect: (dealId: string) => void;
  openDeals: ForecastDeal[];
};

export const OpenDealsTable = ({
  activeDealId,
  getOwnerDisplayName,
  isLoading,
  onDealSelect,
  openDeals,
}: OpenDealsTableProps) => (
  <section aria-label="Deals ouverts à closer" className="jv-list-shell">
    <header className="jv-list-head">
      <SectionLabel icon={History}>Deals ouverts à closer</SectionLabel>
      <span className="jv-list-count">
        {openDeals.length} résultat{openDeals.length > 1 ? "s" : ""}
      </span>
    </header>
    <div className="jv-list-body">
      {isLoading && openDeals.length === 0 ? <p className="jv-list-empty">Chargement Supabase…</p> : null}
      {!isLoading && openDeals.length === 0 ? (
        <p className="jv-list-empty">Aucun deal ouvert à closer sur cette période.</p>
      ) : null}
      {openDeals.map((deal) => (
        <button
          className={activeDealId === deal.hubspotDealId ? "jv-list-item selected" : "jv-list-item"}
          key={deal.hubspotDealId}
          onClick={() => onDealSelect(deal.hubspotDealId)}
          type="button"
        >
          <span className="jv-list-main">
            <strong>{deal.dealName ?? deal.hubspotDealId}</strong>
            <small>
              {deal.companyName} · {getOwnerDisplayName(deal)}
            </small>
            <span className="jv-item-meta">
              <span>{deal.stage}</span>
              <span className={deal.aiProbability === null ? "jv-meta-pending" : "jv-meta-ok"}>
                {getProbabilityLabel(deal)}
              </span>
              <span>{deal.crmProbability}% CRM</span>
            </span>
          </span>
          <span className="jv-list-side">
            <time>{deal.closeDate ? formatDate(deal.closeDate) : "Sans date"}</time>
            <em>{formatAmount(deal.forecastAmount)}</em>
            <ChevronRight aria-hidden="true" size={14} strokeWidth={1.5} />
          </span>
        </button>
      ))}
    </div>
  </section>
);

type VsDealsTableProps = {
  activeDealId: string | null;
  getOwnerDisplayName: (deal: ForecastDeal) => string;
  isLoading: boolean;
  onDealSelect: (dealId: string) => void;
  openDeals: ForecastDeal[];
};

export const VsDealsTable = ({
  activeDealId,
  getOwnerDisplayName,
  isLoading,
  onDealSelect,
  openDeals,
}: VsDealsTableProps) => (
  <section aria-label="Comparaison CRM vs IA" className="jv-list-shell">
    <header className="jv-list-head">
      <SectionLabel icon={History}>CRM vs IA</SectionLabel>
      <span className="jv-list-count">
        {openDeals.length} résultat{openDeals.length > 1 ? "s" : ""}
      </span>
    </header>
    <div className="jv-list-body">
      {isLoading && openDeals.length === 0 ? <p className="jv-list-empty">Chargement Supabase…</p> : null}
      {!isLoading && openDeals.length === 0 ? (
        <p className="jv-list-empty">Aucun deal ouvert forecastable sur cette période.</p>
      ) : null}
      {openDeals.map((deal) => {
        const delta = getDelta(deal);

        return (
          <button
            className={activeDealId === deal.hubspotDealId ? "jv-list-item selected" : "jv-list-item"}
            key={deal.hubspotDealId}
            onClick={() => onDealSelect(deal.hubspotDealId)}
            type="button"
          >
            <span className="jv-list-main">
              <strong>{deal.dealName ?? deal.hubspotDealId}</strong>
              <small>
                {deal.companyName} · {getOwnerDisplayName(deal)}
              </small>
              <span className="jv-item-meta">
                <span>{deal.crmProbability}% CRM</span>
                <span className={deal.aiProbability === null ? "jv-meta-pending" : "jv-meta-ok"}>
                  {getProbabilityLabel(deal)}
                </span>
                <span className={`jv-delta ${getDeltaClassName(delta)}`}>{formatDelta(delta)}</span>
              </span>
            </span>
            <span className="jv-list-side">
              <time>{deal.closeDate ? formatDate(deal.closeDate) : "Sans date"}</time>
              <em>{formatAmount(deal.forecastAmount)}</em>
              <ChevronRight aria-hidden="true" size={14} strokeWidth={1.5} />
            </span>
          </button>
        );
      })}
    </div>
  </section>
);

export type ForecastDealDetailProps = {
  analyzingDealId: string | null;
  deal: ForecastDeal | null;
  getOwnerDisplayName: (deal: ForecastDeal) => string;
  isAnalyzing: boolean;
  mode: "overview" | "vs";
  onAnalyzeDeal: (deal: ForecastDeal) => void;
};

export const ForecastDealDetail = ({
  analyzingDealId,
  deal,
  getOwnerDisplayName,
  isAnalyzing,
  mode,
  onAnalyzeDeal,
}: ForecastDealDetailProps) => {
  if (!deal) {
    return (
      <aside className="jv-detail">
        <div className="jv-detail-empty">
          <History aria-hidden="true" size={20} strokeWidth={1.25} />
          <strong>Sélectionnez un deal</strong>
          <p>Consultez la probabilité IA, les signaux et le montant pondéré pour piloter votre forecast.</p>
        </div>
      </aside>
    );
  }

  const delta = getDelta(deal);
  const signals = [...deal.positiveSignals, ...deal.risks].slice(0, 4);

  return (
    <aside className="jv-detail">
      <header className="jv-detail-head">
        <div>
          <h2>{deal.dealName ?? deal.hubspotDealId}</h2>
          <p>
            {[deal.companyName, getOwnerDisplayName(deal), deal.stage, deal.closeDate ? formatDate(deal.closeDate) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <button
          className="jv-btn-ghost"
          disabled={isAnalyzing || analyzingDealId !== null}
          onClick={() => onAnalyzeDeal(deal)}
          type="button"
        >
          {analyzingDealId === deal.hubspotDealId ? (
            <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
          ) : (
            <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
          )}
          {analyzingDealId === deal.hubspotDealId ? "Analyse…" : deal.aiProbability === null ? "Analyser" : "Recalculer"}
        </button>
      </header>

      <dl className="jv-detail-facts">
        <div>
          <dt>Montant</dt>
          <dd>{formatAmount(deal.amount)}</dd>
        </div>
        <div>
          <dt>Pondéré IA</dt>
          <dd>{formatAmount(deal.forecastAmount)}</dd>
        </div>
        <div>
          <dt>% CRM</dt>
          <dd>{deal.crmProbability}%</dd>
        </div>
        <div>
          <dt>% IA</dt>
          <dd className={deal.aiProbability === null ? "jv-meta-pending" : "jv-meta-ok"}>{getProbabilityLabel(deal)}</dd>
        </div>
        {mode === "vs" ? (
          <div>
            <dt>Delta CRM / IA</dt>
            <dd className={`jv-delta ${getDeltaClassName(delta)}`}>{formatDelta(delta)}</dd>
          </div>
        ) : null}
      </dl>

      {deal.summary ? (
        <section className="jv-detail-section">
          <span className="jv-section-label">Résumé IA</span>
          <p className="jv-prose">{deal.summary}</p>
        </section>
      ) : (
        <div className="jv-callout">
          <Sparkles aria-hidden="true" size={16} strokeWidth={1.5} />
          <div>
            <p>Ce deal n&apos;a pas encore été analysé par l&apos;IA.</p>
            <small>Lancez l&apos;analyse pour obtenir probabilité, signaux et prochaine action.</small>
          </div>
        </div>
      )}

      {deal.suggestedMove ? (
        <section className="jv-detail-section">
          <span className="jv-section-label">Prochaine action</span>
          <p className="jv-prose">{deal.suggestedMove}</p>
        </section>
      ) : null}

      {signals.length > 0 ? (
        <section className="jv-detail-section">
          <span className="jv-section-label">Signaux factuels</span>
          <ul className="jv-bullet-list">
            {signals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
};