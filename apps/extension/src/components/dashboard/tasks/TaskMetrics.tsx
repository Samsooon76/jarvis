type TaskMetricsProps = {
  completedTaskCount: number;
  overdueTaskCount: number;
  todayTaskCount: number;
  totalTaskCount: number;
};

export const TaskMetrics = ({
  completedTaskCount,
  overdueTaskCount,
  todayTaskCount,
  totalTaskCount,
}: TaskMetricsProps) => {
  const stats = [
    {
      caption: "tâches ouvertes",
      label: "Total",
      value: totalTaskCount,
    },
    {
      caption: "du jour restantes",
      label: "Aujourd'hui",
      value: todayTaskCount,
    },
    {
      caption: "à traiter en priorité",
      label: "En retard",
      value: overdueTaskCount,
    },
    {
      caption: "sur la période",
      label: "Terminées",
      value: completedTaskCount,
    },
  ] as const;

  return (
    <section className="jv-stat-strip cols-4" aria-label="Indicateurs tâches">
      {stats.map((stat, index) => (
        <div className="jv-stat" key={stat.label} style={{ animationDelay: `${index * 60}ms` }}>
          <span className="jv-stat-label">{stat.label}</span>
          <span className="jv-stat-value">{stat.value}</span>
          <small className="jv-stat-caption">{stat.caption}</small>
        </div>
      ))}
    </section>
  );
};