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
    detail: "Collecte des notes, emails, calls, meetings et SMS dates.",
  },
  {
    label: "Qualification IA",
    detail: "Analyse du comite d'achat, MEDDICC et processus de decision.",
  },
  {
    label: "Validation",
    detail: "Controle du format de reponse avant affichage.",
  },
];

const CommitteeTable = ({ members }: { members: BuyingCommitteeMember[] }) => (
  <article className="ae-deal-panel ae-qualification-committee">
    <h3>Comite d'achat</h3>
    {members.length > 0 ? (
      <div className="ae-committee-table">
        <div className="ae-committee-row header">
          <span>Personne</span>
          <span>Role</span>
          <span>Influence</span>
          <span>Sentiment</span>
          <span>Role dans le deal</span>
        </div>
        {members.map((member) => (
          <div className="ae-committee-row" key={`${member.name}:${member.role}`}>
            <div className="ae-committee-person">
              <i aria-hidden="true">{getInitials(member.name)}</i>
              <span>
                <strong>{member.name}</strong>
                <small>{member.evidence}</small>
              </span>
            </div>
            <span>{member.role}</span>
            <span className="ae-qualification-influence">
              <strong>{influenceLabels[member.influence]}</strong>
              <i>
                <b style={{ width: `${getInfluenceScore(member.influence)}%` }} />
              </i>
            </span>
            <span className={`ae-qualification-pill ${getSentimentTone(member.sentiment)}`}>
              {sentimentLabels[member.sentiment]}
            </span>
            <span className={`ae-qualification-pill ${getDealRoleTone(member.dealRole)}`}>
              {dealRoleLabels[member.dealRole]}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <p className="ae-empty compact">Aucun membre de comite nomme dans les donnees CRM.</p>
    )}
  </article>
);

const MeddiccGrid = ({ criteria }: { criteria: MeddiccCriterion[] }) => (
  <article className="ae-deal-panel ae-meddicc-panel">
    <h3>Qualification MEDDICC</h3>
    {criteria.length > 0 ? (
      <div className="ae-meddicc-grid">
        {criteria.map((criterion) => (
          <div className="ae-meddicc-card" key={criterion.id}>
            <span>{criterion.label}</span>
            <strong className={qualificationStatusTones[criterion.status]}>{qualificationStatusLabels[criterion.status]}</strong>
            <small>{criterion.score} %</small>
            <i className={qualificationStatusTones[criterion.status]}>
              <b style={{ width: `${criterion.score}%` }} />
            </i>
            <p>{criterion.gap ?? criterion.evidence}</p>
          </div>
        ))}
      </div>
    ) : (
      <p className="ae-empty compact">Qualification MEDDICC indisponible dans la reponse IA.</p>
    )}
  </article>
);

const DecisionProcessPanel = ({ process }: { process: DecisionProcess }) => (
  <article className="ae-deal-panel ae-decision-panel">
    <h3>Decision & processus</h3>
    <dl className="ae-decision-list">
      <div>
        <dt>Calendrier de decision</dt>
        <dd>{process.decisionCalendar ?? "Non renseigne"}</dd>
      </div>
      <div>
        <dt>Statut budgetaire</dt>
        <dd className={process.budgetStatus === "validated" ? "green" : process.budgetStatus === "blocked" ? "red" : "amber"}>
          {budgetStatusLabels[process.budgetStatus]}
        </dd>
      </div>
      <div>
        <dt>Processus d'achat</dt>
        <dd className={process.purchaseProcess === "clear" ? "green" : process.purchaseProcess === "blocked" ? "red" : "amber"}>
          {purchaseProcessLabels[process.purchaseProcess]}
        </dd>
      </div>
      <div>
        <dt>Statut juridique</dt>
        <dd className={process.legalStatus === "approved" ? "green" : process.legalStatus === "blocked" ? "red" : "amber"}>
          {legalStatusLabels[process.legalStatus]}
        </dd>
      </div>
      <div>
        <dt>Prochaine etape de gouvernance</dt>
        <dd>{process.nextGovernanceStep ?? "Non renseignee"}</dd>
      </div>
    </dl>
  </article>
);

const QualificationRiskRows = ({ risks }: { risks: QualificationRisk[] }) => (
  <article className="ae-deal-panel">
    <h3>Risques & blocages</h3>
    {risks.length > 0 ? (
      <div className="ae-qualification-risk-list">
        {risks.map((risk) => (
          <div className="ae-qualification-risk-row" key={`${risk.title}:${risk.severity}`}>
            <span>{risk.title}</span>
            <small>{risk.evidence}</small>
            <strong className={getRiskTone(risk.severity)}>{riskSeverityLabels[risk.severity]}</strong>
          </div>
        ))}
      </div>
    ) : (
      <p className="ae-empty compact">Aucun risque qualifie par l'IA.</p>
    )}
  </article>
);

const QualificationInsightList = ({ items }: { items: QualificationInsight[] }) =>
  items.length > 0 ? (
    <div className="ae-qualification-insight-list">
      {items.map((item) => (
        <div className="ae-qualification-insight-row" key={item.title}>
          <span aria-hidden="true" />
          <p>
            <strong>{item.title}</strong>
            <small>{item.rationale}</small>
          </p>
        </div>
      ))}
    </div>
  ) : (
    <p className="ae-empty compact">Aucune information disponible.</p>
  );

const QualificationInsightRows = ({ title, items }: { title: string; items: QualificationInsight[] }) => (
  <article className="ae-deal-panel">
    <h3>{title}</h3>
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
  <aside className="ae-deal-panel ae-qualification-ai">
    <h3>Lecture IA</h3>
    <small>
      {result.provider} · {result.model} · {formatOptionalDateTime(result.generatedAt)}
    </small>
    {error ? <p className="ae-detail-error">{error}</p> : null}
    <div className="ae-qualification-ai-section">
      <h4>Ce qui manque pour ameliorer la probabilite de gain</h4>
      <QualificationInsightList items={items} />
    </div>
    <button disabled={isLoading} onClick={onRefresh} type="button">
      {isLoading ? "Analyse..." : "Relancer l'analyse IA"}
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
          idleText="Analyse en cours de preparation."
          isLoading={isLoading}
        steps={qualificationLoadingSteps}
        title="Comite & qualification"
      />
    );
  }

  const qualification = result.qualification;

  return (
    <section className="ae-qualification-layout" aria-label="Comite et qualification">
      <div className="ae-qualification-main">
        <CommitteeTable members={qualification.buyingCommittee} />
        <div className="ae-qualification-top-grid">
          <MeddiccGrid criteria={qualification.meddicc} />
          <DecisionProcessPanel process={qualification.decisionProcess} />
        </div>
        <div className="ae-qualification-bottom-grid">
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
