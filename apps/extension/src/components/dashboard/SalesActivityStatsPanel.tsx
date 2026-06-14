import { useEffect, useMemo, useState } from "react";
import { Activity, type LucideIcon } from "lucide-react";
import {
  backfillSalesActivities,
  fetchSalesActivityStats,
  type ForecastScope,
  type HubSpotOwnerOption,
  type SalesActivityStats,
  type SalesActivityType,
} from "../../services/api";

type SalesActivityStatsPanelProps = {
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedOwnerId?: string;
  /** Managers/admins peuvent basculer entre l'equipe et un sales precis. */
  canViewTeamForecast?: boolean;
};

type ActivityPeriodMode = "all" | "year" | "last3" | "last6" | "last12" | "month";

type PeriodBounds = { dateFrom: string | null; dateTo: string | null };

const ACTIVITY_YEARS = Array.from({ length: 4 }, (_, index) => String(new Date().getFullYear() - index));

const ACTIVITY_LABELS: Record<SalesActivityType, string> = {
  call: "Appels",
  sms: "SMS",
  meeting: "Reunions",
};

const ACTIVITY_ORDER: SalesActivityType[] = ["call", "sms", "meeting"];

const toDateString = (date: Date): string => date.toISOString().slice(0, 10);

const getCurrentMonthValue = (): string => {
  const now = new Date();

  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};

const getMonthBoundsFromValue = (monthValue: string): PeriodBounds => {
  const [year, month] = monthValue.split("-").map(Number);

  if (!year || !month) {
    return { dateFrom: null, dateTo: null };
  }

  return {
    dateFrom: toDateString(new Date(Date.UTC(year, month - 1, 1))),
    dateTo: toDateString(new Date(Date.UTC(year, month, 0))),
  };
};

const getRollingBounds = (months: number): PeriodBounds => {
  const now = new Date();

  return {
    dateFrom: toDateString(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()))),
    dateTo: toDateString(now),
  };
};

const getYearBounds = (yearValue: string): PeriodBounds => {
  const year = Number(yearValue);

  if (!year) {
    return { dateFrom: null, dateTo: null };
  }

  return {
    dateFrom: toDateString(new Date(Date.UTC(year, 0, 1))),
    dateTo: toDateString(new Date(Date.UTC(year, 11, 31))),
  };
};

const resolvePeriodBounds = (mode: ActivityPeriodMode, monthValue: string, yearValue: string): PeriodBounds => {
  if (mode === "year") {
    return getYearBounds(yearValue);
  }

  if (mode === "month") {
    return getMonthBoundsFromValue(monthValue);
  }

  if (mode === "last3") {
    return getRollingBounds(3);
  }

  if (mode === "last6") {
    return getRollingBounds(6);
  }

  if (mode === "last12") {
    return getRollingBounds(12);
  }

  return { dateFrom: null, dateTo: null };
};

