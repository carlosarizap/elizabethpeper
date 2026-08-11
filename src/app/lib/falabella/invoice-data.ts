export interface FalabellaAddress {
  City?: string | null;
  Ward?: string | null;
}

export interface FalabellaExtraBillingAttributes {
  LegalId?: string | null;
  ReceiverLocality?: string | null;
  ReceiverMunicipality?: string | null;
}

export interface FalabellaOrder {
  NationalRegistrationNumber?: string | null;
  AddressBilling?: FalabellaAddress | null;
  AddressShipping?: FalabellaAddress | null;
  ExtraBillingAttributes?: FalabellaExtraBillingAttributes | null;
}

export interface FalabellaInvoiceData {
  companyRut: string | null;
  billingCity: string | null;
}

export function cleanNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const cleaned = value.trim();
  const normalized = cleaned.toLowerCase();

  if (
    !cleaned ||
    cleaned === '-' ||
    normalized === 'null' ||
    normalized === 'undefined'
  ) {
    return null;
  }

  return cleaned;
}

export function normalizeChileanRut(value: unknown): string | null {
  const cleaned = cleanNullableString(value);
  if (!cleaned) return null;

  return cleaned
    .replace(/\./g, '')
    .replace(/\s+/g, '')
    .replace(/k$/i, 'K');
}

export function getFalabellaCompanyRut(order: FalabellaOrder): string | null {
  return (
    normalizeChileanRut(order.ExtraBillingAttributes?.LegalId) ??
    normalizeChileanRut(order.NationalRegistrationNumber)
  );
}

export function getFalabellaBillingCity(
  order: FalabellaOrder,
): string | null {
  const candidates = [
    order.ExtraBillingAttributes?.ReceiverLocality,
    order.ExtraBillingAttributes?.ReceiverMunicipality,
    order.AddressBilling?.City,
    order.AddressBilling?.Ward,
    order.AddressShipping?.City,
    order.AddressShipping?.Ward,
  ];

  for (const candidate of candidates) {
    const value = cleanNullableString(candidate);
    if (value) return value;
  }

  return null;
}

export function getFalabellaInvoiceData(
  order: FalabellaOrder,
): FalabellaInvoiceData {
  return {
    companyRut: getFalabellaCompanyRut(order),
    billingCity: getFalabellaBillingCity(order),
  };
}

export function preserveExistingInvoiceValue(
  existingValue: string | null,
  incomingValue: string | null,
): string | null {
  return incomingValue ?? existingValue;
}
