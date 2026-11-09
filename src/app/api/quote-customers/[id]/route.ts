import { NextRequest, NextResponse } from 'next/server';
import { deleteQuotationCustomer } from '@/app/lib/quotes/repository';
import { isUuid } from '@/app/lib/quotes/validation';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Cliente no válido.' }, { status: 400 });
  try {
    const result = await deleteQuotationCustomer(id);
    if (result === 'deleted') return NextResponse.json({ deleted: true });
    if (result === 'in_use') {
      return NextResponse.json(
        { error: 'Este cliente todavía está usado por una cotización. Borra primero esa cotización.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Cliente no encontrado.' }, { status: 404 });
  } catch (error) {
    console.error('Error deleting quotation customer:', error);
    return NextResponse.json({ error: 'No fue posible borrar el cliente.' }, { status: 500 });
  }
}