const formatAvg = (value: number): string => value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const ActivityBars = ({ stats }: { stats: SalesActivityStats }) => {
  const maxValue = useMemo(
    () =>
      Math.max(
        1,
        ...ACTIVITY_ORDER.map((type) => Math.max(stats.won.byType[type], stats.lost.byType[type])),
      ),
    [stats],
  );

  return (
    <div className="ae-activity-bars" role="img" aria-label="Activites commerciales par type, deals gagnes vs perdus">
      {ACTIVITY_ORDER.map((type) => (
        <div className="ae-activity-bar-row" key={type}>
          <span className="ae-activity-bar-label">{ACTIVITY_LABELS[type]}</span>
          <div className="ae-activity-bar-track">
            <div className="ae-activity-bar won" style={{ width: `${(stats.won.byType[type] / maxValue) * 100}%` }}>
              <i aria-hidden="true" />
              <strong>{stats.won.byType[type]}</strong>
            </div>
            <div className="ae-activity-bar lost" style={{ width: `${(stats.lost.byType[type] / maxValue) * 100}%` }}>
              <i aria-hidden="true" />
              <strong>{stats.lost.byType[type]}</strong>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export const SalesActivityStatsPanel = ({
  orgId,
  owners,
  selectedOwnerId,
  canViewTeamForecast = false,
}: SalesActivityStatsPanelProps) => {
  const [ownerId, setOwnerId] = useState(selectedOwnerId ?? "");
  const [periodMode, setPeriodMode] = useState<ActivityPeriodMode>("year");
  const [monthValue, setMonthValue] = useState<string>(getCurrentMonthValue());
  const [yearValue, setYearValue] = useState<string>(String(new Date().getFullYear()));
  const [stats, setStats] = useState<SalesActivityStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const scope: ForecastScope = ownerId ? "owner" : "all";
  const resolvedOwnerId = ownerId || null;
  const { dateFrom, dateTo } = useMemo(
    () => resolvePeriodBounds(periodMode, monthValue, yearValue),
    [periodMode, monthValue, yearValue],
  );

  useEffect(() => {
    setOwnerId(selectedOwnerId ?? "");
  }, [selectedOwnerId]);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await fetchSalesActivityStats({
          orgId,
          scope,
          hubspotOwnerId: resolvedOwnerId,
          dateFrom,
          dateTo,
        });

        if (isMounted) {
          setStats(result);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Erreur inconnue pendant le chargement des activites.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [dateFrom, dateTo, orgId, resolvedOwnerId, scope]);

  const handleBackfill = async () => {
    try {
      setIsBackfilling(true);
      setError(null);
      setMessage(null);
      const result = await backfillSalesActivities({ orgId, dateFrom, dateTo });
      setMessage(
        `Activites importees depuis HubSpot : ${result.activitiesUpserted} activite(s) sur ${result.dealsProcessed} deal(s) cloture(s).`,
      );
      const refreshed = await fetchSalesActivityStats({
        orgId,
        scope,
        hubspotOwnerId: resolvedOwnerId,
        dateFrom,
        dateTo,
      });
      setStats(refreshed);
    } catch (backfillError) {
      setError(backfillError instanceof Error ? backfillError.message : "Erreur inconnue pendant l'import HubSpot.");
    } finally {
      setIsBackfilling(false);
    }
  };

  const summaryCards = useMemo(
    () => [
      {
        id: "won" as const,
        label: "Deals gagnes",
        color: "var(--jv-success)",
        outcome: stats?.won ?? null,
      },
      {
        id: "lost" as const,
        label: "Deals perdus",
        color: "var(--jv-danger)",
        outcome: stats?.lost ?? null,
      },
    ],
    [stats],
  );

  const hasData = useMemo(
    () => (stats?.won.dealCount ?? 0) > 0 || (stats?.lost.dealCount ?? 0) > 0,
    [stats],
  );
  const totalActivities = (stats?.won.total ?? 0) + (stats?.lost.total ?? 0);

  return (
    <section className="jv-theme-block" aria-label="Activites commerciales">
      <header className="jv-theme-block-head">
        <SectionLabel icon={Activity}>Activites commerciales sur deals clotures</SectionLabel>
        <span className="jv-theme-block-meta">{stats ? `${totalActivities} activite(s)` : "--"}</span>
      </header>

      <div
        className="jv-stats-summary-grid"
        style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
      >
        {summaryCards.map((card) => (
          <article className={card.id === "won" ? "active" : ""} key={card.id}>
            <span>
              <i aria-hidden="true" style={{ background: card.color }} /> {card.label}
            </span>
            <strong>
              {card.outcome?.total ?? 0} <em>activites</em>
            </strong>
            <small>
              sur {card.outcome?.dealCount ?? 0} deal(s) · {formatAvg(card.outcome?.avgPerDeal ?? 0)} activite/deal
            </small>
          </article>
        ))}
      </div>

      <div className="jv-stats-subtoolbar">
        <label className="jv-stats-field">
          <span>Clotures sur</span>
          <select className="jv-select" onChange={(event) => setPeriodMode(event.target.value as ActivityPeriodMode)} value={periodMode}>
            <option value="year">Annee precise</option>
            <option value="all">Tout l'historique</option>
            <option value="last3">3 derniers mois</option>
            <option value="last6">6 derniers mois</option>
            <option value="last12">12 derniers mois</option>
            <option value="month">Mois precis</option>
          </select>
        </label>
        {periodMode === "year" ? (
          <label className="jv-stats-field">
            <span>Annee</span>
            <select className="jv-select" onChange={(event) => setYearValue(event.target.value)} value={yearValue}>
              {ACTIVITY_YEARS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {periodMode === "month" ? (
          <label className="jv-stats-field">
            <span>Mois</span>
            <input onChange={(event) => setMonthValue(event.target.value)} type="month" value={monthValue} />
          </label>
        ) : null}
        {canViewTeamForecast ? (
          <label className="jv-stats-field">
            <span>Perimetre</span>
            <select className="jv-select" disabled={owners.length === 0} onChange={(event) => setOwnerId(event.target.value)} value={ownerId}>
              <option value="">Equipe (tous les sales)</option>
              {owners.map((owner) => (
                <option key={owner.ownerId} value={owner.ownerId}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button className="jv-btn-primary" disabled={isBackfilling} onClick={() => void handleBackfill()} type="button">
          {isBackfilling ? "Import HubSpot..." : "Importer les activites HubSpot"}
        </button>
      </div>

      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}
      {message ? <p className="jv-banner jv-banner-success">{message}</p> : null}

      {hasData && stats ? (
        <>
          <div className="jv-stats-legend">
            <span>
              <i aria-hidden="true" className="is-won" /> Gagnes
            </span>
            <span>
              <i aria-hidden="true" className="is-lost" /> Perdus
            </span>
          </div>
          <ActivityBars stats={stats} />
        </>
      ) : (
        <p className="jv-theme-empty">
          {isLoading ? "Chargement des activites..." : "Aucune activite commerciale sur les deals clotures de ce perimetre."}
        </p>
      )}
    </section>
  );
};