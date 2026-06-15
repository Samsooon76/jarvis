import { RefreshCw, Sparkles } from "lucide-react";
import type {
  BuyingCommitteeMember,
  DealQualificationResult,
  DecisionProcess,
  MeddiccCriterion,
  QualificationInsight,
  QualificationRisk,
} from "../../../services/api";
import {
  budgetStatusLabels,
  dealRoleLabels,
  formatOptionalDateTime,
  getDealRoleTone,
  getInfluenceScore,
  getRiskTone,
  getSentimentTone,
  influenceLabels,
  legalStatusLabels,
  purchaseProcessLabels,
  qualificationStatusLabels,
  qualificationStatusTones,
  riskSeverityLabels,
  sentimentLabels,
} from "../../../utils/dashboard/dealAnalysis";
import { getInitials } from "../../../utils/dashboard/prospects";
import { AnalysisLoadingPanel, type LoadingStep } from "./AnalysisLoadingPanel";

const qualificationLoadingSteps: LoadingStep[] = [
  {
    label: "Chargement CRM",
    detail: "Lecture du deal, des contacts et du contexte HubSpot.",
  },
  {
    label: "Historique commercial",
    detail: "Collecte des notes, emails, calls, meetings et SMS datés.",
  },
  {
    label: "Qualification IA",
    detail: "Analyse du comité d'achat, MEDDICC et processus de décision.",
  },
  {
    label: "Validation",
    detail: "Contrôle du format de réponse avant affichage.",
  },
];

