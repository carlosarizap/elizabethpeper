import { getOrderCreditNoteById } from '@/app/lib/data/order-data';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.pathname.split('/').pop();

    if (!id) {
      return new NextResponse('ID de orden no especificado', { status: 400 });
    }

    const pdfBuffer = await getOrderCreditNoteById(id);

    if (!pdfBuffer) {
      return new NextResponse('Nota de crédito no encontrada', { status: 404 });
    }

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="nota_credito_${id}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Error al descargar la nota de crédito:', error);
    return new NextResponse('Error interno al descargar la nota de crédito', {
      status: 500,
    });
  }
}
