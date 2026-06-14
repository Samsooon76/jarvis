import type { QueueProspect } from "@jarvis/shared";
import { ChevronRight, Users, type LucideIcon } from "lucide-react";
import { priorityLabels } from "../config";
import type { PlannedProspectTask } from "../types";
import { LoadingState } from "../LoadingState";
import { formatAmount } from "../../../utils/dashboard/formatters";
import { getDaysSince } from "../../../utils/dashboard/prospects";

type ProspectTableProps = {
  activeProspectId: string | null;
  filteredProspects: QueueProspect[];
  isLoadingLiveDeals: boolean;
  onActiveProspectChange: (prospectId: string) => void;
  plannedTasksByProspectId: Map<string, PlannedProspectTask>;
};

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const priorityClass: Record<QueueProspect["priority"], string> = {
  urgent: "jv-meta-risk",
  important: "jv-meta-pending",
  routine: "jv-meta-ok",
};

const formatRelativeTouch = (value: string): string => {
  const days = getDaysSince(value);

  if (days === 0) {
    return "Aujourd'hui";
  }

  if (days === 1) {
    return "Hier";
  }

  return `Il y a ${days}j`;
};

const ProspectMeta = ({ prospect }: { prospect: QueueProspect }) => (
  <span className="jv-item-meta">
    <span className={priorityClass[prospect.priority]}>{priorityLabels[prospect.priority]}</span>
    <span>{prospect.dealStage}</span>
    <span>{prospect.closeProbability}%</span>
    <span className="jv-meta-score">Score {prospect.closeProbability}</span>
  </span>
);

export const ProspectTable = ({
  activeProspectId,
  filteredProspects,
  isLoadingLiveDeals,
  onActiveProspectChange,
}: ProspectTableProps) => (
  <section className="jv-list-shell" aria-busy={isLoadingLiveDeals} aria-label="Queue prospects">
    <header className="jv-list-head">
      <SectionLabel icon={Users}>Queue prospects</SectionLabel>
      <span className="jv-list-count">
        {filteredProspects.length} résultat{filteredProspects.length > 1 ? "s" : ""}
      </span>
    </header>
    <div className="jv-list-body">
      {filteredProspects.map((prospect) => {
        const isActive = activeProspectId === prospect.id;
        const dealLabel = prospect.dealName ?? prospect.dealStage;

        return (
          <button
            className={isActive ? "jv-list-item selected" : "jv-list-item"}
            key={prospect.id}
            onClick={() => onActiveProspectChange(prospect.id)}
            type="button"
          >
            <span className="jv-list-main">
              <strong>{prospect.company}</strong>
              <small>
                {prospect.name} · {dealLabel}
              </small>
              <ProspectMeta prospect={prospect} />
            </span>
            <span className="jv-list-side">
              <time>{formatRelativeTouch(prospect.lastContactAt)}</time>
              <em>{formatAmount(prospect.dealAmount)}</em>
              <ChevronRight size={14} strokeWidth={1.5} />
            </span>
          </button>
        );
      })}
      {filteredProspects.length === 0 && isLoadingLiveDeals ? (
        <LoadingState detail="On synchronise la liste avec les donnees live HubSpot." label="Chargement des deals HubSpot" />
      ) : null}
      {filteredProspects.length === 0 && !isLoadingLiveDeals ? (
        <p className="jv-list-empty">Aucun deal ne correspond a ce filtre.</p>
      ) : null}
    </div>
  </section>
);