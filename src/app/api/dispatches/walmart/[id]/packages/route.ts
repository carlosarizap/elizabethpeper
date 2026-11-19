import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { fetchWalmartOrderForLabel, getWalmartLabelEligibility } from '@/app/lib/walmart/shipping-labels';
import { fetchWalmartProductPackaging } from '@/app/lib/walmart/packaging-source';
import { toArray } from '@/app/lib/walmart/order-sync';
import type { WcpPackage } from '@/app/lib/walmart/wcp-labels';
import type { WalmartPackagePreview } from '@/app/lib/dispatches/definitions';
import { suggestGroupedPackages } from '@/app/lib/walmart/packaging';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Orden inválida.' }, { status: 400 });
    const header = await pool.query<{ order_id: string }>(
      `SELECT order_id FROM order_header WHERE id = $1 AND marketplace = 'walmart'`, [id],
    );
    if (!header.rows[0]) return NextResponse.json({ error: 'Orden Walmart no encontrada.' }, { status: 404 });
    const order = await fetchWalmartOrderForLabel(header.rows[0].order_id);
    const eligibility = getWalmartLabelEligibility(order);
    if (!eligibility.eligible) throw new Error(eligibility.reason ?? 'Orden no disponible para imprimir.');
    const saved = order.isWCPOrder ? await pool.query<{ status: string; request_payload: WcpPackage['request'] }>(
      `SELECT status, request_payload FROM walmart_dispatch_label WHERE purchase_order_id = $1 ORDER BY split_part(package_key, ':', 2)::int`,
      [header.rows[0].order_id],
    ) : { rows: [] };
    const lockedPlan = saved.rows.some((row) => row.status !== 'planned' && row.status !== 'failed');
    const packagingBySku = new Map<string, ReturnType<typeof fetchWalmartProductPackaging>>();
    const lines = await Promise.all(toArray(order.orderLines?.orderLine).map(async (line) => {
      const sku = String(line.item?.sku ?? '');
      let packaging = null;
      let packagingError = null;
      if (order.isWCPOrder && !lockedPlan) {
        try {
          if (!packagingBySku.has(sku)) packagingBySku.set(sku, fetchWalmartProductPackaging(sku, line.item?.productName ?? sku));
          packaging = await packagingBySku.get(sku)!;
        } catch (error) { packagingError = error instanceof Error ? error.message : 'Embalaje no disponible.'; }
      }
      return { lineNumber: String(line.lineNumber), sku, title: line.item?.productName ?? sku,
        quantity: Number(line.orderLineQuantity?.amount), packaging, packagingError };
    }));
    const result: WalmartPackagePreview = {
      id, orderId: header.rows[0].order_id, isWCPOrder: order.isWCPOrder === true,
      saved: lockedPlan, lines,
      packages: saved.rows.length ? saved.rows.map(({ request_payload: request }) => ({ items: request.boxItems, packaging: {
        lengthCm: request.boxDimensions.boxLength, widthCm: request.boxDimensions.boxWidth,
        heightCm: request.boxDimensions.boxHeight, weightKg: request.boxDimensions.boxWeight, source: 'saved',
      } })) : order.isWCPOrder ? suggestGroupedPackages(lines) : [],
    };
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudieron preparar los bultos.' }, { status: 422 });
  }
}
