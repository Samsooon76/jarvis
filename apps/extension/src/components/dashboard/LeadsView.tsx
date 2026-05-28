import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Mail, Phone, Search } from "lucide-react";
import {
  fetchHubSpotLeadAccounts,
  type HubSpotLeadAccountItem,
  type HubSpotLeadContactListItem,
  type HubSpotOwnerOption,
} from "../../services/api";
import { formatDate } from "../../utils/dashboard/formatters";
import { getInitials } from "../../utils/dashboard/prospects";

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
  `ae-contact-score ${priority}`;

const ContactChannels = ({ contact }: { contact: HubSpotLeadContactListItem }) => (
  <div className="ae-contact-channels">
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

    return () => abortController.abort();
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
    <section className="ae-view-panel ae-leads-view" aria-label="Leads ouverts">
      <div className="ae-leads-toolbar">
        <div className="ae-view-title">
          <h2>Leads ouverts</h2>
          <p>
            {selectedOwner ? `${selectedOwner.name} · ${selectedOwner.email || "AE HubSpot"}` : "Selectionnez un AE HubSpot"}
          </p>
        </div>

        <div className="ae-leads-controls">
          <label>
            <span>AE</span>
            <select
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
          </label>
          <label>
            <span>Phase</span>
            <select onChange={(event) => setPhaseFilter(event.target.value)} value={phaseFilter}>
              {phaseOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Recherche</span>
            <div className="ae-leads-search">
              <Search aria-hidden="true" size={15} />
              <input
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Societe, contact, email..."
                type="search"
                value={searchTerm}
              />
            </div>
          </label>
        </div>
      </div>

      <div className="ae-leads-mode" role="tablist" aria-label="Vue leads">
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

      <div className="ae-leads-summary" aria-label="Resume leads ouverts">
        <div>
          <span>Comptes</span>
          <strong>{filteredAccounts.length}</strong>
        </div>
        <div>
          <span>Contacts</span>
          <strong>{contactCount}</strong>
        </div>
        <div>
          <span>Avec telephone</span>
          <strong>{withPhoneCount}</strong>
        </div>
        <div>
          <span>Score IA cache</span>
          <strong>{aiScoredCount}</strong>
        </div>
      </div>

      {error ? <p className="ae-app-error">{error}</p> : null}

      {viewMode === "accounts" ? (
        <div className="ae-table ae-leads-table" role="region" aria-label="Liste des comptes leads ouverts de l'AE">
          <table>
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
                    <tr key={account.lead.hubspotLeadId}>
                      <td>
                        <button
                          aria-expanded={isExpanded}
                          className="ae-lead-expand-button"
                          onClick={() => toggleExpanded(account.lead.hubspotLeadId)}
                          type="button"
                        >
                          {isExpanded ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronRight aria-hidden="true" size={16} />}
                          <span className="ae-account">
                            <span aria-hidden="true">{getInitials(account.lead.name)}</span>
                            <span className="ae-account-copy">
                              <strong>{account.lead.name}</strong>
                              <small>{account.contacts.length} contact(s)</small>
                            </span>
                          </span>
                        </button>
                      </td>
                      <td>
                        {bestContact ? <span className={getScoreClassName(bestContact.priority)}>{bestContact.finalScore}</span> : <strong>-</strong>}
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
                      <td className="ae-table-action-cell">
                        {leadUrl ? (
                          <a
                            aria-label={`Ouvrir ${account.lead.name} dans HubSpot`}
                            className="ae-table-analysis-button"
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
                      <tr className="ae-lead-contact-detail-row">
                        <td colSpan={6}>
                          <div className="ae-lead-contact-list">
                            {account.contacts.length > 0 ? (
                              account.contacts.map((contact) => {
                                const contactUrl = buildHubSpotRecordUrl(hubspotPortalId, "0-1", contact.hubspotContactId);

                                return (
                                  <div className="ae-lead-contact-row" key={contact.hubspotContactId}>
                                    <div className="ae-account">
                                      <span aria-hidden="true">{getInitials(contact.name ?? contact.email ?? "Contact")}</span>
                                      <div>
                                        <strong>{contact.name ?? "Contact non renseigne"}</strong>
                                        <small>{contact.title ?? "Titre non renseigne"}</small>
                                      </div>
                                    </div>
                                    <span className={getScoreClassName(contact.priority)}>{contact.finalScore}</span>
                                    <ContactChannels contact={contact} />
                                    <div>
                                      <strong>{contact.recommendedAction}</strong>
                                      <small>{contact.reason}</small>
                                    </div>
                                    {contactUrl ? (
                                      <a
                                        aria-label={`Ouvrir ${contact.name ?? "contact"} dans HubSpot`}
                                        className="ae-table-analysis-button"
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
                              <p className="ae-empty">Aucun contact HubSpot associe a ce lead.</p>
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
          {filteredAccounts.length === 0 ? (
            <p className="ae-empty">{isLoading ? "Chargement des comptes HubSpot..." : "Aucun lead pour cet AE."}</p>
          ) : null}
        </div>
      ) : (
        <div className="ae-table ae-leads-table ae-leads-contacts-table" role="region" aria-label="Contacts a appeler">
          <table>
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
                      <div className="ae-account">
                        <span aria-hidden="true">{getInitials(contact.name ?? contact.email ?? "Contact")}</span>
                        <div>
                          <strong>{contact.name ?? "Contact non renseigne"}</strong>
                          <small>{contact.title ?? "Titre non renseigne"}</small>
                        </div>
                      </div>
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
                    <td className="ae-table-action-cell">
                      {contactUrl ? (
                        <a
                          aria-label={`Ouvrir ${contact.name ?? "contact"} dans HubSpot`}
                          className="ae-table-analysis-button"
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
          {rankedContacts.length === 0 ? (
            <p className="ae-empty">{isLoading ? "Chargement des contacts HubSpot..." : "Aucun contact pour cet AE."}</p>
          ) : null}
        </div>
      )}
    </section>
  );
};
