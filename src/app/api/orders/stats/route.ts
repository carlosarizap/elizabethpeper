import { fetchOrderStatsByMonth } from '@/app/lib/data/order-data';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || '');
  const month = parseInt(searchParams.get('month') || '');

  if (!year || !month) {
    return NextResponse.json({ error: 'Año o mes inválido' }, { status: 400 });
  }

  try {
    const stats = await fetchOrderStatsByMonth(year, month);
    return NextResponse.json(stats);
  } catch {
    return NextResponse.json({ error: 'Error al obtener estadísticas' }, { status: 500 });
  }
}
