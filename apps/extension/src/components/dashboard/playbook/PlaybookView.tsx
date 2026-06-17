import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlignLeft,
  BookOpenCheck,
  ChevronRight,
  History,
  Layers,
  Lightbulb,
  Map as MapIcon,
  Plus,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type {
  Playbook,
  PlaybookBootstrapReadiness,
  PlaybookDetail,
  PlaybookPlay,
  PlaybookPlayCategory,
  PlaybookPlayInput,
  PlaybookPlayStatus,
  PlaybookSuggestion,
} from "@jarvis/shared";
import { PLAYBOOK_PLAY_CATEGORIES } from "@jarvis/shared";
import {
  acceptPlaybookSuggestion,
  bootstrapPlaybookFromWonDeals,
  createPlaybook,
  createPlaybookPlay,
  fetchPlaybookBootstrapReadiness,
  fetchPlaybookDetail,
  fetchPlaybooks,
  fetchPlaybookSuggestions,
  generatePlaybookSuggestions,
  rejectPlaybookSuggestion,
  synthesizePlaybookOverview,
  updatePlaybookPlay,
} from "../../../services/api";
import { LoadingState } from "../LoadingState";
import "../../styles/playbook.css";

const BOOTSTRAP_PROGRESS_STEPS = [
  { afterMs: 0, label: "Analyse des deals gagnés", detail: "Jarvis lit l'historique HubSpot deal par deal (10 max)." },
  { afterMs: 25_000, label: "Synthèse de la séquence gagnante", detail: "Identification des étapes communes aux victoires de l'équipe." },
  { afterMs: 55_000, label: "Structuration du playbook", detail: "Organisation des plays par étapes du cycle de vente." },
  { afterMs: 100_000, label: "Finalisation", detail: "Encore un peu de patience — l'IA termine la synthèse." },
] as const;

const resolveBootstrapStep = (elapsedMs: number) => {
  let step = BOOTSTRAP_PROGRESS_STEPS[0];

  for (const candidate of BOOTSTRAP_PROGRESS_STEPS) {
    if (elapsedMs >= candidate.afterMs) {
      step = candidate;
    }
  }

  return step;
};

const estimateBootstrapProgress = (elapsedMs: number): number =>
  Math.min(94, Math.max(4, Math.round((1 - Math.exp(-elapsedMs / 75_000)) * 94)));

const BootstrapProgressOverlay = ({
  elapsedMs,
  progress,
}: {
  elapsedMs: number;
  progress: number;
}) => {
  const step = resolveBootstrapStep(elapsedMs);
  const elapsedLabel = `${Math.max(1, Math.round(elapsedMs / 1000))} s`;

  return (
    <div aria-busy="true" aria-live="polite" className="jv-playbook-bootstrap-overlay" role="status">
      <div className="jv-playbook-bootstrap-overlay-card">
        <LoadingState detail={step.detail} label={step.label} tone="panel" />
        <section className="jv-run-progress">
          <div className="jv-run-progress-head">
            <span>Génération du playbook en cours</span>
            <strong>{progress}%</strong>
          </div>
          <span className="jv-run-progress-bar">
            <span style={{ width: `${progress}%` }} />
          </span>
          <small>
            Lancé par vous · {elapsedLabel} écoulée{elapsedMs >= 2000 ? "s" : ""} · comptez 1 à 3 minutes
          </small>
        </section>
        <p className="jv-playbook-bootstrap-overlay-note">Ne quittez pas cette page pendant la génération.</p>
      </div>
    </div>
  );
};

const categoryLabels: Record<PlaybookPlayCategory, string> = {
  qualification: "Qualification",
  discovery: "Discovery",
  demo: "Demo",
  objection_handling: "Gestion d'objections",
  negotiation: "Négociation",
  closing: "Closing",
  follow_up: "Follow-up",
};

const statusLabels: Record<PlaybookPlayStatus, string> = {
  draft: "Brouillon",
  active: "Actif",
  archived: "Archivé",
};

type PlayFormState = {
  category: PlaybookPlayCategory;
  title: string;
  triggerDescription: string;
  recommendedResponse: string;
};

const emptyPlayForm: PlayFormState = {
  category: "discovery",
  title: "",
  triggerDescription: "",
  recommendedResponse: "",
};

type PlaybookViewProps = {
  orgId: string;
  canEdit: boolean;
};

type PlaybookSection = "plays" | "overview" | "suggestions";

const MIN_PLAYS_FOR_OVERVIEW = 2;

const formatOverviewDate = (value: string): string => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "date inconnue";
  }

  return date.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const DetailSection = ({ children, icon, label }: { children: React.ReactNode; icon: LucideIcon; label: string }) => (
  <section className="jv-detail-section">
    <SectionLabel icon={icon}>{label}</SectionLabel>
    {children}
  </section>
);

const PlayMeta = ({ play }: { play: PlaybookPlay }) => (
  <span className="jv-item-meta">
    <span>{categoryLabels[play.category]}</span>
    <span className={play.status === "active" ? "jv-meta-ok" : play.status === "draft" ? "jv-meta-pending" : "jv-meta-failed"}>
      {statusLabels[play.status]}
    </span>
    {play.source === "ai_suggested" ? <span className="jv-meta-score">Jarvis</span> : null}
    {play.version > 1 ? <span>v{play.version}</span> : null}
  </span>
);

type PlayFormProps = {
  initialValue: PlayFormState;
  submitLabel: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (value: PlayFormState) => void;
};

