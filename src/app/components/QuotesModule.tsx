'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  BanknotesIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CubeIcon,
  DocumentArrowDownIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { calculateQuotationTotals } from '@/app/lib/quotes/calculations';
import type {
  Quotation,
  QuotationCatalogOption,
  QuotationCustomer,
  QuotationDiscountType,
  QuotationInput,
  QuotationItemInput,
  QuotationListItem,
} from '@/app/lib/quotes/definitions';

interface FormItem extends QuotationItemInput { key: string }

interface FormState extends Omit<QuotationInput, 'items'> {
  id: string | null;
  quoteNumber: string | null;
  items: FormItem[];
}

const money = new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
});
const inputClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10';
const labelClass = 'mb-1.5 block text-xs font-bold text-slate-600';
const panelClass = 'rounded-3xl border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)] sm:p-5';

function chileToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function nextKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function blankItem(): FormItem {
  return { key: nextKey(), catalogProductId: null, catalogVariantId: null, description: '', quantity: 1, unit: 'unidad', unitPrice: 0 };
}

function blankForm(): FormState {
  return {
    id: null,
    quoteNumber: null,
    customer: { id: null, legalName: '', rut: '', contactName: '', email: '', phone: '', address: '', city: '', notes: '' },
    quoteDate: chileToday(),
    validUntil: null,
    deliveryDate: null,
    deliveryNote: '',
    pricesIncludeVat: false,
    vatRate: 0.19,
    discountType: 'none',
    discountValue: 0,
    paymentTerms: '',
    notes: '',
    items: [blankItem()],
  };
}

function quotationToForm(quotation: Quotation): FormState {
  return {
    id: quotation.id,
    quoteNumber: quotation.quoteNumber,
    customer: { ...quotation.customer },
    quoteDate: quotation.quoteDate,
    validUntil: quotation.validUntil,
    deliveryDate: quotation.deliveryDate,
    deliveryNote: quotation.deliveryNote ?? '',
    pricesIncludeVat: quotation.pricesIncludeVat,
    vatRate: quotation.vatRate,
    discountType: quotation.discountType,
    discountValue: quotation.discountValue,
    paymentTerms: quotation.paymentTerms ?? '',
    notes: quotation.notes ?? '',
    items: quotation.items.map((item) => ({ ...item, key: item.id })),
  };
}

function payloadFromForm(form: FormState): QuotationInput {
  return {
    customer: form.customer,
    quoteDate: form.quoteDate,
    validUntil: form.validUntil || null,
    deliveryDate: form.deliveryDate || null,
    deliveryNote: form.deliveryNote || null,
    pricesIncludeVat: form.pricesIncludeVat,
    vatRate: form.vatRate,
    discountType: form.discountType,
    discountValue: form.discountValue,
    paymentTerms: form.paymentTerms || null,
    notes: form.notes || null,
    items: form.items.map(({ key: _key, ...item }) => item),
  };
}

function dateLabel(value: string | null): string {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CL', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function productLabel(product: QuotationCatalogOption): string {
  const variant = product.variantLabel && product.variantLabel.toLocaleLowerCase('es') !== 'default title'
    ? ` · ${product.variantLabel}`
    : '';
  return `${product.sku ? `${product.sku} · ` : ''}${product.productName}${variant}`;
}

