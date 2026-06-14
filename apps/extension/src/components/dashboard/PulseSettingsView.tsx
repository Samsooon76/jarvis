import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import {
  fetchPulsePreferences,
  savePulsePreferences,
  type PulseEventType,
  type PulsePreferences,
} from "../../services/api";
import { LoadingState } from "./LoadingState";

const pulseEventOptions: Array<{ id: PulseEventType; label: string; description: string }> = [
  {
    id: "deal_created",
    label: "Nouveau deal",
    description: "Un nouveau deal entre dans le pipeline HubSpot.",
  },
  {
    id: "probability",
    label: "Probabilite de closing",
    description: "Un deal gagne ou perd des % de closing.",
  },
  {
    id: "amount",
    label: "Montant du deal",
    description: "La valeur d'un deal change.",
  },
  {
    id: "stage",
    label: "Stage",
    description: "Un deal avance ou recule dans le pipeline (incl. gagne / perdu).",
  },
  {
    id: "close_date",
    label: "Date de closing",
    description: "La date de signature prevue est decalee.",
  },
  {
    id: "owner",
    label: "Owner",
    description: "Un deal change de commercial.",
  },
  {
    id: "pipeline",
    label: "Pipeline",
    description: "Un deal est deplace vers un autre pipeline.",
  },
];

const SectionLabel = ({ children }: { children: string }) => (
  <span className="jv-section-label">
    <Bell aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

export const PulseSettingsView = () => {
  const [preferences, setPreferences] = useState<PulsePreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();

    fetchPulsePreferences({ signal: abortController.signal })
      .then((loaded) => {
        if (isMounted) {
          setPreferences(loaded);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted && !(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError(loadError instanceof Error ? loadError.message : "Impossible de charger les preferences Pulse.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, []);

  const persist = async (next: PulsePreferences): Promise<void> => {
    setPreferences(next);
    setError(null);

    try {
      setIsSaving(true);
      await savePulsePreferences(next);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Impossible d'enregistrer les preferences Pulse.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <LoadingState detail="On recupere vos reglages de notifications." label="Chargement des preferences Pulse" />;
  }

  if (!preferences) {
    return <p className="jv-banner jv-banner-error">{error ?? "Preferences Jarvis Pulse indisponibles."}</p>;
  }

  return (
    <section className="jv-theme-block" aria-label="Preferences Jarvis Pulse">
      <div className="jv-settings-heading">
        <h2>Jarvis Pulse</h2>
        <p>
          Notifications quasi temps reel quand un deal HubSpot change. Choisissez les types de changements que vous
          voulez recevoir (dashboard + notification Chrome).
        </p>
      </div>

      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}

      <section className="jv-detail-section">
        <SectionLabel>Interrupteur global</SectionLabel>
        <label className="jv-pulse-settings-toggle is-master">
          <input
            checked={preferences.pulseEnabled}
            disabled={isSaving}
            onChange={(event) => void persist({ ...preferences, pulseEnabled: event.target.checked })}
            type="checkbox"
          />
          <span>
            <strong>Activer Jarvis Pulse</strong>
            <small>Desactive toutes les notifications d'un coup.</small>
          </span>
        </label>
      </section>

      <section className="jv-detail-section">
        <SectionLabel>Types de changements</SectionLabel>
        <div className="jv-pulse-settings-grid">
          {pulseEventOptions.map((option) => (
            <label className="jv-pulse-settings-toggle" key={option.id}>
              <input
                checked={preferences.events[option.id]}
                disabled={isSaving || !preferences.pulseEnabled}
                onChange={(event) =>
                  void persist({
                    ...preferences,
                    events: { ...preferences.events, [option.id]: event.target.checked },
                  })
                }
                type="checkbox"
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </section>
    </section>
  );
};