import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureAppError } from "../sentry";

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
        <main className="ae-loading-screen">
          <h1>Jarvis</h1>
          <p>Une erreur d'affichage est survenue. Recharge Jarvis pour reprendre la session.</p>
        </main>
      );
    }

    return this.props.children;
  }
}
