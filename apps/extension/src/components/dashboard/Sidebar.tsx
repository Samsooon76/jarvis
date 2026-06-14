import {
  BarChart3,
  Bot,
  ChartNoAxesCombined,
  CircleX,
  PhoneCall,
  LayoutDashboard,
  ListFilter,
  ListTodo,
  BookOpenCheck,
  GraduationCap,
  LogOut,
  Trophy,
  Newspaper,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceView } from "./types";

type SidebarProps = {
  activeView: WorkspaceView;
  onSignOut?: () => void | Promise<void>;
  onViewChange: (view: WorkspaceView) => void;
  pulseSlot?: ReactNode;
  showDigest?: boolean;
};

const viewIcons: Record<WorkspaceView, LucideIcon> = {
  closeLostAnalysis: CircleX,
  calls: PhoneCall,
  coaching: GraduationCap,
  dealAnalysis: ChartNoAxesCombined,
  digest: Newspaper,
  forecast: ChartNoAxesCombined,
  leads: ListFilter,
  overview: LayoutDashboard,
  playbook: BookOpenCheck,
  settings: Settings,
  stats: BarChart3,
  tasks: ListTodo,
  winAnalysis: Trophy,
};

const managerOnlyViews = new Set<WorkspaceView>(["digest", "coaching", "winAnalysis"]);

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
  { type: "section", id: "pipeline", label: "Pipeline" },
  { type: "view", id: "overview", label: "Overview" },
  { type: "view", id: "leads", label: "Leads" },
  { type: "view", id: "tasks", label: "Tâches" },
  { type: "view", id: "calls", label: "Appels" },
  { type: "section", id: "intelligence", label: "Intelligence" },
  { type: "view", id: "forecast", label: "Forecast IA" },
  { type: "view", id: "digest", label: "Digest" },
  { type: "view", id: "coaching", label: "Coaching IA" },
  { type: "view", id: "closeLostAnalysis", label: "Close Lost Analysis" },
  { type: "view", id: "winAnalysis", label: "Win Analysis" },
  { type: "view", id: "playbook", label: "Playbook" },
  { type: "section", id: "pilotage", label: "Pilotage" },
  { type: "view", id: "stats", label: "Statistiques" },
  { type: "view", id: "settings", label: "Paramètres" },
];

const isNavItemVisible = (item: SidebarNavItem, showDigest: boolean): boolean => {
  if (item.type === "section") {
    return true;
  }

  return !managerOnlyViews.has(item.id) || showDigest;
};

const buildVisibleNavItems = (showDigest: boolean): SidebarNavItem[] => {
  const visibleItems = sidebarNavItems.filter((item) => isNavItemVisible(item, showDigest));

  return visibleItems.filter((item, index, items) => {
    if (item.type !== "section") {
      return true;
    }

    const nextItem = items[index + 1];
    return Boolean(nextItem && nextItem.type === "view");
  });
};

export const Sidebar = ({ activeView, onSignOut, onViewChange, pulseSlot, showDigest = false }: SidebarProps) => {
  const visibleNavItems = buildVisibleNavItems(showDigest);

  return (
    <aside className="ae-sidebar" aria-label="Workspace navigation">
      <div className="ae-sidebar-header">
        <div className="ae-sidebar-brand">
          <span aria-hidden="true" className="ae-sidebar-icon">
            <Bot size={18} strokeWidth={2} />
          </span>
          <div>
            <strong>Jarvis</strong>
            <small>Sales copilot</small>
          </div>
        </div>
        {pulseSlot ? <div className="ae-sidebar-pulse">{pulseSlot}</div> : null}
      </div>
      <nav className="ae-sidebar-nav">
        {visibleNavItems.map((item) => {
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
              <span aria-hidden="true" className="ae-sidebar-icon">
                <Icon size={18} strokeWidth={1.5} />
              </span>
              <span className="ae-sidebar-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
      {onSignOut ? (
        <button className="ae-sidebar-signout" onClick={() => void onSignOut()} title="Se déconnecter" type="button">
          <span aria-hidden="true" className="ae-sidebar-icon">
            <LogOut size={18} strokeWidth={1.5} />
          </span>
          <span className="ae-sidebar-label">Se déconnecter</span>
        </button>
      ) : null}
    </aside>
  );
};