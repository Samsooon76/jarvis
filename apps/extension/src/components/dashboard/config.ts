import type { ProspectPriority } from "@jarvis/shared";
import type {
  BucketDefinition,
  CloseDatePreset,
  DealStatus,
  DealStatusFilter,
  SelectOption,
  StageFilter,
  WorkspaceViewDefinition,
} from "./types";

export const buckets: BucketDefinition[] = [
  {
    id: "actNow",
    label: "Act now",
    description: "Deals a traiter avant la fin de journee.",
  },
  {
    id: "thisWeek",
    label: "This week",
    description: "Opportunites a planifier cette semaine.",
  },
  {
    id: "watch",
    label: "Watch",
    description: "Signaux visibles sans urgence immediate.",
  },
  {
    id: "all",
    label: "All",
    description: "Toute la queue AE disponible.",
  },
  {
    id: "lastUpdate",
    label: "Last update",
    description: "Derniers deals ayant recu un event HubSpot webhook.",
  },
];

export const priorityLabels: Record<ProspectPriority, string> = {
  urgent: "Hot",
  important: "Warm",
  routine: "Nurture",
};

export const dealStatusFilters: Array<SelectOption<DealStatusFilter>> = [
  { id: "open", label: "Ouverts" },
  { id: "all", label: "Tous" },
  { id: "won", label: "Closed won" },
  { id: "lost", label: "Closed lost" },
];

export const closeDatePresets: Array<SelectOption<CloseDatePreset>> = [
  { id: "all", label: "Toutes dates" },
  { id: "thisMonth", label: "Ce mois" },
  { id: "nextMonth", label: "Mois prochain" },
  { id: "thisQuarter", label: "Ce trimestre" },
  { id: "overdue", label: "En retard" },
  { id: "noDate", label: "Sans date" },
];

export const stageFilters: Array<SelectOption<StageFilter>> = [
  { id: "all", label: "Tous stages" },
  { id: "discovery", label: "Discovery" },
  { id: "initialProposition", label: "Initial Proposition" },
  { id: "testing", label: "Testing" },
  { id: "contractSent", label: "Contract Sent" },
  { id: "negociation", label: "Negociation" },
  { id: "contractValidation", label: "Contract Validation" },
  { id: "dealSignedPaymentPending", label: "Deal Signed/Payment Pending" },
  { id: "paymentReceived", label: "Payment Received" },
  { id: "closedLost", label: "Closed lost" },
  { id: "late", label: "No touch 14j+" },
];

export const openStageKeys = new Set([
  "discovery",
  "initial proposition",
  "testing",
  "contract sent",
  "negociation",
  "negotiation",
]);
export const wonStageKeys = new Set(["contract validation", "deal signed payment pending", "payment received"]);
export const lostStageKeys = new Set(["closed lost"]);

export const stageFilterKeys: Partial<Record<StageFilter, string>> = {
  discovery: "discovery",
  initialProposition: "initial proposition",
  testing: "testing",
  contractSent: "contract sent",
  negociation: "negociation",
  contractValidation: "contract validation",
  dealSignedPaymentPending: "deal signed payment pending",
  paymentReceived: "payment received",
  closedLost: "closed lost",
};

export const dealStatusLabels: Record<DealStatus, string> = {
  open: "Ouvert",
  won: "Won",
  lost: "Lost",
  other: "Autre",
};

export const workspaceViews: WorkspaceViewDefinition[] = [
  { id: "overview", label: "Overview" },
  { id: "forecast", label: "Forecast IA" },
  { id: "closeLostAnalysis", label: "Close Lost Analysis" },
  { id: "stats", label: "Statistiques" },
  { id: "tasks", label: "Taches" },
  { id: "settings", label: "Parametres" },
];

export const bucketRank = {
  actNow: 0,
  thisWeek: 1,
  watch: 2,
  all: 3,
  lastUpdate: 4,
} as const;

export const stageFunnelColors = [
  "#ff5b5b",
  "#ff8a32",
  "#ffb84f",
  "#f5c45a",
  "#85dca7",
  "#4fce85",
  "#26be67",
  "#ef5b5b",
];
