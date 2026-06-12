import { useCallback, useEffect, useMemo, useState } from "react";
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
import { LoadingState } from "../LoadingState";

const categoryLabels: Record<PlaybookPlayCategory, string> = {
  qualification: "Qualification",
  discovery: "Discovery",
  demo: "Demo",
  objection_handling: "Gestion d'objections",
  negotiation: "Negociation",
  closing: "Closing",
  follow_up: "Follow-up",
};

const statusLabels: Record<PlaybookPlayStatus, string> = {
  draft: "Brouillon",
  active: "Actif",
  archived: "Archive",
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
      className="playbook-form"
      onSubmit={(event) => {
        event.preventDefault();

        if (canSubmit && !busy) {
          onSubmit(form);
        }
      }}
    >
      <label>
        Categorie
        <select
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
          placeholder="Ex: Cartographier le comite d'achat"
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
      </label>
      <label>
        Declencheur — quand appliquer ce play ?
        <textarea
          maxLength={600}
          placeholder="Ex: Le prospect mentionne un concurrent pendant la demo."
          rows={2}
          value={form.triggerDescription}
          onChange={(event) => setForm({ ...form, triggerDescription: event.target.value })}
        />
      </label>
      <label>
        Reponse recommandee
        <textarea
          maxLength={4000}
          placeholder="Ce que le commercial doit faire ou dire, et pourquoi ca marche."
          rows={4}
          value={form.recommendedResponse}
          onChange={(event) => setForm({ ...form, recommendedResponse: event.target.value })}
        />
      </label>
      <div className="playbook-form-actions">
        <button className="playbook-button-secondary" disabled={busy} onClick={onCancel} type="button">
          Annuler
        </button>
        <button className="playbook-button-primary" disabled={!canSubmit || busy} type="submit">
          {busy ? "Enregistrement..." : submitLabel}
        </button>
      </div>
    </form>
  );
};

const PlayCard = ({
  play,
  canEdit,
  busy,
  onEdit,
  onStatusChange,
}: {
  play: PlaybookPlay;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onStatusChange: (status: PlaybookPlayStatus) => void;
}) => (
  <article className={`playbook-play playbook-play-${play.status}`}>
    <header>
      <strong>{play.title}</strong>
      <div className="playbook-play-meta">
        {play.source === "ai_suggested" ? <span className="playbook-badge playbook-badge-ai">Suggere par Jarvis</span> : null}
        <span className={`playbook-badge playbook-badge-${play.status}`}>{statusLabels[play.status]}</span>
        {play.version > 1 ? <span className="playbook-badge">v{play.version}</span> : null}
      </div>
    </header>
    <p className="playbook-play-trigger">
      <em>Quand :</em> {play.triggerDescription}
    </p>
    <p className="playbook-play-response">{play.recommendedResponse}</p>
    {play.evidence.length > 0 ? (
      <p className="playbook-play-evidence">
        {play.evidence.length} preuve{play.evidence.length > 1 ? "s" : ""} rattachee{play.evidence.length > 1 ? "s" : ""}
      </p>
    ) : null}
    {canEdit ? (
      <footer className="playbook-play-actions">
        <button className="playbook-button-secondary" disabled={busy} onClick={onEdit} type="button">
          Modifier
        </button>
        {play.status !== "active" ? (
          <button className="playbook-button-secondary" disabled={busy} onClick={() => onStatusChange("active")} type="button">
            Activer
          </button>
        ) : null}
        {play.status !== "archived" ? (
          <button className="playbook-button-secondary" disabled={busy} onClick={() => onStatusChange("archived")} type="button">
            Archiver
          </button>
        ) : null}
      </footer>
    ) : null}
  </article>
);

const SuggestionEvidenceList = ({ evidence }: { evidence: PlaybookSuggestion["evidence"] }) => {
  if (evidence.length === 0) {
    return null;
  }

  return (
    <div className="playbook-suggestion-evidence">
      <strong>Preuves</strong>
      <ul>
        {evidence.map((item, index) => (
          <li key={`${item.sourceId ?? item.title}-${index}`}>
            <span>{item.title}</span>
            {item.quote ? <q>{item.quote}</q> : null}
          </li>
        ))}
      </ul>
    </div>
  );
};

