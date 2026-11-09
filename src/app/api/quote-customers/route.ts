import { NextRequest, NextResponse } from 'next/server';
import { listQuotationCustomers } from '@/app/lib/quotes/repository';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get('search') ?? '';
    return NextResponse.json({ customers: await listQuotationCustomers(search) });
  } catch (error) {
    console.error('Error loading quotation customers:', error);
    return NextResponse.json({ error: 'No fue posible cargar los clientes.' }, { status: 500 });
  }
}

