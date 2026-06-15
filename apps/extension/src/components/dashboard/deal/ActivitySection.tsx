import { useState } from "react";
import type {
  ActivityPlanAction,
  ActivityPlanInsight,
  ActivityPlanRecommendation,
  DealActivityPlanResult,
  DealChannelEngagement,
} from "../../../services/api";
import {
  activityPriorityLabels,
  activityStatusLabels,
  buildRecommendationDateLabel,
  compactText,
  formatActivityTime,
  formatOptionalDate,
  getHubSpotDealUrl,
  type ActivityNextStepSource,
} from "../../../utils/dashboard/dealAnalysis";
import { ActivityChannelIcon } from "./ActivityChannelIcon";
import { AnalysisLoadingPanel, type LoadingStep } from "./AnalysisLoadingPanel";

type ActivityTimelineFilter = "all" | "call" | "email" | "meeting";

const activityLoadingSteps: LoadingStep[] = [
  {
    label: "Connexion HubSpot",
    detail: "Résolution du deal et vérification de l'accès CRM.",
  },
  {
    label: "Collecte des activités",
    detail: "Lecture des notes, calls, meetings, emails et SMS associés.",
  },
  {
    label: "Consolidation timeline",
    detail: "Tri chronologique avec dates complètes et engagement par canal.",
  },
  {
    label: "Analyse IA",
    detail: "Génération du plan d'action, des échéances et des insights.",
  },
  {
    label: "Contrôle chronologique",
    detail: "Filtrage des échéances passées avant affichage.",
  },
];

type ActivityTimelineNextStep = {
  id: string;
  source: ActivityNextStepSource;
  title: string;
  detail: string;
  dateLabel: string;
  ownerName: string | null;
  status?: ActivityPlanAction["status"];
  priority?: ActivityPlanAction["priority"] | ActivityPlanRecommendation["priority"];
};

const buildTimelineNextSteps = (result: DealActivityPlanResult): ActivityTimelineNextStep[] => {
  const actions = result.activityPlan.mutualActionPlan.map((action, index) => ({
    id: `action:${action.title}:${action.dueDate ?? index}`,
    source: "action" as const,
    title: action.title,
    detail: action.rationale,
    dateLabel: formatOptionalDate(action.dueDate),
    ownerName: action.ownerName,
    status: action.status,
    priority: action.priority,
  }));
  const deadlines = result.activityPlan.upcomingDeadlines.map((deadline, index) => ({
    id: `deadline:${deadline.title}:${deadline.date ?? index}`,
    source: "deadline" as const,
    title: deadline.title,
    detail: deadline.description,
    dateLabel: formatOptionalDate(deadline.date),
    ownerName: deadline.ownerName,
  }));
  const recommendation = result.activityPlan.recommendation;
  const recommendedAction: ActivityTimelineNextStep = {
    id: "recommendation:next-best-action",
    source: "recommendation",
    title: recommendation.nextBestAction.title,
    detail: recommendation.nextBestAction.rationale,
    dateLabel: buildRecommendationDateLabel(recommendation.nextBestAction.dueInDays),
    ownerName: null,
    priority: recommendation.priority,
  };

  return [recommendedAction, ...actions, ...deadlines].slice(0, 6);
};

