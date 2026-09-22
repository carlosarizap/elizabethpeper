import { NextResponse } from 'next/server';
import { runDueProductPromotions } from '@/app/lib/products/promotion-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  const result = await runDueProductPromotions();
  return NextResponse.json(result, { status: result.success ? 200 : 207 });
}
