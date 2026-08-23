'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownTrayIcon, ArrowLeftIcon, PrinterIcon } from '@heroicons/react/24/outline';

export default function DispatchPrintView({ batchId }: { batchId: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const documentUrl = `/api/dispatches/batches/${batchId}/document`;

  const openPrintDialog = () => {
    const frameWindow = frameRef.current?.contentWindow;
    if (frameWindow) {
      frameWindow.focus();
      frameWindow.print();
    }
  };

  return (
    <main className="flex min-h-[calc(100vh-65px)] flex-col bg-slate-900">
      <div className="flex flex-col gap-3 bg-white px-4 py-3 shadow sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-slate-900">Etiquetas de despacho · papel carta</p>
          <p className="text-xs text-slate-500">La impresión solicitada ya quedó registrada.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dispatches" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <ArrowLeftIcon className="h-4 w-4" /> Volver
          </Link>
          <a href={documentUrl} download className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <ArrowDownTrayIcon className="h-4 w-4" /> Descargar PDF
          </a>
          <button type="button" onClick={openPrintDialog} disabled={!loaded} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300">
            <PrinterIcon className="h-4 w-4" /> Imprimir
          </button>
        </div>
      </div>
      <iframe
        ref={frameRef}
        src={`${documentUrl}#toolbar=1&navpanes=0&view=FitH`}
        title="Etiquetas de despacho"
        onLoad={() => {
          setLoaded(true);
          window.setTimeout(openPrintDialog, 500);
        }}
        className="min-h-[calc(100vh-145px)] w-full flex-1 border-0 bg-slate-700"
      />
    </main>
  );
}
