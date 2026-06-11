import { taskFilterTabs, type TaskDateFilter } from "../../../utils/dashboard/tasks";

type TaskMetricsProps = {
  laterTaskCount: number;
  overdueTaskCount: number;
  todayTaskCount: number;
  upcomingTaskCount: number;
};

export const TaskMetrics = ({ laterTaskCount, overdueTaskCount, todayTaskCount, upcomingTaskCount }: TaskMetricsProps) => (
  <div className="ae-task-metrics" aria-label="Resume des taches">
    <article className="overdue">
      <span>En retard</span>
      <strong>{overdueTaskCount}</strong>
      <small>A traiter en priorite</small>
    </article>
    <article className="today">
      <span>Aujourd'hui</span>
      <strong>{todayTaskCount}</strong>
      <small>Taches du jour restantes</small>
    </article>
    <article>
      <span>Cette semaine</span>
      <strong>{upcomingTaskCount}</strong>
      <small>Taches planifiees</small>
    </article>
    <article>
      <span>Plus tard</span>
      <strong>{laterTaskCount}</strong>
      <small>Apres cette semaine</small>
    </article>
  </div>
);

type TaskFilterTabsProps = {
  dateFilter: TaskDateFilter;
  onDateFilterChange: (filter: TaskDateFilter) => void;
};

export const TaskFilterTabs = ({ dateFilter, onDateFilterChange }: TaskFilterTabsProps) => (
  <div className="ae-task-tabs" aria-label="Filtrer par periode">
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
);
