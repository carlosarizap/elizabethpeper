process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { getOrderInvoiceById } from '@/app/lib/data/order-data';
import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;

  try {
    const pdfBuffer = await getOrderInvoiceById(id);

    if (!pdfBuffer) {
      return new NextResponse('Boleta no encontrada', { status: 404 });
    }

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="boleta_${id}.pdf"`,
      },
    });
  } catch (error) {
    console.error('Error en la API al descargar boleta:', error);
    return new NextResponse('Error interno al descargar la boleta', { status: 500 });
  }
}
