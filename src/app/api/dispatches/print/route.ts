import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { MARKETPLACES } from '@/app/lib/constants/marketplaces';
import type { DispatchPrintFailure, DispatchPrintResponse } from '@/app/lib/dispatches/definitions';
import {
  falabellaManifestError,
  falabellaPrintError,
  prepareFalabellaLabelAndConfirm,
} from '@/app/lib/dispatches/falabella-print';
import { createFalabellaForwardManifestPdfs } from '@/app/lib/falabella/seller-center-client';
import { composeFalabellaLabelsLetterGridPdf } from '@/app/lib/falabella/shipping-label-layout';
import {
  composeLetterLabelPdf,
  downloadMercadoLibreLabelPdf,
  fetchMercadoLibreShipmentSnapshot,
  getMercadoLibreLabelEligibility,
  type LetterLabelSource,
  type MercadoLibreShipmentSnapshot,
} from '@/app/lib/mercadolibre/shipping-labels';
import { getParisUploadAccessToken } from '@/app/lib/paris/token-manager';
import {
  composeParisLabelsLetterGridPdf,
  downloadParisShippingLabelPdfs,
  parisLabelError,
  type ParisLabelPrintInput,
} from '@/app/lib/paris/shipping-labels';
import {
  downloadRipleyShippingLabels,
  ripleySvcError,
} from '@/app/lib/ripley/svc-client';
import {
  composeWalmartLabelsWithProductSummaryPdf,
  prepareWalmartShippingLabelPdfs,
  walmartLabelError,
  type WalmartLabelPrintInput,
} from '@/app/lib/walmart/shipping-labels';

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
  marketplace: string;
  shipment_id: string | null;
  external_shipment_id: string | null;
  order_item_ids: string[] | null;
  product_summary: string | null;
  has_completed_print: boolean;
}

interface MercadoLibreReady extends Candidate {
  shipment_id: string;
  external_shipment_id: string;
  snapshot: MercadoLibreShipmentSnapshot;
}

interface Completed {
  candidate: Candidate;
  shipmentId: string | null;
}

