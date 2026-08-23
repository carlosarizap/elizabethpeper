import { NextResponse } from 'next/server';
import { fetchMercadoLibreDispatchOrders } from '@/app/lib/dispatches/dispatch-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await fetchMercadoLibreDispatchOrders(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Error loading Mercado Libre dispatches:', error);
    return NextResponse.json(
      { error: 'No fue posible cargar los despachos de Mercado Libre.' },
      { status: 500 },
    );
  }
}
