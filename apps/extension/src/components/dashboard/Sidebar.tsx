import {
  BarChart3,
  Bot,
  ChartNoAxesCombined,
  CircleX,
  LayoutDashboard,
  ListFilter,
  ListTodo,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { workspaceViews } from "./config";
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

export const Sidebar = ({ activeView, onViewChange }: SidebarProps) => (
  <aside className="ae-sidebar" aria-label="Workspace navigation">
    <div className="ae-sidebar-header">
      <div className="ae-sidebar-brand">
        <span aria-hidden="true">
          <Bot size={20} strokeWidth={2} />
        </span>
        <div>
          <strong>Jarvis</strong>
          <small>Sales copilot</small>
        </div>
      </div>
    </div>
    <nav className="ae-sidebar-nav">
      {workspaceViews.map((view) => {
        const Icon = viewIcons[view.id];

        return (
          <button
            aria-current={activeView === view.id ? "page" : undefined}
            className={activeView === view.id ? "active" : ""}
            key={view.id}
            onClick={() => onViewChange(view.id)}
            onPointerDown={() => onViewChange(view.id)}
            title={view.label}
            type="button"
          >
            <span aria-hidden="true">
              <Icon size={20} strokeWidth={2} />
            </span>
            <strong>{view.label}</strong>
          </button>
        );
      })}
    </nav>
  </aside>
);
