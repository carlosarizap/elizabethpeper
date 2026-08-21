import { StarIcon, ArchiveBoxIcon } from '@heroicons/react/24/solid';
import { ProductStat } from '@/app/lib/definitions/dashboard';

interface Props {
  topProducts: ProductStat[];
  rellenos: Record<string, number>;
}

export default function ProductStatsRow({ topProducts, rellenos }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <StarIcon className="w-5 h-5 text-yellow-400" />
          Top 5 productos más vendidos
        </h2>
        {topProducts?.length > 0 ? (
          <ol className="space-y-3 text-sm text-slate-800">
            {topProducts.map((p, i) => (
              <li key={`${p.product_title}-${i}`} className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-yellow-50 text-xs font-bold text-yellow-700">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 leading-6">{p.product_title}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {p.cantidad_total} u.
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-400">No hay productos vendidos este mes.</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ArchiveBoxIcon className="w-5 h-5 text-blue-500" />
          Rellenos vendidos por medida
        </h2>
        {Object.keys(rellenos || {}).length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {Object.entries(rellenos).map(([medida, cantidad]) => (
              <li key={medida} className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                <p className="font-semibold text-slate-800">{medida}</p>
                <p className="mt-1 text-xs text-slate-500">{cantidad} unidades</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">No se vendieron rellenos este mes.</p>
        )}
      </section>
    </div>
  );
}