const CommitteeTable = ({ members }: { members: BuyingCommitteeMember[] }) => (
  <article className="jv-theme-block">
    <span className="jv-section-label">Comité d'achat</span>
    {members.length > 0 ? (
      <div className="jv-committee-table">
        <div className="jv-committee-row header">
          <span>Personne</span>
          <span>Rôle</span>
          <span>Influence</span>
          <span>Sentiment</span>
          <span>Rôle dans le deal</span>
        </div>
        {members.map((member) => (
          <div className="jv-committee-row" key={`${member.name}:${member.role}`}>
            <div className="jv-committee-person">
              <i aria-hidden="true">{getInitials(member.name)}</i>
              <span>
                <strong>{member.name}</strong>
                <small>{member.evidence}</small>
              </span>
            </div>
            <span>{member.role}</span>
            <span className="jv-qualification-influence">
              <strong>{influenceLabels[member.influence]}</strong>
              <i>
                <b style={{ width: `${getInfluenceScore(member.influence)}%` }} />
              </i>
            </span>
            <span className={`jv-qual-pill ${getSentimentTone(member.sentiment)}`}>
              {sentimentLabels[member.sentiment]}
            </span>
            <span className={`jv-qual-pill ${getDealRoleTone(member.dealRole)}`}>
              {dealRoleLabels[member.dealRole]}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <p className="jv-theme-empty">Aucun membre de comité nommé dans les données CRM.</p>
    )}
  </article>
);

const MeddiccGrid = ({ criteria }: { criteria: MeddiccCriterion[] }) => (
  <article className="jv-theme-block">
    <span className="jv-section-label">Qualification MEDDICC</span>
    {criteria.length > 0 ? (
      <div className="jv-meddicc-grid">
        {criteria.map((criterion) => (
          <div className="jv-meddicc-card" key={criterion.id}>
            <span>{criterion.label}</span>
            <span className={`jv-qual-pill ${qualificationStatusTones[criterion.status]}`}>
              {qualificationStatusLabels[criterion.status]}
            </span>
            <small>{criterion.score} %</small>
            <i className={qualificationStatusTones[criterion.status]}>
              <b style={{ width: `${criterion.score}%` }} />
            </i>
            <p>{criterion.gap ?? criterion.evidence}</p>
          </div>
        ))}
      </div>
    ) : (
      <p className="jv-theme-empty">Qualification MEDDICC indisponible dans la réponse IA.</p>
    )}
  </article>
);

const DecisionProcessPanel = ({ process }: { process: DecisionProcess }) => (
  <article className="jv-theme-block">
    <span className="jv-section-label">Décision & processus</span>
    <dl className="jv-decision-list">
      <div>
        <dt>Calendrier de décision</dt>
        <dd>{process.decisionCalendar ?? "Non renseigné"}</dd>
      </div>
      <div>
        <dt>Statut budgétaire</dt>
        <dd className={`jv-qual-pill ${process.budgetStatus === "validated" ? "green" : process.budgetStatus === "blocked" ? "red" : "amber"}`}>
          {budgetStatusLabels[process.budgetStatus]}
        </dd>
      </div>
      <div>
        <dt>Processus d'achat</dt>
        <dd className={`jv-qual-pill ${process.purchaseProcess === "clear" ? "green" : process.purchaseProcess === "blocked" ? "red" : "amber"}`}>
          {purchaseProcessLabels[process.purchaseProcess]}
        </dd>
      </div>
      <div>
        <dt>Statut juridique</dt>
        <dd className={`jv-qual-pill ${process.legalStatus === "approved" ? "green" : process.legalStatus === "blocked" ? "red" : "amber"}`}>
          {legalStatusLabels[process.legalStatus]}
        </dd>
      </div>
      <div>
        <dt>Prochaine étape de gouvernance</dt>
        <dd>{process.nextGovernanceStep ?? "Non renseignée"}</dd>
      </div>
    </dl>
  </article>
);

const QualificationRiskRows = ({ risks }: { risks: QualificationRisk[] }) => (
  <article className="jv-theme-block">
    <span className="jv-section-label">Risques & blocages</span>
    {risks.length > 0 ? (
      <div>
        {risks.map((risk) => (
          <div className="jv-qual-risk-row" key={`${risk.title}:${risk.severity}`}>
            <strong>{risk.title}</strong>
            <small>{risk.evidence}</small>
            <span className={`jv-qual-pill ${getRiskTone(risk.severity)}`}>
              {riskSeverityLabels[risk.severity]}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <p className="jv-theme-empty">Aucun risque qualifié par l'IA.</p>
    )}
  </article>
);

const QualificationInsightList = ({ items }: { items: QualificationInsight[] }) =>
  items.length > 0 ? (
    <ul className="jv-bullet-list">
      {items.map((item) => (
        <li key={item.title}>
          <strong>{item.title}</strong> — {item.rationale}
        </li>
      ))}
    </ul>
  ) : (
    <p className="jv-theme-empty">Aucune information disponible.</p>
  );

const QualificationInsightRows = ({ title, items }: { title: string; items: QualificationInsight[] }) => (
  <article className="jv-theme-block">
    <span className="jv-section-label">{title}</span>
    <QualificationInsightList items={items} />
  </article>
);

const QualificationAiAside = ({
  error,
  isLoading,
  items,
  onRefresh,
  result,
}: {
  error: string | null;
  isLoading: boolean;
  items: QualificationInsight[];
  onRefresh: () => void;
  result: DealQualificationResult;
}) => (
  <aside className="jv-theme-block jv-qual-aside">
    <span className="jv-section-label">Lecture IA</span>
    <small>
      {result.provider} · {result.model} · {formatOptionalDateTime(result.generatedAt)}
    </small>
    {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}
    <div>
      <span className="jv-section-label">Ce qui manque pour améliorer la probabilité</span>
      <QualificationInsightList items={items} />
    </div>
    <button className="jv-btn-ghost" disabled={isLoading} onClick={onRefresh} type="button">
      {isLoading ? (
        <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
      ) : (
        <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
      )}
      {isLoading ? "Analyse…" : "Relancer l'analyse IA"}
    </button>
  </aside>
);

export const QualificationSection = ({
  error,
  isLoading,
  onRefresh,
  result,
}: {
  error: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  result: DealQualificationResult | null;
}) => {
  if (!result) {
    return (
      <AnalysisLoadingPanel
        error={error}
        idleText="Analyse en cours de préparation."
        isLoading={isLoading}
        steps={qualificationLoadingSteps}
        title="Comité & qualification"
      />
    );
  }

  const qualification = result.qualification;

  return (
    <section aria-label="Comité et qualification" className="jv-qualification-layout">
      <div className="jv-qualification-main">
        <CommitteeTable members={qualification.buyingCommittee} />
        <div className="jv-qualification-top-grid">
          <MeddiccGrid criteria={qualification.meddicc} />
          <DecisionProcessPanel process={qualification.decisionProcess} />
        </div>
        <div className="jv-qualification-bottom-grid">
          <QualificationRiskRows risks={qualification.risks} />
          <QualificationInsightRows items={qualification.strengths} title="Atouts du deal" />
        </div>
      </div>

      <QualificationAiAside
        error={error}
        isLoading={isLoading}
        items={qualification.missingForWin}
        onRefresh={onRefresh}
        result={result}
      />
    </section>
  );
};