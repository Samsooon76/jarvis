import { useEffect, useState } from "react";
import {
  fetchPulsePreferences,
  savePulsePreferences,
  type PulseEventType,
  type PulsePreferences,
} from "../../services/api";

const pulseEventOptions: Array<{ id: PulseEventType; label: string; description: string }> = [
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

export const PulseSettingsView = () => {
  const [preferences, setPreferences] = useState<PulsePreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    setMessage(null);
    setError(null);

    try {
      setIsSaving(true);
      await savePulsePreferences(next);
      setMessage("Preferences Jarvis Pulse enregistrees.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Impossible d'enregistrer les preferences Pulse.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <p className="ae-empty">Chargement des preferences Jarvis Pulse...</p>;
  }

  if (!preferences) {
    return <p className="ae-admin-feedback error">{error ?? "Preferences Jarvis Pulse indisponibles."}</p>;
  }

  return (
    <section className="pulse-settings" aria-label="Preferences Jarvis Pulse">
      <div className="ae-settings-section-heading">
        <div>
          <h3>Jarvis Pulse</h3>
          <p>
            Notifications quasi temps reel quand un deal HubSpot change. Choisissez les types de changements que vous
            voulez recevoir (dashboard + notification Chrome).
          </p>
        </div>
      </div>

      {error ? <p className="ae-admin-feedback error">{error}</p> : null}
      {message ? <p className="ae-admin-feedback">{message}</p> : null}

      <label className="pulse-settings-toggle pulse-settings-master">
        <input
          checked={preferences.pulseEnabled}
          disabled={isSaving}
          onChange={(event) => void persist({ ...preferences, pulseEnabled: event.target.checked })}
          type="checkbox"
        />
        <span>
          <strong>Activer Jarvis Pulse</strong>
          <small>Interrupteur global: desactive toutes les notifications d'un coup.</small>
        </span>
      </label>

      <div className="pulse-settings-grid">
        {pulseEventOptions.map((option) => (
          <label className="pulse-settings-toggle" key={option.id}>
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
  );
};
