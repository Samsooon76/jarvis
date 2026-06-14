import {
  ArrowRight,
  BarChart3,
  Bot,
  ListFilter,
  LogIn,
  PhoneCall,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { navigateToAuth } from "../../utils/publicRoute";
import "../styles/auth-landing.css";

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const valueStats = [
  { label: "Morning queue", value: "Priorisée", caption: "Deals triés par score IA" },
  { label: "Appels", value: "Intelligence", caption: "Objections & next steps" },
  { label: "Forecast", value: "Prédictif", caption: "Commit, risques, couverture" },
  { label: "Manager", value: "Coaching", caption: "KPIs équipe en direct" },
] as const;

const morningQueueBenefits = [
  "Queue quotidienne triée par priorité commerciale",
  "Sync HubSpot contacts, deals et owners",
  "Snooze et skip pour garder le focus",
] as const;

const intelligenceBenefits = [
  "Résumé pré-call et talking points",
  "Analyse post-call automatique",
  "Actions suggérées vers HubSpot",
] as const;

export const LandingPage = () => (
  <main className="jv-landing-page" aria-label="Jarvis — présentation produit">
    <div className="jv-landing-shell">
      <header className="jv-landing-topbar">
        <div className="jv-page-header">
          <Bot aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
          <h1>
            Jarvis
            <span className="jv-page-kicker">copilote revenue</span>
          </h1>
        </div>
        <div className="jv-landing-topbar-actions">
          <button className="jv-btn-ghost jv-btn-inline" type="button" onClick={() => navigateToAuth("login")}>
            <LogIn aria-hidden="true" size={14} strokeWidth={1.5} />
            Connexion
          </button>
          <button className="jv-btn-primary jv-btn-inline" type="button" onClick={() => navigateToAuth("signup")}>
            <UserPlus aria-hidden="true" size={14} strokeWidth={1.5} />
            Commencer
          </button>
        </div>
      </header>

      <div className="jv-landing-content" aria-labelledby="jv-landing-hero-title">
        <div className="jv-auth-hero">
          <h2 id="jv-landing-hero-title">Le cockpit HubSpot pour chaque commercial.</h2>
          <p className="jv-auth-hero-copy">
            L&apos;admin connecte le CRM, Jarvis rattache les owners, et chaque sales retrouve sa queue
            priorisée avec ses propres deals — sans quitter son workflow.
          </p>
        </div>

        <section className="jv-stat-strip cols-4" aria-label="Valeur produit">
          {valueStats.map((stat, index) => (
            <div className="jv-stat" key={stat.label} style={{ animationDelay: `${index * 60}ms` }}>
              <span className="jv-stat-label">{stat.label}</span>
              <span className="jv-stat-value">{stat.value}</span>
              <small className="jv-stat-caption">{stat.caption}</small>
            </div>
          ))}
        </section>

        <section className="jv-themes-row" aria-label="Modules Jarvis">
          <div className="jv-theme-block">
            <SectionLabel icon={ListFilter}>Morning queue</SectionLabel>
            <ul className="jv-bullet-list">
              {morningQueueBenefits.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="jv-theme-block">
            <SectionLabel icon={PhoneCall}>Intelligence appels</SectionLabel>
            <ul className="jv-bullet-list">
              {intelligenceBenefits.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="jv-callout" aria-label="Couche IA">
          <Sparkles aria-hidden="true" size={16} strokeWidth={1.5} />
          <div>
            <p>IA intégrée sans remplacer HubSpot.</p>
            <small>
              Jarvis résume, score et suggère — la source de vérité reste ton CRM. Forecast, coaching manager et
              analyse win/loss inclus.
            </small>
          </div>
        </section>

        <section className="jv-theme-block" aria-label="Pour les managers">
          <SectionLabel icon={BarChart3}>Dashboard manager</SectionLabel>
          <ul className="jv-theme-list">
            <li>
              <span>Statut sync HubSpot en temps réel</span>
              <em>Live</em>
            </li>
            <li>
              <span>KPIs équipe et digest quotidien</span>
              <em>Manager</em>
            </li>
            <li>
              <span>Forecast accuracy et coaching reps</span>
              <em>IA</em>
            </li>
          </ul>
        </section>

        <section className="jv-landing-cta" aria-label="Démarrer avec Jarvis">
          <button className="jv-btn-primary jv-btn-inline" type="button" onClick={() => navigateToAuth("signup")}>
            Demarrer avec HubSpot
            <ArrowRight aria-hidden="true" size={15} strokeWidth={1.5} />
          </button>
          <button className="jv-btn-ghost jv-btn-inline" type="button" onClick={() => navigateToAuth("login")}>
            J&apos;ai deja un compte
          </button>
        </section>
      </div>
    </div>
  </main>
);