import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import {
  fetchHubSpotLeads,
  type HubSpotLeadListItem,
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

const formatHubSpotValue = (value: string): string =>
  value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const getLeadStatusLabel = (lead: HubSpotLeadListItem): string =>
  lead.phaseLabel
    ? lead.phaseLabel
    : lead.phaseId
      ? formatHubSpotValue(lead.phaseId)
      : lead.leadStatus
        ? formatHubSpotValue(lead.leadStatus)
        : lead.lifecycleStage
          ? formatHubSpotValue(lead.lifecycleStage)
          : "Non renseigne";

const getLeadPhaseKey = (lead: HubSpotLeadListItem): string =>
  lead.phaseId?.trim() || lead.phaseLabel?.trim() || lead.leadStatus?.trim() || lead.lifecycleStage?.trim() || "__missing";

const getLastActivityLabel = (lead: HubSpotLeadListItem): string => {
  const date = lead.lastActivityAt ?? lead.updatedAt ?? lead.syncedAt;

  return date ? formatDate(date) : "Aucune activite";
};

const buildHubSpotRecordUrl = (
  portalId: string | null | undefined,
  contactId: string,
  leadId: string | null,
): string | null => {
  const trimmedPortalId = portalId?.trim();

  if (!trimmedPortalId) {
    return null;
  }

  if (leadId) {
    return `https://app.hubspot.com/contacts/${encodeURIComponent(trimmedPortalId)}/record/0-136/${encodeURIComponent(leadId)}`;
  }

  return contactId
    ? `https://app.hubspot.com/contacts/${encodeURIComponent(trimmedPortalId)}/record/0-1/${encodeURIComponent(contactId)}`
    : null;
};

export const LeadsView = ({
  hubspotPortalId,
  onOwnerChange,
  orgId,
  owners,
  selectedOwnerId,
}: LeadsViewProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [leads, setLeads] = useState<HubSpotLeadListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedOwner = owners.find((owner) => owner.ownerId === selectedOwnerId) ?? null;
  const ownerNameById = useMemo(() => new Map(owners.map((owner) => [owner.ownerId, owner.name])), [owners]);
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();

  useEffect(() => {
    if (!orgId || !selectedOwnerId) {
      setLeads([]);
      return;
    }

    const abortController = new AbortController();

    setIsLoading(true);
    setError(null);

    void fetchHubSpotLeads(orgId, selectedOwnerId, 500, { signal: abortController.signal })
      .then((loadedLeads) => setLeads(loadedLeads))
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }

        setLeads([]);
        setError(loadError instanceof Error ? loadError.message : "Impossible de charger les leads.");
      })
      .finally(() => setIsLoading(false));

    return () => abortController.abort();
  }, [orgId, selectedOwnerId]);

  const phaseOptions = useMemo<PhaseFilterOption[]>(() => {
    const optionById = new Map<string, PhaseFilterOption>();

    for (const lead of leads) {
      const id = getLeadPhaseKey(lead);
      optionById.set(id, {
        id,
        label: id === "__missing" ? "Non renseigne" : getLeadStatusLabel(lead),
      });
    }

    return [
      { id: "all", label: "Toutes phases" },
      ...Array.from(optionById.values()).sort((left, right) => left.label.localeCompare(right.label, "fr")),
    ];
  }, [leads]);

  const filteredLeads = useMemo(
    () =>
      leads
        .filter((lead) => phaseFilter === "all" || getLeadPhaseKey(lead) === phaseFilter)
        .filter((lead) => {
        if (!normalizedSearchTerm) {
          return true;
        }

        return [lead.name, lead.email, lead.companyName, lead.title, lead.phaseLabel, lead.phaseId, lead.leadStatus, lead.lifecycleStage]
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .some((value) => value.toLowerCase().includes(normalizedSearchTerm));
      })
        .sort(
          (left, right) =>
            getLeadStatusLabel(left).localeCompare(getLeadStatusLabel(right), "fr") ||
            getLastActivityLabel(right).localeCompare(getLastActivityLabel(left), "fr") ||
            left.name.localeCompare(right.name, "fr"),
        ),
    [leads, normalizedSearchTerm, phaseFilter],
  );

  const withEmailCount = filteredLeads.filter((lead) => lead.email).length;
  const withPhoneCount = filteredLeads.filter((lead) => lead.phone).length;

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
                placeholder="Nom, societe, email..."
                type="search"
                value={searchTerm}
              />
            </div>
          </label>
        </div>
      </div>

      <div className="ae-leads-summary" aria-label="Resume leads ouverts">
        <div>
          <span>Leads</span>
          <strong>{filteredLeads.length}</strong>
        </div>
        <div>
          <span>Avec email</span>
          <strong>{withEmailCount}</strong>
        </div>
        <div>
          <span>Avec telephone</span>
          <strong>{withPhoneCount}</strong>
        </div>
      </div>

      {error ? <p className="ae-app-error">{error}</p> : null}

      <div className="ae-table ae-leads-table" role="region" aria-label="Liste des leads ouverts de l'AE">
        <table>
          <thead>
            <tr>
              <th>Lead</th>
              <th>Societe</th>
              <th>Statut</th>
              <th>Derniere activite</th>
              <th>Contact</th>
              <th aria-label="HubSpot" />
            </tr>
          </thead>
          <tbody>
            {filteredLeads.map((lead) => {
              const hubspotUrl = buildHubSpotRecordUrl(hubspotPortalId, lead.hubspotContactId, lead.hubspotLeadId);

              return (
                <tr key={lead.hubspotLeadId ?? lead.hubspotContactId}>
                  <td>
                    <div className="ae-account">
                      <span aria-hidden="true">{getInitials(lead.name)}</span>
                      <div>
                        <strong>{lead.name}</strong>
                        <small>{lead.title ?? "Titre non renseigne"}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <strong>{lead.companyName ?? "Societe non renseignee"}</strong>
                  </td>
                  <td>
                    <strong>{getLeadStatusLabel(lead)}</strong>
                    <small>
                      {lead.pipelineLabel ? `${lead.pipelineLabel} · ` : ""}
                      {lead.hubspotOwnerId
                        ? (ownerNameById.get(lead.hubspotOwnerId) ?? `Owner ${lead.hubspotOwnerId}`)
                        : "Owner non renseigne"}
                    </small>
                  </td>
                  <td>
                    <strong>{getLastActivityLabel(lead)}</strong>
                    <small>Sync {formatDate(lead.syncedAt)}</small>
                  </td>
                  <td>
                    <strong>{lead.email ?? "Email non renseigne"}</strong>
                    <small>{lead.phone ?? "Telephone non renseigne"}</small>
                  </td>
                  <td className="ae-table-action-cell">
                    {hubspotUrl ? (
                      <a
                        aria-label={`Ouvrir ${lead.name} dans HubSpot`}
                        className="ae-table-analysis-button"
                        href={hubspotUrl}
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
              );
            })}
          </tbody>
        </table>
        {filteredLeads.length === 0 ? (
          <p className="ae-empty">{isLoading ? "Chargement des leads HubSpot..." : "Aucun lead pour cet AE."}</p>
        ) : null}
      </div>
    </section>
  );
};
