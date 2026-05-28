import { useState } from "react";
import { ArrowRight, CheckCircle2, DatabaseZap, PlugZap, RefreshCw, ShieldCheck } from "lucide-react";
import type { HubSpotSyncJobStatus, HubSpotSyncResult } from "../../services/api";
import { formatDateTime } from "../../utils/dashboard/formatters";

type FirstRunOnboardingProps = {
  canManageHubSpot: boolean;
  generatedAt?: string;
  hubspotPortalId?: string | null;
  isConnected: boolean;
  onConnectHubSpot?: () => void;
  onSignOut: () => void;
  onSyncHubSpot?: (onProgress?: (status: HubSpotSyncJobStatus) => void) => Promise<HubSpotSyncResult>;
  prospectCount: number;
};

const getStepClassName = (isDone: boolean, isCurrent: boolean): string => {
  if (isDone) {
    return "done";
  }

  return isCurrent ? "current" : "waiting";
};

export const FirstRunOnboarding = ({
  canManageHubSpot,
  generatedAt,
  hubspotPortalId,
  isConnected,
  onConnectHubSpot,
  onSignOut,
  onSyncHubSpot,
  prospectCount,
}: FirstRunOnboardingProps) => {
  const [syncJob, setSyncJob] = useState<HubSpotSyncJobStatus | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<HubSpotSyncResult | null>(null);
  const hasSynced = Boolean(generatedAt || syncResult);
  const progress = syncJob?.progress ?? (hasSynced ? 100 : isConnected ? 42 : 8);
  const visibleLogs = syncJob?.logs.slice(-5) ?? [];

  const handleSyncHubSpot = async () => {
    if (!onSyncHubSpot || syncLoading) {
      return;
    }

    try {
      setSyncLoading(true);
      setSyncError(null);
      setSyncResult(null);
      const result = await onSyncHubSpot(setSyncJob);
      setSyncResult(result);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Synchronisation HubSpot impossible.");
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <main className="ae-first-run">
      <section className="ae-first-run-main" aria-labelledby="jarvis-first-run-title">
        <div className="ae-first-run-copy">
          <span className="ae-eyebrow">Premier demarrage</span>
          <h1 id="jarvis-first-run-title">Connecte HubSpot puis synchronise Supabase.</h1>
          <p>
            Jarvis a besoin d'une connexion CRM et d'une premiere sync avant d'ouvrir la queue commerciale.
          </p>
        </div>

        <div className="ae-first-run-actions">
          {canManageHubSpot ? (
            <>
              <button disabled={!onConnectHubSpot || syncLoading} onClick={onConnectHubSpot} type="button">
                <PlugZap size={18} />
                {isConnected ? "Reconnecter HubSpot" : "Connecter HubSpot"}
              </button>
              <button disabled={!isConnected || !onSyncHubSpot || syncLoading} onClick={handleSyncHubSpot} type="button">
                {syncLoading ? <RefreshCw className="ae-spin" size={18} /> : <DatabaseZap size={18} />}
                {syncLoading ? "Sync en cours" : "Synchroniser Supabase"}
              </button>
            </>
          ) : (
            <button onClick={onSignOut} type="button">
              Changer de compte
              <ArrowRight size={18} />
            </button>
          )}
        </div>

        {!canManageHubSpot ? (
          <div className="ae-first-run-note" role="status">
            <ShieldCheck size={18} />
            <span>Un admin doit connecter HubSpot avant que ce compte puisse charger sa queue.</span>
          </div>
        ) : null}

        {syncError ? <div className="ae-first-run-error">{syncError}</div> : null}

        <div className="ae-first-run-progress" aria-label={`Progression onboarding ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>

        <ol className="ae-first-run-steps">
          <li className={getStepClassName(isConnected, !isConnected)}>
            <span>{isConnected ? <CheckCircle2 size={18} /> : <PlugZap size={18} />}</span>
            <div>
              <strong>Integration HubSpot</strong>
              <small>{hubspotPortalId ? `Portal ${hubspotPortalId}` : "OAuth HubSpot requis"}</small>
            </div>
          </li>
          <li className={getStepClassName(hasSynced, isConnected && !hasSynced)}>
            <span>{hasSynced ? <CheckCircle2 size={18} /> : <DatabaseZap size={18} />}</span>
            <div>
              <strong>Sync Supabase</strong>
              <small>
                {generatedAt
                  ? `Derniere sync ${formatDateTime(generatedAt)}`
                  : syncJob?.currentStep ?? "Contacts, deals, leads et owners"}
              </small>
            </div>
          </li>
          <li className={getStepClassName(hasSynced && prospectCount > 0, hasSynced && prospectCount === 0)}>
            <span>{hasSynced && prospectCount > 0 ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}</span>
            <div>
              <strong>Queue Jarvis</strong>
              <small>{prospectCount > 0 ? `${prospectCount} prospect(s) prets` : "En attente de data HubSpot"}</small>
            </div>
          </li>
        </ol>

        {visibleLogs.length > 0 ? (
          <ol className="ae-first-run-logs" aria-label="Logs de synchronisation">
            {visibleLogs.map((log) => (
              <li className={log.level} key={`${log.at}-${log.message}`}>
                <time>{formatDateTime(log.at)}</time>
                <span>{log.message}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </main>
  );
};
