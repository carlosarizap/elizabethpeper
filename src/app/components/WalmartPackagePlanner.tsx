'use client';

import { useState } from 'react';
import type { WalmartPackagePreview } from '@/app/lib/dispatches/definitions';
import type { WalmartPackageInput } from '@/app/lib/walmart/wcp-labels';

interface Props {
  orders: WalmartPackagePreview[];
  onCancel(): void;
  onConfirm(packages: Record<string, WalmartPackageInput[]>): void;
}

const emptyPackaging = () => ({ lengthCm: 0, widthCm: 0, heightCm: 0, weightKg: 0, source: 'measured' });
const fields = [['lengthCm', 'Largo (cm)'], ['widthCm', 'Ancho (cm)'], ['heightCm', 'Alto (cm)'], ['weightKg', 'Peso (kg)']] as const;

export default function WalmartPackagePlanner({ orders, onCancel, onConfirm }: Props) {
  const [plans, setPlans] = useState<Record<string, WalmartPackageInput[]>>(() => Object.fromEntries(orders.map((order) => {
    const single = order.lines.length === 1 && order.lines[0].quantity === 1;
    return [order.id, order.packages.length ? order.packages : [{
      items: order.lines.map((l) => ({ lineNumber: l.lineNumber, quantity: l.quantity })),
      packaging: single && order.lines[0].packaging ? order.lines[0].packaging : emptyPackaging(),
    }]];
  })));
  const [error, setError] = useState<string | null>(null);
  const update = (id: string, index: number, change: (pkg: WalmartPackageInput) => WalmartPackageInput) => {
    setPlans((current) => ({ ...current, [id]: current[id].map((pkg, i) => i === index ? change(pkg) : pkg) }));
  };
  const confirm = () => {
    for (const order of orders) {
      if (order.saved) continue;
      for (const line of order.lines) {
        const assigned = plans[order.id].flatMap((p) => p.items).filter((i) => i.lineNumber === line.lineNumber)
          .reduce((sum, i) => sum + i.quantity, 0);
        if (assigned !== line.quantity) { setError(`Orden ${order.orderId}: distribuye exactamente ${line.quantity} unidades de ${line.sku}.`); return; }
      }
      if (plans[order.id].some((p) => !p.items.some((i) => i.quantity > 0)
        || p.items.some((i) => !Number.isSafeInteger(i.quantity) || i.quantity < 0)
        || fields.some(([key]) => !Number.isFinite(p.packaging[key]) || p.packaging[key] <= 0))) {
        setError(`Orden ${order.orderId}: cada bulto necesita productos y medidas y peso mayores que cero.`); return;
      }
    }
    onConfirm(Object.fromEntries(orders.filter((o) => !o.saved).map((o) => [o.id, plans[o.id].map((p) => ({
      ...p, items: p.items.filter((i) => i.quantity > 0),
    }))])));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-labelledby="walmart-package-title">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white text-slate-900 shadow-xl">
        <div className="border-b p-5">
          <h2 id="walmart-package-title" className="text-xl font-bold text-slate-900">Preparar bultos de Walmart</h2>
          <p className="mt-1 text-sm text-slate-600">Revisa la agrupación sugerida y ajusta las medidas al paquete final. Se generará una etiqueta por bulto.</p>
        </div>
        <div className="space-y-6 overflow-y-auto p-5">
          {orders.map((order) => (
            <section key={order.id} className="rounded-xl border p-4">
              <h3 className="font-bold text-slate-900">Orden {order.orderId}</h3>
              {order.saved ? <p className="mt-2 text-sm text-blue-700">Bultos guardados: se recuperarán las etiquetas existentes y se completarán las que falten, conservando este contenido.</p> : (
                <div className="my-3 space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  <p className="font-semibold">Embalaje de referencia por unidad comercial</p>
                  {order.lines.map((line) => <p key={line.lineNumber}>{line.sku} · {line.title}: {line.packaging
                    ? `${line.packaging.lengthCm} × ${line.packaging.widthCm} × ${line.packaging.heightCm} cm · ${line.packaging.weightKg} kg · ${line.packaging.source === 'mercado_libre' ? 'Mercado Libre' : line.packaging.source === 'perfil_cojines_evaluado' ? 'Perfil de cojines evaluado' : line.packaging.source === 'estimado_tela_peso_shopify' ? 'Tela plegada estimada; peso Shopify' : 'Tela plegada estimada'}`
                    : line.packagingError ?? 'Sin medidas registradas; ingresa el embalaje real del bulto.'}</p>)}
                  <p>Las medidas de un bulto agrupado deben corresponder al paquete final.</p>
                </div>
              )}
              <div className="mt-3 space-y-3">
                {plans[order.id].map((pkg, index) => (
                  <div key={index} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between"><h4 className="font-semibold">Bulto {index + 1}</h4>
                      {!order.saved && plans[order.id].length > 1 ? <button type="button" onClick={() => setPlans((p) => ({ ...p, [order.id]: p[order.id].filter((_, i) => i !== index) }))} className="text-sm text-red-600">Quitar bulto</button> : null}
                    </div>
                    {order.lines.map((line) => {
                      const quantity = pkg.items.find((i) => i.lineNumber === line.lineNumber)?.quantity ?? 0;
                      return <label key={line.lineNumber} className="mt-2 flex items-center justify-between gap-3 text-sm"><span>{line.title}<span className="ml-2 text-xs text-slate-500">{line.sku} · {line.quantity} en la orden</span></span>
                        <input aria-label={`Cantidad de ${line.sku} en bulto ${index + 1}`} type="number" min="0" max={line.quantity} step="1" value={quantity} disabled={order.saved} onChange={(e) => update(order.id, index, (p) => ({ ...p, items: [...p.items.filter((i) => i.lineNumber !== line.lineNumber), { lineNumber: line.lineNumber, quantity: Number(e.target.value) }] }))} className="w-20 rounded border p-2" />
                      </label>;
                    })}
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{fields.map(([key, label]) => (
                      <label key={key} className="text-xs font-medium text-slate-600">{label}<input aria-label={`${label} del bulto ${index + 1}`} type="number" min="0.01" step="0.01" value={pkg.packaging[key] || ''} disabled={order.saved} onChange={(e) => update(order.id, index, (p) => ({ ...p, packaging: { ...p.packaging, [key]: Number(e.target.value), source: 'measured' } }))} className="mt-1 w-full rounded border p-2 text-sm" /></label>
                    ))}</div>
                    {!order.saved ? <button type="button" className="mt-2 text-xs text-blue-700" onClick={() => {
                      const positive = pkg.items.filter((i) => i.quantity > 0);
                      const unit = positive.length === 1 && positive[0].quantity === 1 ? order.lines.find((l) => l.lineNumber === positive[0].lineNumber)?.packaging : null;
                      if (unit) update(order.id, index, (p) => ({ ...p, packaging: unit }));
                      else setError('El embalaje registrado se puede copiar cuando el bulto contiene una sola unidad comercial. Para agrupar, ingresa las medidas finales.');
                    }}>Usar embalaje registrado de una unidad</button> : null}
                  </div>
                ))}
              </div>
              {!order.saved ? <button type="button" disabled={plans[order.id].length >= 200} onClick={() => setPlans((p) => ({ ...p, [order.id]: [...p[order.id], { items: [], packaging: emptyPackaging() }] }))} className="mt-3 rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700">Agregar bulto</button> : null}
            </section>
          ))}
          {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-3 border-t p-4"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2">Cancelar</button><button type="button" onClick={confirm} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">{orders.every((order) => order.saved) ? 'Recuperar e imprimir etiquetas' : 'Confirmar bultos y generar etiquetas'}</button></div>
      </div>
    </div>
  );
}
