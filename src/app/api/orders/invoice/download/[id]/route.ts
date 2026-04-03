process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { getOrderInvoiceById } from '@/app/lib/data/order-data';
import { NextResponse, NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.pathname.split('/').pop(); // 👈 Obtenemos el id del URL dinámicamente

    if (!id) {
      return new NextResponse('ID de orden no especificado', { status: 400 });
    }

    const pdfBuffer = await getOrderInvoiceById(id);

    if (!pdfBuffer) {
      return new NextResponse('Boleta no encontrada', { status: 404 });
    }

    return new NextResponse(new Uint8Array(pdfBuffer), {
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
