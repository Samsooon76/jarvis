import { Check, Copy, KeyRound, Plug, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CreateOrganizationMcpKeyResult, McpSetupInfo, OrganizationMcpKey } from "@jarvis/shared";
import {
  createMcpKey,
  fetchMcpKeys,
  fetchMcpSetup,
  revokeMcpKey,
} from "../../services/api/mcp";

type McpSettingsViewProps = {
  orgId: string;
};

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return "Jamais";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
};

const buildClaudeConfig = (mcpHttpUrl: string, token: string): string =>
  JSON.stringify(
    {
      mcpServers: {
        jarvis: {
          url: mcpHttpUrl,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  );

export const McpSettingsView = ({ orgId }: McpSettingsViewProps) => {
  const [setup, setSetup] = useState<McpSetupInfo | null>(null);
  const [keys, setKeys] = useState<OrganizationMcpKey[]>([]);
  const [label, setLabel] = useState("Claude Desktop");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<CreateOrganizationMcpKeyResult | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<"token" | "config" | null>(null);

  const activeKeys = useMemo(() => keys.filter((key) => key.status === "active"), [keys]);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const [setupInfo, keyList] = await Promise.all([fetchMcpSetup(orgId), fetchMcpKeys(orgId)]);

        if (!isMounted) {
          return;
        }

        setSetup(setupInfo);
        setKeys(keyList);
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Impossible de charger les cles MCP.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [orgId]);

  const handleCopy = async (value: string, target: "token" | "config") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedTarget(target);
      window.setTimeout(() => setCopiedTarget(null), 2000);
    } catch {
      setError("Impossible de copier dans le presse-papiers.");
    }
  };

  const handleCreateKey = async () => {
    try {
      setCreating(true);
      setError(null);
      setMessage(null);
      const created = await createMcpKey(orgId, label);
      setCreatedKey(created);
      setKeys((current) => [created.key, ...current]);
      setMessage("Cle MCP creee. Copie-la maintenant: elle ne sera plus affichee.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Impossible de creer la cle MCP.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    try {
      setRevokingKeyId(keyId);
      setError(null);
      setMessage(null);
      await revokeMcpKey(orgId, keyId);
      setKeys((current) =>
        current.map((key) =>
          key.id === keyId
            ? {
                ...key,
                status: "revoked",
                revokedAt: new Date().toISOString(),
              }
            : key,
        ),
      );
      setMessage("Cle MCP revoquee.");
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Impossible de revoquer la cle MCP.");
    } finally {
      setRevokingKeyId(null);
    }
  };

  const claudeConfig =
    createdKey && setup ? buildClaudeConfig(setup.mcpHttpUrl, createdKey.token) : null;

  return (
    <section className="jv-settings-content" aria-label="Integration MCP Jarvis">
      <div className="jv-theme-block">
        <div className="jv-settings-heading">
          <h2>Copilot MCP</h2>
          <p>
            Connecte Claude Desktop, Cursor ou Grok a Jarvis. Chaque cle est liee automatiquement a ton organisation —
            aucun UUID a saisir cote client.
          </p>
        </div>

        {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}
        {message ? <p className="jv-banner jv-banner-success">{message}</p> : null}

        <section className="jv-detail-section">
          <span className="jv-section-label">
            <Plug aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
            Connexion
          </span>
          <div className="jv-mcp-meta-grid">
            <div>
              <small>URL MCP</small>
              <strong>{setup?.mcpHttpUrl ?? (loading ? "Chargement..." : "—")}</strong>
            </div>
            <div>
              <small>Organisation</small>
              <strong>{orgId}</strong>
            </div>
            <div>
              <small>Cles actives</small>
              <strong>{activeKeys.length}</strong>
            </div>
          </div>
        </section>

        <section className="jv-detail-section">
          <span className="jv-section-label">
            <KeyRound aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
            Nouvelle cle
          </span>
          <div className="jv-mcp-create-row">
            <div className="jv-settings-field">
              <label htmlFor="mcp-key-label">Nom de la cle</label>
              <input
                id="mcp-key-label"
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Claude Desktop"
                type="text"
                value={label}
              />
            </div>
            <button className="jv-btn-primary" disabled={creating || loading} onClick={() => void handleCreateKey()} type="button">
              {creating ? "Generation..." : "Generer une cle"}
            </button>
          </div>
        </section>

        {createdKey && claudeConfig ? (
          <section className="jv-detail-section jv-mcp-reveal">
            <strong>Cle generee (visible une seule fois)</strong>
            <code className="jv-mcp-token">{createdKey.token}</code>
            <div className="jv-settings-actions">
              <button
                className="jv-btn-ghost"
                onClick={() => void handleCopy(createdKey.token, "token")}
                type="button"
              >
                {copiedTarget === "token" ? <Check size={14} /> : <Copy size={14} />}
                Copier la cle
              </button>
              <button
                className="jv-btn-ghost"
                onClick={() => void handleCopy(claudeConfig, "config")}
                type="button"
              >
                {copiedTarget === "config" ? <Check size={14} /> : <Copy size={14} />}
                Copier config Claude
              </button>
            </div>
            <pre className="jv-mcp-config-preview">{claudeConfig}</pre>
          </section>
        ) : null}

        <section className="jv-detail-section">
          <span className="jv-section-label">Cles existantes</span>
          {loading ? (
            <p className="jv-list-empty">Chargement des cles MCP...</p>
          ) : keys.length === 0 ? (
            <p className="jv-list-empty">Aucune cle MCP pour le moment.</p>
          ) : (
            <div className="jv-mcp-key-list">
              {keys.map((key) => (
                <article className={`jv-mcp-key-card${key.status === "revoked" ? " is-revoked" : ""}`} key={key.id}>
                  <div>
                    <strong>{key.label}</strong>
                    <small>
                      {key.tokenPrefix} · Creee le {formatDateTime(key.createdAt)} · Derniere utilisation{" "}
                      {formatDateTime(key.lastUsedAt)}
                    </small>
                  </div>
                  <div className="jv-mcp-key-actions">
                    <span className={key.status === "active" ? "jv-mcp-pill is-active" : "jv-mcp-pill"}>
                      {key.status === "active" ? "Active" : "Revoquee"}
                    </span>
                    {key.status === "active" ? (
                      <button
                        className="jv-btn-ghost is-danger"
                        disabled={revokingKeyId === key.id}
                        onClick={() => void handleRevoke(key.id)}
                        type="button"
                      >
                        <Trash2 size={14} />
                        {revokingKeyId === key.id ? "..." : "Revoquer"}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="jv-callout">
          <Plug aria-hidden="true" size={16} strokeWidth={1.5} />
          <div>
            <p>Instructions client</p>
            <small>
              1. Generer une cle ici · 2. Coller le JSON dans Claude Desktop (`claude_desktop_config.json`) · 3.
              Redemarrer Claude. La cle identifie automatiquement l&apos;organisation Jarvis.
            </small>
          </div>
        </div>
      </div>
    </section>
  );
};