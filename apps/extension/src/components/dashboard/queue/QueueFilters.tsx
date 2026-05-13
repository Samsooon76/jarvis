import { closeDatePresets, dealStatusFilters, stageFilters } from "../config";
import type { CloseDatePreset, DashboardFilters, DealStatusFilter, StageFilter } from "../types";

type QueueFiltersProps = {
  filteredCount: number;
  filters: DashboardFilters;
  onCloseDateFromChange: (closeDateFrom: string) => void;
  onCloseDatePresetChange: (closeDatePreset: CloseDatePreset) => void;
  onCloseDateToChange: (closeDateTo: string) => void;
  onSearchTermChange: (searchTerm: string) => void;
  onStageFilterChange: (stageFilter: StageFilter) => void;
  onStatusFilterChange: (statusFilter: DealStatusFilter) => void;
};

export const QueueFilters = ({
  filteredCount,
  filters,
  onCloseDateFromChange,
  onCloseDatePresetChange,
  onCloseDateToChange,
  onSearchTermChange,
  onStageFilterChange,
  onStatusFilterChange,
}: QueueFiltersProps) => (
  <section className="ae-toolbar" aria-label="Business filters">
    <label>
      Statut
      <select onChange={(event) => onStatusFilterChange(event.target.value as DealStatusFilter)} value={filters.statusFilter}>
        {dealStatusFilters.map((filter) => (
          <option key={filter.id} value={filter.id}>
            {filter.label}
          </option>
        ))}
      </select>
    </label>
    <label>
      Stage
      <select onChange={(event) => onStageFilterChange(event.target.value as StageFilter)} value={filters.stageFilter}>
        {stageFilters.map((filter) => (
          <option key={filter.id} value={filter.id}>
            {filter.label}
          </option>
        ))}
      </select>
    </label>
    <label className="ae-search-filter">
      <span>Recherche</span>
      <input
        aria-label="Rechercher un compte ou deal"
        onChange={(event) => onSearchTermChange(event.target.value)}
        placeholder="Compte, contact, stage..."
        type="search"
        value={filters.searchTerm}
      />
    </label>
    <label>
      Fermeture
      <select
        onChange={(event) => onCloseDatePresetChange(event.target.value as CloseDatePreset)}
        value={filters.closeDatePreset}
      >
        {closeDatePresets.map((filter) => (
          <option key={filter.id} value={filter.id}>
            {filter.label}
          </option>
        ))}
      </select>
    </label>
    <label>
      Du
      <input onChange={(event) => onCloseDateFromChange(event.target.value)} type="date" value={filters.closeDateFrom} />
    </label>
    <label>
      Au
      <input onChange={(event) => onCloseDateToChange(event.target.value)} type="date" value={filters.closeDateTo} />
    </label>
    <span>{filteredCount} items</span>
  </section>
);
