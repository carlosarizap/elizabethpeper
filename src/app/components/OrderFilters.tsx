'use client';

import { useState } from 'react';
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  CheckBadgeIcon,
  DocumentTextIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import { DateRange } from 'react-date-range';
import { format, subMonths } from 'date-fns';
import { formatOrderStatus } from './OrderStatusBadge';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

export interface Filters {
  search: string;
  marketplace: string;
  documentType: string;
  status: string;
  deliveryDate: string;
  startDate: string;
  endDate: string;
  hasInvoice: string;
}

export interface FilterOptions {
  marketplaces: string[];
  statuses: string[];
}

export interface SyncFeedback {
  kind: 'success' | 'warning' | 'error';
  text: string;
}

interface Props {
  onFilterChange: (filters: Filters) => void;
  options: FilterOptions;
  onRefreshStatuses: () => void;
  refreshingStatuses: boolean;
  syncFeedback: SyncFeedback | null;
}

export function createInitialFilters(): Filters {
  const today = new Date();

  return {
    search: '',
    marketplace: '',
    documentType: '',
    status: '',
    deliveryDate: '',
    startDate: format(subMonths(today, 1), 'yyyy-MM-dd'),
    endDate: format(today, 'yyyy-MM-dd'),
    hasInvoice: '',
  };
}

export const initialFilters = createInitialFilters();

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

const inputClass = 'h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

export default function OrderFilters({
  onFilterChange,
  options,
  onRefreshStatuses,
  refreshingStatuses,
  syncFeedback,
}: Props) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [showRange, setShowRange] = useState(false);
  const [dateRange, setDateRange] = useState([
    { startDate: subMonths(new Date(), 1), endDate: new Date(), key: 'selection' },
  ]);

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const updatedFilters = {
      ...filters,
      [event.target.name]: event.target.value,
    };
    setFilters(updatedFilters);
    onFilterChange(updatedFilters);
  };

  const handleRangeChange = (ranges: any) => {
    const { startDate, endDate } = ranges.selection;
    const updatedFilters = {
      ...filters,
      startDate: format(startDate, 'yyyy-MM-dd'),
      endDate: format(endDate, 'yyyy-MM-dd'),
    };
    setFilters(updatedFilters);
    onFilterChange(updatedFilters);
    setDateRange([ranges.selection]);
    setShowRange(false);
  };

  const handleResetFilters = () => {
    const resetFilters = createInitialFilters();
    const today = new Date();
    setFilters(resetFilters);
    onFilterChange(resetFilters);
    setDateRange([{ startDate: subMonths(today, 1), endDate: today, key: 'selection' }]);
    setShowRange(false);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <FunnelIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Filtros de órdenes</h2>
          <p className="text-xs text-slate-500">Combina los filtros para encontrar órdenes específicas.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <MagnifyingGlassIcon className="h-4 w-4" /> N° de orden o producto
          </span>
          <input
            type="search"
            name="search"
            placeholder="Buscar orden o producto…"
            value={filters.search}
            onChange={handleChange}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <ShoppingBagIcon className="h-4 w-4" /> Marketplace
          </span>
          <select name="marketplace" value={filters.marketplace} onChange={handleChange} className={inputClass}>
            <option value="">Todos los marketplaces</option>
            {options.marketplaces.map((marketplace) => (
              <option key={marketplace} value={marketplace}>
                {marketplaceLabel(marketplace)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <CheckBadgeIcon className="h-4 w-4" /> Estado
          </span>
          <select name="status" value={filters.status} onChange={handleChange} className={inputClass}>
            <option value="">Todos los estados</option>
            {options.statuses.map((status) => (
              <option key={status} value={status}>{formatOrderStatus(status)}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <DocumentTextIcon className="h-4 w-4" /> Tipo de documento
          </span>
          <select name="documentType" value={filters.documentType} onChange={handleChange} className={inputClass}>
            <option value="">Boletas y facturas</option>
            <option value="boleta">Boleta</option>
            <option value="factura">Factura</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <CalendarDaysIcon className="h-4 w-4" /> Fecha de entrega
          </span>
          <input type="date" name="deliveryDate" value={filters.deliveryDate} onChange={handleChange} className={inputClass} />
        </label>

        <div className="relative">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <CalendarDaysIcon className="h-4 w-4" /> Fecha de creación
          </span>
          <button
            type="button"
            onClick={() => setShowRange((visible) => !visible)}
            className={`${inputClass} text-left`}
          >
            {filters.startDate && filters.endDate
              ? `${filters.startDate} — ${filters.endDate}`
              : 'Seleccionar rango'}
          </button>
          {showRange ? (
            <div className="absolute left-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <DateRange
                editableDateInputs
                onChange={handleRangeChange}
                moveRangeOnFirstSelection={false}
                ranges={dateRange}
                rangeColors={['#2563eb']}
                months={1}
                direction="vertical"
              />
            </div>
          ) : null}
        </div>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <CheckBadgeIcon className="h-4 w-4" /> Documento emitido
          </span>
          <select name="hasInvoice" value={filters.hasInvoice} onChange={handleChange} className={inputClass}>
            <option value="">Emitidos y pendientes</option>
            <option value="true">Documento emitido</option>
            <option value="false">Documento pendiente</option>
          </select>
        </label>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-xs">
          {syncFeedback ? (
            <p className={
              syncFeedback.kind === 'success'
                ? 'text-emerald-700'
                : syncFeedback.kind === 'warning'
                  ? 'text-amber-700'
                  : 'text-red-700'
            }>
              {syncFeedback.text}
            </p>
          ) : (
            <p className="text-slate-500">La actualización histórica revisa estados y devoluciones de los últimos 60 días.</p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowPathIcon className="h-4 w-4" /> Limpiar filtros
          </button>
          <button
            type="button"
            onClick={onRefreshStatuses}
            disabled={refreshingStatuses}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowPathIcon className={`h-4 w-4 ${refreshingStatuses ? 'animate-spin' : ''}`} />
            {refreshingStatuses ? 'Actualizando estados…' : 'Actualizar estados (60 días)'}
          </button>
        </div>
      </div>
    </section>
  );
}
