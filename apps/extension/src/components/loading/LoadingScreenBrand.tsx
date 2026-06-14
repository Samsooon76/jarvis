import { Bot } from "lucide-react";

export const LoadingScreenBrand = ({ subtitle }: { subtitle?: string }) => (
  <header className="jv-loading-brand">
    <Bot aria-hidden="true" className="jv-loading-brand-icon" size={18} strokeWidth={2} />
    <div>
      <h1>Jarvis</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  </header>
);