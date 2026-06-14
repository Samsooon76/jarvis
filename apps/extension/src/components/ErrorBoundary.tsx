import { Component, type ErrorInfo, type ReactNode } from "react";
import { LoadingScreenBrand } from "./loading/LoadingScreenBrand";
import { captureAppError } from "../sentry";
import "./styles/loading.css";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: string | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error: error.message,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    captureAppError(error, {
      feature: "react",
      operation: "error_boundary",
      componentStack: errorInfo.componentStack ?? null,
    });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="jv-loading-screen" aria-live="polite">
          <LoadingScreenBrand />
          <p className="jv-loading-error">
            Une erreur d'affichage est survenue. Recharge Jarvis pour reprendre la session.
          </p>
        </main>
      );
    }

    return this.props.children;
  }
}
