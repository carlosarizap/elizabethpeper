'use client';

import { useEffect, useRef } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';

export interface ToastFeedback {
  kind: 'success' | 'warning' | 'error';
  text: string;
  title?: string;
}

interface Props {
  feedback: ToastFeedback | null;
  onClose: () => void;
}

const visuals = {
  success: {
    icon: CheckCircleIcon,
    container: 'border-emerald-200 bg-white text-emerald-800',
    iconClasses: 'text-emerald-500',
  },
  warning: {
    icon: ExclamationTriangleIcon,
    container: 'border-amber-200 bg-white text-amber-800',
    iconClasses: 'text-amber-500',
  },
  error: {
    icon: XCircleIcon,
    container: 'border-red-200 bg-white text-red-800',
    iconClasses: 'text-red-500',
  },
} as const;

export default function StatusRefreshToast({ feedback, onClose }: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => onCloseRef.current(), 7000);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  if (!feedback) return null;

  const visual = visuals[feedback.kind];
  const Icon = visual.icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 right-5 z-[100] flex w-[calc(100%-2.5rem)] max-w-sm items-start gap-3 rounded-2xl border p-4 shadow-2xl ${visual.container}`}
    >
      <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${visual.iconClasses}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{feedback.title ?? 'Actualización de estados'}</p>
        <p className="mt-1 text-sm leading-5 text-slate-600">{feedback.text}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        aria-label="Cerrar notificación"
      >
        <XMarkIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
