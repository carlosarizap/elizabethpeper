export type FalabellaInvoiceType = 'BOLETA' | 'FACTURA';

const FALABELLA_NOT_FOUND_PATTERNS = [
  /OrderItem\(s\)\s+not\s+found\s*:?\s*([\d,\s]+)/i,
  /No\s+se\s+encontraron\s+elementos\s+de\s+pedido\s*:?\s*([\d,\s]+)/i,
];

export function getFalabellaInvoiceType(
  documentType: unknown,
): FalabellaInvoiceType {
  const normalized = String(documentType ?? '').trim().toLowerCase();

  if (normalized === 'boleta') return 'BOLETA';
  if (normalized === 'factura') return 'FACTURA';

  throw new Error(`Tipo de documento no soportado por Falabella: ${documentType}`);
}

export function isParisRepeatedInvoiceError(errorData: unknown): boolean {
  if (!errorData || typeof errorData !== 'object') return false;

  return (errorData as { message?: unknown }).message === 'INVOICE_REPEATED';
}

function collectStrings(value: unknown, result: string[]): void {
  if (typeof value === 'string') {
    result.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, result));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, result));
  }
}

export function getFalabellaMissingOrderItemIds(errorData: unknown): string[] {
  const strings: string[] = [];
  collectStrings(errorData, strings);

  const ids = new Set<string>();
  for (const value of strings) {
    for (const pattern of FALABELLA_NOT_FOUND_PATTERNS) {
      const match = value.match(pattern);
      if (!match) continue;
      match[1]
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => ids.add(item));
    }
  }

  return [...ids];
}

export function getFalabellaRetryOrderItemIds(
  requestedIds: readonly string[],
  errorData: unknown,
): string[] {
  const missingIds = new Set(getFalabellaMissingOrderItemIds(errorData));
  if (missingIds.size === 0) return [];
  return requestedIds.filter((id) => !missingIds.has(id));
}

export function falabellaItemsAreReadyForInvoice(
  items: ReadonlyArray<{ Status?: unknown }>,
): boolean {
  if (items.length === 0) return false;
  return items.every((item) => {
    const status = String(item.Status ?? '')
      .trim()
      .toLowerCase()
      .replaceAll('-', '_')
      .replaceAll(' ', '_');
    return ['ready_to_ship', 'shipped', 'delivered'].includes(status);
  });
}
