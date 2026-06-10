import {
  BarChart3,
  Bot,
  ChartNoAxesCombined,
  ChevronDown,
  CircleX,
  LayoutDashboard,
  ListFilter,
  ListTodo,
  GraduationCap,
  LogOut,
  Trophy,
  Newspaper,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WorkspaceView } from "./types";

type SidebarProps = {
  activeView: WorkspaceView;
  onSignOut?: () => void | Promise<void>;
  onViewChange: (view: WorkspaceView) => void;
  showDigest?: boolean;
};

const viewIcons: Record<WorkspaceView, LucideIcon> = {
  closeLostAnalysis: CircleX,
  coaching: GraduationCap,
  dealAnalysis: ChartNoAxesCombined,
  digest: Newspaper,
  forecast: ChartNoAxesCombined,
  leads: ListFilter,
  overview: LayoutDashboard,
  settings: Settings,
  stats: BarChart3,
  tasks: ListTodo,
  winAnalysis: Trophy,
};

type SidebarNavItem =
  | {
      type: "view";
      id: WorkspaceView;
      label: string;
    }
  | {
      type: "section";
      id: string;
      label: string;
    };

const sidebarNavItems: SidebarNavItem[] = [
  { type: "view", id: "overview", label: "Overview" },
  { type: "view", id: "forecast", label: "Forecast IA" },
  { type: "view", id: "digest", label: "Digest" },
  { type: "view", id: "coaching", label: "Coaching IA" },
  { type: "view", id: "leads", label: "Leads" },
  { type: "view", id: "closeLostAnalysis", label: "Close Lost Analysis" },
  { type: "view", id: "winAnalysis", label: "Win Analysis" },
  { type: "view", id: "stats", label: "Statistiques" },
  { type: "view", id: "tasks", label: "Taches" },
  { type: "view", id: "settings", label: "Parametres" },
];

export const Sidebar = ({ activeView, onSignOut, onViewChange, showDigest = false }: SidebarProps) => (
  <aside className="ae-sidebar" aria-label="Workspace navigation">
    <div className="ae-sidebar-header">
      <div className="ae-sidebar-brand">
        <span aria-hidden="true">
          <Bot size={18} strokeWidth={2} />
        </span>
        <div>
          <strong>Jarvis</strong>
          <small>Sales copilot</small>
        </div>
      </div>
    </div>
    <div className="ae-sidebar-space" aria-label="Votre espace">
      <span aria-hidden="true">J</span>
      <div>
        <small>Votre espace</small>
        <strong>Jarvis</strong>
      </div>
      <ChevronDown aria-hidden="true" size={15} strokeWidth={2} />
    </div>
    <nav className="ae-sidebar-nav">
      {sidebarNavItems.map((item) => {
        // Le digest, le coaching et la win analysis sont reserves aux
        // admins/managers: on masque ces entrees pour les sales.
        if (
          item.type === "view" &&
          (item.id === "digest" || item.id === "coaching" || item.id === "winAnalysis") &&
          !showDigest
        ) {
          return null;
        }

        if (item.type === "section") {
          return (
            <span className="ae-sidebar-section" key={item.id}>
              {item.label}
            </span>
          );
        }

        const Icon = viewIcons[item.id];

        return (
          <button
            aria-current={activeView === item.id ? "page" : undefined}
            className={activeView === item.id ? "active" : ""}
            key={item.id}
            onClick={() => onViewChange(item.id)}
            title={item.label}
            type="button"
          >
            <span aria-hidden="true">
              <Icon size={17} strokeWidth={2} />
            </span>
            <strong>{item.label}</strong>
          </button>
        );
      })}
    </nav>
    {onSignOut ? (
      <button className="ae-sidebar-signout" onClick={() => void onSignOut()} title="Se deconnecter" type="button">
        <span aria-hidden="true">
          <LogOut size={17} strokeWidth={2} />
        </span>
        <strong>Se deconnecter</strong>
      </button>
    ) : null}
  </aside>
);
