import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { MARKETPLACES } from '@/app/lib/constants/marketplaces';
import type { DispatchPrintFailure, DispatchPrintResponse } from '@/app/lib/dispatches/definitions';
import {
  falabellaPrintError,
  prepareFalabellaLabelAndConfirm,
} from '@/app/lib/dispatches/falabella-print';
import { composeLetterLabelPdf } from '@/app/lib/mercadolibre/shipping-labels';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PrintBody {
  clientRequestId?: unknown;
  orderHeaderIds?: unknown;
}

interface Candidate {
  id: string;
  order_id: string;
  order_item_ids: string[];
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function POST(request: NextRequest) {
  let batchId: string | null = null;
  try {
    const body = await request.json() as PrintBody;
    const clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId : '';
    const rawIds = Array.isArray(body.orderHeaderIds)
      ? body.orderHeaderIds.filter((value): value is string => typeof value === 'string')
      : [];
    const orderHeaderIds = [...new Set(rawIds)];

    if (!UUID_PATTERN.test(clientRequestId)) {
      return NextResponse.json({ error: 'La solicitud de impresión no es válida.' }, { status: 400 });
    }
    if (
      orderHeaderIds.length === 0
      || orderHeaderIds.length > 100
      || orderHeaderIds.some((id) => !UUID_PATTERN.test(id))
    ) {
      return NextResponse.json({ error: 'Selecciona entre 1 y 100 órdenes válidas.' }, { status: 400 });
    }

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO dispatch_batch (client_request_id, marketplace, status, page_size)
       VALUES ($1, $2, 'processing', 'letter')
       RETURNING id`,
      [clientRequestId, MARKETPLACES.FALABELLA],
    );
    batchId = inserted.rows[0].id;

    const candidatesResult = await pool.query<Candidate>(
      `SELECT
         oh.id,
         oh.order_id,
         ARRAY_AGG(od.marketplace_item_id ORDER BY od.marketplace_item_id)
           FILTER (WHERE od.marketplace_item_id IS NOT NULL) AS order_item_ids
       FROM order_header oh
       JOIN order_detail od ON od.id_order_header = oh.id
       WHERE oh.id = ANY($1::uuid[])
         AND oh.marketplace = $2
         AND COALESCE(oh.status, 'pendiente') = 'pendiente'
         AND oh.delivery_date IS NOT NULL
         AND oh.delivery_date::date >= (NOW() AT TIME ZONE 'America/Santiago')::date
         AND LOWER(COALESCE(od.marketplace_status, '')) IN ('pending', 'ready_to_ship')
       GROUP BY oh.id, oh.order_id, oh.delivery_date
       ORDER BY oh.delivery_date::date, oh.order_id`,
      [orderHeaderIds, MARKETPLACES.FALABELLA],
    );

    const attempts = await mapWithConcurrency(candidatesResult.rows, 4, async (candidate) => {
      try {
        return {
          candidate,
          documents: await prepareFalabellaLabelAndConfirm({
            id: candidate.id,
            orderId: candidate.order_id,
            sellerCenterOrderId: candidate.order_id.split('-').at(-1) ?? candidate.order_id,
            orderItemIds: candidate.order_item_ids,
          }),
          error: null as string | null,
        };
      } catch (error) {
        return { candidate, documents: [] as Uint8Array[], error: falabellaPrintError(error) };
      }
    });
    const successful = attempts.filter((attempt) => !attempt.error && attempt.documents.length > 0);
    const failed = attempts.filter((attempt) => Boolean(attempt.error));

    if (successful.length === 0) {
      for (const attempt of failed) {
        await pool.query(
          `INSERT INTO dispatch_batch_item
             (dispatch_batch_id, id_order_header, status, error_message)
           VALUES ($1, $2, 'failed', $3)`,
          [batchId, attempt.candidate.id, attempt.error],
        );
      }
      await pool.query(
        `UPDATE dispatch_batch
         SET status = 'failed', completed_at = NOW(), error_message = $2
         WHERE id = $1`,
        [batchId, 'No se pudo obtener ninguna etiqueta Falabella.'],
      );
      return NextResponse.json(
        {
          error: 'Falabella todavía no habilita las etiquetas seleccionadas.',
          failures: failed.map((attempt) => ({
            orderId: attempt.candidate.order_id,
            shipmentId: null,
            message: attempt.error,
          })),
        },
        { status: 422 },
      );
    }

    const letterPdf = await composeLetterLabelPdf(
      successful.flatMap((attempt) => attempt.documents),
    );
    const status = failed.length > 0 ? 'partial' : 'completed';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const attempt of successful) {
        await client.query(
          `INSERT INTO dispatch_batch_item
             (dispatch_batch_id, id_order_header, status, print_requested_at)
           VALUES ($1, $2, 'completed', NOW())`,
          [batchId, attempt.candidate.id],
        );
      }
      for (const attempt of failed) {
        await client.query(
          `INSERT INTO dispatch_batch_item
             (dispatch_batch_id, id_order_header, status, error_message)
           VALUES ($1, $2, 'failed', $3)`,
          [batchId, attempt.candidate.id, attempt.error],
        );
      }
      await client.query(
        `UPDATE dispatch_batch
         SET status = $2, document_pdf = $3, document_mime_type = 'application/pdf',
             completed_at = NOW(), error_message = $4
         WHERE id = $1`,
        [
          batchId,
          status,
          Buffer.from(letterPdf),
          failed.length ? `${failed.length} etiqueta(s) Falabella no disponibles.` : null,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const failures: DispatchPrintFailure[] = failed.map((attempt) => ({
      orderId: attempt.candidate.order_id,
      shipmentId: null,
      message: attempt.error ?? 'Etiqueta no disponible.',
    }));
    const response: DispatchPrintResponse = {
      batchId,
      status,
      completedCount: successful.length,
      failures,
      documentUrl: `/api/dispatches/batches/${batchId}/document`,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error printing Falabella labels:', error);
    if (batchId) {
      await pool.query(
        `UPDATE dispatch_batch
         SET status = 'failed', completed_at = NOW(), error_message = $2
         WHERE id = $1 AND status = 'processing'`,
        [batchId, 'No fue posible preparar las etiquetas Falabella.'],
      ).catch(() => undefined);
    }
    return NextResponse.json(
      { error: 'No fue posible preparar las etiquetas Falabella.' },
      { status: 500 },
    );
  }
}
