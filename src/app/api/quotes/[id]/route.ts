import { NextRequest, NextResponse } from 'next/server';
import { deleteQuotation, getQuotation, updateQuotation } from '@/app/lib/quotes/repository';
import { isUuid, parseQuotationInput } from '@/app/lib/quotes/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Cotización no válida.' }, { status: 400 });
  try {
    const quotation = await getQuotation(id);
    return quotation
      ? NextResponse.json({ quotation })
      : NextResponse.json({ error: 'Cotización no encontrada.' }, { status: 404 });
  } catch (error) {
    console.error('Error loading quotation:', error);
    return NextResponse.json({ error: 'No fue posible cargar la cotización.' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Cotización no válida.' }, { status: 400 });
  try {
    const input = parseQuotationInput(await request.json());
    const quotation = await updateQuotation(id, input);
    return quotation
      ? NextResponse.json({ quotation })
      : NextResponse.json({ error: 'Cotización no encontrada.' }, { status: 404 });
  } catch (error) {
    console.error('Error updating quotation:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No fue posible actualizar la cotización.' },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Cotización no válida.' }, { status: 400 });
  try {
    const deleted = await deleteQuotation(id);
    return deleted
      ? NextResponse.json({ deleted: true })
      : NextResponse.json({ error: 'Cotización no encontrada.' }, { status: 404 });
  } catch (error) {
    console.error('Error deleting quotation:', error);
    return NextResponse.json({ error: 'No fue posible borrar la cotización.' }, { status: 500 });
  }
}

