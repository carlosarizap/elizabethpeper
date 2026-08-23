import { NextResponse } from 'next/server';
import { fetchFalabellaDispatchOrders } from '@/app/lib/dispatches/falabella-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await fetchFalabellaDispatchOrders(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Error loading Falabella dispatches:', error);
    return NextResponse.json(
      { error: 'No fue posible cargar los despachos de Falabella.' },
      { status: 500 },
    );
  }
}
