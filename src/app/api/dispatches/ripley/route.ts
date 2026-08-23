import { NextResponse } from 'next/server';
import { fetchRipleyDispatchOrders } from '@/app/lib/dispatches/ripley-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await fetchRipleyDispatchOrders());
  } catch (error) {
    console.error('Error loading Ripley dispatches:', error);
    return NextResponse.json({ error: 'No fue posible cargar los despachos de Ripley.' }, { status: 500 });
  }
}
