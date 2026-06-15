import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ListFilter,
  Mail,
  Phone,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  fetchHubSpotLeadAccounts,
  type HubSpotLeadAccountItem,
  type HubSpotLeadContactListItem,
  type HubSpotOwnerOption,
} from "../../services/api";
import { formatDate } from "../../utils/dashboard/formatters";
import { getInitials } from "../../utils/dashboard/prospects";
import "../styles/leads.css";

type LeadsViewProps = {
  hubspotPortalId?: string | null;
  onOwnerChange?: (ownerId: string) => void;
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedOwnerId?: string;
};

type PhaseFilterOption = {
  id: string;
  label: string;
};

type ViewMode = "accounts" | "contacts";

type RankedContact = HubSpotLeadContactListItem & {
  account: HubSpotLeadAccountItem;
};

const accountsByOwnerCache = new Map<string, HubSpotLeadAccountItem[]>();

const getAccountsCacheKey = (orgId: string, hubspotOwnerId: string): string => `${orgId}:${hubspotOwnerId}`;

const formatHubSpotValue = (value: string): string =>
  value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const getLeadStatusLabel = (account: HubSpotLeadAccountItem): string =>
  account.lead.phaseLabel
    ? account.lead.phaseLabel
    : account.lead.phaseId
      ? formatHubSpotValue(account.lead.phaseId)
      : account.lead.leadStatus
        ? formatHubSpotValue(account.lead.leadStatus)
        : account.lead.lifecycleStage
          ? formatHubSpotValue(account.lead.lifecycleStage)
          : "Non renseigne";

const getLeadPhaseKey = (account: HubSpotLeadAccountItem): string =>
  account.lead.phaseId?.trim() ||
  account.lead.phaseLabel?.trim() ||
  account.lead.leadStatus?.trim() ||
  account.lead.lifecycleStage?.trim() ||
  "__missing";

const getAccountLastActivityLabel = (account: HubSpotLeadAccountItem): string => {
  const date = account.lead.lastActivityAt ?? account.lead.updatedAt ?? account.lead.syncedAt;

  return date ? formatDate(date) : "Aucune activite";
};

const getContactLastActivityLabel = (contact: HubSpotLeadContactListItem): string =>
  contact.lastActivityAt ? formatDate(contact.lastActivityAt) : "Aucune activite";

const buildHubSpotRecordUrl = (
  portalId: string | null | undefined,
  objectTypeId: "0-1" | "0-136",
  recordId: string | null,
): string | null => {
  const trimmedPortalId = portalId?.trim();

  if (!trimmedPortalId || !recordId) {
    return null;
  }

  return `https://app.hubspot.com/contacts/${encodeURIComponent(trimmedPortalId)}/record/${objectTypeId}/${encodeURIComponent(recordId)}`;
};

const matchesSearch = (account: HubSpotLeadAccountItem, normalizedSearchTerm: string): boolean => {
  if (!normalizedSearchTerm) {
    return true;
  }

  const leadValues = [
    account.lead.name,
    account.lead.companyName,
    account.lead.phaseLabel,
    account.lead.phaseId,
    account.lead.leadStatus,
    account.lead.lifecycleStage,
  ];
  const contactValues = account.contacts.flatMap((contact) => [
    contact.name,
    contact.email,
    contact.phone,
    contact.title,
    contact.reason,
    contact.recommendedAction,
  ]);

  return [...leadValues, ...contactValues]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .some((value) => value.toLowerCase().includes(normalizedSearchTerm));
};

const getScoreClassName = (priority: HubSpotLeadContactListItem["priority"]): string =>
  `jv-score-pill ${priority}`;

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const AccountIdentity = ({
  name,
  subtitle,
}: {
  name: string;
  subtitle: string;
}) => (
  <div className="jv-account">
    <span aria-hidden="true" className="jv-account-avatar">
      {getInitials(name)}
    </span>
    <span className="jv-account-copy">
      <strong>{name}</strong>
      <small>{subtitle}</small>
    </span>
  </div>
);

const ContactChannels = ({ contact }: { contact: HubSpotLeadContactListItem }) => (
  <div className="jv-contact-channels">
    <span className={contact.phone ? "available" : ""}>
      <Phone aria-hidden="true" size={13} />
      {contact.phone ?? "Telephone non renseigne"}
    </span>
    <span className={contact.email ? "available" : ""}>
      <Mail aria-hidden="true" size={13} />
      {contact.email ?? "Email non renseigne"}
    </span>
  </div>
);

