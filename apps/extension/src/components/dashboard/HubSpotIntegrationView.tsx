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
    <section className={variant === "embedded" ? "ae-hubspot-settings" : "ae-view-panel"} aria-label="Integration HubSpot">
      {variant === "page" ? (
        <div className="ae-view-title">
          <p className="ae-eyebrow">Integrations</p>
          <h2>HubSpot</h2>
        </div>
      ) : null}

      <div className="ae-integration-grid">
        <article className="ae-admin-panel ae-integration-card">
          <span>Connexion Jarvis / HubSpot</span>
          <strong className={`ae-integration-status ${integrationStatusClassName}`}>
            <span aria-hidden="true" />
            {integrationStatusLabel}
          </strong>
          <div className="ae-admin-actions">
            <button disabled={!onConnectHubSpot} onClick={onConnectHubSpot} type="button">
              {isConnected ? "Reconnecter" : "Connecter"}
            </button>
            <button disabled={!isConnected || !onSyncHubSpot || syncLoading || isRefreshing} onClick={onSyncHubSpot} type="button">
              {syncLoading ? "Sync..." : "Sync Supabase"}
            </button>
            <button disabled={!isConnected || disconnectLoading} onClick={onDisconnectHubSpot} type="button">
              {disconnectLoading ? "Deconnexion..." : "Deconnecter"}
            </button>
          </div>
          {syncJob ? (
            <div className="ae-sync-progress" aria-live="polite">
              <div className="ae-sync-progress-head">
                <span>{syncJob.currentStep}</span>
                <strong>{syncJob.progress}%</strong>
              </div>
              <div className="ae-sync-progress-track">
                <div style={{ width: `${syncJob.progress}%` }} />
              </div>
              <button className="ae-sync-log-toggle" onClick={() => setLogsOpen((current) => !current)} type="button">
                {logsOpen ? "Masquer les logs" : "Voir les logs"}
              </button>
              {logsOpen ? (
                <ol className="ae-sync-logs">
                  {visibleLogs.map((log) => (
                    <li className={`ae-sync-log ${log.level}`} key={`${log.at}-${log.message}`}>
                      <time>{formatDateTime(log.at)}</time>
                      <span>{log.message}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
        </article>

        <article className="ae-sync">
          <label htmlFor="hubspot-owner">HubSpot owner</label>
          <select
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

        <article className="ae-sync">
          <span>Portal</span>
          <strong>{hubspotPortalId ?? "--"}</strong>
        </article>
        <article className="ae-sync">
          <span>Prospects / deals</span>
          <strong>{hubspotDealCount ?? "--"}</strong>
        </article>
        <article className="ae-sync">
          <span>{isRefreshing ? "Loading owner" : "Last sync"}</span>
          <strong>{generatedAt ? formatDateTime(generatedAt) : "Pending"}</strong>
        </article>
      </div>
    </section>
  );
};