const PlayForm = ({ initialValue, submitLabel, busy, onCancel, onSubmit }: PlayFormProps) => {
  const [form, setForm] = useState<PlayFormState>(initialValue);
  const canSubmit =
    form.title.trim().length > 0 && form.triggerDescription.trim().length > 0 && form.recommendedResponse.trim().length > 0;

  return (
    <form
      className="jv-playbook-form"
      onSubmit={(event) => {
        event.preventDefault();

        if (canSubmit && !busy) {
          onSubmit(form);
        }
      }}
    >
      <label>
        Catégorie
        <select
          className="jv-select"
          value={form.category}
          onChange={(event) => setForm({ ...form, category: event.target.value as PlaybookPlayCategory })}
        >
          {PLAYBOOK_PLAY_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {categoryLabels[category]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Titre du play
        <input
          maxLength={160}
          placeholder="Ex : Cartographier le comité d'achat"
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
      </label>
      <label>
        Quand appliquer ce play (étape / signal)
        <textarea
          maxLength={600}
          placeholder="Ex : Stage Discovery — le besoin est identifié mais le comité d'achat n'est pas cartographié."
          rows={2}
          value={form.triggerDescription}
          onChange={(event) => setForm({ ...form, triggerDescription: event.target.value })}
        />
      </label>
      <label>
        Comment exécuter le play
        <textarea
          maxLength={4000}
          placeholder="Objectif, étapes, questions à poser, signaux de succès et prochaine action."
          rows={4}
          value={form.recommendedResponse}
          onChange={(event) => setForm({ ...form, recommendedResponse: event.target.value })}
        />
      </label>
      <div className="jv-playbook-form-actions">
        <button className="jv-btn-ghost" disabled={busy} onClick={onCancel} type="button">
          Annuler
        </button>
        <button className="jv-btn-primary" disabled={!canSubmit || busy} type="submit">
          {busy ? "Enregistrement…" : submitLabel}
        </button>
      </div>
    </form>
  );
};

const SuggestionEvidenceList = ({ evidence }: { evidence: PlaybookSuggestion["evidence"] }) => {
  if (evidence.length === 0) {
    return null;
  }

  return (
    <ul className="jv-bullet-list">
      {evidence.map((item, index) => (
        <li key={`${item.sourceId ?? item.title}-${index}`}>
          <strong>{item.title}</strong>
          {item.quote ? ` — ${item.quote}` : ""}
        </li>
      ))}
    </ul>
  );
};

const BootstrapPanel = ({
  bootstrapping,
  busy,
  canEdit,
  newPlaybookName,
  onBootstrap,
  onCreateManual,
  onNameChange,
  readiness,
}: {
  bootstrapping: boolean;
  busy: boolean;
  canEdit: boolean;
  newPlaybookName: string;
  onBootstrap: () => void;
  onCreateManual: () => void;
  onNameChange: (value: string) => void;
  readiness: PlaybookBootstrapReadiness | null;
}) => {
  const dealSampleCount = readiness?.recommendedDealCount ?? 10;
  const teamScopeLabel =
    readiness && readiness.teamOwnerCount > 0
      ? `équipe Sales AE · ${readiness.teamOwnerCount} commercial${readiness.teamOwnerCount > 1 ? "aux" : ""}`
      : "toute l'équipe";
  const wonDealLabel =
    readiness === null
      ? null
      : readiness.wonDealCount === 0
        ? `Aucun deal gagné synchronisé pour ${teamScopeLabel}`
        : `${readiness.wonDealCount} deal${readiness.wonDealCount > 1 ? "s" : ""} gagné${readiness.wonDealCount > 1 ? "s" : ""} · ${teamScopeLabel}`;
  const bootstrapLabel = readiness?.replacesDrafts
    ? `Relancer la génération (${readiness.draftPlayCount} brouillon${readiness.draftPlayCount > 1 ? "s" : ""} remplacé${readiness.draftPlayCount > 1 ? "s" : ""})`
    : `Générer depuis ${dealSampleCount} deal${dealSampleCount > 1 ? "s" : ""} gagné${dealSampleCount > 1 ? "s" : ""}`;

  return (
    <aside className="jv-detail jv-playbook-empty-panel">
      <div className="jv-detail-empty">
        <BookOpenCheck aria-hidden="true" size={20} strokeWidth={1.25} />
        <strong>Construisez votre playbook depuis vos victoires</strong>
        <p>
          Jarvis analyse les deals gagnés de toute l&apos;équipe Sales AE et construit un playbook structuré par étapes du
          cycle de vente (qualification → closing), pas une simple liste de réponses à objections.
        </p>
      </div>

      {wonDealLabel ? <p className="jv-playbook-readiness">{wonDealLabel}</p> : null}
      {readiness && readiness.draftPlayCount > 0 && readiness.canBootstrap ? (
        <p className="jv-banner jv-banner-info">
          {readiness.draftPlayCount} play{readiness.draftPlayCount > 1 ? "s" : ""} en brouillon détecté
          {readiness.draftPlayCount > 1 ? "s" : ""} — relancez la génération ou activez-les dans l&apos;onglet Plays.
        </p>
      ) : null}
      {readiness?.blockingReason ? <p className="jv-banner jv-banner-warning">{readiness.blockingReason}</p> : null}

      {canEdit ? (
        <div className="jv-playbook-create">
          <button
            className={readiness?.canBootstrap ? "jv-btn-primary" : "jv-btn-primary is-disabled"}
            disabled={bootstrapping || busy || !readiness?.canBootstrap}
            onClick={onBootstrap}
            type="button"
          >
            <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
            {bootstrapLabel}
          </button>
          <p className="jv-theme-empty">
            {readiness?.canBootstrap
              ? "Cliquez pour lancer la génération (sync HubSpot de l'équipe incluse). Comptez 1 à 3 minutes — un indicateur de progression s'affichera."
              : readiness && readiness.wonDealCount < readiness.minDealCount
                ? "Cliquez sur Générer pour synchroniser les deals de l'équipe puis construire le playbook."
                : "La génération automatique n'est pas disponible dans l'état actuel du playbook."}
          </p>
          <div className="jv-playbook-create-manual">
            <input
              disabled={bootstrapping}
              maxLength={120}
              placeholder="Ou créez un playbook vide (ex : Playbook AE 2026)"
              value={newPlaybookName}
              onChange={(event) => onNameChange(event.target.value)}
            />
            <button className="jv-btn-ghost" disabled={bootstrapping || busy} onClick={onCreateManual} type="button">
              {busy ? (
                <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
              ) : (
                <Plus aria-hidden="true" size={14} strokeWidth={1.5} />
              )}
              {busy ? "Création…" : "Créer vide"}
            </button>
          </div>
        </div>
      ) : (
        <p className="jv-theme-empty">Aucun playbook publié pour le moment. Votre manager peut en générer un depuis les deals gagnés.</p>
      )}
    </aside>
  );
};

const PlayList = ({
  activePlayId,
  plays,
  onPlaySelect,
}: {
  activePlayId: string | null;
  plays: PlaybookPlay[];
  onPlaySelect: (playId: string) => void;
}) => (
  <section aria-label="Liste des plays" className="jv-list-shell">
    <header className="jv-list-head">
      <SectionLabel icon={History}>Plays</SectionLabel>
      <span className="jv-list-count">
        {plays.length} résultat{plays.length > 1 ? "s" : ""}
      </span>
    </header>
    <div className="jv-list-body">
      {plays.length === 0 ? (
        <p className="jv-list-empty">
          Aucun play pour l&apos;instant. Lancez la génération depuis vos deals gagnés ou ajoutez un play manuellement.
        </p>
      ) : null}
      {plays.map((play) => (
        <button
          className={activePlayId === play.id ? "jv-list-item selected" : "jv-list-item"}
          key={play.id}
          onClick={() => onPlaySelect(play.id)}
          type="button"
        >
          <span className="jv-list-main">
            <strong>{play.title}</strong>
            <small>{categoryLabels[play.category]}</small>
            <PlayMeta play={play} />
          </span>
          <span className="jv-list-side">
            {play.evidence.length > 0 ? <em>{play.evidence.length} preuve{play.evidence.length > 1 ? "s" : ""}</em> : null}
            <ChevronRight aria-hidden="true" size={14} strokeWidth={1.5} />
          </span>
        </button>
      ))}
    </div>
  </section>
);

const SuggestionList = ({
  activeSuggestionId,
  suggestions,
  onSuggestionSelect,
}: {
  activeSuggestionId: string | null;
  suggestions: PlaybookSuggestion[];
  onSuggestionSelect: (suggestionId: string) => void;
}) => (
  <section aria-label="Suggestions playbook" className="jv-list-shell">
    <header className="jv-list-head">
      <SectionLabel icon={Sparkles}>Suggestions</SectionLabel>
      <span className="jv-list-count">
        {suggestions.length} en attente
      </span>
    </header>
    <div className="jv-list-body">
      {suggestions.length === 0 ? (
        <p className="jv-list-empty">Aucune suggestion en attente. Lancez une génération depuis les analyses win/loss.</p>
      ) : null}
      {suggestions.map((suggestion) => (
        <button
          className={activeSuggestionId === suggestion.id ? "jv-list-item selected" : "jv-list-item"}
          key={suggestion.id}
          onClick={() => onSuggestionSelect(suggestion.id)}
          type="button"
        >
          <span className="jv-list-main">
            <strong>{suggestion.title}</strong>
            <small>{categoryLabels[suggestion.category]}</small>
            <span className="jv-item-meta">
              <span className="jv-meta-pending">À valider</span>
            </span>
          </span>
          <span className="jv-list-side">
            <em>{suggestion.evidence.length} preuve{suggestion.evidence.length > 1 ? "s" : ""}</em>
            <ChevronRight aria-hidden="true" size={14} strokeWidth={1.5} />
          </span>
        </button>
      ))}
    </div>
  </section>
);

const PlayDetail = ({
  busy,
  canEdit,
  creating,
  editing,
  play,
  onCancelEdit,
  onEdit,
  onStatusChange,
  onSubmitForm,
}: {
  busy: boolean;
  canEdit: boolean;
  creating: boolean;
  editing: boolean;
  play: PlaybookPlay | null;
  onCancelEdit: () => void;
  onEdit: () => void;
  onStatusChange: (status: PlaybookPlayStatus) => void;
  onSubmitForm: (form: PlayFormState) => void;
}) => {
  if (creating) {
    return (
      <aside className="jv-detail jv-detail-expanded">
        <header className="jv-detail-head">
          <div>
            <h2>Nouveau play</h2>
            <p>Ajoutez un déclencheur et une réponse recommandée à votre playbook.</p>
          </div>
        </header>
        <PlayForm busy={busy} initialValue={emptyPlayForm} onCancel={onCancelEdit} onSubmit={onSubmitForm} submitLabel="Ajouter le play" />
      </aside>
    );
  }

  if (editing && play) {
    return (
      <aside className="jv-detail jv-detail-expanded">
        <header className="jv-detail-head">
          <div>
            <h2>Modifier le play</h2>
            <p>{categoryLabels[play.category]}</p>
          </div>
        </header>
        <PlayForm
          busy={busy}
          initialValue={{
            category: play.category,
            title: play.title,
            triggerDescription: play.triggerDescription,
            recommendedResponse: play.recommendedResponse,
          }}
          onCancel={onCancelEdit}
          onSubmit={onSubmitForm}
          submitLabel="Enregistrer"
        />
      </aside>
    );
  }

  if (!play) {
    return (
      <aside className="jv-detail jv-detail-expanded">
        <div className="jv-detail-empty">
          <BookOpenCheck aria-hidden="true" size={20} strokeWidth={1.25} />
          <strong>Sélectionnez un play</strong>
          <p>Étapes du cycle, exécution recommandée et preuves issues de vos deals gagnés.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="jv-detail jv-detail-expanded">
      <header className="jv-detail-head">
        <div>
          <h2>{play.title}</h2>
          <p>{[categoryLabels[play.category], statusLabels[play.status], play.source === "ai_suggested" ? "Suggéré par Jarvis" : null].filter(Boolean).join(" · ")}</p>
        </div>
        {canEdit ? (
          <button className="jv-btn-ghost" disabled={busy} onClick={onEdit} type="button">
            Modifier
          </button>
        ) : null}
      </header>

      <DetailSection icon={Lightbulb} label="Quand appliquer">
        <p className="jv-prose">{play.triggerDescription}</p>
      </DetailSection>

      <DetailSection icon={AlignLeft} label="Comment exécuter">
        <p className="jv-prose">{play.recommendedResponse}</p>
      </DetailSection>

      {play.evidence.length > 0 ? (
        <DetailSection icon={History} label="Preuves">
          <p className="jv-prose">
            {play.evidence.length} preuve{play.evidence.length > 1 ? "s" : ""} rattachée{play.evidence.length > 1 ? "s" : ""} à ce play.
          </p>
        </DetailSection>
      ) : null}

      {canEdit ? (
        <div className="jv-playbook-detail-actions">
          {play.status !== "active" ? (
            <button className="jv-btn-ghost" disabled={busy} onClick={() => onStatusChange("active")} type="button">
              Activer
            </button>
          ) : null}
          {play.status !== "archived" ? (
            <button className="jv-btn-ghost" disabled={busy} onClick={() => onStatusChange("archived")} type="button">
              Archiver
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
};

const OverviewPanel = ({
  busy,
  canEdit,
  detail,
  onOpenPlay,
  onSynthesize,
  plays,
}: {
  busy: boolean;
  canEdit: boolean;
  detail: PlaybookDetail;
  onOpenPlay: (playId: string) => void;
  onSynthesize: () => void;
  plays: PlaybookPlay[];
}) => {
  const overview = detail.overview;
  const sourcePlays = plays.filter((play) => play.status !== "archived");
  const playById = new Map(plays.map((play) => [play.id, play]));

  if (sourcePlays.length < MIN_PLAYS_FOR_OVERVIEW) {
    return (
      <section aria-label="Vue globale du playbook" className="jv-playbook-overview jv-playbook-overview-empty">
        <div className="jv-detail-empty">
          <MapIcon aria-hidden="true" size={20} strokeWidth={1.25} />
          <strong>Vue globale pas encore disponible</strong>
          <p>
            Il faut au moins {MIN_PLAYS_FOR_OVERVIEW} plays pour construire le playbook global. Générez ou ajoutez des
            plays, puis lancez la synthèse.
          </p>
        </div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section aria-label="Vue globale du playbook" className="jv-playbook-overview jv-playbook-overview-empty">
        <div className="jv-detail-empty">
          <MapIcon aria-hidden="true" size={20} strokeWidth={1.25} />
          <strong>Construire le playbook global</strong>
          <p>
            Jarvis va relier vos plays en une doctrine, une séquence du cycle et des objectifs par étape — le référentiel
            lisible pour l&apos;équipe.
          </p>
        </div>
        {canEdit ? (
          <button className="jv-btn-primary" disabled={busy} onClick={onSynthesize} type="button">
            <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
            {busy ? "Synthèse en cours…" : "Synthétiser la vue globale"}
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-label="Vue globale du playbook" className="jv-playbook-overview">
      {detail.overviewIsStale ? (
        <p className="jv-banner jv-banner-warning">
          Le playbook global n&apos;est plus aligné avec les plays actuels. Mettez à jour la synthèse pour refléter les
          changements.
        </p>
      ) : null}

      <header className="jv-playbook-overview-head">
        <div>
          <h2>{detail.name}</h2>
          <p>
            Synthèse du {formatOverviewDate(overview.synthesizedAt)} · confiance {overview.confidence} ·{" "}
            {overview.sourceSnapshot.length} play{overview.sourceSnapshot.length > 1 ? "s" : ""} source
          </p>
        </div>
        {canEdit ? (
          <button className="jv-btn-ghost" disabled={busy} onClick={onSynthesize} type="button">
            {busy ? (
              <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
            ) : (
              <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
            )}
            {busy ? "Mise à jour…" : detail.overviewIsStale ? "Mettre à jour" : "Rafraîchir"}
          </button>
        ) : null}
      </header>

      <div className="jv-playbook-overview-grid">
        <article className="jv-playbook-overview-card">
          <SectionLabel icon={Lightbulb}>Doctrine</SectionLabel>
          <p className="jv-prose">{overview.doctrine}</p>
        </article>

        <article className="jv-playbook-overview-card">
          <SectionLabel icon={MapIcon}>Séquence type</SectionLabel>
          <ol className="jv-playbook-overview-sequence">
            {overview.idealSequence.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>

        <article className="jv-playbook-overview-card jv-playbook-overview-card-wide">
          <SectionLabel icon={Layers}>Étapes du cycle</SectionLabel>
          {overview.stages.length > 0 ? (
            <div className="jv-playbook-overview-stages">
              {overview.stages.map((stage) => (
                <div className="jv-playbook-overview-stage" key={`${stage.category}-${stage.objective}`}>
                  <header>
                    <strong>{categoryLabels[stage.category]}</strong>
                    <span>{stage.playIds.length} play{stage.playIds.length > 1 ? "s" : ""}</span>
                  </header>
                  <p className="jv-prose">
                    <em>Objectif</em> — {stage.objective}
                  </p>
                  <p className="jv-prose">
                    <em>Passage</em> — {stage.exitCriteria}
                  </p>
                  {stage.playIds.length > 0 ? (
                    <ul className="jv-playbook-overview-play-links">
                      {stage.playIds.map((playId) => {
                        const play = playById.get(playId);

                        if (!play) {
                          return null;
                        }

                        return (
                          <li key={playId}>
                            <button onClick={() => onOpenPlay(playId)} type="button">
                              {play.title}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="jv-theme-empty">Aucune étape structurée pour l&apos;instant.</p>
          )}
        </article>

        <article className="jv-playbook-overview-card">
          <SectionLabel icon={Sparkles}>Principes transverses</SectionLabel>
          {overview.principles.length > 0 ? (
            <ul className="jv-playbook-overview-list">
              {overview.principles.map((principle) => (
                <li key={principle}>{principle}</li>
              ))}
            </ul>
          ) : (
            <p className="jv-theme-empty">Aucun principe identifié.</p>
          )}
        </article>

        <article className="jv-playbook-overview-card">
          <SectionLabel icon={History}>Gaps</SectionLabel>
          {overview.gaps.length > 0 ? (
            <ul className="jv-playbook-overview-list jv-playbook-overview-gaps">
              {overview.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          ) : (
            <p className="jv-theme-empty">Aucun gap structurel détecté.</p>
          )}
        </article>
      </div>
    </section>
  );
};

const SuggestionDetail = ({
  busy,
  editing,
  suggestion,
  onAccept,
  onCancelEdit,
  onEdit,
  onReject,
}: {
  busy: boolean;
  editing: boolean;
  suggestion: PlaybookSuggestion | null;
  onAccept: (form: PlayFormState) => void;
  onCancelEdit: () => void;
  onEdit: () => void;
  onReject: () => void;
}) => {
  if (!suggestion) {
    return (
      <aside className="jv-detail jv-detail-expanded">
        <div className="jv-detail-empty">
          <Sparkles aria-hidden="true" size={20} strokeWidth={1.25} />
          <strong>Sélectionnez une suggestion</strong>
          <p>Jarvis transforme les patterns win/loss en plays candidats à valider.</p>
        </div>
      </aside>
    );
  }

  const initialValue: PlayFormState = {
    category: suggestion.category,
    title: suggestion.title,
    triggerDescription: suggestion.triggerDescription,
    recommendedResponse: suggestion.recommendedResponse,
  };

  if (editing) {
    return (
      <aside className="jv-detail jv-detail-expanded">
        <header className="jv-detail-head">
          <div>
            <h2>Éditer avant acceptation</h2>
            <p>{categoryLabels[suggestion.category]}</p>
          </div>
        </header>
        <PlayForm busy={busy} initialValue={initialValue} onCancel={onCancelEdit} onSubmit={onAccept} submitLabel="Accepter et publier" />
      </aside>
    );
  }

  return (
    <aside className="jv-detail jv-detail-expanded">
      <header className="jv-detail-head">
        <div>
          <h2>{suggestion.title}</h2>
          <p>{categoryLabels[suggestion.category]} · Suggestion Jarvis</p>
        </div>
      </header>

      <div className="jv-callout">
        <Sparkles aria-hidden="true" size={16} strokeWidth={1.5} />
        <div>
          <p>Suggestion générée depuis vos analyses win/loss.</p>
          <small>{suggestion.rationale}</small>
        </div>
      </div>

      <DetailSection icon={Lightbulb} label="Quand appliquer">
        <p className="jv-prose">{suggestion.triggerDescription}</p>
      </DetailSection>

      <DetailSection icon={AlignLeft} label="Comment exécuter">
        <p className="jv-prose">{suggestion.recommendedResponse}</p>
      </DetailSection>

      {suggestion.evidence.length > 0 ? (
        <DetailSection icon={History} label="Preuves">
          <SuggestionEvidenceList evidence={suggestion.evidence} />
        </DetailSection>
      ) : null}

      <div className="jv-playbook-detail-actions">
        <button className="jv-btn-primary" disabled={busy} onClick={() => onAccept(initialValue)} type="button">
          Accepter
        </button>
        <button className="jv-btn-ghost" disabled={busy} onClick={onEdit} type="button">
          Éditer
        </button>
        <button className="jv-btn-ghost" disabled={busy} onClick={onReject} type="button">
          Rejeter
        </button>
      </div>
    </aside>
  );
};

export const PlaybookView = ({ orgId, canEdit }: PlaybookViewProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [detail, setDetail] = useState<PlaybookDetail | null>(null);
  const [suggestions, setSuggestions] = useState<PlaybookSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [creatingPlay, setCreatingPlay] = useState(false);
  const [editingPlayId, setEditingPlayId] = useState<string | null>(null);
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(null);
  const [newPlaybookName, setNewPlaybookName] = useState("");
  const [activeSection, setActiveSection] = useState<PlaybookSection>("plays");
  const [selectedPlayId, setSelectedPlayId] = useState<string | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<PlaybookBootstrapReadiness | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapStartedAt, setBootstrapStartedAt] = useState<number | null>(null);
  const [bootstrapElapsedMs, setBootstrapElapsedMs] = useState(0);
  const [bootstrapProgress, setBootstrapProgress] = useState(0);

  const loadData = useCallback(
    async (forceRefresh = false) => {
      setError(null);

      try {
        const [list, nextReadiness] = await Promise.all([
          fetchPlaybooks(orgId, forceRefresh),
          fetchPlaybookBootstrapReadiness(orgId, forceRefresh),
        ]);

        setReadiness(nextReadiness);
        setPlaybooks(list);
        const active = list.find((playbook) => playbook.status === "active") ?? list[0] ?? null;

        if (!active) {
          setDetail(null);
          setSuggestions([]);
          return;
        }

        const [nextDetail, nextSuggestions] = await Promise.all([
          fetchPlaybookDetail(orgId, active.id, forceRefresh),
          canEdit ? fetchPlaybookSuggestions(orgId, active.id, forceRefresh) : Promise.resolve([]),
        ]);

        setDetail(nextDetail);
        setSuggestions(nextSuggestions);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Impossible de charger le playbook.");
      } finally {
        setLoading(false);
      }
    },
    [canEdit, orgId],
  );

  useEffect(() => {
    setLoading(true);
    void loadData(true);
  }, [loadData]);

  useEffect(() => {
    if (!bootstrapping || bootstrapStartedAt === null) {
      return;
    }

    const tick = (): void => {
      const elapsedMs = Date.now() - bootstrapStartedAt;
      setBootstrapElapsedMs(elapsedMs);
      setBootstrapProgress(estimateBootstrapProgress(elapsedMs));
    };

    tick();
    const intervalId = window.setInterval(tick, 500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [bootstrapStartedAt, bootstrapping]);

  const visiblePlays = useMemo(() => {
    const plays = detail?.plays ?? [];

    return plays
      .filter((play) => (canEdit && showArchived) || play.status !== "archived")
      .sort((left, right) => {
        const categoryDelta = PLAYBOOK_PLAY_CATEGORIES.indexOf(left.category) - PLAYBOOK_PLAY_CATEGORIES.indexOf(right.category);

        if (categoryDelta !== 0) {
          return categoryDelta;
        }

        return left.position - right.position;
      });
  }, [canEdit, detail, showArchived]);

  const pendingSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.status === "pending"),
    [suggestions],
  );

  const selectedPlay = visiblePlays.find((play) => play.id === selectedPlayId) ?? null;
  const selectedSuggestion = pendingSuggestions.find((suggestion) => suggestion.id === selectedSuggestionId) ?? null;

  const categoryCounts = useMemo(() => {
    const counts = new Map<PlaybookPlayCategory, number>();

    for (const play of detail?.plays ?? []) {
      if (play.status !== "active") {
        continue;
      }

      counts.set(play.category, (counts.get(play.category) ?? 0) + 1);
    }

    return counts;
  }, [detail]);

  const sourceCounts = useMemo(() => {
    const manual = (detail?.plays ?? []).filter((play) => play.status === "active" && play.source === "manual").length;
    const aiSuggested = (detail?.plays ?? []).filter((play) => play.status === "active" && play.source === "ai_suggested").length;

    return { manual, aiSuggested };
  }, [detail]);

  useEffect(() => {
    if (activeSection !== "plays") {
      return;
    }

    setSelectedPlayId((current) => {
      if (current && visiblePlays.some((play) => play.id === current)) {
        return current;
      }

      return visiblePlays[0]?.id ?? null;
    });
  }, [activeSection, visiblePlays]);

  useEffect(() => {
    if (activeSection !== "suggestions") {
      return;
    }

    setSelectedSuggestionId((current) => {
      if (current && pendingSuggestions.some((suggestion) => suggestion.id === current)) {
        return current;
      }

      return pendingSuggestions[0]?.id ?? null;
    });
  }, [activeSection, pendingSuggestions]);

  const runMutation = async (mutation: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await mutation();
      await loadData(true);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "L'opération a échoué.");
    } finally {
      setBusy(false);
    }
  };

  const handleSynthesizeOverview = () =>
    runMutation(async () => {
      if (!detail) {
        return;
      }

      await synthesizePlaybookOverview(orgId, detail.id);
      setActiveSection("overview");
    });

  const handleOpenPlayFromOverview = (playId: string): void => {
    setActiveSection("plays");
    setCreatingPlay(false);
    setEditingPlayId(null);
    setSelectedPlayId(playId);
  };

  const handleCreatePlaybook = () =>
    runMutation(async () => {
      await createPlaybook(orgId, newPlaybookName.trim() || "Playbook de vente");
      setNewPlaybookName("");
    });

  const handleBootstrapPlaybook = async (): Promise<void> => {
    if (bootstrapping) {
      return;
    }

    setBootstrapping(true);
    setBootstrapStartedAt(Date.now());
    setBootstrapElapsedMs(0);
    setBootstrapProgress(4);
    setError(null);

    try {
      await bootstrapPlaybookFromWonDeals(orgId, {
        dealCount: readiness?.recommendedDealCount ?? 10,
      });
      setBootstrapProgress(100);
      await loadData(true);
      setActiveSection("overview");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "La génération du playbook a échoué.");
    } finally {
      setBootstrapping(false);
      setBootstrapStartedAt(null);
      setBootstrapElapsedMs(0);
      setBootstrapProgress(0);
    }
  };

  const handleCreatePlay = (form: PlayFormState) =>
    runMutation(async () => {
      if (!detail) {
        return;
      }

      const input: PlaybookPlayInput = { ...form, status: "active" };

      await createPlaybookPlay(orgId, detail.id, input);
      setCreatingPlay(false);
    });

  const handleUpdatePlay = (play: PlaybookPlay, form: PlayFormState) =>
    runMutation(async () => {
      if (!detail) {
        return;
      }

      await updatePlaybookPlay(orgId, detail.id, play.id, form);
      setEditingPlayId(null);
    });

  const handlePlayStatusChange = (play: PlaybookPlay, status: PlaybookPlayStatus) =>
    runMutation(async () => {
      if (!detail) {
        return;
      }

      await updatePlaybookPlay(orgId, detail.id, play.id, { status });
    });

  const handleGenerateSuggestions = () =>
    runMutation(async () => {
      if (!detail) {
        return;
      }

      await generatePlaybookSuggestions(orgId, detail.id);
      setActiveSection("suggestions");
    });

  const handleAcceptSuggestion = (suggestion: PlaybookSuggestion, form: PlayFormState) =>
    runMutation(async () => {
      if (!detail) {
        return;
      }

      const input: PlaybookPlayInput = { ...form, status: "active" };

      await acceptPlaybookSuggestion(orgId, detail.id, suggestion.id, input);
      setEditingSuggestionId(null);
      setActiveSection("plays");
    });

  const handleRejectSuggestion = (suggestion: PlaybookSuggestion) =>
    runMutation(async () => {
      if (!detail) {
        return;
      }

      await rejectPlaybookSuggestion(orgId, detail.id, suggestion.id);
      setEditingSuggestionId(null);
    });

  const coveredCategories = categoryCounts.size;
  const playbookIsEmpty = readiness
    ? readiness.playCount === 0
    : detail
      ? detail.playCount === 0
      : playbooks.length === 0;
  const periodLabel = detail
    ? `${detail.activePlayCount} play${detail.activePlayCount > 1 ? "s" : ""} actif${detail.activePlayCount > 1 ? "s" : ""} sur ${detail.playCount}`
    : "Référentiel des meilleures pratiques de vente";

  const pageShell = (content: ReactNode): ReactNode => (
    <div className="jv-playbook-page" aria-busy={bootstrapping} aria-label="Playbook de vente">
      {bootstrapping ? <BootstrapProgressOverlay elapsedMs={bootstrapElapsedMs} progress={bootstrapProgress} /> : null}
      {content}
    </div>
  );

  if (loading) {
    return pageShell(
      <>
        <header className="jv-page-header">
          <BookOpenCheck aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
          <h1>Playbook</h1>
        </header>
        <LoadingState detail="Récupération du playbook et du nombre de deals gagnés." label="Chargement de la page" tone="panel" />
      </>,
    );
  }

  if (playbooks.length === 0) {
    return pageShell(
      <>
        <header className="jv-page-header">
          <BookOpenCheck aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
          <h1>
            Playbook
            <span className="jv-page-kicker">vente</span>
          </h1>
        </header>

        {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}

        <BootstrapPanel
          bootstrapping={bootstrapping}
          busy={busy}
          canEdit={canEdit}
          newPlaybookName={newPlaybookName}
          onBootstrap={() => void handleBootstrapPlaybook()}
          onCreateManual={() => void handleCreatePlaybook()}
          onNameChange={setNewPlaybookName}
          readiness={readiness}
        />
      </>,
    );
  }

  return pageShell(
    <>
      <header className="jv-page-header">
        <BookOpenCheck aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>Playbook</h1>
      </header>

      <div className="jv-toolbar">
        <div className="jv-toolbar-filters">
          <div className="jv-filter-pills" role="group" aria-label="Sections playbook">
            <button
              className={activeSection === "plays" ? "active" : ""}
              onClick={() => {
                setActiveSection("plays");
                setCreatingPlay(false);
                setEditingSuggestionId(null);
              }}
              type="button"
            >
              Plays
            </button>
            <button
              className={activeSection === "overview" ? "active" : ""}
              onClick={() => {
                setActiveSection("overview");
                setCreatingPlay(false);
                setEditingPlayId(null);
                setEditingSuggestionId(null);
              }}
              type="button"
            >
              Vue globale
              {detail?.overviewIsStale ? <em>!</em> : null}
            </button>
            {canEdit ? (
              <button
                className={activeSection === "suggestions" ? "active" : ""}
                onClick={() => {
                  setActiveSection("suggestions");
                  setCreatingPlay(false);
                  setEditingPlayId(null);
                }}
                type="button"
              >
                Suggestions
                {pendingSuggestions.length > 0 ? <em>{pendingSuggestions.length}</em> : null}
              </button>
            ) : null}
          </div>
          {canEdit ? (
            <label className="jv-playbook-toggle">
              <input checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} type="checkbox" />
              Voir les archives
            </label>
          ) : null}
        </div>
        <div className="jv-toolbar-actions">
          <span className="jv-toolbar-period">{periodLabel}</span>
          {canEdit && activeSection === "plays" && !creatingPlay ? (
            readiness?.canBootstrap && (playbookIsEmpty || readiness.replacesDrafts) ? (
              <button
                className="jv-btn-primary"
                disabled={bootstrapping || busy}
                onClick={() => void handleBootstrapPlaybook()}
                type="button"
              >
                <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
                {readiness.replacesDrafts ? "Relancer" : "Générer le playbook"}
              </button>
            ) : (
              <button
                className="jv-btn-primary"
                disabled={busy}
                onClick={() => {
                  setCreatingPlay(true);
                  setEditingPlayId(null);
                  setSelectedPlayId(null);
                }}
                type="button"
              >
                <Plus aria-hidden="true" size={14} strokeWidth={1.5} />
                Nouveau play
              </button>
            )
          ) : null}
          {canEdit && activeSection === "overview" && !playbookIsEmpty ? (
            <button className="jv-btn-primary" disabled={busy} onClick={() => void handleSynthesizeOverview()} type="button">
              {busy ? (
                <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
              ) : (
                <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
              )}
              {busy ? "Synthèse…" : detail?.overview ? "Mettre à jour" : "Synthétiser"}
            </button>
          ) : null}
          {canEdit && activeSection === "suggestions" ? (
            <button className="jv-btn-primary" disabled={busy} onClick={() => void handleGenerateSuggestions()} type="button">
              {busy ? (
                <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
              ) : (
                <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
              )}
              {busy ? "Génération…" : "Générer"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}

      {detail ? (
        <>
          {!playbookIsEmpty ? (
          <>
          <section aria-label="Indicateurs playbook" className="jv-stat-strip">
            <div className="jv-stat" style={{ animationDelay: "0ms" }}>
              <span className="jv-stat-label">Plays actifs</span>
              <span className="jv-stat-value">{detail.activePlayCount}</span>
              <small className="jv-stat-caption">publiés dans le playbook</small>
            </div>
            <div className="jv-stat" style={{ animationDelay: "60ms" }}>
              <span className="jv-stat-label">Total plays</span>
              <span className="jv-stat-value">{detail.playCount}</span>
              <small className="jv-stat-caption">incluant brouillons et archives</small>
            </div>
            <div className="jv-stat" style={{ animationDelay: "120ms" }}>
              <span className="jv-stat-label">Suggestions</span>
              <span className="jv-stat-value">{pendingSuggestions.length}</span>
              <small className="jv-stat-caption">en attente de validation</small>
            </div>
            <div className="jv-stat" style={{ animationDelay: "180ms" }}>
              <span className="jv-stat-label">Catégories</span>
              <span className="jv-stat-value">{coveredCategories}</span>
              <small className="jv-stat-caption">couvertes par au moins un play</small>
            </div>
          </section>

          <section aria-label="Répartition playbook" className="jv-themes-row">
            <div className="jv-theme-block">
              <SectionLabel icon={Layers}>Plays par catégorie</SectionLabel>
              {categoryCounts.size > 0 ? (
                <ul className="jv-theme-list">
                  {PLAYBOOK_PLAY_CATEGORIES.filter((category) => categoryCounts.has(category))
                    .slice(0, 5)
                    .map((category) => (
                      <li key={category}>
                        <span>{categoryLabels[category]}</span>
                        <em>{categoryCounts.get(category)}</em>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="jv-theme-empty">Aucun play actif pour l&apos;instant.</p>
              )}
            </div>
            <div className="jv-theme-block">
              <SectionLabel icon={Sparkles}>Sources des plays</SectionLabel>
              {detail.activePlayCount > 0 ? (
                <ul className="jv-theme-list">
                  <li>
                    <span>Créés manuellement</span>
                    <em>{sourceCounts.manual}</em>
                  </li>
                  <li>
                    <span>Suggérés par Jarvis</span>
                    <em>{sourceCounts.aiSuggested}</em>
                  </li>
                </ul>
              ) : (
                <p className="jv-theme-empty">Ajoutez des plays ou générez des suggestions depuis vos analyses.</p>
              )}
            </div>
          </section>
          </>
          ) : null}

          {playbookIsEmpty ? (
            <BootstrapPanel
              bootstrapping={bootstrapping}
              busy={busy}
              canEdit={canEdit}
              newPlaybookName={newPlaybookName}
              onBootstrap={() => void handleBootstrapPlaybook()}
              onCreateManual={() => void handleCreatePlaybook()}
              onNameChange={setNewPlaybookName}
              readiness={readiness}
            />
          ) : (
          <div className={activeSection === "overview" ? "jv-playbook-overview-shell" : "jv-workspace"}>
            {activeSection === "overview" ? (
              <OverviewPanel
                busy={busy}
                canEdit={canEdit}
                detail={detail}
                onOpenPlay={handleOpenPlayFromOverview}
                onSynthesize={() => void handleSynthesizeOverview()}
                plays={detail.plays}
              />
            ) : activeSection === "plays" ? (
              <>
                <PlayList activePlayId={selectedPlayId} onPlaySelect={setSelectedPlayId} plays={visiblePlays} />
                <PlayDetail
                  busy={busy}
                  canEdit={canEdit}
                  creating={creatingPlay}
                  editing={editingPlayId === selectedPlay?.id}
                  onCancelEdit={() => {
                    setCreatingPlay(false);
                    setEditingPlayId(null);
                  }}
                  onEdit={() => {
                    if (selectedPlay) {
                      setEditingPlayId(selectedPlay.id);
                      setCreatingPlay(false);
                    }
                  }}
                  onStatusChange={(status) => {
                    if (selectedPlay) {
                      void handlePlayStatusChange(selectedPlay, status);
                    }
                  }}
                  onSubmitForm={(form) => {
                    if (creatingPlay) {
                      void handleCreatePlay(form);
                      return;
                    }

                    if (selectedPlay) {
                      void handleUpdatePlay(selectedPlay, form);
                    }
                  }}
                  play={selectedPlay}
                />
              </>
            ) : activeSection === "suggestions" ? (
              <>
                <SuggestionList
                  activeSuggestionId={selectedSuggestionId}
                  onSuggestionSelect={setSelectedSuggestionId}
                  suggestions={pendingSuggestions}
                />
                <SuggestionDetail
                  busy={busy}
                  editing={editingSuggestionId === selectedSuggestion?.id}
                  onAccept={(form) => {
                    if (selectedSuggestion) {
                      void handleAcceptSuggestion(selectedSuggestion, form);
                    }
                  }}
                  onCancelEdit={() => setEditingSuggestionId(null)}
                  onEdit={() => {
                    if (selectedSuggestion) {
                      setEditingSuggestionId(selectedSuggestion.id);
                    }
                  }}
                  onReject={() => {
                    if (selectedSuggestion) {
                      void handleRejectSuggestion(selectedSuggestion);
                    }
                  }}
                  suggestion={selectedSuggestion}
                />
              </>
            ) : null}
          </div>
          )}
        </>
      ) : (
        <p className="jv-list-empty">Playbook indisponible.</p>
      )}
    </>,
  );
};