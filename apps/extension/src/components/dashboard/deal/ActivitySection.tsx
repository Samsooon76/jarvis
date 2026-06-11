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
    detail: "Resolution du deal et verification de l'acces CRM.",
  },
  {
    label: "Collecte des activites",
    detail: "Lecture des notes, calls, meetings, emails et SMS associes.",
  },
  {
    label: "Consolidation timeline",
    detail: "Tri chronologique avec dates completes et engagement par canal.",
  },
  {
    label: "Analyse IA",
    detail: "Generation du plan d'action, des echeances et des insights.",
  },
  {
    label: "Controle chronologique",
    detail: "Filtrage des echeances passees avant affichage.",
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
    { id: "meeting", label: "Reunions" },
  ];

  return (
    <article className="ae-deal-panel ae-activity-timeline-panel">
    <div className="ae-deal-panel-heading">
        <div>
          <h3>Timeline du deal</h3>
          <span>{nextSteps.length} next step{nextSteps.length > 1 ? "s" : ""} integre{nextSteps.length > 1 ? "s" : ""}</span>
        </div>
      {crmDealUrl ? (
        <a href={crmDealUrl} rel="noreferrer" target="_blank">
            Ouvrir HubSpot
        </a>
      ) : (
        <button disabled type="button">
            Ouvrir HubSpot
        </button>
      )}
    </div>

      <div className="ae-timeline-filters" aria-label="Filtres timeline">
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

      <div className="ae-activity-timeline">
        {visibleNextSteps.length > 0 ? (
          <div className="ae-timeline-section-label">
            <span>Next steps</span>
          </div>
        ) : null}
        {visibleNextSteps.map((step) => (
          <div className={`ae-activity-event next-step ${step.source}`} key={step.id}>
            <ActivityChannelIcon channel={step.source} />
            <time>{step.dateLabel}</time>
            <div>
              <strong>{step.title}</strong>
              {step.ownerName ? <small>{step.ownerName}</small> : null}
              <p>{compactText(step.detail, 180)}</p>
              <div className="ae-timeline-badges">
                {step.priority ? <span>{activityPriorityLabels[step.priority]}</span> : null}
                {step.status ? <span>{activityStatusLabels[step.status]}</span> : null}
                <span>{step.source === "recommendation" ? "IA" : step.source === "deadline" ? "Echeance" : "Action"}</span>
              </div>
            </div>
          </div>
        ))}

        {activities.length > 0 ? (
          <div className="ae-timeline-section-label">
            <span>Historique CRM</span>
          </div>
        ) : null}
        {activities.map((item) => (
          <div className={`ae-activity-event ${item.channel}`} key={item.id}>
            <ActivityChannelIcon channel={item.channel} />
            <time>
              {formatOptionalDate(item.occurredAt)}
              {formatActivityTime(item.occurredAt) ? `, ${formatActivityTime(item.occurredAt)}` : ""}
            </time>
            <div>
              <strong>{item.title}</strong>
              {item.actorName ? <small>{item.actorName}</small> : null}
              {item.body ? <p>{compactText(item.body, 130)}</p> : null}
            </div>
          </div>
        ))}
        {activities.length === 0 && nextSteps.length === 0 ? (
          <p className="ae-empty compact">Aucune activite HubSpot exploitable.</p>
        ) : null}
        {activities.length === 0 && visibleNextSteps.length === 0 && activeFilter !== "all" ? (
          <p className="ae-empty compact">Aucune activite pour ce filtre.</p>
        ) : null}
      </div>
  </article>
  );
};

const ChannelEngagementPanel = ({ channels }: { channels: DealChannelEngagement[] }) => (
  <article className="ae-deal-panel ae-channel-panel">
    <div className="ae-deal-panel-heading">
      <h3>Engagement par canal</h3>
      <button type="button">Historique CRM</button>
    </div>
    <div className="ae-channel-grid">
      {channels.map((channel) => (
        <div className="ae-channel-card" key={channel.channel}>
          <span>{channel.label}</span>
          <strong>{channel.count}</strong>
          <small>{channel.responseRate === null ? channel.caption : `${channel.responseRate} % de reponse`}</small>
        </div>
      ))}
    </div>
    <p className="ae-channel-summary">
      Volumes calcules depuis les activites HubSpot associees a ce deal.
    </p>
  </article>
);

const NotesInsightsPanel = ({ insights }: { insights: ActivityPlanInsight[] }) => (
  <article className="ae-deal-panel ae-activity-notes">
    <h3>Notes & insights</h3>
    {insights.length > 0 ? (
      <div className="ae-activity-note-list">
        {insights.map((insight) => (
          <div className="ae-activity-note" key={insight.title}>
            <span aria-hidden="true" />
            <p>
              <strong>{insight.title}</strong>
              <small>{insight.detail}</small>
            </p>
          </div>
        ))}
      </div>
    ) : (
      <p className="ae-empty compact">Aucun insight supplementaire detecte.</p>
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
    <article className="ae-deal-panel ae-activity-reco">
      <div className="ae-deal-panel-heading">
        <h3>Recommandation IA</h3>
        <strong className={`ae-activity-priority ${recommendation.priority}`}>
          {activityPriorityLabels[recommendation.priority]}
        </strong>
      </div>
      <p>{recommendation.summary}</p>
      <div className="ae-next-best-action">
        <span>Prochaine meilleure action</span>
        <div className="ae-next-best-action-card">
          <strong>{recommendation.nextBestAction.title}</strong>
          <small>{recommendation.nextBestAction.rationale}</small>
        </div>
      </div>
      <button disabled={isLoading} onClick={onRefresh} type="button">
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
          idleText="Activite en cours de preparation."
        isLoading={isLoading}
        steps={activityLoadingSteps}
        title="Activite & plan d'action"
      />
    );
  }

  const crmDealUrl = getHubSpotDealUrl(hubspotPortalId, result.hubspotDealId);

  return (
    <section className="ae-activity-layout" aria-label="Activite et plan d'action">
      {isLoading ? (
        <AnalysisLoadingPanel
          compact
          error={null}
          idleText=""
          isLoading={isLoading}
          steps={activityLoadingSteps}
          title="Mise a jour de l'activite"
        />
      ) : null}
      {error ? <p className="ae-detail-error">{error}</p> : null}
      <div className="ae-activity-main-column">
        <ActivityTimelinePanel crmDealUrl={crmDealUrl} result={result} />
      </div>
      <div className="ae-activity-side-column">
        <ChannelEngagementPanel channels={result.channelEngagement} />
        <NotesInsightsPanel insights={result.activityPlan.notesAndInsights} />
        <ActivityRecommendationPanel isLoading={isLoading} onRefresh={onRefresh} result={result} />
      </div>
    </section>
  );
};
