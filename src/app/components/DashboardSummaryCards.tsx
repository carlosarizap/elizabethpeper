import {
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  CalculatorIcon,
  ChartBarIcon,
  ReceiptPercentIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import { DashboardSummary } from '@/app/lib/definitions/dashboard';

const currency = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

interface Props {
  summary: DashboardSummary;
}

export default function DashboardSummaryCards({ summary }: Props) {
  const growth = summary.crecimiento_mensual;
  const GrowthIcon = growth !== null && growth < 0
    ? ArrowTrendingDownIcon
    : ArrowTrendingUpIcon;
  const growthTone = growth === null
    ? 'bg-slate-50 text-slate-600'
    : growth >= 0
      ? 'bg-emerald-50 text-emerald-600'
      : 'bg-rose-50 text-rose-600';

  const cards = [
    {
      label: 'Ventas brutas',
      value: currency.format(summary.total_ventas),
      detail: 'Incluye devoluciones y excluye cancelaciones',
      icon: BanknotesIcon,
      iconClass: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'Ventas netas',
      value: currency.format(summary.ventas_netas),
      detail: `${currency.format(summary.monto_devuelto)} descontado por devoluciones`,
      icon: CalculatorIcon,
      iconClass: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'Crecimiento mensual',
      value: growth === null
        ? 'Sin base'
        : `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`,
      detail: `Comparado con ${currency.format(summary.ventas_mes_anterior)}`,
      icon: GrowthIcon,
      iconClass: growthTone,
    },
    {
      label: summary.es_proyeccion ? 'Proyección de cierre' : 'Cierre del mes',
      value: currency.format(summary.proyeccion_cierre),
      detail: summary.es_proyeccion
        ? 'Estimación según el ritmo de venta actual'
        : 'Resultado final del período seleccionado',
      icon: ChartBarIcon,
      iconClass: 'bg-indigo-50 text-indigo-600',
    },
    {
      label: 'Órdenes del mes',
      value: summary.total_ordenes.toLocaleString('es-CL'),
      detail: 'Incluye devoluciones y excluye canceladas',
      icon: ShoppingBagIcon,
      iconClass: 'bg-cyan-50 text-cyan-600',
    },
    {
      label: 'Ticket promedio',
      value: currency.format(summary.ticket_promedio),
      detail: 'Venta bruta promedio por orden',
      icon: ReceiptPercentIcon,
      iconClass: 'bg-violet-50 text-violet-600',
    },
  ];

  return (
    <section aria-labelledby="performance-title">
      <div className="mb-4">
        <h2 id="performance-title" className="text-base font-semibold text-slate-900">
          Rendimiento del mes
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Resultado comercial, comparación y proyección del período seleccionado.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {cards.map(({ label, value, detail, icon: Icon, iconClass }) => (
          <article
            key={label}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${iconClass}`}>
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-1 break-words text-2xl font-bold tracking-tight text-slate-900">
              {value}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
