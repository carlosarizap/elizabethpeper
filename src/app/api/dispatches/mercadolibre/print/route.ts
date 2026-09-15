import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { MARKETPLACES } from '@/app/lib/constants/marketplaces';
import type { DispatchPrintFailure, DispatchPrintResponse } from '@/app/lib/dispatches/definitions';
import {
  composeLetterLabelPdf,
  downloadMercadoLibreLabelPdf,
  fetchMercadoLibreShipmentSnapshot,
  getMercadoLibreLabelEligibility,
  type MercadoLibreShipmentSnapshot,
} from '@/app/lib/mercadolibre/shipping-labels';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PrintRequestBody {
  clientRequestId?: unknown;
  orderHeaderIds?: unknown;
}

interface CandidateRow {
  order_header_id: string;
  order_id: string;
  shipment_id: string | null;
  external_shipment_id: string | null;
}

interface ReadyCandidate extends CandidateRow {
  shipment_id: string;
  external_shipment_id: string;
  snapshot: MercadoLibreShipmentSnapshot;
}

interface FailedCandidate {
  candidate: CandidateRow;
  message: string;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Ocurrió un error inesperado.';
  if (error.message.startsWith('Mercado Libre respondió')) {
    const status = error.message.match(/respondió (\d+)/)?.[1];
    return status
      ? `Mercado Libre rechazó la solicitud (código ${status}).`
      : 'Mercado Libre rechazó la solicitud.';
  }
  return error.message.slice(0, 300);
}

