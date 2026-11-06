export function isWalmartReturnsNotFound(
  status: number,
  payload: unknown,
): boolean {
  if (status !== 404 || !payload || typeof payload !== 'object') return false;

  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;

  return (
    (error as { code?: unknown }).code === '404.ORDER_SERVICE.100' &&
    (error as { description?: unknown }).description === 'Returns not found'
  );
}
