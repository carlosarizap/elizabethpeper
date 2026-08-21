import { DailySalesStat } from '@/app/lib/definitions/dashboard';

const currency = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

interface Props {
  data: DailySalesStat[];
}

export default function DailySalesChart({ data }: Props) {
  const maximum = Math.max(...data.map((entry) => entry.total_ventas), 0);
  const daysWithSales = data.filter((entry) => entry.total_ordenes > 0);
  const average = daysWithSales.length
    ? daysWithSales.reduce((sum, entry) => sum + entry.total_ventas, 0) /
      daysWithSales.length
    : 0;
  const bestDay = data.reduce<DailySalesStat | null>(
    (best, entry) => (!best || entry.total_ventas > best.total_ventas ? entry : best),
    null,
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Ventas día a día</h2>
          <p className="mt-1 text-sm text-slate-500">
            Ventas registradas por día, incluyendo devoluciones y excluyendo cancelaciones.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-blue-50 px-3 py-1.5 font-medium text-blue-700">
            Promedio activo: {currency.format(average)}
          </span>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700">
            Mejor día: {bestDay?.total_ventas ? `${bestDay.day} · ${currency.format(bestDay.total_ventas)}` : 'Sin ventas'}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex h-64 min-w-[760px] items-end gap-1.5 border-b border-slate-200 px-1 pt-8">
          {data.map((entry, index) => {
            const height = maximum > 0 ? (entry.total_ventas / maximum) * 100 : 0;
            const visibleHeight = entry.total_ventas > 0 ? Math.max(height, 4) : 1;
            const tooltipPosition =
              index < 3
                ? 'left-0'
                : index >= data.length - 3
                  ? 'right-0'
                  : 'left-1/2 -translate-x-1/2';

            return (
              <button
                type="button"
                key={entry.day}
                className="group flex h-full min-w-0 flex-1 flex-col items-center outline-none"
                aria-label={`Día ${entry.day}: ${currency.format(entry.total_ventas)}, ${entry.total_ordenes} órdenes`}
                title={`Día ${entry.day}: ${currency.format(entry.total_ventas)} · ${entry.total_ordenes} órdenes`}
              >
                <div className="relative flex w-full flex-1 items-end">
                  <div
                    className={`pointer-events-none absolute top-2 z-20 hidden w-max rounded-lg bg-slate-900 px-3 py-2 text-left text-xs text-white shadow-lg group-hover:block group-focus:block ${tooltipPosition}`}
                  >
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-300">
                      Día {entry.day}
                    </p>
                    <p className="mt-0.5 text-sm font-bold">
                      {currency.format(entry.total_ventas)}
                    </p>
                    <p className="text-slate-300">{entry.total_ordenes} órdenes</p>
                  </div>
                  <div
                    className={`w-full rounded-t-md transition-colors ${
                      entry.total_ventas > 0
                        ? 'bg-blue-500 group-hover:bg-blue-600'
                        : 'bg-slate-100'
                    }`}
                    style={{ height: `${visibleHeight}%` }}
                  />
                </div>
                <span className="mt-2 text-[10px] font-medium text-slate-500">
                  {entry.day}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400 sm:hidden">
        Desliza horizontalmente para revisar todos los días.
      </p>
    </section>
  );
}