function failure(candidate: CandidateRow, message: string): DispatchPrintFailure {
  return {
    orderId: candidate.order_id,
    shipmentId: candidate.external_shipment_id,
    message,
  };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function existingBatchResponse(clientRequestId: string) {
  const result = await pool.query<{
    id: string;
    status: string;
    document_pdf: Buffer | null;
    completed_count: string;
  }>(
    `SELECT db.id, db.status, db.document_pdf,
       COUNT(*) FILTER (WHERE dbi.status = 'completed') AS completed_count
     FROM dispatch_batch db
     LEFT JOIN dispatch_batch_item dbi ON dbi.dispatch_batch_id = db.id
     WHERE db.client_request_id = $1
     GROUP BY db.id`,
    [clientRequestId],
  );
  const batch = result.rows[0];
  if (!batch) return null;

  if (batch.document_pdf && ['completed', 'partial'].includes(batch.status)) {
    const failuresResult = await pool.query<{
      order_id: string;
      external_shipment_id: string | null;
      error_message: string | null;
    }>(
      `SELECT oh.order_id, ms.external_shipment_id, dbi.error_message
       FROM dispatch_batch_item dbi
       JOIN order_header oh ON oh.id = dbi.id_order_header
       LEFT JOIN marketplace_shipment ms ON ms.id = dbi.marketplace_shipment_id
       WHERE dbi.dispatch_batch_id = $1 AND dbi.status = 'failed'`,
      [batch.id],
    );
    const response: DispatchPrintResponse = {
      batchId: batch.id,
      status: batch.status as DispatchPrintResponse['status'],
      completedCount: Number(batch.completed_count),
      failures: failuresResult.rows.map((row) => ({
        orderId: row.order_id,
        shipmentId: row.external_shipment_id,
        message: row.error_message ?? 'No fue posible obtener esta etiqueta.',
      })),
      documentUrl: `/api/dispatches/batches/${batch.id}/document`,
    };
    return NextResponse.json(response);
  }

  return NextResponse.json(
    { error: batch.status === 'processing' ? 'Esta impresión todavía está en proceso.' : 'Esta impresión falló. Intenta nuevamente.' },
    { status: 409 },
  );
}

export async function POST(request: NextRequest) {
  let batchId: string | null = null;

  try {
    const body = await request.json() as PrintRequestBody;
    const clientRequestId = typeof body.clientRequestId === 'string'
      ? body.clientRequestId
      : '';
    const requestedIds = Array.isArray(body.orderHeaderIds)
      ? body.orderHeaderIds.filter((value): value is string => typeof value === 'string')
      : [];
    const orderHeaderIds = [...new Set(requestedIds)];

    if (!UUID_PATTERN.test(clientRequestId)) {
      return NextResponse.json({ error: 'La solicitud de impresión no es válida.' }, { status: 400 });
    }
    if (
      orderHeaderIds.length === 0
      || orderHeaderIds.length > 200
      || orderHeaderIds.some((id) => !UUID_PATTERN.test(id))
    ) {
      return NextResponse.json(
        { error: 'Selecciona entre 1 y 200 órdenes válidas.' },
        { status: 400 },
      );
    }

    const previous = await existingBatchResponse(clientRequestId);
    if (previous) return previous;

    const batchResult = await pool.query<{ id: string }>(
      `INSERT INTO dispatch_batch (client_request_id, marketplace, status, page_size)
       VALUES ($1, $2, 'processing', 'letter')
       RETURNING id`,
      [clientRequestId, MARKETPLACES.MERCADO_LIBRE],
    );
    batchId = batchResult.rows[0].id;

    const candidatesResult = await pool.query<CandidateRow>(
      `SELECT
         oh.id AS order_header_id,
         oh.order_id,
         ms.id AS shipment_id,
         ms.external_shipment_id
       FROM order_header oh
       LEFT JOIN marketplace_shipment ms
         ON ms.id_order_header = oh.id
        AND ms.marketplace = $1
       WHERE oh.id = ANY($2::uuid[])
         AND oh.marketplace = $1
         AND (
           oh.delivery_date IS NULL
           OR oh.delivery_date::date >= (NOW() AT TIME ZONE 'America/Santiago')::date
         )
         AND COALESCE(oh.status, 'pendiente') = 'pendiente'
       ORDER BY oh.delivery_date::date NULLS FIRST, oh.order_id, ms.external_shipment_id`,
      [MARKETPLACES.MERCADO_LIBRE, orderHeaderIds],
    );

    const preflight = await mapWithConcurrency<CandidateRow, ReadyCandidate | FailedCandidate>(
      candidatesResult.rows,
      6,
      async (candidate) => {
        if (!candidate.shipment_id || !candidate.external_shipment_id) {
          return { candidate, message: 'El envío todavía no está sincronizado.' };
        }
        try {
          const snapshot = await fetchMercadoLibreShipmentSnapshot(candidate.external_shipment_id);
          await pool.query(
            `UPDATE marketplace_shipment
             SET status = $1, substatus = $2, shipping_mode = $3,
                 logistic_type = $4, tracking_number = $5, updated_at = NOW()
             WHERE id = $6`,
            [
              snapshot.status,
              snapshot.substatus,
              snapshot.mode,
              snapshot.logisticType,
              snapshot.trackingNumber,
              candidate.shipment_id,
            ],
          );
          const eligibility = getMercadoLibreLabelEligibility(snapshot);
          if (!eligibility.eligible) {
            return { candidate, message: eligibility.reason ?? 'La etiqueta no está disponible.' };
          }
          return {
            ...candidate,
            shipment_id: candidate.shipment_id,
            external_shipment_id: candidate.external_shipment_id,
            snapshot,
          };
        } catch (error) {
          return { candidate, message: errorMessage(error) };
        }
      },
    );

    const ready = preflight.filter((item): item is ReadyCandidate => 'snapshot' in item);
    const failed: FailedCandidate[] = preflight.filter(
      (item): item is FailedCandidate => !('snapshot' in item),
    );
    const completed: ReadyCandidate[] = [];
    const sourceDocuments: Uint8Array[] = [];

    for (const group of chunks(ready, 50)) {
      try {
        sourceDocuments.push(
          await downloadMercadoLibreLabelPdf(group.map((item) => item.external_shipment_id)),
        );
        completed.push(...group);
      } catch (error) {
        const message = errorMessage(error);
        failed.push(...group.map((candidate) => ({ candidate, message })));
      }
    }

    if (completed.length === 0) {
      for (const item of failed) {
        await pool.query(
          `INSERT INTO dispatch_batch_item
             (dispatch_batch_id, id_order_header, marketplace_shipment_id, status, error_message)
           VALUES ($1, $2, $3, 'failed', $4)`,
          [batchId, item.candidate.order_header_id, item.candidate.shipment_id, item.message],
        );
      }
      await pool.query(
        `UPDATE dispatch_batch
         SET status = 'failed', completed_at = NOW(), error_message = $2
         WHERE id = $1`,
        [batchId, 'No se pudo obtener ninguna etiqueta.'],
      );
      return NextResponse.json(
        {
          error: 'No se pudo obtener ninguna etiqueta.',
          failures: failed.map((item) => failure(item.candidate, item.message)),
        },
        { status: 422 },
      );
    }

    const letterPdf = await composeLetterLabelPdf(sourceDocuments);
    const client = await pool.connect();
    const batchStatus = failed.length === 0 ? 'completed' : 'partial';
    try {
      await client.query('BEGIN');
      for (const item of completed) {
        await client.query(
          `INSERT INTO dispatch_batch_item
             (dispatch_batch_id, id_order_header, marketplace_shipment_id, status, print_requested_at)
           VALUES ($1, $2, $3, 'completed', NOW())`,
          [batchId, item.order_header_id, item.shipment_id],
        );
      }
      for (const item of failed) {
        await client.query(
          `INSERT INTO dispatch_batch_item
             (dispatch_batch_id, id_order_header, marketplace_shipment_id, status, error_message)
           VALUES ($1, $2, $3, 'failed', $4)`,
          [batchId, item.candidate.order_header_id, item.candidate.shipment_id, item.message],
        );
      }
      await client.query(
        `UPDATE dispatch_batch
         SET status = $2, document_pdf = $3, document_mime_type = 'application/pdf',
             completed_at = NOW(), error_message = $4
         WHERE id = $1`,
        [
          batchId,
          batchStatus,
          Buffer.from(letterPdf),
          failed.length > 0 ? `${failed.length} etiqueta(s) no pudieron incluirse.` : null,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const response: DispatchPrintResponse = {
      batchId,
      status: batchStatus,
      completedCount: completed.length,
      failures: failed.map((item) => failure(item.candidate, item.message)),
      documentUrl: `/api/dispatches/batches/${batchId}/document`,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error printing Mercado Libre labels:', error);
    if (batchId) {
      await pool.query(
        `UPDATE dispatch_batch
         SET status = 'failed', completed_at = NOW(), error_message = $2
         WHERE id = $1 AND status = 'processing'`,
        [batchId, errorMessage(error)],
      ).catch((updateError) => console.error('Error updating failed dispatch batch:', updateError));
    }
    return NextResponse.json(
      { error: 'No fue posible preparar las etiquetas. Intenta nuevamente.' },
      { status: 500 },
    );
  }
}
