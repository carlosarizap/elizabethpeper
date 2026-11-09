import { NextRequest, NextResponse } from 'next/server';
import { createQuotation, listQuotations } from '@/app/lib/quotes/repository';
import type { QuotationStatus } from '@/app/lib/quotes/definitions';
import { parseQuotationInput } from '@/app/lib/quotes/validation';

export const dynamic = 'force-dynamic';

const statuses = new Set<QuotationStatus>(['draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled']);

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get('search') ?? '';
    const requestedStatus = request.nextUrl.searchParams.get('status') ?? 'all';
    const status = statuses.has(requestedStatus as QuotationStatus)
      ? requestedStatus as QuotationStatus
      : 'all';
    return NextResponse.json({ quotations: await listQuotations({ search, status }) });
  } catch (error) {
    console.error('Error loading quotations:', error);
    return NextResponse.json({ error: 'No fue posible cargar las cotizaciones.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = parseQuotationInput(await request.json());
    return NextResponse.json({ quotation: await createQuotation(input) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible guardar la cotización.';
    const isValidationError = !/database|connection|relation|column/i.test(message);
    console.error('Error creating quotation:', error);
    return NextResponse.json({ error: message }, { status: isValidationError ? 400 : 500 });
  }
}

