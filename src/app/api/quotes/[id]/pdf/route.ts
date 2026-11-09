import { NextRequest, NextResponse } from 'next/server';
import { createQuotationPdf } from '@/app/lib/quotes/pdf';
import { getQuotation } from '@/app/lib/quotes/repository';
import { isUuid } from '@/app/lib/quotes/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Cotización no válida.' }, { status: 400 });
  try {
    const quotation = await getQuotation(id);
    if (!quotation) return NextResponse.json({ error: 'Cotización no encontrada.' }, { status: 404 });
    const pdf = await createQuotationPdf(quotation);
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="cotizacion_${quotation.quoteNumber}.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('Error generating quotation PDF:', error);
    return NextResponse.json({ error: 'No fue posible generar el PDF.' }, { status: 500 });
  }
}

