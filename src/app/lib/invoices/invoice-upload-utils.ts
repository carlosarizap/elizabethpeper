export type FalabellaInvoiceType = 'BOLETA' | 'FACTURA';

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
