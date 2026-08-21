import {
  ClipboardDocumentCheckIcon,
  DocumentMinusIcon,
} from '@heroicons/react/24/outline';
import { DocumentStats, OrderStatusStat } from '@/app/lib/definitions/dashboard';

interface Props {
  statuses: OrderStatusStat[];
  documents: DocumentStats;
}

const statusStyles: Record<string, { label: string; bar: string; badge: string }> = {
  pendiente: { label: 'Pendiente', bar: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700' },
  enviado: { label: 'Enviado', bar: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700' },
  recibido: { label: 'Recibido', bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700' },
  cancelado: { label: 'Cancelado', bar: 'bg-red-500', badge: 'bg-red-50 text-red-700' },
  devuelto: { label: 'Devuelto', bar: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700' },
};

function getStatusStyle(status: string) {
  return statusStyles[status] ?? {
    label: `Sin mapear (${status})`,
    bar: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-700',
  };
}

export default function OperationsOverview({ statuses, documents }: Props) {
  return (
    <section aria-labelledby="operations-title">
      <div className="mb-4">
        <h2 id="operations-title" className="text-base font-semibold text-slate-900">
          Operación y documentos tributarios
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Estado de las órdenes y carga pendiente para la automatización del SII.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 xl:col-span-3">
          <h3 className="text-sm font-semibold text-slate-800">Distribución por estado</h3>
          <p className="mt-1 text-xs text-slate-500">Incluye todas las órdenes registradas en el período.</p>
          {statuses.length > 0 ? (
            <ul className="mt-5 space-y-4">
              {statuses.map((item) => {
                const style = getStatusStyle(item.status);
                return (
                  <li key={item.status}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                      <span className={`rounded-full px-2.5 py-1 font-semibold ${style.badge}`}>
                        {style.label}
                      </span>
                      <span className="font-medium text-slate-600">
                        {item.total.toLocaleString('es-CL')} · {item.porcentaje.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${style.bar}`}
                        style={{ width: `${Math.min(100, item.porcentaje)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-5 text-sm text-slate-400">No hay órdenes en este período.</p>
          )}
        </article>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-2 xl:grid-cols-1">
          <article className="rounded-2xl border border-blue-100 bg-gradient-to-br from-white to-blue-50 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-600">Documentos pendientes</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
                  {documents.documentos_pendientes.toLocaleString('es-CL')}
                </p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <ClipboardDocumentCheckIcon className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-white/80 p-3">
                <span className="block text-slate-500">Boletas</span>
                <strong className="mt-1 block text-lg text-slate-900">{documents.boletas_pendientes}</strong>
              </div>
              <div className="rounded-xl bg-white/80 p-3">
                <span className="block text-slate-500">Facturas</span>
                <strong className="mt-1 block text-lg text-slate-900">{documents.facturas_pendientes}</strong>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-600">Notas de crédito pendientes</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
                  {documents.notas_credito_pendientes.toLocaleString('es-CL')}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Boletas emitidas con líneas canceladas o devueltas.
                </p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                <DocumentMinusIcon className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
