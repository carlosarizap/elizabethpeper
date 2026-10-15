export interface FalabellaOrderPage<T> {
  orders: T[];
  totalCount: number | null;
}

interface FalabellaOrdersPayload<T> {
  SuccessResponse?: {
    Head?: {
      TotalCount?: unknown;
    };
    Body?: {
      Orders?: {
        Order?: T | T[];
      };
      Order?: T | T[];
    };
  };
}

export function readFalabellaOrderPage<T>(
  payload: FalabellaOrdersPayload<T> | null | undefined,
): FalabellaOrderPage<T> {
  const rawOrders =
    payload?.SuccessResponse?.Body?.Orders?.Order ??
    payload?.SuccessResponse?.Body?.Order ??
    [];
  const rawTotalCount = payload?.SuccessResponse?.Head?.TotalCount;
  const parsedTotalCount = Number(rawTotalCount);

  return {
    orders: Array.isArray(rawOrders) ? rawOrders : [rawOrders],
    totalCount:
      Number.isSafeInteger(parsedTotalCount) && parsedTotalCount >= 0
        ? parsedTotalCount
        : null,
  };
}

export async function fetchAllFalabellaOrderPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<FalabellaOrderPage<T>>,
  pageSize = 100,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error('El tamaño de página de Falabella debe ser un entero positivo.');
  }

  const orders: T[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchPage(offset, pageSize);
    orders.push(...page.orders);

    if (page.orders.length === 0) break;

    offset += page.orders.length;
    if (page.totalCount !== null) {
      if (offset >= page.totalCount) break;
    } else if (page.orders.length < pageSize) {
      break;
    }
  }

  return orders;
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error('La concurrencia debe ser un entero positivo.');
  }

  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  );

  return results;
}
