import { NextResponse } from 'next/server';
import { fetchWalmartDispatchOrders } from '@/app/lib/dispatches/walmart-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await fetchWalmartDispatchOrders(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Error loading Walmart dispatches:', error);
    return NextResponse.json(
      { error: 'No fue posible cargar los despachos de Walmart.' },
      { status: 500 },
    );
  }
}
