import type { BuyingCommitteeMember } from "../../../services/api";
import {
  dealRoleLabels,
  getDealRoleTone,
  getSentimentTone,
  sentimentLabels,
} from "../../../utils/dashboard/dealAnalysis";
import { getInitials } from "../../../utils/dashboard/prospects";

export const StakeholdersSummary = ({ members }: { members: BuyingCommitteeMember[] }) => {
  const visible = members.slice(0, 4);

  return (
    <article className="jv-theme-block">
      <span className="jv-section-label">Qui contacter</span>
      {visible.length > 0 ? (
        <div className="jv-stakeholders-row">
          {visible.map((member) => (
            <div className="jv-stakeholder-chip" key={`${member.name}:${member.role}`}>
              <span aria-hidden="true" className="jv-stakeholder-avatar">
                {getInitials(member.name)}
              </span>
              <div className="jv-stakeholder-copy">
                <strong>{member.name}</strong>
                <small>{member.role}</small>
              </div>
              <div className="jv-stakeholder-tags">
                <span className={`jv-qual-pill ${getDealRoleTone(member.dealRole)}`}>
                  {dealRoleLabels[member.dealRole]}
                </span>
                <span className={`jv-qual-pill ${getSentimentTone(member.sentiment)}`}>
                  {sentimentLabels[member.sentiment]}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="jv-theme-empty">Aucun contact clé identifié dans l'analyse.</p>
      )}
    </article>
  );
};