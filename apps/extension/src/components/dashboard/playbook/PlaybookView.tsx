import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlignLeft,
  BookOpenCheck,
  ChevronRight,
  History,
  Layers,
  Lightbulb,
  Plus,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type {
  Playbook,
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
  createPlaybook,
  createPlaybookPlay,
  fetchPlaybookDetail,
  fetchPlaybooks,
  fetchPlaybookSuggestions,
  generatePlaybookSuggestions,
  rejectPlaybookSuggestion,
  updatePlaybookPlay,
} from "../../../services/api";
import "../../styles/playbook.css";

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

type PlaybookSection = "plays" | "suggestions";

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
        Déclencheur — quand appliquer ce play ?
        <textarea
          maxLength={600}
          placeholder="Ex : Le prospect mentionne un concurrent pendant la démo."
          rows={2}
          value={form.triggerDescription}
          onChange={(event) => setForm({ ...form, triggerDescription: event.target.value })}
        />
      </label>
      <label>
        Réponse recommandée
        <textarea
          maxLength={4000}
          placeholder="Ce que le commercial doit faire ou dire, et pourquoi ça marche."
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
        <p className="jv-list-empty">Aucun play pour l&apos;instant. Ajoutez votre premier play ou générez-en depuis vos analyses win/loss.</p>
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
      <aside className="jv-detail">
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
      <aside className="jv-detail">
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
      <aside className="jv-detail">
        <div className="jv-detail-empty">
          <BookOpenCheck aria-hidden="true" size={20} strokeWidth={1.25} />
          <strong>Sélectionnez un play</strong>
          <p>Déclencheurs, réponses recommandées et preuves issues de vos deals.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="jv-detail">
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

      <DetailSection icon={Lightbulb} label="Déclencheur">
        <p className="jv-prose">{play.triggerDescription}</p>
      </DetailSection>

      <DetailSection icon={AlignLeft} label="Réponse recommandée">
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
      <aside className="jv-detail">
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
      <aside className="jv-detail">
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
    <aside className="jv-detail">
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

      <DetailSection icon={Lightbulb} label="Déclencheur">
        <p className="jv-prose">{suggestion.triggerDescription}</p>
      </DetailSection>

      <DetailSection icon={AlignLeft} label="Réponse recommandée">
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

  const loadData = useCallback(
    async (forceRefresh = false) => {
      setError(null);

      try {
        const list = await fetchPlaybooks(orgId, forceRefresh);

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
    void loadData();
  }, [loadData]);

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

  const handleCreatePlaybook = () =>
    runMutation(async () => {
      await createPlaybook(orgId, newPlaybookName.trim() || "Playbook de vente");
      setNewPlaybookName("");
    });

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
  const periodLabel = detail
    ? `${detail.activePlayCount} play${detail.activePlayCount > 1 ? "s" : ""} actif${detail.activePlayCount > 1 ? "s" : ""} sur ${detail.playCount}`
    : "Référentiel des meilleures pratiques de vente";

  if (loading) {
    return (
      <div className="jv-playbook-page" aria-busy="true" aria-label="Playbook de vente">
        <header className="jv-page-header">
          <BookOpenCheck aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
          <h1>Playbook</h1>
        </header>
        <p className="jv-list-empty">Chargement du playbook…</p>
      </div>
    );
  }

  if (playbooks.length === 0) {
    return (
      <div className="jv-playbook-page" aria-label="Playbook de vente">
        <header className="jv-page-header">
          <BookOpenCheck aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
          <h1>
            Playbook
            <span className="jv-page-kicker">vente</span>
          </h1>
        </header>

        {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}

        <aside className="jv-detail jv-playbook-empty-panel">
          <div className="jv-detail-empty">
            <BookOpenCheck aria-hidden="true" size={20} strokeWidth={1.25} />
            <strong>Créez le playbook de votre équipe</strong>
            <p>Capitalisez vos meilleures pratiques : déclencheurs, réponses recommandées et preuves issues de vos deals.</p>
          </div>

          {canEdit ? (
            <div className="jv-playbook-create">
              <input
                maxLength={120}
                placeholder="Nom du playbook (ex : Playbook AE 2026)"
                value={newPlaybookName}
                onChange={(event) => setNewPlaybookName(event.target.value)}
              />
              <button className="jv-btn-primary" disabled={busy} onClick={() => void handleCreatePlaybook()} type="button">
                {busy ? (
                  <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
                ) : (
                  <Plus aria-hidden="true" size={14} strokeWidth={1.5} />
                )}
                {busy ? "Création…" : "Créer le playbook"}
              </button>
            </div>
          ) : (
            <p className="jv-theme-empty">Aucun playbook publié pour le moment. Votre manager peut en créer un.</p>
          )}
        </aside>
      </div>
    );
  }

  return (
    <div className="jv-playbook-page" aria-label="Playbook de vente">
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

          <div className="jv-workspace">
            {activeSection === "plays" ? (
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
            ) : (
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
            )}
          </div>
        </>
      ) : (
        <p className="jv-list-empty">Playbook indisponible.</p>
      )}
    </div>
  );
};