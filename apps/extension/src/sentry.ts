import * as Sentry from "@sentry/react";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
const isSentryEnabled = Boolean(sentryDsn);

export const initSentry = (): void => {
  if (!isSentryEnabled) {
    return;
  }

  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });

  if (typeof window !== "undefined") {
    window.__jarvisTestSentry = () =>
      captureAppError(new Error("Jarvis frontend Sentry smoke test"), {
        feature: "debug",
        operation: "sentry_frontend_smoke_test",
        source: "react",
      });
  }
};

export const captureAppError = (
  error: unknown,
  context: Record<string, string | number | boolean | null>,
): string | null => {
  if (!isSentryEnabled) {
    return null;
  }

  return Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
    contexts: {
      jarvis: context,
    },
  });
};

export const setSentryUser = (user: { id: string; orgId?: string | null; role?: string | null } | null): void => {
  if (!isSentryEnabled) {
    return;
  }

  Sentry.setUser(
    user
      ? {
          id: user.id,
          orgId: user.orgId ?? undefined,
          role: user.role ?? undefined,
        }
      : null,
  );
};

declare global {
  interface Window {
    __jarvisTestSentry?: () => string | null;
  }
}
