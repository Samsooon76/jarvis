import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  backfillProbabilityHistory,
  fetchProbabilityTimeline,
  type DealAgeProbabilityPoint,
  type DealAgeProbabilityTimeline,
  type ForecastScope,
  type HubSpotOwnerOption,
} from "../../services/api";

type ProbabilityTimelinePanelProps = {
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedOwnerId?: string;
  /** Managers/admins peuvent basculer entre l'equipe et un sales precis. */
  canViewTeamForecast?: boolean;
};

type ProbabilityPeriodMode = "all" | "day" | "week" | "last3" | "last6" | "last12" | "month";
type ProbabilityViewMode = "compare" | "won" | "lost";
type ProbabilityAxisGranularity = "day" | "week";

type PeriodBounds = { dateFrom: string | null; dateTo: string | null };

type ProbabilityModeOption = {
  id: ProbabilityViewMode;
  label: string;
  color: string;
  count: number;
  duration: number | null;
  detail: string;
};

type ProbabilityRibbonSeries = {
  id: "won" | "lost";
  label: string;
  color: string;
  points: DealAgeProbabilityPoint[];
};

type ProbabilityPlotPoint = DealAgeProbabilityPoint & {
  x: number;
  y: number;
};

type ProbabilityTooltip = {
  x: number;
  y: number;
  label: string;
  color: string;
  ageDays: number;
  probability: number;
  dealCount: number;
} | null;

const toDateString = (date: Date): string => date.toISOString().slice(0, 10);

const getCurrentMonthValue = (): string => {
  const now = new Date();

  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};

const getCurrentDateValue = (): string => toDateString(new Date());

const getCurrentWeekValue = (): string => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;

  date.setUTCDate(date.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
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

const getWeekBoundsFromValue = (weekValue: string): PeriodBounds => {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekValue);

  if (!match) {
    return { dateFrom: null, dateTo: null };
  }

  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);

  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    dateFrom: toDateString(monday),
    dateTo: toDateString(sunday),
  };
};

const getRollingBounds = (months: number): PeriodBounds => {
  const now = new Date();

  return {
    dateFrom: toDateString(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()))),
    dateTo: toDateString(now),
  };
};