interface Failed {
  candidate: Candidate;
  message: string;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
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

function mercadoLibreError(error: unknown): string {
  if (!(error instanceof Error)) return 'No fue posible obtener la etiqueta desde Mercado Libre.';
  const status = error.message.match(/Mercado Libre respondi. (\d+)/)?.[1];
  if (status) return `Mercado Libre rechazó la solicitud (código ${status}).`;
  return error.message.slice(0, 300);
}

function toFailure(item: Failed): DispatchPrintFailure {
  return {
    orderId: item.candidate.order_id,
    shipmentId: item.candidate.external_shipment_id,
    marketplace: item.candidate.marketplace,
    message: item.message,
  };
}

export async function POST(request: NextRequest) {
  let batchId: string | null = null;
  try {
    const body = await request.json() as PrintBody;
    const clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId : '';
    const ids = [...new Set(
      (Array.isArray(body.orderHeaderIds) ? body.orderHeaderIds : [])
        .filter((value): value is string => typeof value === 'string'),
    )];

    if (!UUID_PATTERN.test(clientRequestId)) {
      return NextResponse.json({ error: 'La solicitud de impresión no es válida.' }, { status: 400 });
    }
    if (ids.length === 0 || ids.length > 200 || ids.some((id) => !UUID_PATTERN.test(id))) {
      return NextResponse.json({ error: 'Selecciona entre 1 y 200 órdenes válidas.' }, { status: 400 });
    }

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO dispatch_batch (client_request_id, marketplace, status, page_size)
       VALUES ($1, 'mixed', 'processing', 'letter')
       RETURNING id`,
      [clientRequestId],
    );
    batchId = inserted.rows[0].id;

    const candidatesResult = await pool.query<Candidate>(
      `SELECT
         oh.id,
         oh.order_id,
         oh.marketplace,
         ms.id AS shipment_id,
         ms.external_shipment_id,
         items.order_item_ids,
         items.product_summary,
         EXISTS (
           SELECT 1
           FROM dispatch_batch_item printed
           WHERE printed.id_order_header = oh.id
             AND printed.status = 'completed'
         ) AS has_completed_print
       FROM order_header oh
       LEFT JOIN LATERAL (
         SELECT shipment.id, shipment.external_shipment_id
         FROM marketplace_shipment shipment
         WHERE shipment.id_order_header = oh.id
           AND shipment.marketplace = $1
         ORDER BY shipment.updated_at DESC
         LIMIT 1
       ) ms ON true
       LEFT JOIN LATERAL (
         SELECT
           ARRAY_AGG(od.marketplace_item_id ORDER BY od.marketplace_item_id)
             FILTER (WHERE od.marketplace_item_id IS NOT NULL) AS order_item_ids,
           (
             SELECT STRING_AGG(
               grouped.total_quantity::text || ' - ' || grouped.product_title,
               E'\n' ORDER BY grouped.product_title
             )
             FROM (
               SELECT
                 COALESCE(NULLIF(TRIM(grouped_od.product_title), ''), 'Producto sin nombre') AS product_title,
                 SUM(grouped_od.product_quantity) AS total_quantity
               FROM order_detail grouped_od
               WHERE grouped_od.id_order_header = oh.id
               GROUP BY COALESCE(NULLIF(TRIM(grouped_od.product_title), ''), 'Producto sin nombre')
             ) grouped
           ) AS product_summary
         FROM order_detail od
         WHERE od.id_order_header = oh.id
       ) items ON true
       WHERE oh.id = ANY($6::uuid[])
         AND oh.marketplace IN ($1, $2, $3, $4, $5)
         AND (
           oh.delivery_date::date >= (NOW() AT TIME ZONE 'America/Santiago')::date
           OR (oh.marketplace = $1 AND oh.delivery_date IS NULL)
         )
         AND (
           COALESCE(oh.status, 'pendiente') = 'pendiente'
           OR (
             oh.marketplace = $5
             AND LOWER(COALESCE(oh.status, '')) IN ('created', 'acknowledged')
           )
         )
       ORDER BY oh.delivery_date::date NULLS FIRST, oh.marketplace, oh.order_id`,
      [
        MARKETPLACES.MERCADO_LIBRE,
        MARKETPLACES.FALABELLA,
        MARKETPLACES.PARIS,
        MARKETPLACES.RIPLEY,
        MARKETPLACES.WALMART,
        ids,
      ],
    );

    const sourceDocuments: LetterLabelSource[] = [];
    const completed: Completed[] = [];
    const failed: Failed[] = [];

    const mercadoLibreCandidates = candidatesResult.rows.filter(
      (candidate) => candidate.marketplace === MARKETPLACES.MERCADO_LIBRE,
    );
    const mercadoLibrePreflight = await mapWithConcurrency<Candidate, MercadoLibreReady | Failed>(
      mercadoLibreCandidates,
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
          return { candidate, message: mercadoLibreError(error) };
        }
      },
    );
    const mercadoLibreReady = mercadoLibrePreflight.filter(
      (item): item is MercadoLibreReady => 'snapshot' in item,
    );
    failed.push(...mercadoLibrePreflight.filter((item): item is Failed => !('snapshot' in item)));
    for (const group of chunks(mercadoLibreReady, 50)) {
      try {
        sourceDocuments.push({
          bytes: await downloadMercadoLibreLabelPdf(
            group.map((candidate) => candidate.external_shipment_id),
          ),
          orientation: 'landscape',
        });
        completed.push(...group.map((candidate) => ({
          candidate,
          shipmentId: candidate.shipment_id,
        })));
      } catch (error) {
        const message = mercadoLibreError(error);
        failed.push(...group.map((candidate) => ({ candidate, message })));
      }
    }

    const falabellaCandidates = candidatesResult.rows.filter(
      (candidate) => candidate.marketplace === MARKETPLACES.FALABELLA,
    );
    const falabellaDocuments: Uint8Array[] = [];
    const falabellaManifestDocuments: Uint8Array[] = [];
    const falabellaAttempts = await mapWithConcurrency(falabellaCandidates, 4, async (candidate) => {
      try {
        const prepared = await prepareFalabellaLabelAndConfirm({
          id: candidate.id,
          orderId: candidate.order_id,
          sellerCenterOrderId: candidate.order_id.split('-').at(-1) ?? candidate.order_id,
          orderItemIds: candidate.order_item_ids ?? [],
        });
        return { candidate, prepared, message: null as string | null };
      } catch (error) {
        return { candidate, prepared: null, message: falabellaPrintError(error) };
      }
    });
    const falabellaManifestCandidates = falabellaAttempts.filter(
      (attempt) => !attempt.message && attempt.prepared && !attempt.candidate.has_completed_print,
    );
    const falabellaManifestBlocked = new Set<string>();
    if (falabellaManifestCandidates.length > 0) {
      try {
        falabellaManifestDocuments.push(...await createFalabellaForwardManifestPdfs(
          falabellaManifestCandidates.flatMap((attempt) => attempt.prepared?.orderItemIds ?? []),
        ));
      } catch (error) {
        const message = falabellaManifestError(error);
        for (const attempt of falabellaManifestCandidates) {
          falabellaManifestBlocked.add(attempt.candidate.id);
          failed.push({ candidate: attempt.candidate, message });
        }
      }
    }
    for (const attempt of falabellaAttempts) {
      if (attempt.message) failed.push({ candidate: attempt.candidate, message: attempt.message });
      else if (attempt.prepared && !falabellaManifestBlocked.has(attempt.candidate.id)) {
        falabellaDocuments.push(...attempt.prepared.documents);
        completed.push({ candidate: attempt.candidate, shipmentId: null });
      }
    }
    if (falabellaDocuments.length > 0) {
      sourceDocuments.push(await composeFalabellaLabelsLetterGridPdf(falabellaDocuments));
    }
    sourceDocuments.push(...falabellaManifestDocuments);

    const parisCandidates = candidatesResult.rows.filter(
      (candidate) => candidate.marketplace === MARKETPLACES.PARIS,
    );
    const parisDocuments: ParisLabelPrintInput[] = [];
    if (parisCandidates.length > 0) {
      let parisAccessToken: string | null = null;
      try {
        parisAccessToken = await getParisUploadAccessToken();
      } catch (error) {
        const message = parisLabelError(error);
        failed.push(...parisCandidates.map((candidate) => ({ candidate, message })));
      }

      if (parisAccessToken) {
        // El gateway de París se vuelve inestable ante ráfagas grandes. Dos
        // workers mantienen buen rendimiento sin golpear todos los labels a la vez.
        const parisAttempts = await mapWithConcurrency(parisCandidates, 2, async (candidate) => {
          try {
            const documents = await downloadParisShippingLabelPdfs(
              candidate.order_id,
              parisAccessToken,
            );
            return { candidate, documents, message: null as string | null };
          } catch (error) {
            return { candidate, documents: [] as Uint8Array[], message: parisLabelError(error) };
          }
        });
        for (const attempt of parisAttempts) {
          if (attempt.message) failed.push({ candidate: attempt.candidate, message: attempt.message });
          else {
            parisDocuments.push(...attempt.documents.map((document) => ({
              document,
              orderId: attempt.candidate.order_id,
              productSummary: attempt.candidate.product_summary,
            })));
            completed.push({ candidate: attempt.candidate, shipmentId: null });
          }
        }
      }
    }
    if (parisDocuments.length > 0) {
      sourceDocuments.push(await composeParisLabelsLetterGridPdf(parisDocuments));
    }

    const ripleyCandidates = candidatesResult.rows.filter(
      (candidate) => candidate.marketplace === MARKETPLACES.RIPLEY,
    );
    if (ripleyCandidates.length > 0) {
      try {
        const result = await downloadRipleyShippingLabels(
          ripleyCandidates.map((candidate) => candidate.order_id),
        );
        if (result.document) sourceDocuments.push(result.document);

        const completedIds = new Set(result.completedOrderIds);
        const candidatesByOrderId = new Map(
          ripleyCandidates.map((candidate) => [candidate.order_id, candidate]),
        );
        completed.push(...ripleyCandidates
          .filter((candidate) => completedIds.has(candidate.order_id))
          .map((candidate) => ({ candidate, shipmentId: null })));
        failed.push(...result.failures.map((failure) => ({
          candidate: candidatesByOrderId.get(failure.orderId) ?? {
            ...ripleyCandidates[0],
            order_id: failure.orderId,
          },
          message: failure.message,
        })));
      } catch (error) {
        const message = ripleySvcError(error);
        failed.push(...ripleyCandidates.map((candidate) => ({ candidate, message })));
      }
    }

    const walmartCandidates = candidatesResult.rows.filter(
      (candidate) => candidate.marketplace === MARKETPLACES.WALMART,
    );
    const walmartDocuments: WalmartLabelPrintInput[] = [];
    const walmartAttempts = await mapWithConcurrency(walmartCandidates, 3, async (candidate) => {
      try {
        const result = await prepareWalmartShippingLabelPdfs(candidate.order_id);
        return {
          candidate,
          documents: result.documents,
          acknowledged: result.acknowledged,
          message: null as string | null,
        };
      } catch (error) {
        return {
          candidate,
          documents: [] as Uint8Array[],
          acknowledged: false,
          message: walmartLabelError(error),
        };
      }
    });
    for (const attempt of walmartAttempts) {
      if (attempt.message) {
        failed.push({ candidate: attempt.candidate, message: attempt.message });
      } else {
        walmartDocuments.push(...attempt.documents.map((document) => ({
          document,
          orderId: attempt.candidate.order_id,
          productSummary: attempt.candidate.product_summary,
        })));
        completed.push({ candidate: attempt.candidate, shipmentId: null });
        await pool.query(
          `UPDATE order_detail
           SET marketplace_status = 'Acknowledged', status_updated_at = NOW(), updated_at = NOW()
           WHERE id_order_header = $1
             AND LOWER(COALESCE(status, 'pendiente')) = 'pendiente'`,
          [attempt.candidate.id],
        );
        await pool.query(
          `UPDATE order_header
           SET status = 'pendiente', updated_at = NOW()
           WHERE id = $1
             AND LOWER(COALESCE(status, 'pendiente')) IN ('created', 'acknowledged')`,
          [attempt.candidate.id],
        );
      }
    }
    if (walmartDocuments.length > 0) {
      sourceDocuments.push(await composeWalmartLabelsWithProductSummaryPdf(walmartDocuments));
    }

    if (completed.length === 0) {
      for (const item of failed) {
        await pool.query(
          `INSERT INTO dispatch_batch_item
             (dispatch_batch_id, id_order_header, marketplace_shipment_id, status, error_message)
           VALUES ($1, $2, $3, 'failed', $4)`,
          [batchId, item.candidate.id, item.candidate.shipment_id, item.message],
        );
      }
      await pool.query(
        `UPDATE dispatch_batch
         SET status = 'failed', completed_at = NOW(), error_message = $2
         WHERE id = $1`,
        [batchId, 'No se pudo preparar ninguna etiqueta.'],
      );
      return NextResponse.json(
        { error: 'No se pudo preparar ninguna etiqueta.', failures: failed.map(toFailure) },
        { status: 422 },
      );
    }

    const letterPdf = await composeLetterLabelPdf(sourceDocuments);
    const batchStatus = failed.length === 0 ? 'completed' : 'partial';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of completed) {
        await client.query(
          `INSERT INTO dispatch_batch_item
             (dispatch_batch_id, id_order_header, marketplace_shipment_id, status, print_requested_at)
           VALUES ($1, $2, $3, 'completed', NOW())`,
          [batchId, item.candidate.id, item.shipmentId],
        );
      }
      for (const item of failed) {
        await client.query(
          `INSERT INTO dispatch_batch_item
             (dispatch_batch_id, id_order_header, marketplace_shipment_id, status, error_message)
           VALUES ($1, $2, $3, 'failed', $4)`,
          [batchId, item.candidate.id, item.candidate.shipment_id, item.message],
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
          failed.length ? `${failed.length} etiqueta(s) requieren atención.` : null,
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
      failures: failed.map(toFailure),
      documentUrl: `/api/dispatches/batches/${batchId}/document`,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error preparing unified dispatch labels:', error);
    if (batchId) {
      await pool.query(
        `UPDATE dispatch_batch
         SET status = 'failed', completed_at = NOW(), error_message = $2
         WHERE id = $1 AND status = 'processing'`,
        [batchId, 'No fue posible preparar las etiquetas.'],
      ).catch(() => undefined);
    }
    return NextResponse.json({ error: 'No fue posible preparar las etiquetas.' }, { status: 500 });
  }
}
