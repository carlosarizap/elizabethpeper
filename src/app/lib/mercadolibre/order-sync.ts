import {
  cleanNullableString,
  normalizeChileanRut,
} from '../falabella/invoice-data.ts';

type UnknownRecord = Record<string, unknown>;

export interface MercadoLibreInvoiceData {
  companyRut: string | null;
  billingCity: string | null;
}

export interface MercadoLibreDispatchDeadlineInput {
  slaExpectedDate?: unknown;
  /** Límite de preparación; se conserva para distinguirlo, pero no es un SLA. */
  preparationDeadline?: unknown;
  /** Fecha prometida al comprador; permite estimar el despacho cuando aún no hay SLA. */
  buyerDeliveryDate?: unknown;
}

export type MercadoLibreDeliveryDateSource = 'sla' | 'predicted';

const SANTIAGO_TIME_ZONE = 'America/Santiago';
const PREDICTED_CUTOFF_HOUR = 16;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function scalarString(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  return cleanNullableString(value);
}

export function resolveMercadoLibreDispatchDeadline(
  input: MercadoLibreDispatchDeadlineInput,
): string | null {
  // /shipments/{id}/sla siempre tiene prioridad. Mientras Mercado Libre todavía
  // no lo publica, la fecha se estima y se marca explícitamente como predictiva.
  return scalarString(input.slaExpectedDate)
    ?? predictMercadoLibreDispatchDeadline(input);
}

