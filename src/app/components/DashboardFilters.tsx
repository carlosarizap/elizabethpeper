import { CalendarDaysIcon } from '@heroicons/react/24/solid';

const meses = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

interface Props {
  month: number;
  year: number;
  setMonth: (m: number) => void;
  setYear: (y: number) => void;
}

export default function DashboardFilters({ month, year, setMonth, setYear }: Props) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-slate-900">Período del informe</p>
        <p className="mt-1 text-xs text-slate-500">Selecciona el mes que quieres analizar.</p>
      </div>
      <div className="flex flex-col gap-3 min-[420px]:flex-row">
      <div className="flex min-w-[160px] flex-col">
        <label className="text-gray-700 text-sm font-semibold flex items-center gap-1 mb-1">
          <CalendarDaysIcon className="w-4 h-4" /> Mes
        </label>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        >
          {meses.map((nombre, index) => (
            <option key={index + 1} value={index + 1}>{nombre}</option>
          ))}
        </select>
      </div>

      <div className="flex min-w-[120px] flex-col">
        <label className="text-gray-700 text-sm font-semibold flex items-center gap-1 mb-1">
          <CalendarDaysIcon className="w-4 h-4" /> Año
        </label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          min="2020"
          max="2100"
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </div>
      </div>
    </div>
  );
}