const SuggestionCard = ({
  suggestion,
  busy,
  editing,
  onAccept,
  onCancelEdit,
  onEdit,
  onReject,
}: {
  suggestion: PlaybookSuggestion;
  busy: boolean;
  editing: boolean;
  onAccept: (form: PlayFormState) => void;
  onCancelEdit: () => void;
  onEdit: () => void;
  onReject: () => void;
}) => {
  const initialValue: PlayFormState = {
    category: suggestion.category,
    title: suggestion.title,
    triggerDescription: suggestion.triggerDescription,
    recommendedResponse: suggestion.recommendedResponse,
  };

  if (editing) {
    return (
      <article className="playbook-suggestion-card">
        <header>
          <strong>Editer avant acceptation</strong>
          <span className="playbook-badge playbook-badge-ai">Suggestion Jarvis</span>
        </header>
        <PlayForm
          busy={busy}
          initialValue={initialValue}
          onCancel={onCancelEdit}
          onSubmit={onAccept}
          submitLabel="Accepter et publier"
        />
      </article>
    );
  }

  return (
    <article className="playbook-suggestion-card">
      <header>
        <div>
          <strong>{suggestion.title}</strong>
          <small>{categoryLabels[suggestion.category]}</small>
        </div>
        <span className="playbook-badge playbook-badge-ai">Pending</span>
      </header>
      <p className="playbook-play-trigger">
        <em>Quand :</em> {suggestion.triggerDescription}
      </p>
      <p className="playbook-play-response">{suggestion.recommendedResponse}</p>
      <p className="playbook-suggestion-rationale">{suggestion.rationale}</p>
      <SuggestionEvidenceList evidence={suggestion.evidence} />
      <footer className="playbook-play-actions">
        <button className="playbook-button-primary" disabled={busy} onClick={() => onAccept(initialValue)} type="button">
          Accepter
        </button>
        <button className="playbook-button-secondary" disabled={busy} onClick={onEdit} type="button">
          Editer
        </button>
        <button className="playbook-button-secondary" disabled={busy} onClick={onReject} type="button">
          Rejeter
        </button>
      </footer>
    </article>
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

  const playsByCategory = useMemo(() => {
    const groups = new Map<PlaybookPlayCategory, PlaybookPlay[]>();

    for (const play of detail?.plays ?? []) {
      if ((!canEdit || !showArchived) && play.status === "archived") {
        continue;
      }

      const group = groups.get(play.category);

      if (group) {
        group.push(play);
      } else {
        groups.set(play.category, [play]);
      }
    }

    return groups;
  }, [canEdit, detail, showArchived]);

  const runMutation = async (mutation: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await mutation();
      await loadData(true);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "L'operation a echoue.");
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

  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");

  if (loading) {
    return (
      <section className="ae-view-panel" aria-busy="true">
        <LoadingState detail="Chargement du playbook de vente." label="Chargement du playbook" />
      </section>
    );
  }

  if (playbooks.length === 0) {
    return (
      <section className="ae-view-panel playbook-view">
        {error ? <p className="playbook-error">{error}</p> : null}
        {canEdit ? (
          <div className="playbook-empty">
            <h3>Creez le playbook de votre equipe</h3>
            <p>
              Le playbook capitalise vos meilleures pratiques de vente: declencheurs, reponses recommandees et preuves
              tirees de vos deals.
            </p>
            <div className="playbook-create-row">
              <input
                maxLength={120}
                placeholder="Nom du playbook (ex: Playbook AE 2026)"
                value={newPlaybookName}
                onChange={(event) => setNewPlaybookName(event.target.value)}
              />
              <button className="playbook-button-primary" disabled={busy} onClick={() => void handleCreatePlaybook()} type="button">
                {busy ? "Creation..." : "Creer le playbook"}
              </button>
            </div>
          </div>
        ) : (
          <p className="ae-empty">Aucun playbook publie pour le moment. Votre manager peut en creer un.</p>
        )}
      </section>
    );
  }

  return (
    <section className="ae-view-panel playbook-view">
      {error ? <p className="playbook-error">{error}</p> : null}

      {detail ? (
        <>
          <header className="playbook-header">
            <div>
              <h3>{detail.name}</h3>
              {detail.description ? <p>{detail.description}</p> : null}
              <small>
                {detail.activePlayCount} play{detail.activePlayCount > 1 ? "s" : ""} actif
                {detail.activePlayCount > 1 ? "s" : ""} sur {detail.playCount}
              </small>
            </div>
            <div className="playbook-header-actions">
              {canEdit ? (
                <label className="playbook-toggle">
                  <input checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} type="checkbox" />
                  Voir les archives
                </label>
              ) : null}
              {canEdit && !creatingPlay ? (
                <button className="playbook-button-primary" disabled={busy} onClick={() => setCreatingPlay(true)} type="button">
                  Nouveau play
                </button>
              ) : null}
            </div>
          </header>

          <nav className="playbook-tabs" aria-label="Sections playbook">
            <button
              className={activeSection === "plays" ? "active" : ""}
              onClick={() => setActiveSection("plays")}
              type="button"
            >
              Plays
            </button>
            {canEdit ? (
              <button
                className={activeSection === "suggestions" ? "active" : ""}
                onClick={() => setActiveSection("suggestions")}
                type="button"
              >
                Suggestions
                {pendingSuggestions.length > 0 ? <span>{pendingSuggestions.length}</span> : null}
              </button>
            ) : null}
          </nav>

          {activeSection === "suggestions" && canEdit ? (
            <section className="playbook-suggestions">
              <div className="playbook-suggestions-head">
                <div>
                  <h4>Suggestions depuis les analyses win/loss</h4>
                  <p>
                    Jarvis transforme les patterns repetes en plays candidats. Verifiez les preuves avant publication.
                  </p>
                </div>
                <button className="playbook-button-primary" disabled={busy} onClick={() => void handleGenerateSuggestions()} type="button">
                  {busy ? "Generation..." : "Generer"}
                </button>
              </div>

              {pendingSuggestions.length === 0 ? (
                <p className="ae-empty">Aucune suggestion pending. Lancez une generation depuis les analyses win/loss.</p>
              ) : (
                <div className="playbook-suggestion-grid">
                  {pendingSuggestions.map((suggestion) => (
                    <SuggestionCard
                      busy={busy}
                      editing={editingSuggestionId === suggestion.id}
                      key={suggestion.id}
                      onAccept={(form) => void handleAcceptSuggestion(suggestion, form)}
                      onCancelEdit={() => setEditingSuggestionId(null)}
                      onEdit={() => setEditingSuggestionId(suggestion.id)}
                      onReject={() => void handleRejectSuggestion(suggestion)}
                      suggestion={suggestion}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeSection === "plays" && creatingPlay ? (
            <PlayForm
              busy={busy}
              initialValue={emptyPlayForm}
              onCancel={() => setCreatingPlay(false)}
              onSubmit={(form) => void handleCreatePlay(form)}
              submitLabel="Ajouter le play"
            />
          ) : null}

          {activeSection === "plays" && playsByCategory.size === 0 && !creatingPlay ? (
            <p className="ae-empty">
              {canEdit
                ? "Aucun play pour l'instant. Ajoutez votre premier play ou generez-en depuis vos analyses win/loss."
                : "Le playbook ne contient pas encore de play."}
            </p>
          ) : null}

          {activeSection === "plays" ? PLAYBOOK_PLAY_CATEGORIES.map((category) => {
            const plays = playsByCategory.get(category);

            if (!plays || plays.length === 0) {
              return null;
            }

            return (
              <div className="playbook-category" key={category}>
                <h4>{categoryLabels[category]}</h4>
                <div className="playbook-play-grid">
                  {plays.map((play) =>
                    editingPlayId === play.id ? (
                      <PlayForm
                        busy={busy}
                        initialValue={{
                          category: play.category,
                          title: play.title,
                          triggerDescription: play.triggerDescription,
                          recommendedResponse: play.recommendedResponse,
                        }}
                        key={play.id}
                        onCancel={() => setEditingPlayId(null)}
                        onSubmit={(form) => void handleUpdatePlay(play, form)}
                        submitLabel="Enregistrer"
                      />
                    ) : (
                      <PlayCard
                        busy={busy}
                        canEdit={canEdit}
                        key={play.id}
                        onEdit={() => setEditingPlayId(play.id)}
                        onStatusChange={(status) => void handlePlayStatusChange(play, status)}
                        play={play}
                      />
                    ),
                  )}
                </div>
              </div>
            );
          }) : null}
        </>
      ) : (
        <p className="ae-empty">Playbook indisponible.</p>
      )}
    </section>
  );
};
