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
    <div className="flex flex-wrap gap-4 mb-4 items-end">
      <div className="flex flex-col min-w-[160px]">
        <label className="text-gray-700 text-sm font-semibold flex items-center gap-1 mb-1">
          <CalendarDaysIcon className="w-4 h-4" /> Mes
        </label>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="border p-2 h-10 rounded text-black bg-white text-sm"
        >
          {meses.map((nombre, index) => (
            <option key={index + 1} value={index + 1}>{nombre}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col min-w-[120px]">
        <label className="text-gray-700 text-sm font-semibold flex items-center gap-1 mb-1">
          <CalendarDaysIcon className="w-4 h-4" /> Año
        </label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="border p-2 h-10 rounded text-black bg-white text-sm"
        />
      </div>
    </div>
  );
}
