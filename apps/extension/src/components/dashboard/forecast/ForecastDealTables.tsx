import type { ForecastDeal } from "../../../services/api";
import { formatAmount, formatDate, formatDateTime } from "../../../utils/dashboard/formatters";
import {
  formatDelta,
  getDelta,
  getDeltaClassName,
  getProbabilityLabel,
  getSignedBucketLabel,
} from "../../../utils/dashboard/forecast";

type SignedDealsTableProps = {
  getOwnerDisplayName: (deal: ForecastDeal) => string;
  isLoading: boolean;
  signedDeals: ForecastDeal[];
};

export const SignedDealsTable = ({ getOwnerDisplayName, isLoading, signedDeals }: SignedDealsTableProps) => (
  <article className="ae-forecast-panel">
    <div className="ae-panel-heading">
      <span>Deals signes</span>
      <strong>{signedDeals.length} deal(s)</strong>
    </div>
    <div className="ae-forecast-deal-table signed" role="table">
      <div className="header" role="row">
        <span>Deal</span>
        <span>Compte</span>
        <span>Statut</span>
        <span>Proprietaire</span>
        <span>Montant</span>
        <span>Close prevue</span>
        <span>Sync CRM</span>
      </div>
      {signedDeals.length > 0 ? (
        signedDeals.map((deal) => (
          <div key={deal.hubspotDealId} role="row">
            <span>{deal.dealName ?? deal.hubspotDealId}</span>
            <span>{deal.companyName}</span>
            <span>{getSignedBucketLabel(deal)}</span>
            <span>{getOwnerDisplayName(deal)}</span>
            <span>{formatAmount(deal.amount)}</span>
            <span>{deal.closeDate ? formatDate(deal.closeDate) : "Sans date"}</span>
            <span>{formatDateTime(deal.syncedAt)}</span>
          </div>
        ))
      ) : (
        <p className="ae-empty">{isLoading ? "Chargement Supabase..." : "Aucun deal signe sur cette periode."}</p>
      )}
    </div>
  </article>
);

type OpenDealsTableProps = {
  analyzingDealId: string | null;
  getOwnerDisplayName: (deal: ForecastDeal) => string;
  isAnalyzing: boolean;
  isLoading: boolean;
  onAnalyzeDeal: (deal: ForecastDeal) => void;
  openDeals: ForecastDeal[];
};

export const OpenDealsTable = ({
  analyzingDealId,
  getOwnerDisplayName,
  isAnalyzing,
  isLoading,
  onAnalyzeDeal,
  openDeals,
}: OpenDealsTableProps) => (
  <article className="ae-forecast-panel">
    <div className="ae-panel-heading">
      <span>Deals ouverts a closer</span>
      <strong>{openDeals.length} deal(s)</strong>
    </div>
    <div className="ae-forecast-deal-table open" role="table">
      <div className="header" role="row">
        <span>Deal</span>
        <span>Compte</span>
        <span>Etape</span>
        <span>Proprietaire</span>
        <span>Montant</span>
        <span>% CRM</span>
        <span>% IA</span>
        <span>Pondere</span>
        <span>Close prevue</span>
        <span>Action</span>
      </div>
      {openDeals.length > 0 ? (
        openDeals.map((deal) => (
          <div key={deal.hubspotDealId} role="row">
            <span>{deal.dealName ?? deal.hubspotDealId}</span>
            <span>{deal.companyName}</span>
            <span>{deal.stage}</span>
            <span>{getOwnerDisplayName(deal)}</span>
            <span>{formatAmount(deal.amount)}</span>
            <span>{deal.crmProbability}%</span>
            <span>{getProbabilityLabel(deal)}</span>
            <span>{formatAmount(deal.forecastAmount)}</span>
            <span>{deal.closeDate ? formatDate(deal.closeDate) : "Sans date"}</span>
            <span>
              <button
                className="ae-forecast-row-action"
                disabled={isAnalyzing || analyzingDealId !== null}
                onClick={() => onAnalyzeDeal(deal)}
                type="button"
              >
                {analyzingDealId === deal.hubspotDealId ? "Analyse..." : deal.aiProbability === null ? "Analyser" : "Recalculer"}
              </button>
            </span>
          </div>
        ))
      ) : (
        <p className="ae-empty">{isLoading ? "Chargement Supabase..." : "Aucun deal ouvert a closer sur cette periode."}</p>
      )}
    </div>
  </article>
);

type VsDealsTableProps = {
  analyzingDealId: string | null;
  getOwnerDisplayName: (deal: ForecastDeal) => string;
  isAnalyzing: boolean;
  isLoading: boolean;
  onAnalyzeDeal: (deal: ForecastDeal) => void;
  openDeals: ForecastDeal[];
};

export const VsDealsTable = ({
  analyzingDealId,
  getOwnerDisplayName,
  isAnalyzing,
  isLoading,
  onAnalyzeDeal,
  openDeals,
}: VsDealsTableProps) => (
  <article className="ae-forecast-panel">
    <div className="ae-panel-heading">
      <span>Table VS</span>
      <strong>{openDeals.length} deal(s) ouvert(s)</strong>
    </div>
    <div className="ae-forecast-deal-table vs" role="table">
      <div className="header" role="row">
        <span>Deal</span>
        <span>Compte</span>
        <span>Proprietaire</span>
        <span>Montant</span>
        <span>% CRM</span>
        <span>% IA</span>
        <span>Delta</span>
        <span>Pondere IA</span>
        <span>Close prevue</span>
        <span>Factuel</span>
        <span>Action</span>
      </div>
      {openDeals.length > 0 ? (
        openDeals.map((deal) => {
          const delta = getDelta(deal);
          const signals = [...deal.positiveSignals, ...deal.risks].slice(0, 2);

          return (
            <div key={deal.hubspotDealId} role="row">
              <span>{deal.dealName ?? deal.hubspotDealId}</span>
              <span>{deal.companyName}</span>
              <span>{getOwnerDisplayName(deal)}</span>
              <span>{formatAmount(deal.amount)}</span>
              <span>{deal.crmProbability}%</span>
              <span>{getProbabilityLabel(deal)}</span>
              <span className={`ae-forecast-delta ${getDeltaClassName(delta)}`}>{formatDelta(delta)}</span>
              <span>{formatAmount(deal.forecastAmount)}</span>
              <span>{deal.closeDate ? formatDate(deal.closeDate) : "Sans date"}</span>
              <span>{signals.length > 0 ? signals.join(" / ") : deal.summary ?? "Analyse IA factuelle a lancer"}</span>
              <span>
                <button
                  className="ae-forecast-row-action"
                  disabled={isAnalyzing || analyzingDealId !== null}
                  onClick={() => onAnalyzeDeal(deal)}
                  type="button"
                >
                  {analyzingDealId === deal.hubspotDealId ? "Analyse..." : deal.aiProbability === null ? "Analyser" : "Recalculer"}
                </button>
              </span>
            </div>
          );
        })
      ) : (
        <p className="ae-empty">{isLoading ? "Chargement Supabase..." : "Aucun deal ouvert forecastable sur cette periode."}</p>
      )}
    </div>
  </article>
);
