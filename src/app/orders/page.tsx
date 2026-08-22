'use client';

import { useEffect, useState } from 'react';
import { OrderHeader } from '../lib/definitions/order_header';
import Pagination from '../components/Pagination';
import OrderTable from '../components/OrderTable';
import OrderFilters, {
  FilterOptions,
  Filters,
  initialFilters,
  SyncFeedback,
} from '../components/OrderFilters';
import LoadingSpinner from '../components/LoadingSpinner';
import StatusRefreshToast from '../components/StatusRefreshToast';

const PAGE_SIZE = 10;

interface OrdersResponse {
  orders?: OrderHeader[];
  filterOptions?: FilterOptions;
  error?: string;
}

async function requestOrders(filters: Filters, signal?: AbortSignal): Promise<OrdersResponse> {
  const params = new URLSearchParams({
    search: filters.search,
    marketplace: filters.marketplace,
    documentType: filters.documentType,
    status: filters.status,
    deliveryDate: filters.deliveryDate,
    startDate: filters.startDate,
    endDate: filters.endDate,
    hasInvoice: filters.hasInvoice,
  });
  const response = await fetch(`/api/orders/all?${params.toString()}`, {
    cache: 'no-store',
    signal,
  });
  const result = await response.json().catch(() => null) as OrdersResponse | null;
  if (!response.ok) throw new Error(result?.error || 'No fue posible cargar las órdenes');
  return result ?? {};
}

export default function OrderMaintainer() {
  const [orders, setOrders] = useState<OrderHeader[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    marketplaces: [],
    statuses: [],
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [refreshingStatuses, setRefreshingStatuses] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedback | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    requestOrders(filters, controller.signal)
      .then((result) => {
        setOrders(result.orders ?? []);
        if (result.filterOptions) setFilterOptions(result.filterOptions);
        setCurrentPage(1);
      })
      .catch((requestError) => {
        if (requestError instanceof Error && requestError.name === 'AbortError') return;
        console.error('Error al cargar órdenes:', requestError);
        setError('No pudimos cargar las órdenes. Intenta nuevamente.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [filters]);

  const refreshStatuses = async () => {
    setRefreshingStatuses(true);
    setSyncFeedback(null);

    try {
      const response = await fetch('/api/cron/returns', { cache: 'no-store' });
      const result = await response.json().catch(() => null);
      const failedMarketplaces = Array.isArray(result?.results)
        ? result.results.filter((item: { ok?: boolean }) => !item.ok).length
        : 0;
      const changedOrders = Number(result?.changedOrders ?? 0);
      const changeSummary = changedOrders === 1
        ? '1 orden cambió de estado.'
        : `${changedOrders} órdenes cambiaron de estado.`;

      if (!response.ok || !result?.success) {
        setSyncFeedback({
          kind: 'warning',
          text: `${changeSummary} La actualización terminó con incidencias en ${failedMarketplaces || 'algunos'} marketplace(s).`,
        });
      } else {
        setSyncFeedback({
          kind: 'success',
          text: changeSummary,
        });
      }

      const refreshedOrders = await requestOrders(filters);
      setOrders(refreshedOrders.orders ?? []);
      if (refreshedOrders.filterOptions) setFilterOptions(refreshedOrders.filterOptions);
      setCurrentPage(1);
    } catch (refreshError) {
      console.error('Error actualizando estados:', refreshError);
      setSyncFeedback({
        kind: 'error',
        text: 'No fue posible completar la actualización de estados.',
      });
    } finally {
      setRefreshingStatuses(false);
    }
  };

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const currentOrders = orders.slice(startIndex, startIndex + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">Elizabeth Peper</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Mantenedor de órdenes</h1>
              <p className="mt-2 text-sm text-slate-500">
                Consulta documentos, estados logísticos y devoluciones por línea de producto.
              </p>
            </div>
            <p className="text-sm font-medium text-slate-500">
              {orders.length.toLocaleString('es-CL')} órdenes encontradas
            </p>
          </div>
        </header>

        <OrderFilters
          onFilterChange={setFilters}
          options={filterOptions}
          onRefreshStatuses={refreshStatuses}
          refreshingStatuses={refreshingStatuses}
          syncFeedback={syncFeedback}
        />

        {loading ? <LoadingSpinner /> : null}
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>
        ) : null}
        {!loading && !error ? <OrderTable orders={currentOrders} /> : null}

        {!loading && !error && orders.length > 0 ? (
          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
        ) : null}

        <StatusRefreshToast
          feedback={syncFeedback}
          onClose={() => setSyncFeedback(null)}
        />
      </div>
    </main>
  );
}