const resolvePeriodBounds = (
  mode: ProbabilityPeriodMode,
  monthValue: string,
  weekValue: string,
  dayValue: string,
): PeriodBounds => {
  if (mode === "day") {
    return { dateFrom: dayValue, dateTo: dayValue };
  }

  if (mode === "week") {
    return getWeekBoundsFromValue(weekValue);
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

const formatDuration = (days: number | null): string => {
  if (days === null) {
    return "--";
  }

  if (days < 14) {
    return `${days} j`;
  }

  return `${days} j (~${Math.round(days / 7)} sem.)`;
};

const getModeOptions = (timeline: DealAgeProbabilityTimeline | null): ProbabilityModeOption[] => [
  {
    id: "compare",
    label: "Comparaison",
    color: "#2ccc76",
    count: (timeline?.wonDealCount ?? 0) + (timeline?.lostDealCount ?? 0),
    duration: null,
    detail: "gagnes vs perdus",
  },
  {
    id: "won",
    label: "Gagnes",
    color: "#1f9d57",
    count: timeline?.wonDealCount ?? 0,
    duration: timeline?.wonAvgDurationDays ?? null,
    detail: "signature",
  },
  {
    id: "lost",
    label: "Perdus",
    color: "#ef5b5b",
    count: timeline?.lostDealCount ?? 0,
    duration: timeline?.lostAvgDurationDays ?? null,
    detail: "perte",
  },
];

const getSeriesForMode = (timeline: DealAgeProbabilityTimeline, mode: ProbabilityViewMode): ProbabilityRibbonSeries[] => {
  const series: ProbabilityRibbonSeries[] = [];

  if (mode === "compare" || mode === "won") {
    series.push({
      id: "won",
      label: "Gagnes",
      color: "#1f9d57",
      points: timeline.won,
    });
  }

  if (mode === "compare" || mode === "lost") {
    series.push({
      id: "lost",
      label: "Perdus",
      color: "#ef5b5b",
      points: timeline.lost,
    });
  }

  return series.filter((item) => item.points.length > 0);
};

const getPointsForGranularity = (
  points: DealAgeProbabilityPoint[],
  granularity: ProbabilityAxisGranularity,
): DealAgeProbabilityPoint[] => {
  if (granularity === "day" || points.length === 0) {
    return points;
  }

  const weeklyPoints = points.filter((point) => point.ageDays % 7 === 0);
  const lastPoint = points[points.length - 1];

  if (weeklyPoints.length === 0 || weeklyPoints[weeklyPoints.length - 1].ageDays !== lastPoint.ageDays) {
    weeklyPoints.push(lastPoint);
  }

  return weeklyPoints;
};

const formatAxisCapMessage = (maxAgeDays: number, granularity: ProbabilityAxisGranularity): string => {
  if (granularity === "week") {
    return `Lecture calee sur ${Math.ceil(maxAgeDays / 7)} semaines, la duree moyenne du cohort.`;
  }

  return `Lecture calee sur ${maxAgeDays} jours, la duree moyenne du cohort.`;
};

const buildAreaPath = (points: ProbabilityPlotPoint[], baselineY: number): string => {
  if (points.length === 0) {
    return "";
  }

  const line = buildLinePath(points);
  const first = points[0];
  const last = points[points.length - 1];

  return `${line} L ${last.x},${baselineY} L ${first.x},${baselineY} Z`;
};

const buildLinePath = (points: ProbabilityPlotPoint[]): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x},${point.y}`).join(" ");

const getYAxisBounds = (series: ProbabilityRibbonSeries[], mode: ProbabilityViewMode): { min: number; max: number } => {
  if (mode === "compare") {
    return { min: 0, max: 100 };
  }

  const values = series.flatMap((item) => item.points.map((point) => point.averageProbability));

  if (values.length === 0) {
    return { min: 0, max: 100 };
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = Math.max(0, Math.floor(rawMin / 10) * 10 - 5);
  const max = Math.min(100, Math.ceil(rawMax / 10) * 10 + 5);

  return max - min < 20 ? { min, max: Math.min(100, min + 20) } : { min, max };
};

const getChartMaxAgeDays = (timeline: DealAgeProbabilityTimeline, mode: ProbabilityViewMode): number => {
  if (mode === "won") {
    return Math.max(1, timeline.wonAvgDurationDays ?? timeline.maxAgeDays);
  }

  if (mode === "lost") {
    return Math.max(1, timeline.lostAvgDurationDays ?? timeline.maxAgeDays);
  }

  return Math.max(1, timeline.wonAvgDurationDays ?? 0, timeline.lostAvgDurationDays ?? 0, timeline.maxAgeDays);
};

const trimPointsToMaxAge = (points: DealAgeProbabilityPoint[], maxAgeDays: number): DealAgeProbabilityPoint[] =>
  points.filter((point) => point.ageDays <= maxAgeDays);

const ProbabilityRibbonChart = ({
  timeline,
  mode,
  granularity,
}: {
  timeline: DealAgeProbabilityTimeline;
  mode: ProbabilityViewMode;
  granularity: ProbabilityAxisGranularity;
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tooltip, setTooltip] = useState<ProbabilityTooltip>(null);
  const width = 1000;
  const height = 250;
  const padding = { left: 42, right: 18, top: 18, bottom: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxAgeDays = getChartMaxAgeDays(timeline, mode);
  const columnCount = 9;
  const series = getSeriesForMode(timeline, mode).map((item) => ({
    ...item,
    points: getPointsForGranularity(trimPointsToMaxAge(item.points, maxAgeDays), granularity),
  }));
  const yAxis = getYAxisBounds(series, mode);
  const yRange = Math.max(1, yAxis.max - yAxis.min);
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const x = padding.left + (index * plotWidth) / columnCount;
    const nextX = padding.left + ((index + 1) * plotWidth) / columnCount;

    return { x, width: nextX - x };
  });
  const maxAgeWeeks = Math.ceil(maxAgeDays / 7);
  const tickCount = granularity === "week" ? Math.min(10, Math.max(2, maxAgeWeeks + 1)) : 10;
  const xTicks = Array.from({ length: tickCount }, (_, index) => {
    const ageDays =
      granularity === "week"
        ? Math.min(maxAgeDays, Math.round((index * maxAgeWeeks) / Math.max(1, tickCount - 1)) * 7)
        : Math.round((index * maxAgeDays) / Math.max(1, tickCount - 1));
    const x = padding.left + (ageDays / maxAgeDays) * plotWidth;

    return { ageDays, x };
  });
  const yTicks = [yAxis.max, Math.round((yAxis.max + yAxis.min) / 2), yAxis.min].map((value) => ({
    value,
    y: padding.top + ((yAxis.max - value) / yRange) * plotHeight,
  }));
  const plottedSeries = series.map((item) => {
    const points = item.points.map((point) => ({
      ...point,
      x: padding.left + (Math.min(point.ageDays, maxAgeDays) / maxAgeDays) * plotWidth,
      y: padding.top + ((yAxis.max - point.averageProbability) / yRange) * plotHeight,
    }));

    return {
      ...item,
      points,
    };
  });
  const baselineY = padding.top + plotHeight;
  const interactivePoints = plottedSeries.flatMap((item) =>
    item.points.map((point) => ({
      ...point,
      label: item.label,
      color: item.color,
    })),
  );

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    const rect = svgRef.current?.getBoundingClientRect();

    if (!rect || interactivePoints.length === 0) {
      return;
    }

    const svgX = ((event.clientX - rect.left) / rect.width) * width;
    const closest = interactivePoints.reduce((best, point) =>
      Math.abs(point.x - svgX) < Math.abs(best.x - svgX) ? point : best,
    );

    setTooltip({
      x: Math.max(72, Math.min(width - 86, closest.x)),
      y: Math.max(34, Math.min(height - 70, closest.y)),
      label: closest.label,
      color: closest.color,
      ageDays: closest.ageDays,
      probability: closest.averageProbability,
      dealCount: closest.dealCount,
    });
  };

  return (
    <div className="ae-probability-ribbon" role="img" aria-label="Evolution de la probabilite realisee par duree d'ouverture">
      <svg
        onPointerLeave={() => setTooltip(null)}
        onPointerMove={handlePointerMove}
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          {plottedSeries.map((item) => (
            <linearGradient gradientUnits="userSpaceOnUse" id={`probability-gradient-${item.id}`} key={item.id} x1="0" x2="0" y1={padding.top} y2={baselineY}>
              <stop offset="0%" stopColor={item.color} stopOpacity={mode === "compare" ? "0.24" : "0.32"} />
              <stop offset="72%" stopColor={item.color} stopOpacity={mode === "compare" ? "0.09" : "0.13"} />
              <stop offset="100%" stopColor={item.color} stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>
        {columns.map((column, index) => (
          <rect
            className={`ae-probability-column-bg ${index % 2 === 1 ? "muted" : ""}`}
            height={height - padding.bottom + 3}
            key={index}
            width={column.width}
            x={column.x}
            y="0"
          />
        ))}
        {yTicks.map((tick) => (
          <g key={tick.value}>
            <line className="ae-probability-guide" x1={padding.left} x2={width - padding.right} y1={tick.y} y2={tick.y} />
            <text className="ae-probability-y-label" x="0" y={tick.y + 4}>
              {tick.value}%
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={tick.ageDays}>
            <line className="ae-probability-divider" x1={tick.x} x2={tick.x} y1="0" y2={height - padding.bottom + 3} />
            <text className="ae-probability-x-label" textAnchor="middle" x={tick.x} y={height - 8}>
              {granularity === "week" ? `S+${Math.round(tick.ageDays / 7)}` : `J+${tick.ageDays}`}
            </text>
          </g>
        ))}
        {plottedSeries.map((item) => (
          <g className={`ae-probability-series ${item.id}`} key={item.id}>
            <path className="ae-probability-area-fill" d={buildAreaPath(item.points, baselineY)} style={{ fill: `url(#probability-gradient-${item.id})` }} />
            <path className="ae-probability-ribbon-line" d={buildLinePath(item.points)} style={{ stroke: item.color }} />
            {item.points.map((point) => (
              <circle className="ae-probability-hover-point" cx={point.x} cy={point.y} key={`${item.id}-${point.ageDays}`} r="8" />
            ))}
          </g>
        ))}
        {tooltip ? (
          <g className="ae-probability-live-tooltip" style={{ "--tooltip-color": tooltip.color } as CSSProperties}>
            <line x1={tooltip.x} x2={tooltip.x} y1={padding.top} y2={baselineY} />
            <circle cx={tooltip.x} cy={tooltip.y} r="4" />
            <rect height="48" rx="8" width="128" x={tooltip.x - 64} y={Math.max(8, tooltip.y - 62)} />
            <text x={tooltip.x - 52} y={Math.max(27, tooltip.y - 41)}>
              {tooltip.label} - {granularity === "week" ? `S+${Math.round(tooltip.ageDays / 7)}` : `J+${tooltip.ageDays}`}
            </text>
            <text className="value" x={tooltip.x - 52} y={Math.max(45, tooltip.y - 23)}>
              {tooltip.probability}% · {tooltip.dealCount} deal(s)
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
};

export const ProbabilityTimelinePanel = ({
  orgId,
  owners,
  selectedOwnerId,
  canViewTeamForecast = false,
}: ProbabilityTimelinePanelProps) => {
  const [ownerId, setOwnerId] = useState(selectedOwnerId ?? "");
  const [periodMode, setPeriodMode] = useState<ProbabilityPeriodMode>("all");
  const [viewMode, setViewMode] = useState<ProbabilityViewMode>("compare");
  const [axisGranularity, setAxisGranularity] = useState<ProbabilityAxisGranularity>("week");
  const [dayValue, setDayValue] = useState<string>(getCurrentDateValue());
  const [weekValue, setWeekValue] = useState<string>(getCurrentWeekValue());
  const [monthValue, setMonthValue] = useState<string>(getCurrentMonthValue());
  const [timeline, setTimeline] = useState<DealAgeProbabilityTimeline | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const scope: ForecastScope = ownerId ? "owner" : "all";
  const resolvedOwnerId = ownerId || null;
  const { dateFrom, dateTo } = useMemo(
    () => resolvePeriodBounds(periodMode, monthValue, weekValue, dayValue),
    [dayValue, monthValue, periodMode, weekValue],
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
        const result = await fetchProbabilityTimeline({
          orgId,
          scope,
          hubspotOwnerId: resolvedOwnerId,
          dateFrom,
          dateTo,
        });

        if (isMounted) {
          setTimeline(result);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Erreur inconnue pendant le chargement de la timeline.");
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
      const result = await backfillProbabilityHistory(orgId);
      setMessage(
        `Historique importe depuis HubSpot : ${result.pointsInserted} point(s) sur ${result.dealsProcessed} deal(s).`,
      );
      const refreshed = await fetchProbabilityTimeline({
        orgId,
        scope,
        hubspotOwnerId: resolvedOwnerId,
        dateFrom,
        dateTo,
      });
      setTimeline(refreshed);
    } catch (backfillError) {
      setError(backfillError instanceof Error ? backfillError.message : "Erreur inconnue pendant l'import HubSpot.");
    } finally {
      setIsBackfilling(false);
    }
  };

  const hasData = useMemo(
    () => (timeline?.won.length ?? 0) > 0 || (timeline?.lost.length ?? 0) > 0,
    [timeline],
  );
  const modeOptions = useMemo(() => getModeOptions(timeline), [timeline]);
  const visibleDealCount =
    viewMode === "won"
      ? timeline?.wonDealCount ?? 0
      : viewMode === "lost"
        ? timeline?.lostDealCount ?? 0
        : (timeline?.wonDealCount ?? 0) + (timeline?.lostDealCount ?? 0);

  return (
    <article className="ae-dashboard-panel ae-probability-panel">
      <div className="ae-panel-heading">
        <span>Probabilite realisee selon la duree d'ouverture</span>
        <strong>{timeline ? `${visibleDealCount} deal(s)` : "--"}</strong>
      </div>

      <div className="ae-probability-toolbar">
        <span>Vue</span>
        <div className="ae-probability-toolbar-actions">
          <div className="ae-probability-toggle" role="tablist" aria-label="Granularite de l'axe temporel">
            <button
              aria-selected={axisGranularity === "day"}
              className={axisGranularity === "day" ? "active" : ""}
              onClick={() => setAxisGranularity("day")}
              role="tab"
              type="button"
            >
              Jour
            </button>
            <button
              aria-selected={axisGranularity === "week"}
              className={axisGranularity === "week" ? "active" : ""}
              onClick={() => setAxisGranularity("week")}
              role="tab"
              type="button"
            >
              Semaine
            </button>
          </div>
          <div className="ae-probability-toggle" role="tablist" aria-label="Mode de lecture won/lost">
            {modeOptions.map((option) => (
              <button
                aria-selected={viewMode === option.id}
                className={viewMode === option.id ? "active" : ""}
                key={option.id}
                onClick={() => setViewMode(option.id)}
                role="tab"
                type="button"
              >
                <i aria-hidden="true" style={{ background: option.color }} />
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ae-probability-summary-grid" style={{ gridTemplateColumns: `repeat(${modeOptions.length}, minmax(0, 1fr))` }}>
        {modeOptions.map((option) => (
          <article className={viewMode === option.id ? "active" : ""} key={option.id}>
            <span>{option.label}</span>
            <strong>{option.id === "compare" ? option.count : formatDuration(option.duration)}</strong>
            <small>{option.id === "compare" ? `${option.count} deal(s) clotures` : `${option.count} deal(s) - ${option.detail}`}</small>
          </article>
        ))}
      </div>

      <div className="ae-forecast-filters">
        <label>
          Clotures sur
          <select onChange={(event) => setPeriodMode(event.target.value as ProbabilityPeriodMode)} value={periodMode}>
            <option value="all">Tout l'historique</option>
            <option value="day">Jour precis</option>
            <option value="week">Semaine precise</option>
            <option value="last3">3 derniers mois</option>
            <option value="last6">6 derniers mois</option>
            <option value="last12">12 derniers mois</option>
            <option value="month">Mois precis</option>
          </select>
        </label>
        {periodMode === "day" ? (
          <label>
            Jour
            <input onChange={(event) => setDayValue(event.target.value)} type="date" value={dayValue} />
          </label>
        ) : null}
        {periodMode === "week" ? (
          <label>
            Semaine
            <input onChange={(event) => setWeekValue(event.target.value)} type="week" value={weekValue} />
          </label>
        ) : null}
        {periodMode === "month" ? (
          <label>
            Mois
            <input onChange={(event) => setMonthValue(event.target.value)} type="month" value={monthValue} />
          </label>
        ) : null}
        {canViewTeamForecast ? (
          <label>
            Perimetre
            <select disabled={owners.length === 0} onChange={(event) => setOwnerId(event.target.value)} value={ownerId}>
              <option value="">Equipe (tous les sales)</option>
              {owners.map((owner) => (
                <option key={owner.ownerId} value={owner.ownerId}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button disabled={isBackfilling} onClick={() => void handleBackfill()} type="button">
          {isBackfilling ? "Import HubSpot..." : "Importer l'historique HubSpot"}
        </button>
      </div>

      {error ? <p className="ae-admin-feedback error">{error}</p> : null}
      {message ? <p className="ae-admin-feedback">{message}</p> : null}

      {hasData && timeline ? (
        <>
          <ProbabilityRibbonChart granularity={axisGranularity} mode={viewMode} timeline={timeline} />
          {timeline.capped ? (
            <p className="ae-empty">{formatAxisCapMessage(getChartMaxAgeDays(timeline, viewMode), axisGranularity)}</p>
          ) : null}
        </>
      ) : (
        <p className="ae-empty">
          {isLoading
            ? "Chargement de la timeline..."
            : "Aucun deal cloture avec historique de probabilite. Lance « Importer l'historique HubSpot »."}
        </p>
      )}
    </article>
  );
};
