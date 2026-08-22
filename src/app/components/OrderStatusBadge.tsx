import {
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  TruckIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';

const statusVisuals = {
  pendiente: {
    label: 'Pendiente',
    classes: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: ClockIcon,
  },
  enviado: {
    label: 'Enviado',
    classes: 'border-blue-200 bg-blue-50 text-blue-700',
    icon: TruckIcon,
  },
  recibido: {
    label: 'Recibido',
    classes: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: CheckCircleIcon,
  },
  cancelado: {
    label: 'Cancelado',
    classes: 'border-red-200 bg-red-50 text-red-700',
    icon: XCircleIcon,
  },
  devuelto: {
    label: 'Devuelto',
    classes: 'border-rose-200 bg-rose-50 text-rose-700',
    icon: ArrowUturnLeftIcon,
  },
} as const;

export function formatOrderStatus(status: string | null | undefined): string {
  const normalized = String(status ?? '').trim().toLowerCase();
  const known = statusVisuals[normalized as keyof typeof statusVisuals];
  if (known) return known.label;
  if (!normalized) return 'Sin estado';

  return normalized
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

interface Props {
  status: string | null | undefined;
  marketplaceStatus?: string | null;
  compact?: boolean;
}

export default function OrderStatusBadge({ status, marketplaceStatus, compact = false }: Props) {
  const normalized = String(status ?? '').trim().toLowerCase();
  const visual = statusVisuals[normalized as keyof typeof statusVisuals] ?? {
    label: formatOrderStatus(status),
    classes: 'border-slate-200 bg-slate-100 text-slate-700',
    icon: ExclamationTriangleIcon,
  };
  const Icon = visual.icon;

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold ${visual.classes} ${
        compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs'
      }`}
      title={marketplaceStatus ? `Estado original: ${marketplaceStatus}` : undefined}
    >
      <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
      <span className="truncate">{visual.label}</span>
    </span>
  );
}

export function ReturnStatusBadge({ status }: { status: string | null | undefined }) {
  if (status !== 'devolucion_parcial' && status !== 'devolucion_total') return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
      <ArrowUturnLeftIcon className="h-4 w-4" aria-hidden="true" />
      {status === 'devolucion_total' ? 'Devolución total' : 'Devolución parcial'}
    </span>
  );
}
