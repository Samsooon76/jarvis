import { Brain, Search } from "lucide-react";
import type { HubSpotOwnerOption } from "../../../services/api";

type TaskFiltersBarProps = {
  analyzeButtonLabel: string;
  batchIsRunning: boolean;
  onOwnerChange?: (ownerId: string) => void;
  onProcessOverdueTasks: () => void;
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
  onOwnerChange,
  onProcessOverdueTasks,
  onSearchTermChange,
  ownerById,
  owners,
  overdueTasksCount,
  searchTerm,
  selectedOwnerId,
  selectedOwnerName,
  usingSalesOperatingQueue,
}: TaskFiltersBarProps) => (
  <div className="ae-task-filters" aria-label="Filtres des taches">
    <label className="ae-task-search">
      <Search size={15} />
      <input
        aria-label="Rechercher une tache"
        onChange={(event) => onSearchTermChange(event.target.value)}
        placeholder="Rechercher une tache..."
        value={searchTerm}
      />
    </label>
    <select
      aria-label="Filtrer par commercial"
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
    {!usingSalesOperatingQueue ? (
      <button
        className="ae-task-analyze-button"
        disabled={!selectedOwnerId || overdueTasksCount === 0 || batchIsRunning}
        onClick={onProcessOverdueTasks}
        type="button"
      >
        <Brain size={15} />
        <span>{analyzeButtonLabel}</span>
      </button>
    ) : null}
  </div>
);
