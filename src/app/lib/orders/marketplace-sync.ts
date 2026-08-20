export const MARKETPLACE_ORDER_ENDPOINTS = [
  '/api/mercadolibre/orders',
  '/api/falabella/orders',
  '/api/ripley/orders',
  '/api/paris/orders',
  '/api/walmart/orders',
  '/api/shopify/orders',
] as const;

export type MarketplaceSyncMode = 'orders' | 'returns';

export function getMarketplaceSyncMode(
  searchParams: Pick<URLSearchParams, 'get'>,
): MarketplaceSyncMode {
  return searchParams.get('mode') === 'returns' ? 'returns' : 'orders';
}

export function buildMarketplaceSyncUrl(
  origin: string,
  path: string,
  mode: MarketplaceSyncMode,
): string {
  const url = new URL(path, origin);
  url.searchParams.set('mode', mode);
  return url.toString();
}

export async function runMarketplaceSync(
  origin: string,
  mode: MarketplaceSyncMode,
) {
  const results = await Promise.all(
    MARKETPLACE_ORDER_ENDPOINTS.map(async (path) => {
      try {
        const response = await fetch(
          buildMarketplaceSyncUrl(origin, path, mode),
          { cache: 'no-store' },
        );
        const payload = await response.json().catch(() => null);
        return {
          path,
          ok: response.ok,
          status: response.status,
          payload,
        };
      } catch (error) {
        return {
          path,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return {
    mode,
    success: results.every((result) => result.ok),
    results,
  };
}
