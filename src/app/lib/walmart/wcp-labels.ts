import { toArray, type WalmartOrder } from './order-sync.ts';
import { walmartBoxDimensions, type ProductPackaging } from './packaging.ts';
import { PDFDocument } from 'pdf-lib';

export interface WcpPackage {
  key: string;
  productSummary: string;
  request: {
    purchaseOrderId: string;
    packageType: string;
    boxDimensions: ReturnType<typeof walmartBoxDimensions>;
    boxItems: Array<{ lineNumber: string; sku: string; quantity: number }>;
  };
}

export interface StoredWcpLabel {
  key: string;
  status: 'planned' | 'creating' | 'ready' | 'failed' | 'uncertain';
  request: WcpPackage['request'];
  productSummary: string;
  trackingNumber: string | null;
  document: Uint8Array | null;
}

export interface WcpLabelStore {
  list(): Promise<StoredWcpLabel[]>;
  savePlan(packages: WcpPackage[]): Promise<void>;
  start(key: string): Promise<void>;
  ready(pkg: WcpPackage, trackingNumber: string, document: Uint8Array): Promise<void>;
  fail(key: string, status: 'failed' | 'uncertain', message: string): Promise<void>;
}

export interface WcpDependencies {
  request(path: string, init?: RequestInit, accept?: string): Promise<Response>;
  download(trackingNumbers: readonly string[]): Promise<Uint8Array>;
  acknowledge?(): Promise<void>;
  store: WcpLabelStore;
}

interface RemoteLabel {
  purchaseOrderId?: string;
  trackingNo?: string;
  trackingNumber?: string;
  boxItems?: Array<{ sku: string; lineNumber: string; quantity: number }>;
  shippingDocuments?: Array<{ documentFormat?: string; documentType?: string; base64EncodedDocument?: string }>;
}

function tracking(label: RemoteLabel): string {
  return String(label.trackingNo ?? label.trackingNumber ?? '').trim();
}

function pdf(label: RemoteLabel): Uint8Array | null {
  const document = label.shippingDocuments?.find((d) => d.documentFormat === 'PDF' && d.documentType === 'LABEL');
  if (!document?.base64EncodedDocument) return null;
  const bytes = Buffer.from(document.base64EncodedDocument, 'base64');
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Walmart devolvió un documento de etiqueta inválido.');
  return bytes;
}

export interface WalmartPackageInput {
  items: Array<{ lineNumber: string; quantity: number }>;
  packaging: ProductPackaging;
}

export function planWcpPackages(order: WalmartOrder, input: unknown): WcpPackage[] {
  if (!Array.isArray(input) || !input.length || input.length > 200) {
    throw new Error('Define entre 1 y 200 bultos para esta orden Walmart antes de imprimir.');
  }
  const lines = new Map(toArray(order.orderLines?.orderLine).map((line) => [String(line.lineNumber), line]));
  const assigned = new Map<string, number>();
  const packages = input.map((value: WalmartPackageInput, index) => {
    if (!value || !value.packaging || !Array.isArray(value.items) || !value.items.length) {
      throw new Error('Cada bulto debe tener contenido, medidas y peso.');
    }
    const seen = new Set<string>();
    const boxItems = value.items.map((item) => {
      const lineNumber = String(item.lineNumber);
      const line = lines.get(lineNumber);
      if (!line?.item?.sku || seen.has(lineNumber) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new Error('El contenido del bulto tiene líneas o cantidades inválidas.');
      }
      seen.add(lineNumber);
      assigned.set(lineNumber, (assigned.get(lineNumber) ?? 0) + item.quantity);
      return { lineNumber, sku: line.item.sku, quantity: item.quantity };
    });
    return {
      key: `box:${index + 1}`,
      productSummary: boxItems.map((item) => `${item.quantity} - ${lines.get(item.lineNumber)!.item!.productName ?? item.sku}`).join('\n'),
      request: {
        purchaseOrderId: String(order.purchaseOrderId), packageType: 'CUSTOM_PACKAGE',
        boxDimensions: walmartBoxDimensions(value.packaging), boxItems,
      },
    };
  });
  for (const [lineNumber, line] of lines) {
    const quantity = Number(line.orderLineQuantity?.amount);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || assigned.get(lineNumber) !== quantity) {
      throw new Error(`Distribuye exactamente las ${quantity} unidades de ${line.item?.sku ?? lineNumber} entre los bultos.`);
    }
  }
  if (!lines.size) throw new Error('La orden Walmart no tiene productos.');
  return packages;
}

