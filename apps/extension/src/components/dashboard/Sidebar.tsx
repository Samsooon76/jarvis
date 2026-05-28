import {
  BarChart3,
  Bot,
  ChartNoAxesCombined,
  ChevronDown,
  CircleX,
  CircleHelp,
  LayoutDashboard,
  ListFilter,
  ListTodo,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WorkspaceView } from "./types";

type SidebarProps = {
  activeView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
};

const viewIcons: Record<WorkspaceView, LucideIcon> = {
  closeLostAnalysis: CircleX,
  dealAnalysis: ChartNoAxesCombined,
  forecast: ChartNoAxesCombined,
  leads: ListFilter,
  overview: LayoutDashboard,
  settings: Settings,
  stats: BarChart3,
  tasks: ListTodo,
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
  { type: "view", id: "leads", label: "Leads" },
  { type: "view", id: "closeLostAnalysis", label: "Close Lost Analysis" },
  { type: "view", id: "stats", label: "Statistiques" },
  { type: "view", id: "tasks", label: "Taches" },
  { type: "view", id: "settings", label: "Parametres" },
];

export const Sidebar = ({ activeView, onViewChange }: SidebarProps) => (
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
      <button aria-label="Aide Jarvis" className="ae-sidebar-help" type="button">
        <CircleHelp size={16} strokeWidth={2} />
      </button>
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
            onPointerDown={() => onViewChange(item.id)}
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
  </aside>
);
