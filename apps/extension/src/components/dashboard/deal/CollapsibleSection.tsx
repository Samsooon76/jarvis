import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type CollapsibleSectionProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  subtitle?: string;
  title: string;
};

export const CollapsibleSection = ({
  children,
  defaultOpen = false,
  subtitle,
  title,
}: CollapsibleSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`jv-collapsible${open ? " is-open" : ""}`}>
      <button
        aria-expanded={open}
        className="jv-collapsible-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="jv-collapsible-copy">
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
        <ChevronDown aria-hidden="true" className="jv-collapsible-icon" size={16} strokeWidth={1.75} />
      </button>
      {open ? <div className="jv-collapsible-body">{children}</div> : null}
    </section>
  );
};