const ActivityTimelinePanel = ({
  crmDealUrl,
  result,
}: {
  crmDealUrl: string | null;
  result: DealActivityPlanResult;
}) => {
  const [activeFilter, setActiveFilter] = useState<ActivityTimelineFilter>("all");
  const nextSteps = buildTimelineNextSteps(result);
  const activities =
    activeFilter === "all"
      ? result.recentActivities
      : result.recentActivities.filter((item) => item.channel === activeFilter);
  const visibleNextSteps = activeFilter === "all" ? nextSteps : [];
  const filters: Array<{ id: ActivityTimelineFilter; label: string }> = [
    { id: "all", label: "Tout" },
    { id: "call", label: "Appels" },
    { id: "email", label: "Emails" },
    { id: "meeting", label: "Réunions" },
  ];

  return (
    <article className="jv-theme-block">
      <div className="jv-theme-block-head">
        <div>
          <span className="jv-section-label">Timeline du deal</span>
          <span className="jv-chart-legend">
            {nextSteps.length} next step{nextSteps.length > 1 ? "s" : ""} intégré{nextSteps.length > 1 ? "s" : ""}
          </span>
        </div>
        {crmDealUrl ? (
          <a className="jv-btn-ghost" href={crmDealUrl} rel="noreferrer" target="_blank">
            Ouvrir HubSpot
          </a>
        ) : (
          <button className="jv-btn-ghost" disabled type="button">
            Ouvrir HubSpot
          </button>
        )}
      </div>

      <div aria-label="Filtres timeline" className="jv-timeline-filters" role="group">
        {filters.map((filter) => (
          <button
            aria-pressed={activeFilter === filter.id}
            className={activeFilter === filter.id ? "active" : undefined}
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="jv-activity-timeline">
        {visibleNextSteps.length > 0 ? (
          <div className="jv-timeline-label">
            <span>Next steps</span>
          </div>
        ) : null}
        {visibleNextSteps.map((step) => (
          <div className={`jv-activity-event next-step ${step.source}`} key={step.id}>
            <ActivityChannelIcon channel={step.source} />
            <time>{step.dateLabel}</time>
            <div>
              <strong>{step.title}</strong>
              {step.ownerName ? <small> · {step.ownerName}</small> : null}
              <p className="jv-prose">{compactText(step.detail, 180)}</p>
              <div className="jv-item-meta">
                {step.priority ? <span className="jv-meta-pending">{activityPriorityLabels[step.priority]}</span> : null}
                {step.status ? <span className="jv-meta-ok">{activityStatusLabels[step.status]}</span> : null}
                <span>
                  {step.source === "recommendation" ? "IA" : step.source === "deadline" ? "Échéance" : "Action"}
                </span>
              </div>
            </div>
          </div>
        ))}

        {activities.length > 0 ? (
          <div className="jv-timeline-label">
            <span>Historique CRM</span>
          </div>
        ) : null}
        {activities.map((item) => (
          <div className={`jv-activity-event ${item.channel}`} key={item.id}>
            <ActivityChannelIcon channel={item.channel} />
            <time>
              {formatOptionalDate(item.occurredAt)}
              {formatActivityTime(item.occurredAt) ? `, ${formatActivityTime(item.occurredAt)}` : ""}
            </time>
            <div>
              <strong>{item.title}</strong>
              {item.actorName ? <small> · {item.actorName}</small> : null}
              {item.body ? <p className="jv-prose">{compactText(item.body, 130)}</p> : null}
            </div>
          </div>
        ))}
        {activities.length === 0 && nextSteps.length === 0 ? (
          <p className="jv-theme-empty">Aucune activité HubSpot exploitable.</p>
        ) : null}
        {activities.length === 0 && visibleNextSteps.length === 0 && activeFilter !== "all" ? (
          <p className="jv-theme-empty">Aucune activité pour ce filtre.</p>
        ) : null}
      </div>
    </article>
  );
};

const ChannelEngagementPanel = ({ channels }: { channels: DealChannelEngagement[] }) => (
  <article className="jv-theme-block">
    <span className="jv-section-label">Engagement par canal</span>
    <div className="jv-channel-grid">
      {channels.map((channel) => (
        <div className="jv-channel-card" key={channel.channel}>
          <span>{channel.label}</span>
          <strong>{channel.count}</strong>
          <small>
            {channel.responseRate === null ? channel.caption : `${channel.responseRate} % de réponse`}
          </small>
        </div>
      ))}
    </div>
    <p className="jv-theme-empty">Volumes calculés depuis les activités HubSpot associées à ce deal.</p>
  </article>
);

const NotesInsightsPanel = ({ insights }: { insights: ActivityPlanInsight[] }) => (
  <article className="jv-theme-block">
    <span className="jv-section-label">Notes & insights</span>
    {insights.length > 0 ? (
      <div>
        {insights.map((insight) => (
          <div className="jv-activity-note" key={insight.title}>
            <span aria-hidden="true" />
            <p>
              <strong>{insight.title}</strong>
              <small>{insight.detail}</small>
            </p>
          </div>
        ))}
      </div>
    ) : (
      <p className="jv-theme-empty">Aucun insight supplémentaire détecté.</p>
    )}
  </article>
);

const ActivityRecommendationPanel = ({
  isLoading,
  onRefresh,
  result,
}: {
  isLoading: boolean;
  onRefresh: () => void;
  result: DealActivityPlanResult;
}) => {
  const recommendation = result.activityPlan.recommendation;

  return (
    <article className="jv-theme-block">
      <div className="jv-theme-block-head">
        <span className="jv-section-label">Recommandation IA</span>
        <span className={`jv-qual-pill ${recommendation.priority === "high" ? "red" : recommendation.priority === "medium" ? "amber" : "muted"}`}>
          {activityPriorityLabels[recommendation.priority]}
        </span>
      </div>
      <p className="jv-prose">{recommendation.summary}</p>
      <div className="jv-nba-card">
        <span className="jv-section-label">Prochaine meilleure action</span>
        <strong>{recommendation.nextBestAction.title}</strong>
        <small>{recommendation.nextBestAction.rationale}</small>
      </div>
      <button className="jv-btn-ghost" disabled={isLoading} onClick={onRefresh} type="button">
        {isLoading ? "Analyse..." : "Relancer l'analyse IA"}
      </button>
    </article>
  );
};

export const ActivitySection = ({
  error,
  hubspotPortalId,
  isLoading,
  onRefresh,
  result,
}: {
  error: string | null;
  hubspotPortalId?: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  result: DealActivityPlanResult | null;
}) => {
  if (!result) {
    return (
      <AnalysisLoadingPanel
        error={error}
        idleText="Activité en cours de préparation."
        isLoading={isLoading}
        steps={activityLoadingSteps}
        title="Activité & plan d'action"
      />
    );
  }

  const crmDealUrl = getHubSpotDealUrl(hubspotPortalId, result.hubspotDealId);

  return (
    <section aria-label="Activité et plan d'action" className="jv-activity-layout">
      {isLoading ? (
        <AnalysisLoadingPanel
          compact
          error={null}
          idleText=""
          isLoading={isLoading}
          steps={activityLoadingSteps}
          title="Mise à jour de l'activité"
        />
      ) : null}
      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}
      <div className="jv-activity-main">
        <ActivityTimelinePanel crmDealUrl={crmDealUrl} result={result} />
      </div>
      <div className="jv-activity-side">
        <ChannelEngagementPanel channels={result.channelEngagement} />
        <NotesInsightsPanel insights={result.activityPlan.notesAndInsights} />
        <ActivityRecommendationPanel isLoading={isLoading} onRefresh={onRefresh} result={result} />
      </div>
    </section>
  );
};