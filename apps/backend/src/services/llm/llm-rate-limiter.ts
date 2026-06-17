const MAX_CONCURRENT_LLM_CALLS = 5;
const LLM_QUEUE_TIMEOUT_MS = 2 * 60 * 1000;

let activeCallCount = 0;
const waiters: Array<() => void> = [];

const acquireSlot = async (): Promise<() => void> => {
  if (activeCallCount < MAX_CONCURRENT_LLM_CALLS) {
    activeCallCount += 1;
    return releaseSlot;
  }

  return new Promise<() => void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const waiterIndex = waiters.indexOf(onReady);

      if (waiterIndex >= 0) {
        waiters.splice(waiterIndex, 1);
      }

      reject(new Error("Timeout d'attente du limiteur LLM."));
    }, LLM_QUEUE_TIMEOUT_MS);

    const onReady = (): void => {
      clearTimeout(timeout);
      activeCallCount += 1;
      resolve(releaseSlot);
    };

    waiters.push(onReady);
  });
};

const releaseSlot = (): void => {
  activeCallCount = Math.max(0, activeCallCount - 1);
  const nextWaiter = waiters.shift();

  if (nextWaiter) {
    nextWaiter();
  }
};

export const runWithLlmConcurrencyLimit = async <T>(operation: () => Promise<T>): Promise<T> => {
  const release = await acquireSlot();

  try {
    return await operation();
  } finally {
    release();
  }
};

export const extractOpenAiRateLimitRetryMs = (errorText: string): number | null => {
  const match = errorText.match(/try again in ([\d.]+)s/i);

  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return Math.ceil(seconds * 1_000) + 500;
};

export const waitMs = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

export const isTransientLlmError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("timeout") ||
    message.includes("abort") ||
    message.includes("openai error (429)") ||
    /^openai error \(5\d\d\)/i.test(error.message)
  );
};
