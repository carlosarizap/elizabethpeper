import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Documento no válido.' }, { status: 400 });
  }

  const result = await pool.query<{
    document_pdf: Buffer | null;
    document_mime_type: string | null;
  }>(
    `SELECT document_pdf, document_mime_type
     FROM dispatch_batch
     WHERE id = $1 AND status IN ('completed', 'partial')`,
    [id],
  );
  const document = result.rows[0];
  if (!document?.document_pdf) {
    return NextResponse.json({ error: 'El documento no está disponible.' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(document.document_pdf), {
    headers: {
      'Content-Type': document.document_mime_type ?? 'application/pdf',
      'Content-Disposition': `inline; filename="etiquetas_despacho_${id}.pdf"`,
      'Cache-Control': 'private, no-store, max-age=0',
    },
  });
}
