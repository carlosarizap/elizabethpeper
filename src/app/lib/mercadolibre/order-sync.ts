import {
  cleanNullableString,
  normalizeChileanRut,
} from '../falabella/invoice-data.ts';

type UnknownRecord = Record<string, unknown>;

export interface MercadoLibreInvoiceData {
  companyRut: string | null;
  billingCity: string | null;
}

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
