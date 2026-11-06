const MAX_RETRY_DELAY_MS = 15_000;

export function getMercadoLibreRetryDelayMs(
  status: number,
  retryAfter: string | null,
  attempt: number,
  maxRetries = 3,
): number | null {
  if (status !== 429 || attempt >= maxRetries) return null;

  const retryAfterSeconds = Number(retryAfter);
  const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : 1000 * 2 ** attempt;

  return Math.min(delay, MAX_RETRY_DELAY_MS);
}
