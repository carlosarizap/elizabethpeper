import { NextResponse } from 'next/server';
import { fetchParisDispatchOrders } from '@/app/lib/dispatches/paris-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await fetchParisDispatchOrders());
  } catch (error) {
    console.error('Error loading Paris dispatches:', error);
    return NextResponse.json({ error: 'No fue posible cargar los despachos de París.' }, { status: 500 });
  }
}
