import { NextRequest, NextResponse } from 'next/server';
import type { QuotationStatus } from '@/app/lib/quotes/definitions';
import { changeQuotationStatus } from '@/app/lib/quotes/repository';
import { isUuid } from '@/app/lib/quotes/validation';

const statuses = new Set<QuotationStatus>(['draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled']);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Cotización no válida.' }, { status: 400 });
  try {
    const body = await request.json() as { status?: unknown; note?: unknown };
    if (typeof body.status !== 'string' || !statuses.has(body.status as QuotationStatus)) {
      return NextResponse.json({ error: 'El estado indicado no es válido.' }, { status: 400 });
    }
    const quotation = await changeQuotationStatus(
      id,
      body.status as QuotationStatus,
      typeof body.note === 'string' ? body.note.trim() || null : null,
    );
    return quotation
      ? NextResponse.json({ quotation })
      : NextResponse.json({ error: 'Cotización no encontrada.' }, { status: 404 });
  } catch (error) {
    console.error('Error changing quotation status:', error);
    return NextResponse.json({ error: 'No fue posible cambiar el estado.' }, { status: 500 });
  }
}

