import { useEffect, useMemo, useState } from "react";
import {
  aiProviderOptions,
  fetchMonthlySalesTargets,
  saveMonthlySalesTargets,
  fetchOrgUsers,
  updateOrgUserRole,
  type AiProviderId,
  type AiProviderOption,
  type HubSpotOwnerOption,
  type HubSpotSyncJobStatus,
  type MonthlySalesTargetInput,
  type OrgUser,
  type AppUserRole,
} from "../../services/api";
import { formatAmount } from "../../utils/dashboard/formatters";
import { HubSpotIntegrationView } from "./HubSpotIntegrationView";
import { PulseSettingsView } from "./PulseSettingsView";

type SettingsTab = "hubspot" | "ai" | "targets" | "pulse" | "team";

type HubSpotSettingsProps = {
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
  ownerName?: string;
  selectedOwnerId?: string;
  syncJob?: HubSpotSyncJobStatus | null;
  syncLoading: boolean;
};

type SettingsViewProps = {
  canManagePulse?: boolean;
  hubSpot: HubSpotSettingsProps;
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedProvider: AiProviderOption;
  selectedProviderId: AiProviderId;
  onProviderChange: (providerId: AiProviderId) => void;
};

const getCurrentYear = (): number => new Date().getFullYear();

const monthLabels = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1).padStart(2, "0"),
  label: new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(new Date(Date.UTC(2026, index, 1))),
}));

const getTargetKey = (hubspotOwnerId: string, targetMonth: string): string => `${hubspotOwnerId}:${targetMonth}`;

