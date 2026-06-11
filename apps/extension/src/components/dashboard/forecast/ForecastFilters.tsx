import type { HubSpotOwnerOption } from "../../../services/api";
import type { ForecastPeriodMode } from "../../../utils/dashboard/forecast";

type ForecastFiltersProps = {
  canViewTeamForecast: boolean;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onOwnerIdChange: (ownerId: string) => void;
  onPeriodChange: (mode: ForecastPeriodMode) => void;
  ownerId: string;
  owners: HubSpotOwnerOption[];
  periodMode: ForecastPeriodMode;
};

export const ForecastFilters = ({
  canViewTeamForecast,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onOwnerIdChange,
  onPeriodChange,
  ownerId,
  owners,
  periodMode,
}: ForecastFiltersProps) => (
  <div className="ae-forecast-filters">
    <label>
      Periode
      <span className="ae-forecast-period-toggle">
        <button className={periodMode === "currentMonth" ? "active" : ""} onClick={() => onPeriodChange("currentMonth")} type="button">
          Ce mois
        </button>
        <button className={periodMode === "nextMonth" ? "active" : ""} onClick={() => onPeriodChange("nextMonth")} type="button">
          Mois prochain
        </button>
        <button className={periodMode === "custom" ? "active" : ""} onClick={() => onPeriodChange("custom")} type="button">
          Personnalise
        </button>
      </span>
    </label>
    <label>
      Dates
      <span>
        <input onChange={(event) => onDateFromChange(event.target.value)} type="date" value={dateFrom} />
        <input onChange={(event) => onDateToChange(event.target.value)} type="date" value={dateTo} />
      </span>
    </label>
    {canViewTeamForecast ? (
      <label>
        Forecast
        <select disabled={owners.length === 0} onChange={(event) => onOwnerIdChange(event.target.value)} value={ownerId}>
          <option value="">Equipe (tous les sales)</option>
          {owners.map((owner) => (
            <option key={owner.ownerId} value={owner.ownerId}>
              {owner.name}
            </option>
          ))}
        </select>
      </label>
    ) : null}
  </div>
);