function dateKey(value: unknown): string | null {
  const raw = scalarString(value);
  const match = raw?.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function previousBusinessDay(date: string): string {
  let candidate = shiftDate(date, -1);
  while (isWeekend(candidate)) candidate = shiftDate(candidate, -1);
  return candidate;
}

function nextBusinessDay(date: string): string {
  let candidate = shiftDate(date, 1);
  while (isWeekend(candidate)) candidate = shiftDate(candidate, 1);
  return candidate;
}

function santiagoOffset(date: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SANTIAGO_TIME_ZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${date}T16:00:00Z`));
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value;
  const match = offset?.match(/^GMT([+-]\d{2}:\d{2})$/);
  return match?.[1] ?? '-03:00';
}

export function predictMercadoLibreDispatchDeadline(
  input: Pick<MercadoLibreDispatchDeadlineInput, 'preparationDeadline' | 'buyerDeliveryDate'>,
): string | null {
  const preparationDate = dateKey(input.preparationDeadline);
  const buyerDeliveryDate = dateKey(input.buyerDeliveryDate);

  let predictedDate = buyerDeliveryDate
    ? previousBusinessDay(buyerDeliveryDate)
    : preparationDate
      ? nextBusinessDay(preparationDate)
      : null;

  // Nunca anticipamos el despacho a una fecha anterior al límite que ML le dio
  // al vendedor para confirmar la disponibilidad del producto.
  if (predictedDate && preparationDate && predictedDate < preparationDate) {
    predictedDate = nextBusinessDay(preparationDate);
  }
  if (!predictedDate) return null;

  return `${predictedDate}T${String(PREDICTED_CUTOFF_HOUR).padStart(2, '0')}:00:00${santiagoOffset(predictedDate)}`;
}

export function getMercadoLibreDeliveryDateSource(
  input: MercadoLibreDispatchDeadlineInput,
): MercadoLibreDeliveryDateSource | null {
  if (scalarString(input.slaExpectedDate)) return 'sla';
  return predictMercadoLibreDispatchDeadline(input) ? 'predicted' : null;
}

export function isMercadoLibreFulfillmentShipment(
  shipments: readonly { logisticType?: unknown }[] | null | undefined,
): boolean {
  return Boolean(
    shipments?.some((shipment) => scalarString(shipment.logisticType)?.toLowerCase() === 'fulfillment'),
  );
}

function getBillingInfoRoot(payload: unknown): UnknownRecord | null {
  const root = asRecord(payload);
  const buyer = asRecord(root?.buyer);
  return (
    asRecord(buyer?.billing_info) ??
    asRecord(root?.billing_info) ??
    root
  );
}

function getAttributeValue(attributes: unknown, names: readonly string[]): unknown {
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  const record = asRecord(attributes);

  if (record) {
    for (const [key, value] of Object.entries(record)) {
      if (normalizedNames.has(key.toLowerCase())) return value;
    }
  }

  if (Array.isArray(attributes)) {
    for (const entry of attributes) {
      const attribute = asRecord(entry);
      const key = cleanNullableString(
        attribute?.id ?? attribute?.name ?? attribute?.type,
      )?.toLowerCase();
      if (key && normalizedNames.has(key)) {
        return attribute?.value ?? attribute?.values;
      }
    }
  }

  return null;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  const record = asRecord(value);
  if (record) return Object.values(record).some(hasMeaningfulValue);
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  return cleanNullableString(value) !== null;
}

export function getMercadoLibreInvoiceData(
  payload: unknown,
): MercadoLibreInvoiceData {
  const billingInfo = getBillingInfoRoot(payload);
  const identification = asRecord(billingInfo?.identification);
  const address = asRecord(billingInfo?.address);

  return {
    companyRut: normalizeChileanRut(scalarString(identification?.number)),
    billingCity: cleanNullableString(address?.city_name),
  };
}

export function inferMercadoLibreDocumentType(
  payload: unknown,
): 'boleta' | 'factura' {
  const billingInfo = getBillingInfoRoot(payload);
  if (!billingInfo) return 'boleta';

  const attributes = billingInfo.attributes;
  const customerType = cleanNullableString(
    getAttributeValue(attributes, ['cust_type', 'customer_type']),
  )?.toUpperCase();
  const economicActivity =
    billingInfo.economic_activity ??
    billingInfo.economic_activities ??
    billingInfo.business_activity ??
    getAttributeValue(attributes, [
      'economic_activity',
      'economic_activities',
      'business_activity',
      'activity',
      'giro',
    ]);

  if (customerType === 'BU' || hasMeaningfulValue(economicActivity)) {
    return 'factura';
  }

  const knownConsumerTypes = new Set(['CO', 'CF', 'PF', 'PERSON']);
  if (customerType && !knownConsumerTypes.has(customerType)) {
    console.warn(
      '[MercadoLibre][Billing] Caso fiscal ambiguo:',
      JSON.stringify(payload),
    );
  }

  return 'boleta';
}

export function getMercadoLibreMarketplaceItemId(item: unknown): string {
  const itemRecord = asRecord(item);
  const product = asRecord(itemRecord?.item);
  const itemId = cleanNullableString(product?.id) ?? 'sin-item-id';
  const variationId = scalarString(itemRecord?.variation_id);
  return variationId ? `${itemId}:${variationId}` : itemId;
}

export function extractReturnShippingStatuses(payload: unknown): string[] {
  const returnEntries = Array.isArray(payload) ? payload : [payload];
  const statuses: string[] = [];

  for (const entry of returnEntries) {
    const returnRecord = asRecord(entry);
    if (!returnRecord) continue;

    const returnStatus = cleanNullableString(returnRecord.status);
    if (returnStatus) statuses.push(returnStatus.toLowerCase());

    const shipping = asRecord(returnRecord.shipping);
    const shippingStatus = cleanNullableString(shipping?.status);
    if (shippingStatus) statuses.push(shippingStatus.toLowerCase());

    if (Array.isArray(returnRecord.shipments)) {
      for (const shipmentEntry of returnRecord.shipments) {
        const shipment = asRecord(shipmentEntry);
        const status = cleanNullableString(shipment?.status);
        if (status) statuses.push(status.toLowerCase());
      }
    }
  }

  return statuses;
}

export function isMercadoLibreReturnClaim(claim: unknown): boolean {
  const claimRecord = asRecord(claim);
  const type = cleanNullableString(claimRecord?.type)?.toLowerCase();
  const relatedEntities = Array.isArray(claimRecord?.related_entities)
    ? claimRecord.related_entities
    : [];

  return type === 'return' || relatedEntities.some(
    (entity) => cleanNullableString(entity)?.toLowerCase() === 'return',
  );
}

export function isCertainFullLineReturn(
  claim: unknown,
  orderQuantity: number,
  orderItemCount: number,
): boolean {
  const claimRecord = asRecord(claim);
  const quantityType = cleanNullableString(claimRecord?.quantity_type)?.toLowerCase();
  const claimedQuantity = Number(claimRecord?.claimed_quantity);

  if (orderItemCount !== 1 || quantityType === 'partial') return false;
  if (Number.isFinite(claimedQuantity) && claimedQuantity > 0) {
    return claimedQuantity === orderQuantity;
  }
  return quantityType === 'total';
}