export const SettingsView = ({
  canManagePulse = false,
  hubSpot,
  orgId,
  owners,
  selectedProvider,
  selectedProviderId,
  onProviderChange,
}: SettingsViewProps) => {
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("hubspot");
  const [targetYear, setTargetYear] = useState(getCurrentYear);
  const [targetAmounts, setTargetAmounts] = useState<Record<string, string>>({});
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsSaving, setTargetsSaving] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [targetsMessage, setTargetsMessage] = useState<string | null>(null);

  const [users, setUsers] = useState<OrgUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (activeSettingsTab !== "team") {
      return;
    }

    let isMounted = true;
    const loadUsers = async () => {
      try {
        setUsersLoading(true);
        setUsersError(null);
        setSuccessMessage(null);
        const data = await fetchOrgUsers();
        if (isMounted) {
          setUsers(data);
        }
      } catch (err) {
        if (isMounted) {
          setUsersError(err instanceof Error ? err.message : "Erreur lors du chargement des utilisateurs.");
        }
      } finally {
        if (isMounted) {
          setUsersLoading(false);
        }
      }
    };

    void loadUsers();

    return () => {
      isMounted = false;
    };
  }, [activeSettingsTab]);

  const handleRoleChange = async (userId: string, newRole: AppUserRole) => {
    try {
      setUpdatingUserId(userId);
      setUsersError(null);
      setSuccessMessage(null);
      
      await updateOrgUserRole(userId, newRole);
      
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
      setSuccessMessage("Role mis a jour avec succes.");
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Erreur lors de la mise a jour du role.");
    } finally {
      setUpdatingUserId(null);
    }
  };

  const forecastOwners = useMemo(
    () => owners.filter((owner) => owner.ownerId.trim()).sort((left, right) => left.name.localeCompare(right.name)),
    [owners],
  );
  const totalObjective = useMemo(
    () =>
      Object.values(targetAmounts).reduce((sum, value) => {
        const parsed = Number(value);

        return Number.isFinite(parsed) ? sum + parsed : sum;
      }, 0),
    [targetAmounts],
  );

  useEffect(() => {
    let isMounted = true;

    const loadTargets = async () => {
      try {
        setTargetsLoading(true);
        setTargetsError(null);
        setTargetsMessage(null);
        const targets = await fetchMonthlySalesTargets(orgId, targetYear);
        const nextAmounts = targets.reduce<Record<string, string>>((amountsByKey, target) => {
          amountsByKey[getTargetKey(target.hubspotOwnerId, target.targetMonth)] = String(Math.round(target.objectiveAmount));

          return amountsByKey;
        }, {});

        if (isMounted) {
          setTargetAmounts(nextAmounts);
        }
      } catch (error) {
        if (isMounted) {
          setTargetsError(error instanceof Error ? error.message : "Erreur inconnue pendant le chargement des objectifs.");
        }
      } finally {
        if (isMounted) {
          setTargetsLoading(false);
        }
      }
    };

    void loadTargets();

    return () => {
      isMounted = false;
    };
  }, [orgId, targetYear]);

  const setAmount = (hubspotOwnerId: string, targetMonth: string, value: string) => {
    setTargetAmounts((currentAmounts) => ({
      ...currentAmounts,
      [getTargetKey(hubspotOwnerId, targetMonth)]: value,
    }));
  };

  const handleSaveTargets = async () => {
    const targets: MonthlySalesTargetInput[] = forecastOwners.flatMap((owner) =>
      monthLabels.map((month) => {
        const targetMonth = `${targetYear}-${month.id}-01`;
        const rawAmount = targetAmounts[getTargetKey(owner.ownerId, targetMonth)] ?? "";
        const objectiveAmount = Math.max(0, Number(rawAmount) || 0);

        return {
          hubspotOwnerId: owner.ownerId,
          ownerName: owner.name,
          targetMonth,
          objectiveAmount,
        };
      }),
    );

    try {
      setTargetsSaving(true);
      setTargetsError(null);
      setTargetsMessage(null);
      const savedTargets = await saveMonthlySalesTargets(orgId, targets);
      const nextAmounts = savedTargets.reduce<Record<string, string>>((amountsByKey, target) => {
        amountsByKey[getTargetKey(target.hubspotOwnerId, target.targetMonth)] = String(Math.round(target.objectiveAmount));

        return amountsByKey;
      }, {});

      setTargetAmounts(nextAmounts);
      setTargetsMessage("Objectifs forecast enregistres.");
    } catch (error) {
      setTargetsError(error instanceof Error ? error.message : "Erreur inconnue pendant l'enregistrement des objectifs.");
    } finally {
      setTargetsSaving(false);
    }
  };

  return (
    <section className="ae-view-panel" aria-label="Parametres Jarvis">
      <div className="ae-view-title">
        <h2>Parametres</h2>
        <p>Integrations, provider IA et objectifs mensuels utilises dans le forecast.</p>
      </div>

      <div className="ae-settings-tabs" role="tablist" aria-label="Sections des parametres">
        <button
          aria-selected={activeSettingsTab === "hubspot"}
          className={activeSettingsTab === "hubspot" ? "active" : ""}
          onClick={() => setActiveSettingsTab("hubspot")}
          role="tab"
          type="button"
        >
          HubSpot
        </button>
        <button
          aria-selected={activeSettingsTab === "ai"}
          className={activeSettingsTab === "ai" ? "active" : ""}
          onClick={() => setActiveSettingsTab("ai")}
          role="tab"
          type="button"
        >
          IA
        </button>
        <button
          aria-selected={activeSettingsTab === "targets"}
          className={activeSettingsTab === "targets" ? "active" : ""}
          onClick={() => setActiveSettingsTab("targets")}
          role="tab"
          type="button"
        >
          Objectifs
        </button>
        {canManagePulse ? (
          <button
            aria-selected={activeSettingsTab === "pulse"}
            className={activeSettingsTab === "pulse" ? "active" : ""}
            onClick={() => setActiveSettingsTab("pulse")}
            role="tab"
            type="button"
          >
            Pulse
          </button>
        ) : null}
        {canManagePulse ? (
          <button
            aria-selected={activeSettingsTab === "team"}
            className={activeSettingsTab === "team" ? "active" : ""}
            onClick={() => setActiveSettingsTab("team")}
            role="tab"
            type="button"
          >
            Equipe
          </button>
        ) : null}
      </div>

      {activeSettingsTab === "hubspot" ? (
        <HubSpotIntegrationView
          disconnectLoading={hubSpot.disconnectLoading}
          generatedAt={hubSpot.generatedAt}
          hubspotDealCount={hubSpot.hubspotDealCount}
          hubspotPortalId={hubSpot.hubspotPortalId}
          integrationStatusClassName={hubSpot.integrationStatusClassName}
          integrationStatusLabel={hubSpot.integrationStatusLabel}
          isConnected={hubSpot.isConnected}
          isRefreshing={hubSpot.isRefreshing}
          onConnectHubSpot={hubSpot.onConnectHubSpot}
          onDisconnectHubSpot={hubSpot.onDisconnectHubSpot}
          onOwnerChange={hubSpot.onOwnerChange}
          onSyncHubSpot={hubSpot.onSyncHubSpot}
          owners={owners}
          ownerName={hubSpot.ownerName}
          selectedOwnerId={hubSpot.selectedOwnerId}
          syncJob={hubSpot.syncJob}
          syncLoading={hubSpot.syncLoading}
          variant="embedded"
        />
      ) : null}

      {activeSettingsTab === "ai" ? (
        <>
          <div className="ae-settings-grid">
            {aiProviderOptions.map((provider) => (
              <label className="ae-provider-option" key={provider.id}>
                <input
                  checked={selectedProviderId === provider.id}
                  name="ai-provider"
                  onChange={() => onProviderChange(provider.id)}
                  type="radio"
                />
                <span>
                  <strong>{provider.label}</strong>
                  <small>{provider.model}</small>
                </span>
                <p>{provider.description}</p>
                <small>Backend: {provider.requiredEnv}</small>
                {provider.docsUrl ? (
                  <a href={provider.docsUrl} rel="noreferrer" target="_blank">
                    Docs
                  </a>
                ) : null}
              </label>
            ))}
          </div>

          <div className="ae-settings-note">
            <strong>Provider actif</strong>
            <span>
              {selectedProvider.label} · {selectedProvider.model}
            </span>
            <p>
              Le choix est stocke pour l'organisation et utilise aussi par les analyses lancees automatiquement apres
              webhook HubSpot. Les cles API restent cote backend et ne sont jamais envoyees a l'extension.
            </p>
          </div>
        </>
      ) : null}

      {activeSettingsTab === "targets" ? (
        <section className="ae-target-settings compact" aria-label="Objectifs forecast mensuels">
        <div className="ae-settings-section-heading">
          <div>
            <h3>Objectifs mensuels par personne</h3>
            <p>Ces montants alimentent la ligne Objectif et le gap dans le forecast.</p>
          </div>
          <label>
            Annee
            <input
              max="2100"
              min="2020"
              onChange={(event) => setTargetYear(Number(event.target.value))}
              type="number"
              value={targetYear}
            />
          </label>
        </div>

        {targetsError ? <p className="ae-admin-feedback error">{targetsError}</p> : null}
        {targetsMessage ? <p className="ae-admin-feedback">{targetsMessage}</p> : null}

        <div className="ae-target-table" role="table" aria-label="Objectifs mensuels par commercial">
          <div className="ae-target-table-row header" role="row">
            <span>Personne</span>
            {monthLabels.map((month) => (
              <span key={month.id}>{month.label}</span>
            ))}
          </div>
          {forecastOwners.map((owner) => (
            <div className="ae-target-table-row" key={owner.ownerId} role="row">
              <strong>{owner.name}</strong>
              {monthLabels.map((month) => {
                const targetMonth = `${targetYear}-${month.id}-01`;
                const key = getTargetKey(owner.ownerId, targetMonth);

                return (
                  <input
                    aria-label={`Objectif ${owner.name} ${month.label} ${targetYear}`}
                    inputMode="numeric"
                    key={month.id}
                    min="0"
                    onChange={(event) => setAmount(owner.ownerId, targetMonth, event.target.value)}
                    placeholder="0"
                    type="number"
                    value={targetAmounts[key] ?? ""}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {forecastOwners.length === 0 ? (
          <p className="ae-empty">{targetsLoading ? "Chargement des owners HubSpot..." : "Aucun owner HubSpot disponible."}</p>
        ) : null}

        <div className="ae-target-actions">
          <span>Total annuel saisi : {formatAmount(totalObjective)}</span>
          <button disabled={targetsSaving || targetsLoading || forecastOwners.length === 0} onClick={() => void handleSaveTargets()} type="button">
            {targetsSaving ? "Enregistrement..." : "Enregistrer les objectifs"}
          </button>
        </div>
        </section>
      ) : null}

      {activeSettingsTab === "pulse" && canManagePulse ? <PulseSettingsView /> : null}

      {activeSettingsTab === "team" && canManagePulse ? (
        <section className="ae-target-settings compact" aria-label="Gestion de l'equipe">
          <div className="ae-settings-section-heading">
            <div>
              <h3>Gestion de l'equipe</h3>
              <p>Visualisez les membres de votre organisation et gerez leurs roles dans Jarvis.</p>
            </div>
          </div>

          {usersError ? <p className="ae-admin-feedback error">{usersError}</p> : null}
          {successMessage ? <p className="ae-admin-feedback success">{successMessage}</p> : null}

          {usersLoading && users.length === 0 ? (
            <p className="ae-empty">Chargement des membres de l'equipe...</p>
          ) : (
            <div className="ae-team-table-wrapper" style={{ marginTop: "14px", border: "1px solid #e4e8e1", borderRadius: "8px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", color: "#17201b", fontSize: "13px" }}>
                <thead>
                  <tr style={{ background: "#fbfcfa", borderBottom: "1px solid #e4e8e1", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px", fontWeight: "600" }}>Nom</th>
                    <th style={{ padding: "10px 14px", fontWeight: "600" }}>Email</th>
                    <th style={{ padding: "10px 14px", fontWeight: "600" }}>Date d'inscription</th>
                    <th style={{ padding: "10px 14px", fontWeight: "600", width: "180px" }}>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} style={{ borderBottom: "1px solid #e4e8e1" }}>
                      <td style={{ padding: "10px 14px" }}>
                        <strong>{user.name}</strong>
                      </td>
                      <td style={{ padding: "10px 14px", color: "#647068" }}>{user.email}</td>
                      <td style={{ padding: "10px 14px", color: "#647068" }}>
                        {user.createdAt ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" }).format(new Date(user.createdAt)) : "-"}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <select
                          value={user.role}
                          disabled={updatingUserId === user.id}
                          onChange={(e) => void handleRoleChange(user.id, e.target.value as AppUserRole)}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "6px",
                            border: "1px solid #d7ddd5",
                            background: "#fbfcfa",
                            color: "#17201b",
                            font: "inherit",
                            width: "100%",
                            cursor: "pointer"
                          }}
                        >
                          <option value="sales">Commercial (sales)</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Administrateur</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {users.length === 0 && !usersLoading ? (
            <p className="ae-empty">Aucun utilisateur trouve.</p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
};
