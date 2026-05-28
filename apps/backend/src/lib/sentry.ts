import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";

let isSentryInitialized = false;

export const initSentry = (): void => {
  if (!env.sentryDsn || isSentryInitialized) {
    return;
  }

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    tracesSampleRate: env.sentryTracesSampleRate,
    integrations: [Sentry.fastifyIntegration()],
  });

  isSentryInitialized = true;
};

export const registerSentryErrorHandler = (app: Parameters<typeof Sentry.setupFastifyErrorHandler>[0]): void => {
  if (!isSentryInitialized) {
    return;
  }

  Sentry.setupFastifyErrorHandler(app);
};

export const captureServerError = async (
  error: unknown,
  context: Record<string, string | number | boolean | null>,
): Promise<{ eventId: string | null; flushed: boolean }> => {
  if (!isSentryInitialized) {
    return {
      eventId: null,
      flushed: false,
    };
  }

  const eventId = Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
    contexts: {
      jarvis: context,
    },
  });

  const flushed = await Sentry.flush(5_000);

  return {
    eventId,
    flushed,
  };
};

export const isSentryReady = (): boolean => isSentryInitialized;

export const getSentryDsnProjectId = (): string | null => {
  const match = /\/([0-9]+)$/.exec(env.sentryDsn);

  return match?.[1] ?? null;
};

export const setRequestSentryUser = (user: { id: string; orgId?: string | null; role?: string | null } | null): void => {
  if (!isSentryInitialized) {
    return;
  }

  Sentry.getIsolationScope().setUser(
    user
      ? {
          id: user.id,
          orgId: user.orgId ?? undefined,
          role: user.role ?? undefined,
        }
      : null,
  );
};
