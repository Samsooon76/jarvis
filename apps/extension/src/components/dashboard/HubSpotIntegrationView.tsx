import { Plug, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { HubSpotOwnerOption, HubSpotSyncJobStatus } from "../../services/api";
import { formatDateTime } from "../../utils/dashboard/formatters";

type HubSpotIntegrationViewProps = {
  disconnectLoading: boolean;
  generatedAt?: string;
  hubspotDealCount?: number | null;
  hubspotPortalId?: string | null;
  integrationStatusClassName: string;
  integrationStatusLabel: string;
  isConnected: boolean;
  isRefreshing: boolean;
  onConnectHubSpot?: () => void;
  onDisconnectHubSpot: () => void;
  onOwnerChange?: (ownerId: string) => void;
  onSyncHubSpot: () => void;
  owners: HubSpotOwnerOption[];
  ownerName?: string;
  selectedOwnerId?: string;
  syncJob?: HubSpotSyncJobStatus | null;
  syncLoading: boolean;
  variant?: "page" | "embedded";
};

const SectionLabel = ({ children }: { children: string }) => (
  <span className="jv-section-label">
    <Plug aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

export const HubSpotIntegrationView = ({
  disconnectLoading,
  generatedAt,
  hubspotDealCount,
  hubspotPortalId,
  integrationStatusClassName,
  integrationStatusLabel,
  isConnected,
  isRefreshing,
  onConnectHubSpot,
  onDisconnectHubSpot,
  onOwnerChange,
  onSyncHubSpot,
  owners,
  ownerName,
  selectedOwnerId,
  syncJob,
  syncLoading,
  variant = "page",
}: HubSpotIntegrationViewProps) => {
  const [logsOpen, setLogsOpen] = useState(false);
  const visibleLogs = syncJob?.logs.slice(-8) ?? [];

  return (
    <section
      className={variant === "embedded" ? "jv-settings-content" : "ae-view-panel"}
      aria-label="Integration HubSpot"
    >
      {variant === "page" ? (
        <div className="ae-view-title">
          <p className="ae-eyebrow">Integrations</p>
          <h2>HubSpot</h2>
        </div>
      ) : null}

      <div className="jv-hubspot-grid">
        <article className="jv-theme-block jv-hubspot-connect">
          <SectionLabel>Connexion Jarvis / HubSpot</SectionLabel>
          <strong className={`jv-integration-status ${integrationStatusClassName}`}>
            <span aria-hidden="true" />
            {integrationStatusLabel}
          </strong>
          <div className="jv-settings-actions">
            <button className="jv-btn-primary" disabled={!onConnectHubSpot} onClick={onConnectHubSpot} type="button">
              {isConnected ? "Reconnecter" : "Connecter"}
            </button>
            <button
              className="jv-btn-ghost"
              disabled={!isConnected || !onSyncHubSpot || syncLoading || isRefreshing}
              onClick={onSyncHubSpot}
              type="button"
            >
              {syncLoading ? (
                <>
                  <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
                  Sync...
                </>
              ) : (
                "Sync Supabase"
              )}
            </button>
            <button
              className="jv-btn-ghost is-danger"
              disabled={!isConnected || disconnectLoading}
              onClick={onDisconnectHubSpot}
              type="button"
            >
              {disconnectLoading ? "Deconnexion..." : "Deconnecter"}
            </button>
          </div>
          {syncJob ? (
            <div className="jv-sync-progress" aria-live="polite">
              <div className="jv-sync-progress-head">
                <span>{syncJob.currentStep}</span>
                <strong>{syncJob.progress}%</strong>
              </div>
              <div className="jv-sync-progress-track">
                <div style={{ width: `${syncJob.progress}%` }} />
              </div>
              <button className="jv-sync-log-toggle" onClick={() => setLogsOpen((current) => !current)} type="button">
                {logsOpen ? "Masquer les logs" : "Voir les logs"}
              </button>
              {logsOpen ? (
                <ol className="jv-sync-logs">
                  {visibleLogs.map((log) => (
                    <li className={`jv-sync-log ${log.level}`} key={`${log.at}-${log.message}`}>
                      <time>{formatDateTime(log.at)}</time>
                      <span>{log.message}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
        </article>

        <article className="jv-settings-stat">
          <span>HubSpot owner</span>
          <select
            className="jv-select"
            disabled={owners.length === 0}
            id="hubspot-owner"
            onChange={(event) => onOwnerChange?.(event.target.value)}
            value={selectedOwnerId ?? ""}
          >
            {owners.length === 0 ? <option value="">{ownerName ?? "Auto"}</option> : null}
            {owners.map((owner) => (
              <option key={owner.ownerId} value={owner.ownerId}>
                {[owner.name, owner.teamName].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </article>

        <article className="jv-settings-stat">
          <span>Portal</span>
          <strong>{hubspotPortalId ?? "—"}</strong>
        </article>
        <article className="jv-settings-stat">
          <span>Prospects / deals</span>
          <strong>{hubspotDealCount ?? "—"}</strong>
        </article>
        <article className="jv-settings-stat">
          <span>{isRefreshing ? "Chargement owner" : "Derniere sync"}</span>
          <strong>{generatedAt ? formatDateTime(generatedAt) : "En attente"}</strong>
        </article>
      </div>
    </section>
  );
};