import { Info, Settings, Sparkles, Target, Users, type LucideIcon } from "lucide-react";
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
import "../styles/settings.css";
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

const settingsTabs: Array<{ id: SettingsTab; label: string; requiresPulse?: boolean }> = [
  { id: "hubspot", label: "HubSpot" },
  { id: "ai", label: "IA" },
  { id: "targets", label: "Objectifs" },
  { id: "pulse", label: "Pulse", requiresPulse: true },
  { id: "team", label: "Equipe", requiresPulse: true },
];

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

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

  const visibleTabs = useMemo(
    () => settingsTabs.filter((tab) => !tab.requiresPulse || canManagePulse),
    [canManagePulse],
  );

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

      setUsers((prev) => prev.map((user) => (user.id === userId ? { ...user, role: newRole } : user)));
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
    <div className="jv-settings-page" aria-label="Parametres">
      <header className="jv-page-header">
        <Settings aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>Parametres</h1>
      </header>

      <div className="jv-toolbar">
        <div className="jv-toolbar-filters">
          <div className="jv-filter-pills" role="tablist" aria-label="Sections des parametres">
            {visibleTabs.map((tab) => (
              <button
                aria-selected={activeSettingsTab === tab.id}
                className={activeSettingsTab === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setActiveSettingsTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
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
        <div className="jv-settings-content">
          <section className="jv-theme-block" aria-label="Provider IA">
            <div className="jv-settings-heading">
              <h2>Provider IA</h2>
              <p>Choisissez le modele utilise pour les analyses, resumes et coaching.</p>
            </div>

            <section className="jv-detail-section">
              <SectionLabel icon={Sparkles}>Modeles disponibles</SectionLabel>
              <div className="jv-provider-grid">
                {aiProviderOptions.map((provider) => (
                  <label className="jv-provider-option" key={provider.id}>
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
                        Documentation
                      </a>
                    ) : null}
                  </label>
                ))}
              </div>
            </section>

            <div className="jv-callout">
              <Info aria-hidden="true" size={16} strokeWidth={1.5} />
              <div>
                <p>
                  Provider actif : {selectedProvider.label} · {selectedProvider.model}
                </p>
                <small>
                  Le choix est stocke pour l'organisation et utilise aussi par les analyses lancees automatiquement apres
                  webhook HubSpot. Les cles API restent cote backend et ne sont jamais envoyees a l'extension.
                </small>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activeSettingsTab === "targets" ? (
        <section className="jv-theme-block" aria-label="Objectifs forecast mensuels">
          <div className="jv-settings-heading-row">
            <div className="jv-settings-heading">
              <h2>Objectifs mensuels par personne</h2>
              <p>Ces montants alimentent la ligne Objectif et le gap dans le forecast.</p>
            </div>
            <div className="jv-settings-field">
              <label htmlFor="target-year">Annee</label>
              <input
                id="target-year"
                max="2100"
                min="2020"
                onChange={(event) => setTargetYear(Number(event.target.value))}
                type="number"
                value={targetYear}
              />
            </div>
          </div>

          {targetsError ? <p className="jv-banner jv-banner-error">{targetsError}</p> : null}
          {targetsMessage ? <p className="jv-banner jv-banner-success">{targetsMessage}</p> : null}

          <section className="jv-detail-section">
            <SectionLabel icon={Target}>Grille mensuelle</SectionLabel>
            {forecastOwners.length === 0 ? (
              <p className="jv-list-empty">
                {targetsLoading ? "Chargement des owners HubSpot..." : "Aucun owner HubSpot disponible."}
              </p>
            ) : (
              <div className="jv-settings-table-shell">
                <div className="jv-settings-table-scroll">
                  <div className="jv-target-table" role="table" aria-label="Objectifs mensuels par commercial">
                    <div className="jv-target-table-row header" role="row">
                      <span>Personne</span>
                      {monthLabels.map((month) => (
                        <span key={month.id}>{month.label}</span>
                      ))}
                    </div>
                    {forecastOwners.map((owner) => (
                      <div className="jv-target-table-row" key={owner.ownerId} role="row">
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
                </div>
              </div>
            )}
          </section>

          <div className="jv-settings-footer">
            <span>Total annuel saisi : {formatAmount(totalObjective)}</span>
            <button
              className="jv-btn-primary"
              disabled={targetsSaving || targetsLoading || forecastOwners.length === 0}
              onClick={() => void handleSaveTargets()}
              type="button"
            >
              {targetsSaving ? "Enregistrement..." : "Enregistrer les objectifs"}
            </button>
          </div>
        </section>
      ) : null}

      {activeSettingsTab === "pulse" && canManagePulse ? <PulseSettingsView /> : null}

      {activeSettingsTab === "team" && canManagePulse ? (
        <section className="jv-theme-block" aria-label="Gestion de l'equipe">
          <div className="jv-settings-heading">
            <h2>Gestion de l'equipe</h2>
            <p>Visualisez les membres de votre organisation et gerez leurs roles dans Jarvis.</p>
          </div>

          {usersError ? <p className="jv-banner jv-banner-error">{usersError}</p> : null}
          {successMessage ? <p className="jv-banner jv-banner-success">{successMessage}</p> : null}

          <section className="jv-detail-section">
            <SectionLabel icon={Users}>Membres</SectionLabel>
            {usersLoading && users.length === 0 ? (
              <p className="jv-list-empty">Chargement des membres de l'equipe...</p>
            ) : users.length === 0 ? (
              <p className="jv-list-empty">Aucun utilisateur trouve.</p>
            ) : (
              <div className="jv-team-table">
                <table>
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th>Email</th>
                      <th>Date d'inscription</th>
                      <th className="jv-team-role-col">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <strong>{user.name}</strong>
                        </td>
                        <td>{user.email}</td>
                        <td>
                          {user.createdAt
                            ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" }).format(new Date(user.createdAt))
                            : "—"}
                        </td>
                        <td>
                          <select
                            className="jv-select"
                            disabled={updatingUserId === user.id}
                            onChange={(event) => void handleRoleChange(user.id, event.target.value as AppUserRole)}
                            value={user.role}
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
          </section>
        </section>
      ) : null}
    </div>
  );
};