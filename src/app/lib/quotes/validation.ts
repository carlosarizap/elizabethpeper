import type {
  QuotationCustomerInput,
  QuotationDiscountType,
  QuotationInput,
  QuotationItemInput,
} from './definitions';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function optionalUuid(value: unknown): string | null {
  const normalized = optionalText(value);
  if (!normalized) return null;
  if (!UUID_PATTERN.test(normalized)) throw new Error('Se recibió un identificador no válido.');
  return normalized;
}

function dateValue(value: unknown, label: string, required = false): string | null {
  const normalized = optionalText(value);
  if (!normalized && !required) return null;
  if (!normalized || !DATE_PATTERN.test(normalized) || Number.isNaN(Date.parse(`${normalized}T12:00:00Z`))) {
    throw new Error(`${label} no es una fecha válida.`);
  }
  return normalized;
}

function numberValue(value: unknown, label: string, minimum = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${label} no es válido.`);
  }
  return parsed;
}

function customerInput(value: unknown): QuotationCustomerInput {
  if (!value || typeof value !== 'object') throw new Error('Debes indicar el cliente.');
  const customer = value as Record<string, unknown>;
  const legalName = optionalText(customer.legalName);
  if (!legalName) throw new Error('El nombre o razón social del cliente es obligatorio.');
  return {
    id: optionalUuid(customer.id),
    legalName,
    rut: optionalText(customer.rut),
    contactName: optionalText(customer.contactName),
    email: optionalText(customer.email),
    phone: optionalText(customer.phone),
    address: optionalText(customer.address),
    city: optionalText(customer.city),
    notes: optionalText(customer.notes),
  };
}

function itemInput(value: unknown, index: number): QuotationItemInput {
  if (!value || typeof value !== 'object') throw new Error(`El ítem ${index + 1} no es válido.`);
  const item = value as Record<string, unknown>;
  const description = optionalText(item.description);
  if (!description) throw new Error(`La descripción del ítem ${index + 1} es obligatoria.`);
  return {
    id: optionalUuid(item.id),
    catalogProductId: optionalUuid(item.catalogProductId),
    catalogVariantId: optionalUuid(item.catalogVariantId),
    description,
    quantity: numberValue(item.quantity, `La cantidad del ítem ${index + 1}`, 0.001),
    unit: optionalText(item.unit) ?? 'unidad',
    unitPrice: numberValue(item.unitPrice, `El precio del ítem ${index + 1}`),
  };
}

export function parseQuotationInput(value: unknown): QuotationInput {
  if (!value || typeof value !== 'object') throw new Error('Los datos de la cotización no son válidos.');
  const input = value as Record<string, unknown>;
  const items = Array.isArray(input.items) ? input.items.map(itemInput) : [];
  if (items.length === 0) throw new Error('Agrega al menos un producto o servicio.');
  const discountType = optionalText(input.discountType) ?? 'none';
  if (!(['none', 'percent', 'fixed'] as QuotationDiscountType[]).includes(discountType as QuotationDiscountType)) {
    throw new Error('El tipo de descuento no es válido.');
  }
  const vatRate = input.vatRate === undefined ? 0.19 : numberValue(input.vatRate, 'La tasa de IVA');
  if (vatRate > 1) throw new Error('La tasa de IVA debe expresarse entre 0 y 1.');
  const discountValue = input.discountValue === undefined
    ? 0
    : numberValue(input.discountValue, 'El descuento');
  if (discountType === 'percent' && discountValue > 100) {
    throw new Error('El descuento porcentual no puede superar 100%.');
  }
  return {
    customer: customerInput(input.customer),
    quoteDate: dateValue(input.quoteDate, 'La fecha de cotización', true)!,
    validUntil: dateValue(input.validUntil, 'La fecha de vigencia'),
    deliveryDate: dateValue(input.deliveryDate, 'La fecha de entrega'),
    deliveryNote: optionalText(input.deliveryNote),
    pricesIncludeVat: Boolean(input.pricesIncludeVat),
    vatRate,
    discountType: discountType as QuotationDiscountType,
    discountValue,
    paymentTerms: optionalText(input.paymentTerms),
    notes: optionalText(input.notes),
    items,
  };
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

