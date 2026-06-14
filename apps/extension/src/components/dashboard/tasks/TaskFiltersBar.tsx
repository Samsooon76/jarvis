import { RefreshCw, Search, Sparkles } from "lucide-react";
import type { HubSpotOwnerOption } from "../../../services/api";
import { taskFilterTabs, type TaskDateFilter } from "../../../utils/dashboard/tasks";

type TaskFiltersBarProps = {
  analyzeButtonLabel: string;
  batchIsRunning: boolean;
  dateFilter: TaskDateFilter;
  isLoading: boolean;
  onDateFilterChange: (filter: TaskDateFilter) => void;
  onOwnerChange?: (ownerId: string) => void;
  onProcessOverdueTasks: () => void;
  onRefresh: () => void;
  onSearchTermChange: (value: string) => void;
  ownerById: Map<string, HubSpotOwnerOption>;
  owners: HubSpotOwnerOption[];
  overdueTasksCount: number;
  searchTerm: string;
  selectedOwnerId?: string | null;
  selectedOwnerName: string;
  usingSalesOperatingQueue: boolean;
};

export const TaskFiltersBar = ({
  analyzeButtonLabel,
  batchIsRunning,
  dateFilter,
  isLoading,
  onDateFilterChange,
  onOwnerChange,
  onProcessOverdueTasks,
  onRefresh,
  onSearchTermChange,
  ownerById,
  owners,
  overdueTasksCount,
  searchTerm,
  selectedOwnerId,
  selectedOwnerName,
  usingSalesOperatingQueue,
}: TaskFiltersBarProps) => (
  <div className="jv-toolbar" aria-label="Filtres des tâches">
    <div className="jv-toolbar-filters">
      <label className="jv-task-search">
        <Search aria-hidden="true" size={15} strokeWidth={1.5} />
        <input
          aria-label="Rechercher une tâche"
          onChange={(event) => onSearchTermChange(event.target.value)}
          placeholder="Rechercher une tâche…"
          value={searchTerm}
        />
      </label>
      <div className="jv-filter-pills" role="group" aria-label="Filtrer par période">
        {taskFilterTabs.map((tab) => (
          <button
            className={dateFilter === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => onDateFilterChange(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
    <div className="jv-toolbar-actions">
      <select
        aria-label="Filtrer par commercial"
        className="jv-select"
        onChange={(event) => onOwnerChange?.(event.target.value)}
        value={selectedOwnerId ?? ""}
      >
        <option value="">{owners.length > 0 ? "Tous les reps" : selectedOwnerName}</option>
        {selectedOwnerId && !ownerById.has(selectedOwnerId) ? (
          <option value={selectedOwnerId}>{selectedOwnerName}</option>
        ) : null}
        {owners.map((owner) => (
          <option key={owner.ownerId} value={owner.ownerId}>
            {owner.name}
          </option>
        ))}
      </select>
      <button
        aria-label="Rafraîchir les tâches"
        className="jv-btn-ghost"
        disabled={isLoading || !selectedOwnerId}
        onClick={onRefresh}
        title="Rafraîchir"
        type="button"
      >
        <RefreshCw className={isLoading ? "jv-spin" : undefined} size={14} strokeWidth={1.5} />
        Rafraîchir
      </button>
      {!usingSalesOperatingQueue ? (
        <button
          className="jv-btn-primary"
          disabled={!selectedOwnerId || overdueTasksCount === 0 || batchIsRunning}
          onClick={onProcessOverdueTasks}
          type="button"
        >
          {batchIsRunning ? (
            <RefreshCw className="jv-spin" size={14} strokeWidth={1.5} />
          ) : (
            <Sparkles size={14} strokeWidth={1.5} />
          )}
          <span>{analyzeButtonLabel}</span>
        </button>
      ) : null}
    </div>
  </div>
);