import { refreshVisibleOrderStatuses } from '@/app/lib/orders/status-refresh';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_VISIBLE_ORDERS = 150;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const requestedIds: unknown[] = Array.isArray(body?.orderHeaderIds)
    ? body.orderHeaderIds
    : [];
  const orderHeaderIds: string[] = [
    ...new Set(
      requestedIds.filter(
        (value: unknown): value is string =>
          typeof value === 'string' && UUID_PATTERN.test(value),
      ),
    ),
  ];

  if (orderHeaderIds.length === 0) {
    return NextResponse.json(
      { error: 'No se recibieron órdenes visibles válidas.' },
      { status: 400 },
    );
  }

  if (orderHeaderIds.length > MAX_VISIBLE_ORDERS) {
    return NextResponse.json(
      { error: `Solo se pueden revisar hasta ${MAX_VISIBLE_ORDERS} órdenes.` },
      { status: 400 },
    );
  }

  const result = await refreshVisibleOrderStatuses(
    request.nextUrl.origin,
    orderHeaderIds,
  );

  return NextResponse.json(result, { status: result.success ? 200 : 207 });
}
