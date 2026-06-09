import type { ReactNode } from "react";
import { formatDateTime } from "../../utils/dashboard/formatters";

type HubSpotHeaderProps = {
  eyebrow?: string;
  generatedAt?: string;
  hubspotPortalId?: string | null;
  integrationStatusClassName: string;
  integrationStatusLabel: string;
  isConnected: boolean;
  isRefreshing: boolean;
  pulseSlot?: ReactNode;
  subtitle?: string;
  title?: string;
};

export const HubSpotHeader = ({
  eyebrow = "AE workspace",
  generatedAt,
  hubspotPortalId,
  integrationStatusClassName,
  integrationStatusLabel,
  isConnected,
  isRefreshing,
  pulseSlot,
  subtitle = "La queue priorisee pour savoir qui relancer, pourquoi, et avec quel angle.",
  title = "Pipeline inbox",
}: HubSpotHeaderProps) => (
  <header className="ae-header">
    <div>
      <p className="ae-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="ae-subtitle">{subtitle}</p>
    </div>
    {pulseSlot}
    <div className="ae-header-meta" aria-label="Etat HubSpot">
      <div className="ae-sync">
        <span>Integration</span>
        <strong className={`ae-integration-status ${integrationStatusClassName}`}>
          <span aria-hidden="true" />
          {isConnected ? integrationStatusLabel : "Non connecte"}
        </strong>
      </div>
      <div className="ae-sync">
        <span>Portal</span>
        <strong>{hubspotPortalId ?? "--"}</strong>
      </div>
      <div className="ae-sync">
        <span>{isRefreshing ? "Loading owner" : "Last sync"}</span>
        <strong>{generatedAt ? formatDateTime(generatedAt) : "Pending"}</strong>
      </div>
    </div>
  </header>
);
