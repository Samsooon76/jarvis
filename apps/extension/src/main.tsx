import React from "react";
import ReactDOM from "react-dom/client";
import { ExtensionApp } from "./ExtensionApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initSentry } from "./sentry";

initSentry();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ExtensionApp />
    </ErrorBoundary>
  </React.StrictMode>,
);
