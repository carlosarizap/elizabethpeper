'use client';

import { Fragment, useState } from 'react';
import Image from 'next/image';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BuildingOffice2Icon,
  ClockIcon,
  DocumentArrowDownIcon,
  ReceiptPercentIcon,
} from '@heroicons/react/24/solid';
import { OrderHeader } from '../lib/definitions/order_header';
import OrderStatusBadge, { ReturnStatusBadge } from './OrderStatusBadge';

interface Props {
  orders: OrderHeader[];
}

const currency = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

function marketplaceLabel(marketplace: string): string {
  const labels: Record<string, string> = {
    mercado_libre: 'Mercado Libre',
    falabella: 'Falabella',
    paris: 'París',
    ripley: 'Ripley',
    shopify: 'Shopify',
    walmart: 'Walmart',
  };
  return labels[marketplace] ?? marketplace.replaceAll('_', ' ');
}

function MarketplaceIdentity({ marketplace }: { marketplace: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = marketplaceLabel(marketplace);

  return (
    <div className="flex min-w-[130px] items-center gap-3">
      <div className="flex h-9 w-20 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-2">
        {imageFailed ? (
          <span className="text-xs font-bold uppercase text-slate-500">{label.slice(0, 2)}</span>
        ) : (
          <Image
            src={`/marketplaces/${marketplace}.png`}
            alt={label}
            width={76}
            height={24}
            onError={() => setImageFailed(true)}
            className="max-h-5 w-auto max-w-full object-contain"
          />
        )}
      </div>
      <span className="text-xs font-medium capitalize text-slate-600">{label}</span>
    </div>
  );
}

function DocumentTypeBadge({ type }: { type: OrderHeader['document_type'] }) {
  const isInvoice = type === 'factura';
  const Icon = isInvoice ? BuildingOffice2Icon : ReceiptPercentIcon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
        isInvoice
          ? 'border-violet-200 bg-violet-50 text-violet-700'
          : 'border-sky-200 bg-sky-50 text-sky-700'
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {isInvoice ? 'Factura' : 'Boleta'}
    </span>
  );
}

function formatDate(value: string | null) {
  if (!value) return 'Por confirmar';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';

  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function OrderTable({ orders }: Props) {
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const sortedOrders = [...orders].sort((left, right) => {
    const leftDeliveryDate = left.delivery_date;
    const rightDeliveryDate = right.delivery_date;
    if (!leftDeliveryDate && rightDeliveryDate) return -1;
    if (leftDeliveryDate && !rightDeliveryDate) return 1;
    if (!leftDeliveryDate || !rightDeliveryDate) return 0;
    const leftDate = new Date(leftDeliveryDate).getTime();
    const rightDate = new Date(rightDeliveryDate).getTime();
    return sortOrder === 'asc' ? leftDate - rightDate : rightDate - leftDate;
  });

  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
        <p className="font-semibold text-slate-700">No encontramos órdenes</p>
        <p className="mt-1 text-sm text-slate-500">Prueba cambiando o limpiando los filtros.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-[1240px] w-full text-sm text-slate-800">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Orden</th>
              <th className="px-4 py-3 text-left">Marketplace</th>
              <th className="px-4 py-3 text-left">Monto</th>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-left">Creada</th>
              <th className="cursor-pointer select-none px-4 py-3 text-left" onClick={() => setSortOrder((current) => current === 'asc' ? 'desc' : 'asc')}>
                <span className="inline-flex items-center gap-1.5">
                  Entrega
                  {sortOrder === 'asc' ? <ArrowUpIcon className="h-4 w-4" /> : <ArrowDownIcon className="h-4 w-4" />}
                </span>
              </th>
              <th className="px-4 py-3 text-center">Documento</th>
            </tr>
          </thead>

          <tbody>
            {sortedOrders.map((order) => (
              <Fragment key={order.id}>
                <tr className="border-b border-slate-100 bg-white align-middle transition hover:bg-slate-50/70">
                  <td className="px-4 py-4">
                    <p className="font-semibold text-slate-900">{order.order_id}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {order.details.length} {order.details.length === 1 ? 'línea' : 'líneas'}
                    </p>
                  </td>
                  <td className="px-4 py-4"><MarketplaceIdentity marketplace={order.marketplace} /></td>
                  <td className="px-4 py-4">
                    <p className="font-semibold text-slate-900">{currency.format(Number(order.total_amount))}</p>
                    <p className="mt-1 text-xs text-slate-500">Envío: {currency.format(Number(order.shipping_amount || 0))}</p>
                  </td>
                  <td className="px-4 py-4">
                    <DocumentTypeBadge type={order.document_type} />
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex max-w-[220px] flex-wrap gap-2">
                      <OrderStatusBadge status={order.status} />
                      <ReturnStatusBadge status={order.return_status} />
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-600">
                    {formatDate(order.created_at)}
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-600">
                    <div className="inline-flex items-center gap-1.5">
                      {order.delivery_date_source === 'predicted'
                        ? <ClockIcon className="h-4 w-4 text-amber-600" aria-label="Fecha estimada" />
                        : null}
                      <span>{formatDate(order.delivery_date)}</span>
                      {order.delivery_date_source === 'predicted'
                        ? <span className="text-xs font-medium text-amber-700">Estimada</span>
                        : null}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <div className="flex min-w-[150px] flex-col items-center gap-2">
                      {order.has_invoice && order.invoice_pdf ? (
                        <a
                          href={`/api/orders/invoice/download/${order.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                        >
                          <DocumentArrowDownIcon className="h-4 w-4" />
                          {order.document_type === 'factura' ? 'Factura' : 'Boleta'}
                        </a>
                      ) : order.has_invoice ? (
                        <span className="text-xs font-medium text-amber-600">Emitido sin PDF</span>
                      ) : (
                        <span className="text-xs text-slate-400">Documento pendiente</span>
                      )}

                      {order.has_credit_note && order.credit_note_pdf ? (
                        <a
                          href={`/api/orders/credit-note/download/${order.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-700"
                        >
                          <DocumentArrowDownIcon className="h-4 w-4" /> Nota de crédito
                        </a>
                      ) : order.has_credit_note ? (
                        <span className="text-xs font-medium text-rose-600">NC emitida sin PDF</span>
                      ) : null}
                    </div>
                  </td>
                </tr>

                <tr className="border-b border-slate-200 bg-slate-50/70">
                  <td colSpan={8} className="px-4 py-3 sm:px-6">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detalle de productos</p>
                      {order.details.some((detail) => detail.status === 'devuelto') ? (
                        <p className="text-xs font-semibold text-rose-600">Contiene líneas devueltas</p>
                      ) : null}
                    </div>
                    <ul className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                      {order.details.map((detail) => {
                        const returned = detail.status === 'devuelto';
                        const cancelled = detail.status === 'cancelado';
                        return (
                          <li
                            key={detail.id}
                            className={`flex items-start gap-3 rounded-xl border p-3 ${
                              returned
                                ? 'border-rose-200 bg-rose-50/80'
                                : cancelled
                                  ? 'border-red-200 bg-red-50/70'
                                  : 'border-slate-200 bg-white'
                            }`}
                          >
                            <span className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 px-2 text-xs font-bold text-slate-700">
                              {detail.product_quantity}×
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium leading-5 text-slate-800">{detail.product_title}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {currency.format(Number(detail.product_price))} por unidad
                                {detail.marketplace_status ? ` · Original: ${detail.marketplace_status}` : ''}
                              </p>
                            </div>
                            <OrderStatusBadge
                              status={detail.status}
                              marketplaceStatus={detail.marketplace_status}
                              compact
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