export const LeadsView = ({
  hubspotPortalId,
  onOwnerChange,
  orgId,
  owners,
  selectedOwnerId,
}: LeadsViewProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("accounts");
  const [accounts, setAccounts] = useState<HubSpotLeadAccountItem[]>([]);
  const [expandedLeadIds, setExpandedLeadIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedOwner = owners.find((owner) => owner.ownerId === selectedOwnerId) ?? null;
  const ownerNameById = useMemo(() => new Map(owners.map((owner) => [owner.ownerId, owner.name])), [owners]);
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();

  useEffect(() => {
    if (!orgId || !selectedOwnerId) {
      setAccounts([]);
      setExpandedLeadIds(new Set());
      return;
    }

    const abortController = new AbortController();
    const cacheKey = getAccountsCacheKey(orgId, selectedOwnerId);
    const cachedAccounts = accountsByOwnerCache.get(cacheKey);

    if (cachedAccounts) {
      setAccounts(cachedAccounts);
    }

    setExpandedLeadIds(new Set());
    setIsLoading(!cachedAccounts);
    setError(null);

    void fetchHubSpotLeadAccounts(orgId, selectedOwnerId, 500, { signal: abortController.signal })
      .then((loadedAccounts) => {
        accountsByOwnerCache.set(cacheKey, loadedAccounts);
        setAccounts(loadedAccounts);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }

        setAccounts([]);
        setError(loadError instanceof Error ? loadError.message : "Impossible de charger les comptes leads.");
      })
      .finally(() => setIsLoading(false));

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void fetchHubSpotLeadAccounts(orgId, selectedOwnerId, 500, { signal: abortController.signal }, true)
        .then((loadedAccounts) => {
          accountsByOwnerCache.set(cacheKey, loadedAccounts);
          setAccounts(loadedAccounts);
        })
        .catch((loadError: unknown) => {
          if (loadError instanceof DOMException && loadError.name === "AbortError") {
            return;
          }
        });
    }, 30_000);

    return () => {
      abortController.abort();
      window.clearInterval(intervalId);
    };
  }, [orgId, selectedOwnerId]);

  const phaseOptions = useMemo<PhaseFilterOption[]>(() => {
    const optionById = new Map<string, PhaseFilterOption>();

    for (const account of accounts) {
      const id = getLeadPhaseKey(account);
      optionById.set(id, {
        id,
        label: id === "__missing" ? "Non renseigne" : getLeadStatusLabel(account),
      });
    }

    return [
      { id: "all", label: "Toutes phases" },
      ...Array.from(optionById.values()).sort((left, right) => left.label.localeCompare(right.label, "fr")),
    ];
  }, [accounts]);

  const filteredAccounts = useMemo(
    () =>
      accounts
        .filter((account) => phaseFilter === "all" || getLeadPhaseKey(account) === phaseFilter)
        .filter((account) => matchesSearch(account, normalizedSearchTerm)),
    [accounts, normalizedSearchTerm, phaseFilter],
  );

  const rankedContacts = useMemo<RankedContact[]>(
    () =>
      filteredAccounts
        .flatMap((account) => account.contacts.map((contact) => ({ ...contact, account })))
        .sort(
          (left, right) =>
            right.finalScore - left.finalScore ||
            (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? "") ||
            (left.name ?? "").localeCompare(right.name ?? "", "fr"),
        ),
    [filteredAccounts],
  );

  const contactCount = filteredAccounts.reduce((sum, account) => sum + account.contacts.length, 0);
  const withPhoneCount = rankedContacts.filter((contact) => contact.phone).length;
  const aiScoredCount = rankedContacts.filter((contact) => contact.scoringSource === "ai_cached").length;

  const stats = [
    { label: "Comptes", value: String(filteredAccounts.length) },
    { label: "Contacts", value: String(contactCount) },
    { label: "Avec telephone", value: String(withPhoneCount) },
    { label: "Score IA cache", value: String(aiScoredCount) },
  ] as const;

  const ownerKicker = selectedOwner
    ? `${selectedOwner.name} · ${selectedOwner.email || "AE HubSpot"}`
    : "Selectionnez un AE HubSpot";

  const toggleExpanded = (hubspotLeadId: string): void => {
    setExpandedLeadIds((current) => {
      const next = new Set(current);

      if (next.has(hubspotLeadId)) {
        next.delete(hubspotLeadId);
      } else {
        next.add(hubspotLeadId);
      }

      return next;
    });
  };

  return (
    <div className="jv-leads-page" aria-label="Leads ouverts">
      <header className="jv-page-header">
        <ListFilter aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>
          Leads ouverts
          <span className="jv-page-kicker">{ownerKicker}</span>
        </h1>
      </header>

      <div className="jv-toolbar">
        <div className="jv-toolbar-filters">
          <div className="jv-filter-pills" role="tablist" aria-label="Vue leads">
            <button
              aria-selected={viewMode === "accounts"}
              className={viewMode === "accounts" ? "active" : ""}
              onClick={() => setViewMode("accounts")}
              role="tab"
              type="button"
            >
              Comptes
            </button>
            <button
              aria-selected={viewMode === "contacts"}
              className={viewMode === "contacts" ? "active" : ""}
              onClick={() => setViewMode("contacts")}
              role="tab"
              type="button"
            >
              Contacts a appeler
            </button>
          </div>
        </div>

        <div className="jv-toolbar-actions">
          <select
            aria-label="AE HubSpot"
            className="jv-select"
            disabled={!onOwnerChange || owners.length === 0}
            onChange={(event) => onOwnerChange?.(event.target.value)}
            value={selectedOwnerId ?? ""}
          >
            {owners.map((owner) => (
              <option key={owner.ownerId} value={owner.ownerId}>
                {owner.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Phase lead"
            className="jv-select"
            onChange={(event) => setPhaseFilter(event.target.value)}
            value={phaseFilter}
          >
            {phaseOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="jv-search-field">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label="Rechercher un lead"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Societe, contact, email..."
              type="search"
              value={searchTerm}
            />
          </div>
        </div>
      </div>

      <section className="jv-stat-strip cols-4" aria-label="Resume leads ouverts">
        {stats.map((stat, index) => (
          <div className="jv-stat" key={stat.label} style={{ animationDelay: `${index * 60}ms` }}>
            <span className="jv-stat-label">{stat.label}</span>
            <span className="jv-stat-value">{stat.value}</span>
          </div>
        ))}
      </section>

      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}

      {viewMode === "accounts" ? (
        <section className="jv-list-shell" role="region" aria-label="Liste des comptes leads ouverts de l'AE">
          <header className="jv-list-head">
            <SectionLabel icon={Building2}>Comptes</SectionLabel>
            <span className="jv-list-count">
              {filteredAccounts.length} compte{filteredAccounts.length > 1 ? "s" : ""}
            </span>
          </header>
          <div className="jv-leads-table-scroll">
            <table className="jv-leads-table">
              <thead>
                <tr>
                  <th>Compte</th>
                  <th>Score</th>
                  <th>Statut</th>
                  <th>Derniere activite</th>
                  <th>Meilleur contact</th>
                  <th aria-label="HubSpot" />
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => {
                  const isExpanded = expandedLeadIds.has(account.lead.hubspotLeadId);
                  const leadUrl = buildHubSpotRecordUrl(hubspotPortalId, "0-136", account.lead.hubspotLeadId);
                  const bestContact = account.bestContact;

                  return (
                    <Fragment key={account.lead.hubspotLeadId}>
                      <tr>
                        <td>
                          <button
                            aria-expanded={isExpanded}
                            className="jv-lead-expand-button"
                            onClick={() => toggleExpanded(account.lead.hubspotLeadId)}
                            type="button"
                          >
                            {isExpanded ? (
                              <ChevronDown aria-hidden="true" size={16} />
                            ) : (
                              <ChevronRight aria-hidden="true" size={16} />
                            )}
                            <AccountIdentity
                              name={account.lead.name}
                              subtitle={`${account.contacts.length} contact(s)`}
                            />
                          </button>
                        </td>
                        <td>
                          {bestContact ? (
                            <span className={getScoreClassName(bestContact.priority)}>{bestContact.finalScore}</span>
                          ) : (
                            <strong>-</strong>
                          )}
                        </td>
                        <td>
                          <strong>{getLeadStatusLabel(account)}</strong>
                          <small>
                            {account.lead.pipelineLabel ? `${account.lead.pipelineLabel} · ` : ""}
                            {account.lead.hubspotOwnerId
                              ? (ownerNameById.get(account.lead.hubspotOwnerId) ?? `Owner ${account.lead.hubspotOwnerId}`)
                              : "Owner non renseigne"}
                          </small>
                        </td>
                        <td>
                          <strong>{getAccountLastActivityLabel(account)}</strong>
                          <small>Sync {formatDate(account.lead.syncedAt)}</small>
                        </td>
                        <td>
                          {bestContact ? (
                            <>
                              <strong>{bestContact.name ?? "Contact non renseigne"}</strong>
                              <small>{bestContact.recommendedAction}</small>
                            </>
                          ) : (
                            <>
                              <strong>Aucun contact</strong>
                              <small>Associer un contact HubSpot au lead</small>
                            </>
                          )}
                        </td>
                        <td className="jv-leads-table-action-cell">
                          {leadUrl ? (
                            <a
                              aria-label={`Ouvrir ${account.lead.name} dans HubSpot`}
                              className="jv-table-action"
                              href={leadUrl}
                              rel="noreferrer"
                              target="_blank"
                              title="Ouvrir le lead dans HubSpot"
                            >
                              <ExternalLink aria-hidden="true" size={15} />
                              <span>HubSpot</span>
                            </a>
                          ) : null}
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="jv-lead-contact-detail-row">
                          <td colSpan={6}>
                            <div className="jv-lead-contact-list">
                              {account.contacts.length > 0 ? (
                                account.contacts.map((contact) => {
                                  const contactUrl = buildHubSpotRecordUrl(
                                    hubspotPortalId,
                                    "0-1",
                                    contact.hubspotContactId,
                                  );

                                  return (
                                    <div className="jv-lead-contact-row" key={contact.hubspotContactId}>
                                      <AccountIdentity
                                        name={contact.name ?? "Contact non renseigne"}
                                        subtitle={contact.title ?? "Titre non renseigne"}
                                      />
                                      <span className={getScoreClassName(contact.priority)}>{contact.finalScore}</span>
                                      <ContactChannels contact={contact} />
                                      <div className="jv-cell-copy">
                                        <strong>{contact.recommendedAction}</strong>
                                        <small>{contact.reason}</small>
                                      </div>
                                      {contactUrl ? (
                                        <a
                                          aria-label={`Ouvrir ${contact.name ?? "contact"} dans HubSpot`}
                                          className="jv-table-action"
                                          href={contactUrl}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          <ExternalLink aria-hidden="true" size={15} />
                                          <span>Contact</span>
                                        </a>
                                      ) : null}
                                    </div>
                                  );
                                })
                              ) : (
                                <p className="jv-list-empty">Aucun contact HubSpot associe a ce lead.</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredAccounts.length === 0 ? (
            <p className="jv-list-empty">{isLoading ? "Chargement des comptes HubSpot..." : "Aucun lead pour cet AE."}</p>
          ) : null}
        </section>
      ) : (
        <section
          className="jv-list-shell jv-leads-contacts-table"
          role="region"
          aria-label="Contacts a appeler"
        >
          <header className="jv-list-head">
            <SectionLabel icon={Users}>Contacts a appeler</SectionLabel>
            <span className="jv-list-count">
              {rankedContacts.length} contact{rankedContacts.length > 1 ? "s" : ""}
            </span>
          </header>
          <div className="jv-leads-table-scroll">
            <table className="jv-leads-table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Score</th>
                  <th>Societe</th>
                  <th>Statut</th>
                  <th>Derniere activite</th>
                  <th>Action</th>
                  <th aria-label="HubSpot" />
                </tr>
              </thead>
              <tbody>
                {rankedContacts.map((contact) => {
                  const contactUrl = buildHubSpotRecordUrl(hubspotPortalId, "0-1", contact.hubspotContactId);

                  return (
                    <tr key={`${contact.account.lead.hubspotLeadId}:${contact.hubspotContactId}`}>
                      <td>
                        <AccountIdentity
                          name={contact.name ?? "Contact non renseigne"}
                          subtitle={contact.title ?? "Titre non renseigne"}
                        />
                      </td>
                      <td>
                        <span className={getScoreClassName(contact.priority)}>{contact.finalScore}</span>
                      </td>
                      <td>
                        <strong>{contact.account.lead.name}</strong>
                        <small>{contact.account.lead.companyName ?? "Societe non renseignee"}</small>
                      </td>
                      <td>
                        <strong>{getLeadStatusLabel(contact.account)}</strong>
                        <small>{contact.scoringSource === "ai_cached" ? "Score IA cache" : "Score regles"}</small>
                      </td>
                      <td>
                        <strong>{getContactLastActivityLabel(contact)}</strong>
                        <ContactChannels contact={contact} />
                      </td>
                      <td>
                        <strong>{contact.recommendedAction}</strong>
                        <small>{contact.reason}</small>
                      </td>
                      <td className="jv-leads-table-action-cell">
                        {contactUrl ? (
                          <a
                            aria-label={`Ouvrir ${contact.name ?? "contact"} dans HubSpot`}
                            className="jv-table-action"
                            href={contactUrl}
                            rel="noreferrer"
                            target="_blank"
                            title="Ouvrir le contact dans HubSpot"
                          >
                            <ExternalLink aria-hidden="true" size={15} />
                            <span>HubSpot</span>
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rankedContacts.length === 0 ? (
            <p className="jv-list-empty">{isLoading ? "Chargement des contacts HubSpot..." : "Aucun contact pour cet AE."}</p>
          ) : null}
        </section>
      )}
    </div>
  );
};