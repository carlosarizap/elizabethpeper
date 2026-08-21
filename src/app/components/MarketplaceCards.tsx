import Image from 'next/image';
import { MarketplaceStat } from '@/app/lib/definitions/dashboard';

interface Props {
  data: MarketplaceStat[];
}

const currency = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

export default function MarketplaceCards({ data }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-slate-900">Rendimiento por marketplace</h2>
        <p className="mt-1 text-sm text-slate-500">
          Ventas, participación sobre el total y crecimiento frente al período anterior.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {data.map((marketplace) => {
          const growth = marketplace.crecimiento;
          const growthClass = growth === null
            ? 'bg-slate-100 text-slate-600'
            : growth >= 0
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-rose-50 text-rose-700';

          return (
            <article
              key={marketplace.marketplace}
              className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 transition-colors hover:bg-white"
            >
              <div className="flex items-center justify-between gap-3">
                <Image
                  src={`/marketplaces/${marketplace.marketplace}.png`}
                  alt={marketplace.marketplace.replaceAll('_', ' ')}
                  width={110}
                  height={34}
                  className="h-6 w-auto max-w-[110px] object-contain object-left"
                />
                <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${growthClass}`}>
                  {growth === null ? 'Sin base' : `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`}
                </span>
              </div>
              <p className="mt-4 text-xl font-bold tracking-tight text-slate-900">
                {currency.format(marketplace.total_ventas)}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>{marketplace.total_ordenes.toLocaleString('es-CL')} ventas</span>
                <span className="font-semibold text-slate-700">
                  {marketplace.participacion.toFixed(1)}%
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{ width: `${Math.min(100, marketplace.participacion)}%` }}
                  aria-label={`${marketplace.participacion.toFixed(1)}% de participación`}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
