'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  PrinterIcon,
  TruckIcon,
} from '@heroicons/react/24/outline';
import type {
  DispatchPrintFailure,
  DispatchPrintResponse,
  FalabellaDispatchOrder,
  FalabellaDispatchResponse,
  MercadoLibreDispatchOrder,
  MercadoLibreDispatchResponse,
  ParisDispatchOrder,
  ParisDispatchResponse,
  RipleyDispatchOrder,
  RipleyDispatchResponse,
  WalmartDispatchOrder,
  WalmartDispatchResponse,
} from '@/app/lib/dispatches/definitions';

type DispatchFilter = 'all' | 'pending' | 'printed' | 'waiting';
type MarketplaceFilter = 'all' | 'mercado_libre' | 'falabella' | 'paris' | 'ripley' | 'walmart';
type SupportedMarketplace = Exclude<MarketplaceFilter, 'all'>;

interface UnifiedOrder {
  key: string;
  id: string;
  marketplace: SupportedMarketplace;
  orderId: string;
  deliveryDate: string;
  productSummary: string;
  totalUnits: number;
  printCount: number;
  selectable: boolean;
  waitingForLabel: boolean;
  confirmed: boolean;
  reason: string | null;
  mercadoLibre?: MercadoLibreDispatchOrder;
}

interface ApiError {
  error?: string;
  failures?: DispatchPrintFailure[];
}

interface MarkReadyResponse {
  success?: boolean;
  readyToPrint?: boolean;
  message?: string;
  error?: string;
}

const MARKETPLACES: Record<SupportedMarketplace, { label: string; logo: string }> = {
  mercado_libre: { label: 'Mercado Libre', logo: '/marketplaces/mercado_libre.png' },
  falabella: { label: 'Falabella', logo: '/marketplaces/falabella.png' },
  paris: { label: 'París', logo: '/marketplaces/paris.png' },
  ripley: { label: 'Ripley', logo: '/marketplaces/ripley.png' },
  walmart: { label: 'Walmart', logo: '/marketplaces/walmart.png' },
};

const STATUS_FILTERS: Array<{ id: DispatchFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'printed', label: 'Impresos' },
  { id: 'waiting', label: 'Esperando etiqueta' },
];

function chileDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateHeading(dateKey: string): string {
  const today = chileDateKey();
  const prefix = dateKey === today ? 'Hoy' : dateKey === addDays(today, 1) ? 'Mañana' : null;
  const formatted = new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T12:00:00Z`));
  return prefix ? `${prefix}, ${formatted}` : formatted;
}

function mergeOrders(
  mercadoLibre: MercadoLibreDispatchOrder[],
  falabella: FalabellaDispatchOrder[],
  paris: ParisDispatchOrder[],
  ripley: RipleyDispatchOrder[],
  ripleyIntegration: RipleyDispatchResponse['integration'],
  walmart: WalmartDispatchOrder[],
): UnifiedOrder[] {
  const merged: UnifiedOrder[] = [
    ...mercadoLibre.map((order): UnifiedOrder => ({
      key: `mercado_libre:${order.id}`,
      id: order.id,
      marketplace: 'mercado_libre',
      orderId: order.orderId,
      deliveryDate: order.deliveryDate,
      productSummary: order.productSummary,
      totalUnits: order.totalUnits,
      printCount: order.printCount,
      selectable: order.eligible,
      waitingForLabel: order.waitingForLabel,
      confirmed: false,
      reason: order.eligibilityReason,
      mercadoLibre: order,
    })),
    ...falabella.map((order): UnifiedOrder => ({
      key: `falabella:${order.id}`,
      id: order.id,
      marketplace: 'falabella',
      orderId: order.orderId,
      deliveryDate: order.deliveryDate,
      productSummary: order.productSummary,
      totalUnits: order.totalUnits,
      printCount: order.printCount,
      selectable: true,
      waitingForLabel: false,
      confirmed: order.confirmed,
      reason: order.printCount === 0
        ? 'La disponibilidad se comprobará al imprimir.'
        : order.confirmed ? null : 'Al reimprimir, el sistema volverá a intentar la confirmación.',
    })),
    ...paris.map((order): UnifiedOrder => ({
      key: `paris:${order.id}`,
      id: order.id,
      marketplace: 'paris',
      orderId: order.orderId,
      deliveryDate: order.deliveryDate,
      productSummary: order.productSummary,
      totalUnits: order.totalUnits,
      printCount: order.printCount,
      selectable: true,
      waitingForLabel: false,
      confirmed: false,
      reason: order.printCount === 0
        ? 'La disponibilidad se comprobará al imprimir.'
        : null,
    })),
    ...ripley.map((order): UnifiedOrder => ({
      key: `ripley:${order.id}`,
      id: order.id,
      marketplace: 'ripley',
      orderId: order.orderId,
      deliveryDate: order.deliveryDate,
      productSummary: order.productSummary,
      totalUnits: order.totalUnits,
      printCount: order.printCount,
      selectable: ripleyIntegration.connected,
      waitingForLabel: !ripleyIntegration.connected,
      confirmed: false,
      reason: ripleyIntegration.connected
        ? order.printCount === 0 ? 'La disponibilidad se comprobará al imprimir.' : null
        : ripleyIntegration.message ?? 'Pendiente de credenciales API de Seller Center Ripley.',
    })),
    ...walmart.map((order): UnifiedOrder => ({
      key: `walmart:${order.id}`,
      id: order.id,
      marketplace: 'walmart',
      orderId: order.orderId,
      deliveryDate: order.deliveryDate,
      productSummary: order.productSummary,
      totalUnits: order.totalUnits,
      printCount: order.printCount,
      selectable: true,
      waitingForLabel: false,
      confirmed: order.acknowledged,
      reason: order.acknowledged
        ? order.printCount === 0 ? 'Walmart ya aprobó la orden; la etiqueta se descargará al imprimir.' : null
        : 'Al imprimir, el sistema aprobará la orden en Walmart y descargará su etiqueta.',
    })),
  ];
  return merged.sort((left, right) => (
    left.deliveryDate.localeCompare(right.deliveryDate)
    || left.marketplace.localeCompare(right.marketplace)
    || left.orderId.localeCompare(right.orderId)
  ));
}

function defaultSelection(orders: UnifiedOrder[]): Set<string> {
  return new Set(
    orders
      .filter((order) => order.selectable && order.printCount === 0)
      .map((order) => order.key),
  );
}

function matchesStatus(order: UnifiedOrder, filter: DispatchFilter): boolean {
  if (filter === 'pending') return order.selectable && order.printCount === 0 && !order.waitingForLabel;
  if (filter === 'printed') return order.printCount > 0;
  if (filter === 'waiting') return order.waitingForLabel;
  return true;
}

function marketplaceLabel(value?: string): string {
  if (value === 'falabella') return 'Falabella';
  if (value === 'mercado_libre') return 'Mercado Libre';
  if (value === 'paris') return 'París';
  if (value === 'ripley') return 'Ripley';
  if (value === 'walmart') return 'Walmart';
  return 'Marketplace';
}

export default function DispatchCenter() {
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<DispatchFilter>('all');
  const [marketplaceFilter, setMarketplaceFilter] = useState<MarketplaceFilter>('all');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [readyingShipmentId, setReadyingShipmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failures, setFailures] = useState<DispatchPrintFailure[]>([]);
  const [fallbackDocument, setFallbackDocument] = useState<string | null>(null);

  const loadOrders = useCallback(async (resetSelection = false) => {
    const [mercadoLibreResponse, falabellaResponse, parisResponse, ripleyResponse, walmartResponse] = await Promise.all([
      fetch('/api/dispatches/mercadolibre', { cache: 'no-store' }),
      fetch('/api/dispatches/falabella', { cache: 'no-store' }),
      fetch('/api/dispatches/paris', { cache: 'no-store' }),
      fetch('/api/dispatches/ripley', { cache: 'no-store' }),
      fetch('/api/dispatches/walmart', { cache: 'no-store' }),
    ]);
    const [mercadoLibre, falabella, paris, ripley, walmart] = await Promise.all([
      mercadoLibreResponse.json().catch(() => null) as Promise<MercadoLibreDispatchResponse | ApiError | null>,
      falabellaResponse.json().catch(() => null) as Promise<FalabellaDispatchResponse | ApiError | null>,
      parisResponse.json().catch(() => null) as Promise<ParisDispatchResponse | ApiError | null>,
      ripleyResponse.json().catch(() => null) as Promise<RipleyDispatchResponse | ApiError | null>,
      walmartResponse.json().catch(() => null) as Promise<WalmartDispatchResponse | ApiError | null>,
    ]);
    if (!mercadoLibreResponse.ok || !mercadoLibre || !('orders' in mercadoLibre)) {
      throw new Error(mercadoLibre && 'error' in mercadoLibre && mercadoLibre.error
        ? mercadoLibre.error
        : 'No fue posible cargar Mercado Libre.');
    }
    if (!falabellaResponse.ok || !falabella || !('orders' in falabella)) {
      throw new Error(falabella && 'error' in falabella && falabella.error
        ? falabella.error
        : 'No fue posible cargar Falabella.');
    }
    if (!parisResponse.ok || !paris || !('orders' in paris)) {
      throw new Error(paris && 'error' in paris && paris.error
        ? paris.error
        : 'No fue posible cargar París.');
    }
    if (!ripleyResponse.ok || !ripley || !('orders' in ripley)) {
      throw new Error(ripley && 'error' in ripley && ripley.error
        ? ripley.error
        : 'No fue posible cargar Ripley.');
    }
    if (!walmartResponse.ok || !walmart || !('orders' in walmart)) {
      throw new Error(walmart && 'error' in walmart && walmart.error
        ? walmart.error
        : 'No fue posible cargar Walmart.');
    }
    const nextOrders = mergeOrders(
      mercadoLibre.orders,
      falabella.orders,
      paris.orders,
      ripley.orders,
      ripley.integration,
      walmart.orders,
    );
    setOrders(nextOrders);
    if (resetSelection) setSelection(defaultSelection(nextOrders));
    else {
      setSelection((current) => {
        const selectableKeys = new Set(nextOrders.filter((order) => order.selectable).map((order) => order.key));
        return new Set([...current].filter((key) => selectableKeys.has(key)));
      });
    }
    return nextOrders;
  }, []);

  useEffect(() => {
    loadOrders(true)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'No fue posible cargar los despachos.'))
      .finally(() => setLoading(false));
  }, [loadOrders]);

  const visibleOrders = useMemo(
    () => orders.filter((order) => (
      (marketplaceFilter === 'all' || order.marketplace === marketplaceFilter)
      && matchesStatus(order, statusFilter)
    )),
    [marketplaceFilter, orders, statusFilter],
  );

  const groups = useMemo(() => {
    const grouped = new Map<string, UnifiedOrder[]>();
    for (const order of visibleOrders) {
      const current = grouped.get(order.deliveryDate) ?? [];
      current.push(order);
      grouped.set(order.deliveryDate, current);
    }
    return [...grouped.entries()];
  }, [visibleOrders]);

  const summary = useMemo(() => ({
    total: orders.length,
    pending: orders.filter((order) => order.selectable && order.printCount === 0 && !order.waitingForLabel).length,
    printed: orders.filter((order) => order.printCount > 0).length,
    waiting: orders.filter((order) => order.waitingForLabel).length,
  }), [orders]);

  const selectedOrders = useMemo(
    () => orders.filter((order) => selection.has(order.key)),
    [orders, selection],
  );

  const toggleOrder = (order: UnifiedOrder) => {
    if (!order.selectable) return;
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(order.key)) next.delete(order.key);
      else next.add(order.key);
      return next;
    });
  };

  const setGroupSelection = (groupOrders: UnifiedOrder[], checked: boolean) => {
    setSelection((current) => {
      const next = new Set(current);
      for (const order of groupOrders) {
        if (!order.selectable) continue;
        if (checked) next.add(order.key);
        else next.delete(order.key);
      }
      return next;
    });
  };

  const syncAll = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const responses = await Promise.all([
        fetch('/api/mercadolibre/orders?mode=orders', { cache: 'no-store' }),
        fetch('/api/falabella/orders?mode=orders', { cache: 'no-store' }),
        fetch('/api/paris/orders?mode=orders', { cache: 'no-store' }),
        fetch('/api/ripley/orders?mode=orders', { cache: 'no-store' }),
        fetch('/api/walmart/orders?mode=orders', { cache: 'no-store' }),
      ]);
      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) {
        const result = await failedResponse.json().catch(() => null) as ApiError | null;
        throw new Error(result?.error ?? 'No fue posible actualizar todos los marketplaces.');
      }
      const refreshed = await loadOrders(false);
      setSelection(defaultSelection(refreshed));
      setNotice('Mercado Libre, Falabella, París, Ripley y Walmart quedaron actualizados.');
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'No fue posible actualizar los marketplaces.');
    } finally {
      setSyncing(false);
    }
  };

  const printSelected = async () => {
    if (selectedOrders.length === 0) return;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.title = 'Preparando etiquetas';
      printWindow.document.body.innerHTML = '<p style="font-family:Arial;padding:24px">Preparando etiquetas de los marketplaces seleccionados…</p>';
    }
    setPrinting(true);
    setError(null);
    setNotice(null);
    setFailures([]);
    setFallbackDocument(null);
    try {
      const response = await fetch('/api/dispatches/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          orderHeaderIds: selectedOrders.map((order) => order.id),
        }),
      });
      const result = await response.json().catch(() => null) as DispatchPrintResponse | ApiError | null;
      if (!response.ok || !result || !('batchId' in result)) {
        if (printWindow) printWindow.close();
        if (result && 'failures' in result && result.failures) setFailures(result.failures);
        throw new Error(result && 'error' in result && result.error
          ? result.error
          : 'No fue posible preparar las etiquetas.');
      }
      setFailures(result.failures);
      const printUrl = `/dispatches/print/${result.batchId}`;
      if (printWindow) printWindow.location.assign(printUrl);
      else setFallbackDocument(printUrl);
      setNotice(
        result.status === 'partial'
          ? `Se prepararon ${result.completedCount} etiqueta(s); revisa las incidencias del lote.`
          : `Se prepararon ${result.completedCount} etiqueta(s) en un solo PDF tamaño carta. Los estados automáticos quedaron actualizados.`,
      );
      await loadOrders(false);
      setSelection(new Set());
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : 'No fue posible preparar las etiquetas.');
    } finally {
      setPrinting(false);
    }
  };

  const markProductReady = async (order: UnifiedOrder) => {
    const mercadoLibre = order.mercadoLibre;
    if (!mercadoLibre?.shipment || !mercadoLibre.canMarkReadyToShip) return;
    const confirmed = window.confirm(
      `¿Confirmar que ya tienes los productos de la orden ${order.orderId}?\n\nEsto informará a Mercado Libre que el pedido está listo y puede actualizar su compromiso de despacho.`,
    );
    if (!confirmed) return;
    setReadyingShipmentId(mercadoLibre.shipment.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/dispatches/mercadolibre/shipments/${mercadoLibre.shipment.id}/ready-to-ship`,
        { method: 'POST' },
      );
      const result = await response.json().catch(() => null) as MarkReadyResponse | null;
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? 'No fue posible confirmar el stock en Mercado Libre.');
      }
      const refreshed = await loadOrders(false);
      const refreshedOrder = refreshed.find((item) => item.key === order.key);
      if (result.readyToPrint && refreshedOrder) {
        setSelection((current) => new Set(current).add(refreshedOrder.key));
      }
      setNotice(result.message ?? 'Mercado Libre recibió la confirmación.');
    } catch (requestError) {
      await loadOrders(false).catch(() => undefined);
      setError(requestError instanceof Error ? requestError.message : 'No fue posible confirmar el stock en Mercado Libre.');
    } finally {
      setReadyingShipmentId(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-3 pb-32 pt-4 sm:px-5 sm:pb-28 lg:px-6">
      <div className="mx-auto max-w-[1700px] space-y-3">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Centro de despacho</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Bandeja de etiquetas</h1>
            <p className="mt-1 max-w-4xl text-sm leading-5 text-slate-500">
              Mercado Libre, Falabella, París, Ripley y Walmart en una sola vista. Las etiquetas se reúnen en un PDF tamaño carta; Falabella se confirma y Walmart se aprueba automáticamente al prepararlas.
            </p>
          </div>
          <button type="button" onClick={syncAll} disabled={syncing || printing} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50">
            <ArrowPathIcon className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Actualizando todo…' : 'Actualizar marketplaces'}
          </button>
        </header>

        <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Órdenes visibles', value: summary.total, Icon: CalendarDaysIcon, color: 'text-slate-700' },
            { label: 'Pendientes', value: summary.pending, Icon: PrinterIcon, color: 'text-blue-600' },
            { label: 'Impresos', value: summary.printed, Icon: CheckCircleIcon, color: 'text-emerald-600' },
            { label: 'Esperando etiqueta', value: summary.waiting, Icon: ClockIcon, color: 'text-amber-600' },
          ].map(({ label, value, Icon, color }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-500">{label}</span><Icon className={`h-4 w-4 ${color}`} /></div>
              <p className="mt-1 text-xl font-bold leading-none text-slate-900">{value}</p>
            </div>
          ))}
        </section>

        {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
        {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</div> : null}
        {failures.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-semibold">Etiquetas que requieren atención</p>
            <ul className="mt-2 space-y-1">
              {failures.map((item, index) => (
                <li key={`${item.orderId}-${index}`}>{marketplaceLabel(item.marketplace)} · Orden {item.orderId}: {item.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {fallbackDocument ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">El navegador bloqueó la ventana automática. <a href={fallbackDocument} target="_blank" rel="noreferrer" className="font-semibold underline">Abrir etiquetas para imprimir</a></div> : null}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'mercado_libre', 'falabella', 'paris', 'ripley', 'walmart'] as MarketplaceFilter[]).map((marketplace) => (
                <button key={marketplace} type="button" onClick={() => setMarketplaceFilter(marketplace)} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition ${marketplaceFilter === marketplace ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {marketplace === 'all' ? 'Todos los marketplaces' : <><span className="flex h-7 w-9 items-center justify-center overflow-hidden rounded-md bg-white px-1"><Image src={MARKETPLACES[marketplace].logo} alt="" width={42} height={28} className="max-h-6 w-auto object-contain" /></span>{MARKETPLACES[marketplace].label}</>}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((item) => <button key={item.id} type="button" onClick={() => setStatusFilter(item.id)} className={`rounded-lg px-2.5 py-1.5 text-sm font-semibold transition ${statusFilter === item.id ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>{item.label}</button>)}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 text-xs">
            <p className="max-w-5xl text-slate-500">Mercado Libre imprime en carta horizontal; Falabella confirma y agrupa hasta 4 etiquetas por hoja; Walmart aprueba y descarga; París también agrupa hasta 4 por hoja y Ripley queda pendiente de su acceso SVC. Las no disponibles se omiten sin detener el lote.</p>
            <div className="flex flex-wrap gap-2.5">
              <button type="button" onClick={() => setSelection(defaultSelection(orders))} className="font-semibold text-blue-600">Seleccionar pendientes</button>
              <button type="button" onClick={() => setSelection(new Set(orders.filter((order) => order.selectable).map((order) => order.key)))} className="font-semibold text-blue-600">Seleccionar imprimibles</button>
              <button type="button" onClick={() => setSelection(new Set())} className="font-semibold text-slate-500">Limpiar</button>
            </div>
          </div>

          {loading ? <div className="p-12 text-center text-sm text-slate-500">Cargando despachos…</div> : null}
          {!loading && groups.length === 0 ? <div className="p-12 text-center"><TruckIcon className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 font-semibold text-slate-700">No hay envíos en esta vista</p><p className="mt-1 text-sm text-slate-500">Prueba otro filtro o actualiza los marketplaces.</p></div> : null}

          <div className="divide-y divide-slate-200">
            {groups.map(([date, groupOrders]) => {
              const selectable = groupOrders.filter((order) => order.selectable);
              const allChecked = selectable.length > 0 && selectable.every((order) => selection.has(order.key));
              return (
                <div key={date}>
                  <div className="flex items-center justify-between bg-slate-50 px-3 py-2 sm:px-4">
                    <label className="flex items-center gap-3 font-semibold capitalize text-slate-800"><input type="checkbox" checked={allChecked} disabled={selectable.length === 0} onChange={(event) => setGroupSelection(groupOrders, event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-blue-600" />{dateHeading(date)}</label>
                    <span className="text-xs font-medium text-slate-500">{groupOrders.length} envío(s)</span>
                  </div>
                  <div className="hidden grid-cols-[30px_165px_minmax(150px,0.75fr)_minmax(260px,1.7fr)_100px_minmax(180px,0.85fr)] gap-2 border-b border-slate-100 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 lg:grid">
                    <span /><span>Marketplace</span><span>Orden</span><span>Productos</span><span>Entrega</span><span className="text-right">Estado</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {groupOrders.map((order) => {
                      const marketplace = MARKETPLACES[order.marketplace];
                      return (
                        <div key={order.key} className={`grid gap-2 px-3 py-2.5 transition lg:grid-cols-[30px_165px_minmax(150px,0.75fr)_minmax(260px,1.7fr)_100px_minmax(180px,0.85fr)] lg:items-center lg:px-4 ${order.selectable ? 'hover:bg-blue-50/40' : 'bg-amber-50/30'}`}>
                          <input type="checkbox" aria-label={`Seleccionar orden ${order.orderId}`} checked={selection.has(order.key)} disabled={!order.selectable} onChange={() => toggleOrder(order)} className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-40" />
                          <div className="flex items-center gap-2"><div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white px-1.5 shadow-sm"><Image src={marketplace.logo} alt={marketplace.label} width={52} height={36} className="max-h-8 w-auto object-contain" /></div><span className="text-sm font-semibold text-slate-700">{marketplace.label}</span></div>
                          <div><p className="font-semibold text-slate-900">{order.orderId}</p>{order.mercadoLibre?.shipment ? <p className="mt-1 text-xs text-slate-500">Envío {order.mercadoLibre.shipment.externalShipmentId}</p> : null}</div>
                          <div><p className="text-sm text-slate-700">{order.productSummary}</p><p className="mt-1 text-xs text-slate-500">{order.totalUnits} unidad(es)</p></div>
                          <div><p className="text-sm font-medium capitalize text-slate-700">{new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${order.deliveryDate}T12:00:00Z`))}</p></div>
                          <div className="lg:text-right">
                            {order.marketplace === 'falabella' && order.confirmed ? <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Lista para despachar</span> : order.printCount > 0 ? <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Impresión solicitada · {order.printCount}</span> : order.marketplace === 'walmart' && order.confirmed ? <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">Aprobada · lista para imprimir</span> : order.waitingForLabel ? <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">Esperando etiqueta</span> : order.selectable ? <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">Pendiente de impresión</span> : <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">No disponible</span>}
                            {order.reason ? <p className="mt-2 text-xs text-slate-500">{order.reason}</p> : null}
                            {order.mercadoLibre?.canMarkReadyToShip && order.mercadoLibre.shipment ? <button type="button" onClick={() => markProductReady(order)} disabled={Boolean(readyingShipmentId) || syncing || printing} className="mt-3 inline-flex rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:bg-slate-300">{readyingShipmentId === order.mercadoLibre.shipment.id ? 'Confirmando…' : 'Ya tengo los productos'}</button> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-[1700px] flex-col gap-2 rounded-xl border border-slate-200/90 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl sm:inset-x-5 sm:flex-row sm:items-center sm:justify-between lg:inset-x-6">
          <div><p className="font-semibold text-slate-900">{selectedOrders.length} orden(es) seleccionada(s)</p><p className="text-xs text-slate-500">Un solo lote y un solo PDF tamaño carta para todos los marketplaces seleccionados.</p></div>
          <button type="button" onClick={printSelected} disabled={selectedOrders.length === 0 || printing || syncing} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-300"><PrinterIcon className="h-4 w-4" />{printing ? 'Preparando etiquetas…' : 'Preparar e imprimir'}</button>
        </div>
      </div>
    </main>
  );
}
