import React from "react";
import ReactDOM from "react-dom/client";
import { ExtensionApp } from "./ExtensionApp";
import { initSentry } from "./sentry";

initSentry();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ExtensionApp />
  </React.StrictMode>,
);