function CatalogProductSearch({ selectedId, selectedLabel, onSelect }: {
  selectedId: string | null | undefined;
  selectedLabel: string;
  onSelect: (product: QuotationCatalogOption | null) => void;
}) {
  const [query, setQuery] = useState(selectedId ? selectedLabel : '');
  const [options, setOptions] = useState<QuotationCatalogOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedId) setQuery(selectedLabel);
  }, [selectedId, selectedLabel]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('search', query.trim());
        const response = await fetch(`/api/quote-products?${params}`, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json() as { products?: QuotationCatalogOption[] };
        if (response.ok) setOptions(payload.products ?? []);
      } catch (requestError) {
        if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) setOptions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query]);

  return (
    <div className="relative">
      <label>
        <span className={labelClass}>Buscar en catálogo</span>
        <span className="relative block">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 140)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              if (selectedId) onSelect(null);
            }}
            placeholder="Nombre, SKU o variante…"
            className={`${inputClass} pl-10 pr-10`}
            autoComplete="off"
          />
          {query ? (
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(''); setOpen(true); onSelect(null); }} className="absolute right-2.5 top-2.5 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Limpiar producto">
              <XMarkIcon className="h-4 w-4" />
            </button>
          ) : <ChevronDownIcon className="pointer-events-none absolute right-3.5 top-3.5 h-4 w-4 text-slate-400" />}
        </span>
      </label>

      {open ? (
        <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl shadow-slate-900/15">
          {loading ? <p className="px-3 py-4 text-center text-xs font-medium text-slate-500">Buscando productos…</p> : null}
          {!loading && options.length === 0 ? <p className="px-3 py-4 text-center text-xs text-slate-500">No encontramos coincidencias. Puedes escribir la descripción manualmente.</p> : null}
          {!loading && options.map((product) => (
            <button key={product.variantId} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(productLabel(product)); setOpen(false); onSelect(product); }} className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-blue-50">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-800">{product.productName}</span>
                <span className="block truncate text-xs text-slate-500">{product.sku ? `${product.sku} · ` : ''}{product.variantLabel}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${product.shopifyPrice !== null ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {product.shopifyPrice !== null ? money.format(product.shopifyPrice) : 'Sin precio'}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function QuotesModule() {
  const [quotations, setQuotations] = useState<QuotationListItem[]>([]);
  const [customers, setCustomers] = useState<QuotationCustomer[]>([]);
  const [form, setForm] = useState<FormState>(() => blankForm());
  const [editorOpen, setEditorOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadQuotations = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    const response = await fetch(`/api/quotes?${params}`, { cache: 'no-store' });
    const payload = await response.json() as { quotations?: QuotationListItem[]; error?: string };
    if (!response.ok || !payload.quotations) throw new Error(payload.error ?? 'No fue posible cargar las cotizaciones.');
    setQuotations(payload.quotations);
  }, [search]);

  const loadCustomers = useCallback(async () => {
    const response = await fetch('/api/quote-customers', { cache: 'no-store' });
    const payload = await response.json() as { customers?: QuotationCustomer[] };
    if (response.ok) setCustomers(payload.customers ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      Promise.all([loadQuotations(), loadCustomers()])
        .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'No fue posible cargar el módulo.'))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadCustomers, loadQuotations]);

  const totals = useMemo(() => calculateQuotationTotals({
    items: form.items,
    pricesIncludeVat: form.pricesIncludeVat,
    vatRate: form.vatRate,
    discountType: form.discountType,
    discountValue: form.discountValue,
  }), [form.discountType, form.discountValue, form.items, form.pricesIncludeVat, form.vatRate]);
  const updateCustomer = (field: keyof FormState['customer'], value: string | null) => {
    setForm((current) => ({ ...current, customer: { ...current.customer, [field]: value } }));
  };
  const updateItem = (key: string, patch: Partial<FormItem>) => {
    setForm((current) => ({ ...current, items: current.items.map((item) => item.key === key ? { ...item, ...patch } : item) }));
  };
  const selectCustomer = (id: string) => {
    const customer = customers.find((entry) => entry.id === id);
    if (customer) setForm((current) => ({ ...current, customer: { ...customer } }));
    else setForm((current) => ({ ...current, customer: blankForm().customer }));
  };
  const selectProduct = (key: string, product: QuotationCatalogOption | null) => {
    if (!product) {
      updateItem(key, { catalogProductId: null, catalogVariantId: null, unitPrice: 0 });
      return;
    }
    const variant = product.variantLabel && product.variantLabel.toLocaleLowerCase('es') !== 'default title' ? ` - ${product.variantLabel}` : '';
    updateItem(key, {
      catalogProductId: product.productId,
      catalogVariantId: product.variantId,
      description: `${product.productName}${variant}`,
      unitPrice: product.shopifyPrice ?? 0,
    });
  };
  const scrollToEditor = () => window.setTimeout(() => document.getElementById('quote-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  const newQuotation = () => { setForm(blankForm()); setEditorOpen(true); setError(null); setNotice(null); scrollToEditor(); };

  const editQuotation = async (id: string) => {
    setError(null);
    const response = await fetch(`/api/quotes/${id}`, { cache: 'no-store' });
    const payload = await response.json() as { quotation?: Quotation; error?: string };
    if (!response.ok || !payload.quotation) { setError(payload.error ?? 'No fue posible abrir la cotización.'); return; }
    setForm(quotationToForm(payload.quotation));
    setEditorOpen(true);
    scrollToEditor();
  };

  const saveQuotation = async () => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch(form.id ? `/api/quotes/${form.id}` : '/api/quotes', {
        method: form.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadFromForm(form)),
      });
      const payload = await response.json() as { quotation?: Quotation; error?: string };
      if (!response.ok || !payload.quotation) throw new Error(payload.error ?? 'No fue posible guardar la cotización.');
      setForm(quotationToForm(payload.quotation));
      setNotice(`Cotización ${payload.quotation.quoteNumber} guardada.`);
      await Promise.all([loadQuotations(), loadCustomers()]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No fue posible guardar la cotización.');
    } finally { setSaving(false); }
  };

  const deleteQuote = async (id: string, quoteNumber: string) => {
    if (!window.confirm(`¿Borrar definitivamente la cotización ${quoteNumber}?`)) return;
    setDeletingId(id); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/quotes/${id}`, { method: 'DELETE' });
      const payload = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? 'No fue posible borrar la cotización.');
      if (form.id === id) { setEditorOpen(false); setForm(blankForm()); }
      setNotice(`Cotización ${quoteNumber} borrada.`);
      await loadQuotations();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'No fue posible borrar la cotización.');
    } finally { setDeletingId(null); }
  };

  const deleteCustomer = async () => {
    const customerId = form.customer.id;
    if (!customerId) return;
    if (!window.confirm(`¿Borrar al cliente ${form.customer.legalName}?`)) return;
    setDeletingCustomer(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/quote-customers/${customerId}`, { method: 'DELETE' });
      const payload = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? 'No fue posible borrar el cliente.');
      const customerName = form.customer.legalName;
      setForm((current) => ({ ...current, customer: blankForm().customer }));
      setCustomers((current) => current.filter((customer) => customer.id !== customerId));
      setNotice(`Cliente ${customerName} borrado.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'No fue posible borrar el cliente.');
    } finally { setDeletingCustomer(false); }
  };

  return (
    <main className="min-h-screen bg-[#f4f6fb] px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-[1480px] space-y-5">
        <header className="rounded-[2rem] border border-slate-200/80 bg-white p-5 shadow-[0_18px_60px_-44px_rgba(15,23,42,0.35)] sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Cotizaciones</h1>
            </div>
            <button type="button" onClick={newQuotation} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/15 transition hover:-translate-y-0.5 hover:bg-blue-700 sm:w-auto"><PlusIcon className="h-5 w-5" />Nueva cotización</button>
          </div>
        </header>

        {notice ? <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><CheckCircleIcon className="h-5 w-5 shrink-0" />{notice}</div> : null}
        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

        <section className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white shadow-[0_18px_60px_-40px_rgba(15,23,42,0.45)]">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <label className="relative block w-full max-w-xl"><MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar número, cliente o RUT…" className={`${inputClass} pl-10`} /></label>
            <button type="button" onClick={() => void loadQuotations()} title="Actualizar" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50"><ArrowPathIcon className="h-4 w-4" />Actualizar</button>
          </div>
          {loading ? <div className="p-12 text-center text-sm text-slate-500">Cargando cotizaciones…</div> : null}
          {!loading && quotations.length === 0 ? <div className="p-12 text-center"><DocumentTextIcon className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-600">Todavía no hay cotizaciones.</p><p className="mt-1 text-xs text-slate-400">Crea la primera o cambia tu búsqueda.</p></div> : null}
          {!loading && quotations.length > 0 ? (
            <>
              <div className="divide-y divide-slate-100 md:hidden">
                {quotations.map((quotation) => (
                  <article key={quotation.id} className="p-4">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-black uppercase tracking-wide text-blue-600">{quotation.quoteNumber}</p><h2 className="mt-1 truncate text-base font-black text-slate-900">{quotation.customerName}</h2><p className="mt-1 text-xs text-slate-500">{dateLabel(quotation.quoteDate)} · {quotation.itemCount} {quotation.itemCount === 1 ? 'ítem' : 'ítems'}</p></div><p className="shrink-0 text-base font-black text-slate-900">{money.format(quotation.total)}</p></div>
                    {quotation.deliveryDate ? <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Entrega: {dateLabel(quotation.deliveryDate)}</p> : null}
                    <div className="mt-3 grid grid-cols-3 gap-2"><button type="button" onClick={() => void editQuotation(quotation.id)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700"><PencilSquareIcon className="h-4 w-4" />Editar</button><a href={`/api/quotes/${quotation.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 text-xs font-bold text-blue-700"><DocumentArrowDownIcon className="h-4 w-4" />PDF</a><button type="button" disabled={deletingId === quotation.id} onClick={() => void deleteQuote(quotation.id, quotation.quoteNumber)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-red-200 text-xs font-bold text-red-600 disabled:opacity-50"><TrashIcon className="h-4 w-4" />Borrar</button></div>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50/80 text-left text-[11px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3.5">Cotización</th><th className="px-5 py-3.5">Cliente</th><th className="px-5 py-3.5">Fecha</th><th className="px-5 py-3.5">Entrega</th><th className="px-5 py-3.5">Ítems</th><th className="px-5 py-3.5 text-right">Total</th><th className="px-5 py-3.5 text-right">Acciones</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {quotations.map((quotation) => (
                      <tr key={quotation.id} className="transition hover:bg-blue-50/40"><td className="px-5 py-4 font-black text-blue-700">{quotation.quoteNumber}</td><td className="px-5 py-4 font-semibold text-slate-800">{quotation.customerName}</td><td className="px-5 py-4 text-slate-600">{dateLabel(quotation.quoteDate)}</td><td className="px-5 py-4 text-slate-600">{dateLabel(quotation.deliveryDate)}</td><td className="px-5 py-4 text-slate-600">{quotation.itemCount}</td><td className="px-5 py-4 text-right font-black text-slate-900">{money.format(quotation.total)}</td><td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => void editQuotation(quotation.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-white"><PencilSquareIcon className="h-4 w-4" />Editar</button><a href={`/api/quotes/${quotation.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"><DocumentArrowDownIcon className="h-4 w-4" />PDF</a><button type="button" disabled={deletingId === quotation.id} onClick={() => void deleteQuote(quotation.id, quotation.quoteNumber)} title="Borrar cotización" className="inline-flex min-h-9 items-center rounded-xl border border-red-200 px-2.5 text-red-600 hover:bg-red-50 disabled:opacity-50"><TrashIcon className="h-4 w-4" /></button></div></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>

        {editorOpen ? (
          <section id="quote-editor" className="scroll-mt-4 overflow-hidden rounded-[2rem] border border-slate-200/80 bg-[#f8f9fc] shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 bg-white px-4 py-5 sm:px-6"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">{form.quoteNumber ? 'Editando documento' : 'Nuevo documento'}</p><h2 className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">{form.quoteNumber ? `Cotización ${form.quoteNumber}` : 'Nueva cotización'}</h2><p className="mt-1 hidden text-sm text-slate-500 sm:block">Completa los datos y revisa el total antes de guardar.</p></div><button type="button" onClick={() => setEditorOpen(false)} className="rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100" aria-label="Cerrar editor"><XMarkIcon className="h-5 w-5" /></button></div>
            <div className="grid gap-5 p-3 sm:p-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:p-6">
              <div className="space-y-5">
                <div className={panelClass}>
                  <div className="flex items-center gap-2"><span className="rounded-xl bg-blue-50 p-2 text-blue-700"><UserIcon className="h-5 w-5" /></span><div><h3 className="font-black text-slate-900">Cliente</h3><p className="text-xs text-slate-500">Información que aparecerá en la cotización.</p></div></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div><span className={labelClass}>Cliente guardado</span><div className="flex gap-2"><select value={form.customer.id ?? ''} onChange={(event) => selectCustomer(event.target.value)} className={inputClass}><option value="">Nuevo cliente</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.legalName}{customer.rut ? ` · ${customer.rut}` : ''}</option>)}</select>{form.customer.id ? <button type="button" disabled={deletingCustomer} onClick={() => void deleteCustomer()} title="Borrar cliente" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 text-red-600 hover:bg-red-100 disabled:opacity-50"><TrashIcon className="h-4 w-4" /></button> : null}</div><p className="mt-1 text-[10px] leading-4 text-slate-400">Solo se puede borrar si no tiene cotizaciones asociadas.</p></div>
                    <label className="sm:col-span-2"><span className={labelClass}>Nombre o razón social *</span><input value={form.customer.legalName} onChange={(event) => updateCustomer('legalName', event.target.value)} className={inputClass} /></label>
                    <label><span className={labelClass}>RUT</span><input value={form.customer.rut ?? ''} onChange={(event) => updateCustomer('rut', event.target.value)} className={inputClass} /></label><label><span className={labelClass}>Contacto</span><input value={form.customer.contactName ?? ''} onChange={(event) => updateCustomer('contactName', event.target.value)} className={inputClass} /></label><label><span className={labelClass}>Correo</span><input type="email" value={form.customer.email ?? ''} onChange={(event) => updateCustomer('email', event.target.value)} className={inputClass} /></label><label><span className={labelClass}>Teléfono</span><input value={form.customer.phone ?? ''} onChange={(event) => updateCustomer('phone', event.target.value)} className={inputClass} /></label><label className="sm:col-span-2"><span className={labelClass}>Dirección</span><input value={form.customer.address ?? ''} onChange={(event) => updateCustomer('address', event.target.value)} className={inputClass} /></label><label><span className={labelClass}>Ciudad</span><input value={form.customer.city ?? ''} onChange={(event) => updateCustomer('city', event.target.value)} className={inputClass} /></label>
                  </div>
                </div>

                <div className={panelClass}>
                  <div className="flex items-center gap-2"><span className="rounded-xl bg-violet-50 p-2 text-violet-700"><DocumentTextIcon className="h-5 w-5" /></span><div><h3 className="font-black text-slate-900">Fechas y entrega</h3><p className="text-xs text-slate-500">Plazos de validez y despacho.</p></div></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3"><label><span className={labelClass}>Fecha cotización *</span><input type="date" value={form.quoteDate} onChange={(event) => setForm((current) => ({ ...current, quoteDate: event.target.value }))} className={inputClass} /></label><label><span className={labelClass}>Válida hasta</span><input type="date" value={form.validUntil ?? ''} onChange={(event) => setForm((current) => ({ ...current, validUntil: event.target.value || null }))} className={inputClass} /></label><label><span className={labelClass}>Fecha de entrega</span><input type="date" value={form.deliveryDate ?? ''} onChange={(event) => setForm((current) => ({ ...current, deliveryDate: event.target.value || null }))} className={inputClass} /></label><label className="sm:col-span-3"><span className={labelClass}>Nota de entrega</span><input value={form.deliveryNote ?? ''} onChange={(event) => setForm((current) => ({ ...current, deliveryNote: event.target.value }))} placeholder="Ej.: Entrega sábado 7 de noviembre" className={inputClass} /></label></div>
                </div>

                <div className="overflow-visible rounded-3xl border border-slate-200/80 bg-white shadow-[0_12px_40px_-30px_rgba(15,23,42,0.45)]">
                  <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="flex items-center gap-2"><span className="rounded-xl bg-amber-50 p-2 text-amber-700"><CubeIcon className="h-5 w-5" /></span><div><h3 className="font-black text-slate-900">Productos y servicios</h3><p className="text-xs text-slate-500">Busca en el catálogo o escribe una línea libre.</p></div></div><button type="button" onClick={() => setForm((current) => ({ ...current, items: [...current.items, blankItem()] }))} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-black text-white shadow-sm hover:bg-blue-700"><PlusIcon className="h-4 w-4" />Agregar línea</button></div>
                  <div className="space-y-3 p-3 sm:p-4">
                    {form.items.map((item, index) => (
                      <article key={item.key} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
                        <div className="mb-3 flex items-center justify-between"><span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 shadow-sm">Ítem {index + 1}</span><button type="button" disabled={form.items.length === 1} onClick={() => setForm((current) => ({ ...current, items: current.items.filter((entry) => entry.key !== item.key) }))} className="rounded-xl p-2 text-red-500 hover:bg-red-50 disabled:opacity-30" aria-label="Eliminar línea"><TrashIcon className="h-4 w-4" /></button></div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-12"><div className="col-span-2 sm:col-span-6"><CatalogProductSearch selectedId={item.catalogVariantId} selectedLabel={item.description} onSelect={(product) => selectProduct(item.key, product)} /></div><label className="col-span-2 sm:col-span-6"><span className={labelClass}>Descripción *</span><input value={item.description} onChange={(event) => updateItem(item.key, { description: event.target.value })} className={inputClass} /></label><label className="sm:col-span-2"><span className={labelClass}>Cantidad</span><input type="number" inputMode="decimal" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateItem(item.key, { quantity: Number(event.target.value) })} className={inputClass} /></label><label className="sm:col-span-3"><span className={labelClass}>Unidad</span><input value={item.unit ?? 'unidad'} onChange={(event) => updateItem(item.key, { unit: event.target.value })} className={inputClass} /></label><label className="col-span-2 sm:col-span-4"><span className={labelClass}>Precio unitario</span><input type="number" inputMode="numeric" min="0" step="1" value={item.unitPrice || ''} placeholder="Sin precio Shopify" onChange={(event) => updateItem(item.key, { unitPrice: event.target.value === '' ? 0 : Number(event.target.value) })} className={inputClass} /></label><div className="col-span-2 flex items-end justify-between rounded-xl bg-white px-3.5 py-2.5 sm:col-span-3"><span className="text-xs font-bold text-slate-500">Total línea</span><span className="text-sm font-black text-slate-900">{money.format(item.quantity * item.unitPrice)}</span></div></div>
                      </article>
                    ))}
                  </div>
                </div>

                <div className={panelClass}><h3 className="font-black text-slate-900">Condiciones y notas</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><label><span className={labelClass}>Condiciones de pago</span><textarea rows={3} value={form.paymentTerms ?? ''} onChange={(event) => setForm((current) => ({ ...current, paymentTerms: event.target.value }))} className={inputClass} /></label><label><span className={labelClass}>Notas generales</span><textarea rows={3} value={form.notes ?? ''} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className={inputClass} /></label></div></div>
              </div>

              <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
                <div className={panelClass}><div className="flex items-center gap-2"><span className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><BanknotesIcon className="h-5 w-5" /></span><h3 className="font-black text-slate-900">Precios</h3></div><label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5"><input type="checkbox" checked={form.pricesIncludeVat} onChange={(event) => setForm((current) => ({ ...current, pricesIncludeVat: event.target.checked }))} className="mt-0.5 h-5 w-5 rounded border-slate-300 text-blue-600" /><span><span className="block text-xs font-black text-slate-800">Precios incluyen IVA</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">Actívalo cuando los valores ya son precios finales.</span></span></label><div className="mt-3 grid grid-cols-2 gap-2"><label><span className={labelClass}>Descuento</span><select value={form.discountType} onChange={(event) => setForm((current) => ({ ...current, discountType: event.target.value as QuotationDiscountType, discountValue: event.target.value === 'none' ? 0 : current.discountValue }))} className={inputClass}><option value="none">Sin descuento</option><option value="percent">Porcentaje</option><option value="fixed">Monto fijo</option></select></label><label><span className={labelClass}>{form.discountType === 'percent' ? 'Porcentaje' : 'Monto'}</span><input type="number" min="0" step={form.discountType === 'percent' ? '0.1' : '1'} disabled={form.discountType === 'none'} value={form.discountValue ?? 0} onChange={(event) => setForm((current) => ({ ...current, discountValue: Number(event.target.value) }))} className={inputClass} /></label></div></div>
                <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Resumen</p><dl className="mt-4 space-y-2.5 text-sm text-slate-700"><div className="flex justify-between"><dt>Subtotal</dt><dd className="font-bold">{money.format(totals.subtotal)}</dd></div>{totals.discount > 0 ? <div className="flex justify-between"><dt>Descuento</dt><dd className="font-bold text-rose-600">-{money.format(totals.discount)}</dd></div> : null}<div className="flex justify-between"><dt>Neto</dt><dd className="font-bold">{money.format(totals.net)}</dd></div><div className="flex justify-between"><dt>IVA 19%</dt><dd className="font-bold">{money.format(totals.vat)}</dd></div><div className="mt-4 flex items-end justify-between border-t border-blue-200 pt-4"><dt className="font-black text-slate-900">Total</dt><dd className="text-2xl font-black text-blue-700">{money.format(totals.total)}</dd></div></dl></div>
                <div className="sticky bottom-3 space-y-2 rounded-3xl border border-slate-200 bg-white/95 p-3 shadow-2xl shadow-slate-900/15 backdrop-blur xl:static xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none"><button type="button" disabled={saving} onClick={() => void saveQuotation()} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-60">{saving ? <ArrowPathIcon className="h-5 w-5 animate-spin" /> : <CheckCircleIcon className="h-5 w-5" />}{saving ? 'Guardando…' : 'Guardar cotización'}</button>{form.id ? <a href={`/api/quotes/${form.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 text-sm font-black text-blue-700 hover:bg-blue-100"><DocumentArrowDownIcon className="h-5 w-5" />Abrir PDF</a> : null}{form.id && form.quoteNumber ? <button type="button" disabled={deletingId === form.id} onClick={() => void deleteQuote(form.id!, form.quoteNumber!)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-4 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"><TrashIcon className="h-4 w-4" />Borrar cotización</button> : null}</div>
              </aside>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