function sameItems(left: NonNullable<RemoteLabel['boxItems']>, right: NonNullable<RemoteLabel['boxItems']>): boolean {
  const key = (items: typeof left) => JSON.stringify(items.map((i) => ({ lineNumber: String(i.lineNumber), sku: i.sku, quantity: Number(i.quantity) }))
    .sort((a, b) => a.lineNumber.localeCompare(b.lineNumber)));
  return key(left) === key(right);
}

function sameRequest(left: WcpPackage['request'], right: WcpPackage['request']): boolean {
  return left.purchaseOrderId === right.purchaseOrderId && left.packageType === right.packageType
    && sameItems(left.boxItems, right.boxItems)
    && Object.entries(left.boxDimensions).every(([key, value]) => right.boxDimensions[key as keyof typeof right.boxDimensions] === value);
}

async function labelDocument(label: RemoteLabel, deps: WcpDependencies): Promise<Uint8Array> {
  const bytes = pdf(label) ?? await deps.download([tracking(label)]);
  const document = await PDFDocument.load(bytes);
  if (document.getPageCount() !== 1) throw new Error('Walmart debe devolver una página de etiqueta por bulto. Revisa el documento recibido.');
  return bytes;
}

// Called while holding the database lock for this purchase order. The reservation
// survives a crash: an ambiguous POST must be reconciled, never repeated blindly.
export async function prepareWcpLabels(order: WalmartOrder, deps: WcpDependencies, input?: unknown) {
  let stored = await deps.store.list();
  const requestedPlan = input === undefined ? null : planWcpPackages(order, input);
  const savedPlan = stored.map((r) => ({ key: r.key, request: r.request, productSummary: r.productSummary }));
  if (requestedPlan && savedPlan.length && (requestedPlan.length !== savedPlan.length
    || requestedPlan.some((pkg) => !savedPlan.some((saved) => saved.key === pkg.key && sameRequest(saved.request, pkg.request))))) {
    if (stored.some((row) => row.status !== 'planned' && row.status !== 'failed')) {
      throw new Error('Esta orden ya tiene un plan de bultos guardado. Reimprime sus etiquetas; no cambies el contenido de un envío iniciado.');
    }
    stored = [];
  }
  const packages = requestedPlan ?? (savedPlan.length ? savedPlan : planWcpPackages(order, input));
  // Revalidate the saved contents against the fresh Walmart order.
  planWcpPackages(order, packages.map((p) => ({ items: p.request.boxItems, packaging: {
    lengthCm: p.request.boxDimensions.boxLength, widthCm: p.request.boxDimensions.boxWidth,
    heightCm: p.request.boxDimensions.boxHeight, weightKg: p.request.boxDimensions.boxWeight, source: 'saved',
  } })));
  if (stored.length && stored.every((row) => row.status === 'ready' && row.document)) {
    return stored.map((r) => ({ document: r.document!, productSummary: r.productSummary, fullPage: true }));
  }
  const response = await deps.request(`/v3/shipping/labels/purchase-orders/${encodeURIComponent(String(order.purchaseOrderId))}`);
  const payload = await response.json();
  if (!response.ok || !Array.isArray(payload.data)) {
    throw new Error('No se pudieron consultar las etiquetas existentes de Walmart. No se crearon nuevos envíos.');
  }
  const remote = payload.data as RemoteLabel[];
  const used = new Set(stored.filter((r) => r.status === 'ready').map((r) => r.trackingNumber));
  const documents: Array<{ document: Uint8Array; productSummary: string; fullPage: boolean }> = [];
  const available = remote.filter((r) => !used.has(tracking(r)));
  const unmatched = packages.filter((p) => !stored.some((r) => r.key === p.key && r.status === 'ready')).slice();
  const remoteTrackings = new Set<string>();
  for (const label of available) {
    const match = unmatched.findIndex((p) => label.boxItems && sameItems(label.boxItems, p.request.boxItems));
    if (!tracking(label) || remoteTrackings.has(tracking(label)) || match < 0) {
      throw new Error('La orden tiene etiquetas con otro agrupamiento de productos. Revisa sus bultos en Walmart antes de generar más etiquetas.');
    }
    remoteTrackings.add(tracking(label));
    unmatched.splice(match, 1);
  }
  if (deps.acknowledge) await deps.acknowledge();
  if (!stored.length) await deps.store.savePlan(packages);
  for (const pkg of packages) {
    const local = stored.find((r) => r.key === pkg.key);
    if (local?.status === 'ready' && local.document) {
      documents.push({ document: local.document, productSummary: local.productSummary, fullPage: true });
      continue;
    }
    const existingIndex = available.findIndex((r) => r.boxItems && sameItems(r.boxItems, pkg.request.boxItems));
    if (existingIndex >= 0) {
      const label = available.splice(existingIndex, 1)[0];
      const document = await labelDocument(label, deps);
      await deps.store.ready(pkg, tracking(label), document);
      documents.push({ document, productSummary: pkg.productSummary, fullPage: true });
      continue;
    }
    if (local && local.status !== 'failed' && local.status !== 'planned') {
      throw new Error('Hay una generación de etiqueta sin confirmar en Walmart. Revisa el envío antes de volver a crearlo.');
    }
    if (remote.length > packages.length) throw new Error('Walmart informa más etiquetas que bultos previstos. Revisa la orden.');
    await deps.store.start(pkg.key);
    let definitiveRejection = false;
    try {
      // Do not retry this POST on timeouts or server errors: it can create a shipment.
      const created = await deps.request('/v3/shipping/labels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pkg.request),
      }, 'application/json');
      definitiveRejection = !created.ok && [400, 401, 403, 404, 422, 429].includes(created.status);
      const body = await created.json();
      if (!created.ok) {
        const message = body.errors?.error?.[0]?.description ?? body.errors?.[0]?.description ?? body.message ?? `código ${created.status}`;
        throw new Error(`Walmart no permitió crear la etiqueta: ${String(message).slice(0, 350)}`);
      }
      const label = body.data as RemoteLabel | undefined;
      if (!label || !tracking(label)) throw new Error('Walmart no confirmó el seguimiento de la etiqueta creada.');
      if (used.has(tracking(label))) throw new Error('Walmart devolvió un seguimiento ya usado por otro bulto. Revisa el envío antes de continuar.');
      if (label.purchaseOrderId && String(label.purchaseOrderId) !== String(order.purchaseOrderId)
        || label.boxItems && !sameItems(label.boxItems, pkg.request.boxItems)) {
        throw new Error('Walmart devolvió una etiqueta con contenido diferente al bulto solicitado.');
      }
      const document = await labelDocument(label, deps);
      await deps.store.ready(pkg, tracking(label), document);
      used.add(tracking(label));
      documents.push({ document, productSummary: pkg.productSummary, fullPage: true });
    } catch (error) {
      await deps.store.fail(pkg.key, definitiveRejection ? 'failed' : 'uncertain', error instanceof Error ? error.message : 'Error al generar etiqueta');
      throw error;
    }
  }
  if (available.length) throw new Error('Walmart tiene etiquetas adicionales que no corresponden al plan de bultos.');
  return documents;
}
