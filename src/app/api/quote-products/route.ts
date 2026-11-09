import { NextRequest, NextResponse } from 'next/server';
import { listQuotationCatalogOptions } from '@/app/lib/quotes/repository';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get('search') ?? '';
    return NextResponse.json({ products: await listQuotationCatalogOptions(search) });
  } catch (error) {
    console.error('Error loading quotation catalog:', error);
    return NextResponse.json({ error: 'No fue posible cargar el catálogo.' }, { status: 500 });
  }
}

