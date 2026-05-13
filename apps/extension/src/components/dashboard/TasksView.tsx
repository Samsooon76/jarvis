import type { QueueProspect } from "@jarvis/shared";
import { priorityLabels } from "./config";
import { formatAmount } from "../../utils/dashboard/formatters";
import { getDaysSince } from "../../utils/dashboard/prospects";

type TasksViewProps = {
  taskProspects: QueueProspect[];
};

export const TasksView = ({ taskProspects }: TasksViewProps) => (
  <section className="ae-view-panel" aria-label="Taches prioritaires">
    <div className="ae-view-title">
      <p className="ae-eyebrow">Taches</p>
      <h2>Actions prioritaires</h2>
    </div>
    <div className="ae-task-list">
      {taskProspects.map((prospect) => (
        <article className="ae-task-item" key={prospect.id}>
          <div>
            <strong>{prospect.company}</strong>
            <span>{prospect.nextAction}</span>
          </div>
          <small>
            {formatAmount(prospect.dealAmount)} · {priorityLabels[prospect.priority]} ·{" "}
            {getDaysSince(prospect.lastContactAt)}d
          </small>
        </article>
      ))}
      {taskProspects.length === 0 ? <p className="ae-empty">Aucune tache disponible.</p> : null}
    </div>
  </section>
);
