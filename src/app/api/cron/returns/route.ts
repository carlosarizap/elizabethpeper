import { refreshMarketplaceStatuses } from '@/app/lib/orders/status-refresh';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const result = await refreshMarketplaceStatuses(request.nextUrl.origin, 60);
  return NextResponse.json(result, { status: result.success ? 200 : 207 });
}
