"use client";

import { useState } from "react";
import { MagnifyingGlassIcon, CalendarDaysIcon, DocumentTextIcon, ShoppingBagIcon, CheckBadgeIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { DateRange } from "react-date-range";
import { format } from "date-fns";
import "react-date-range/dist/styles.css"; 
import "react-date-range/dist/theme/default.css"; 

interface Props {
  onFilterChange: (filters: Filters) => void;
}

export interface Filters {
  search: string;
  marketplace: string;
  documentType: string;
  deliveryDate: string;
  startDate: string;
  endDate: string;
  hasInvoice: string;
}

const initialFilters: Filters = {
  search: "",
  marketplace: "",
  documentType: "",
  deliveryDate: "",
  startDate: "",
  endDate: "",
  hasInvoice: "",
};

const OrderFilters = ({ onFilterChange }: Props) => {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [showRange, setShowRange] = useState(false);
  const [dateRange, setDateRange] = useState([
    {
      startDate: new Date(),
      endDate: new Date(),
      key: 'selection'
    }
  ]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const updatedFilters = { ...filters, [name]: value };
    setFilters(updatedFilters);
    onFilterChange(updatedFilters);
  };

  const handleRangeChange = (ranges: any) => {
    const { startDate, endDate } = ranges.selection;
    const updatedFilters = {
      ...filters,
      startDate: format(startDate, "yyyy-MM-dd"),
      endDate: format(endDate, "yyyy-MM-dd")
    };
    setFilters(updatedFilters);
    onFilterChange(updatedFilters);
    setDateRange([ranges.selection]);
    setShowRange(false);
  };

  const handleResetFilters = () => {
    setFilters(initialFilters);
    onFilterChange(initialFilters);
    setDateRange([
      {
        startDate: new Date(),
        endDate: new Date(),
        key: 'selection'
      }
    ]);
    setShowRange(false);
  };

  return (
    <div className="bg-gray-100 p-4 mb-6 rounded-lg shadow-sm flex flex-wrap items-end gap-4">
  {/* Buscar N° Orden */}
  <div className="flex flex-col flex-1 min-w-[180px]">
    <label className="text-gray-700 font-semibold text-sm flex items-center gap-1 mb-1">
      <MagnifyingGlassIcon className="w-4 h-4" />
      Buscar N° Orden
    </label>
    <input
      type="text"
      name="search"
      placeholder="Buscar..."
      value={filters.search}
      onChange={handleChange}
      className="border p-2 h-10 rounded text-black bg-white text-sm w-full"
    />
  </div>

  {/* Marketplace */}
  <div className="flex flex-col flex-1 min-w-[180px]">
    <label className="text-gray-700 font-semibold text-sm flex items-center gap-1 mb-1">
      <ShoppingBagIcon className="w-4 h-4" />
      Marketplace
    </label>
    <select
      name="marketplace"
      value={filters.marketplace}
      onChange={handleChange}
      className="border p-2 h-10 rounded text-black bg-white text-sm w-full"
    >
      <option value="">Todos</option>
      <option value="mercado_libre">Mercado Libre</option>
      <option value="falabella">Falabella</option>
      <option value="ripley">Ripley</option>
      <option value="paris">París</option>
    </select>
  </div>

  {/* Tipo de Documento */}
  <div className="flex flex-col flex-1 min-w-[180px]">
    <label className="text-gray-700 font-semibold text-sm flex items-center gap-1 mb-1">
      <DocumentTextIcon className="w-4 h-4" />
      Tipo de Documento
    </label>
    <select
      name="documentType"
      value={filters.documentType}
      onChange={handleChange}
      className="border p-2 h-10 rounded text-black bg-white text-sm w-full"
    >
      <option value="">Todos</option>
      <option value="boleta">Boleta</option>
      <option value="factura">Factura</option>
    </select>
  </div>

  {/* Fecha de Entrega */}
  <div className="flex flex-col flex-1 min-w-[180px]">
    <label className="text-gray-700 font-semibold text-sm flex items-center gap-1 mb-1">
      <CalendarDaysIcon className="w-4 h-4" />
      Fecha de Entrega
    </label>
    <input
      type="date"
      name="deliveryDate"
      value={filters.deliveryDate}
      onChange={handleChange}
      className="border p-2 h-10 rounded text-black bg-white text-sm w-full"
    />
  </div>

  {/* Rango Fecha de Creación */}
  <div className="flex flex-col flex-1 min-w-[220px] relative">
    <label className="text-gray-700 font-semibold text-sm flex items-center gap-1 mb-1">
      <CalendarDaysIcon className="w-4 h-4" />
      Rango Fecha de Creación
    </label>
    <button
      onClick={() => setShowRange(!showRange)}
      className="border p-2 h-10 rounded text-black bg-white text-sm text-left w-full"
    >
      {filters.startDate && filters.endDate
        ? `${filters.startDate} - ${filters.endDate}`
        : "Seleccionar Rango"}
    </button>

    {showRange && (
      <div className="absolute z-50 mt-2">
        <DateRange
          editableDateInputs={true}
          onChange={handleRangeChange}
          moveRangeOnFirstSelection={false}
          ranges={dateRange}
          rangeColors={["#3b82f6"]}
          months={1}
          direction="vertical"
          className="shadow-lg rounded-lg"
        />
      </div>
    )}
  </div>

  {/* Boleta Emitida */}
  <div className="flex flex-col flex-1 min-w-[180px]">
    <label className="text-gray-700 font-semibold text-sm flex items-center gap-1 mb-1">
      <CheckBadgeIcon className="w-4 h-4" />
      Boleta Emitida
    </label>
    <select
      name="hasInvoice"
      value={filters.hasInvoice}
      onChange={handleChange}
      className="border p-2 h-10 rounded text-black bg-white text-sm w-full"
    >
      <option value="">Con y sin Boleta</option>
      <option value="true">Con Boleta</option>
      <option value="false">Sin Boleta</option>
    </select>
  </div>

  {/* Botón Limpiar Filtros */}
  <div className="flex items-end">
    <button
      onClick={handleResetFilters}
      className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold px-4 py-2 rounded shadow h-10 text-sm"
    >
      <ArrowPathIcon className="w-4 h-4" />
      Limpiar Filtros
    </button>
  </div>
</div>
  );
};

export default OrderFilters;
