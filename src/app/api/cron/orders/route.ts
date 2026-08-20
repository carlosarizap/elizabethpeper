import { runMarketplaceSync } from '@/app/lib/orders/marketplace-sync';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const result = await runMarketplaceSync(request.nextUrl.origin, 'orders');
  return NextResponse.json(result, { status: result.success ? 200 : 207 });
}
