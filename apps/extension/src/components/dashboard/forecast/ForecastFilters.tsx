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

const periodOptions: Array<{ id: ForecastPeriodMode; label: string }> = [
  { id: "currentMonth", label: "Ce mois" },
  { id: "nextMonth", label: "Mois prochain" },
  { id: "custom", label: "Personnalisé" },
];

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
  <div className="jv-toolbar-filters">
    <div aria-label="Période forecast" className="jv-filter-pills" role="group">
      {periodOptions.map((option) => (
        <button
          className={periodMode === option.id ? "active" : ""}
          key={option.id}
          onClick={() => onPeriodChange(option.id)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
    <div className="jv-date-range">
      <input
        aria-label="Date de début"
        className="jv-date-input"
        onChange={(event) => onDateFromChange(event.target.value)}
        type="date"
        value={dateFrom}
      />
      <span aria-hidden="true">→</span>
      <input
        aria-label="Date de fin"
        className="jv-date-input"
        onChange={(event) => onDateToChange(event.target.value)}
        type="date"
        value={dateTo}
      />
    </div>
    {canViewTeamForecast ? (
      <select
        aria-label="Périmètre forecast"
        className="jv-select"
        disabled={owners.length === 0}
        onChange={(event) => onOwnerIdChange(event.target.value)}
        value={ownerId}
      >
        <option value="">Équipe (tous les sales)</option>
        {owners.map((owner) => (
          <option key={owner.ownerId} value={owner.ownerId}>
            {owner.name}
          </option>
        ))}
      </select>
    ) : null}
  </div>
);