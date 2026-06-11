export const getNowMs = (): number => performance.now();

export const formatDurationMs = (startedAtMs: number): number =>
  Math.round((getNowMs() - startedAtMs) * 100) / 100;
