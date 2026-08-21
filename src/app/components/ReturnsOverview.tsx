import Image from 'next/image';
import {
  ArrowUturnLeftIcon,
  CubeIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import {
  DashboardSummary,
  MarketplaceReturnStat,
  ReturnedProductStat,
} from '@/app/lib/definitions/dashboard';

const currency = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

interface Props {
  summary: DashboardSummary;
  byMarketplace: MarketplaceReturnStat[];
  products: ReturnedProductStat[];
}

export default function ReturnsOverview({ summary, byMarketplace, products }: Props) {
  const cards = [
    {
      label: 'Devoluciones del mes',
      value: currency.format(summary.monto_devuelto),
      detail: `${summary.ordenes_devueltas} órdenes · ${summary.tasa_devolucion.toFixed(1)}% de la venta bruta`,
      icon: ArrowUturnLeftIcon,
      tone: 'bg-rose-50 text-rose-600',
    },
    {
      label: 'Tasa por unidades',
      value: `${summary.tasa_unidades_devueltas.toFixed(1)}%`,
      detail: `${summary.unidades_devueltas} devueltas de ${summary.unidades_vendidas} vendidas`,
      icon: CubeIcon,
      tone: 'bg-orange-50 text-orange-600',
    },
    {
      label: 'Cancelaciones',
      value: currency.format(summary.monto_cancelado),
      detail: `${summary.ordenes_canceladas} órdenes · no forman parte de las ventas brutas`,
      icon: XCircleIcon,
      tone: 'bg-amber-50 text-amber-600',
    },
  ];

  return (
    <section aria-labelledby="returns-title">
      <div className="mb-4">
        <h2 id="returns-title" className="text-base font-semibold text-slate-900">
          Devoluciones y cancelaciones
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Impacto económico, unidades afectadas y origen de las devoluciones.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map(({ label, value, detail, icon: Icon, tone }) => (
          <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
          </article>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="text-sm font-semibold text-slate-800">Devoluciones por marketplace</h3>
          <p className="mt-1 text-xs text-slate-500">Monto, órdenes, unidades y tasa sobre sus ventas.</p>
          {byMarketplace.length > 0 ? (
            <ul className="mt-4 divide-y divide-slate-100">
              {byMarketplace.map((item) => (
                <li key={item.marketplace} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="flex h-10 w-24 shrink-0 items-center rounded-lg bg-slate-50 px-2">
                    <Image
                      src={`/marketplaces/${item.marketplace}.png`}
                      alt={item.marketplace.replaceAll('_', ' ')}
                      width={90}
                      height={28}
                      className="max-h-6 w-auto max-w-full object-contain object-left"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{currency.format(item.monto_devuelto)}</p>
                    <p className="text-xs text-slate-500">
                      {item.ordenes_devueltas} órdenes · {item.unidades_devueltas} unidades
                    </p>
                  </div>
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                    {item.tasa_devolucion.toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-sm text-slate-400">No hay devoluciones en este período.</p>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="text-sm font-semibold text-slate-800">Productos con más devoluciones</h3>
          <p className="mt-1 text-xs text-slate-500">Ranking por cantidad de unidades devueltas.</p>
          {products.length > 0 ? (
            <ol className="mt-4 space-y-3">
              {products.map((product, index) => (
                <li key={`${product.product_title}-${index}`} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-50 text-xs font-bold text-rose-700">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm leading-6 text-slate-700">
                    {product.product_title}
                  </span>
                  <span className="shrink-0 text-right">
                    <strong className="block text-sm text-slate-900">{product.cantidad_devuelta} u.</strong>
                    <small className="text-xs text-slate-500">{currency.format(product.monto_devuelto)}</small>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-5 text-sm text-slate-400">No hay productos devueltos en este período.</p>
          )}
        </article>
      </div>
    </section>
  );
}
