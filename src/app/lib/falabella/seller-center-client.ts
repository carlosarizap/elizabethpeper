import { calculateFalabellaSignature } from './signature-helper.ts';

const FALABELLA_API = 'https://sellercenter-api.falabella.com/';

export interface FalabellaLiveOrderItem {
  orderItemId: string;
  status: string | null;
  packageId: string | null;
  shippingType: string | null;
  shipmentProvider: string | null;
  trackingNumber: string | null;
  isProcessable: boolean;
}

interface FalabellaDocument {
  DocumentType?: unknown;
  MimeType?: unknown;
  File?: unknown;
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function credentials() {
  const userId = process.env.FALABELLA_USER_ID;
  const apiKey = process.env.FALABELLA_API_KEY;
  if (!userId || !apiKey) throw new Error('Faltan las credenciales de Falabella.');
  return { userId, apiKey };
}

function signedParams(action: string, extra: Record<string, string>) {
  const { userId, apiKey } = credentials();
  const params: Record<string, string> = {
    Action: action,
    Format: 'JSON',
    Timestamp: new Date().toISOString(),
    UserID: userId,
    Version: '1.0',
    ...extra,
  };
  return { ...params, Signature: calculateFalabellaSignature(params, apiKey) };
}

function falabellaError(payload: Record<string, any>): Error | null {
  const response = payload?.ErrorResponse;
  if (!response) return null;
  const code = cleanString(response?.Head?.ErrorCode);
  const message = cleanString(response?.Head?.ErrorMessage)
    ?? cleanString(response?.Body?.Errors?.Error?.Message)
    ?? 'Falabella rechazó la solicitud.';
  return new Error(`${code ? `${code}: ` : ''}${message}`);
}

async function requestFalabella(
  action: string,
  extra: Record<string, string>,
  method: 'GET' | 'POST' = 'GET',
): Promise<Record<string, any>> {
  const params = signedParams(action, extra);
  const signedUrl = `${FALABELLA_API}?${new URLSearchParams(params).toString()}`;
  const response = method === 'GET'
    ? await fetch(signedUrl, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
    : await fetch(signedUrl, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
      });

  const payload = await response.json().catch(() => null) as Record<string, any> | null;
  if (!response.ok || !payload) {
    throw new Error(`Falabella respondió con código ${response.status}.`);
  }
  const apiError = falabellaError(payload);
  if (apiError) throw apiError;
  if (!payload.SuccessResponse) throw new Error('Falabella devolvió una respuesta inesperada.');
  return payload;
}

export async function fetchFalabellaOrderItems(
  sellerCenterOrderId: string,
): Promise<FalabellaLiveOrderItem[]> {
  const payload = await requestFalabella('GetOrderItems', {
    OrderId: sellerCenterOrderId,
  });
  const rawItems = asArray(
    payload?.SuccessResponse?.Body?.OrderItems?.OrderItem as Record<string, unknown> | Record<string, unknown>[] | undefined,
  );
  return rawItems.map((item) => ({
    orderItemId: cleanString(item.OrderItemId) ?? '',
    status: cleanString(item.Status)?.toLowerCase() ?? null,
    packageId: cleanString(item.PackageId),
    shippingType: cleanString(item.ShippingType),
    shipmentProvider: cleanString(item.ShipmentProvider),
    trackingNumber: cleanString(item.TrackingCode) ?? cleanString(item.TrackingNumber),
    isProcessable: cleanString(item.IsProcessable) !== '0',
  })).filter((item) => item.orderItemId);
}

export async function downloadFalabellaShippingParcelPdfs(
  orderItemIds: readonly string[],
): Promise<Uint8Array[]> {
  if (orderItemIds.length === 0) throw new Error('La orden no tiene ítems Falabella válidos.');
  const payload = await requestFalabella('GetDocument', {
    DocumentType: 'shippingParcel',
    OrderItemIds: `[${orderItemIds.join(',')}]`,
  });
  const documents = asArray(
    (payload?.SuccessResponse?.Body?.Documents?.Document
      ?? payload?.SuccessResponse?.Body?.Document) as FalabellaDocument | FalabellaDocument[] | undefined,
  );
  if (documents.length === 0) throw new Error('Falabella todavía no habilita la etiqueta.');

  return documents.map((document) => {
    const mimeType = cleanString(document.MimeType)?.toLowerCase();
    if (mimeType !== 'application/pdf') {
      throw new Error(`Falabella entregó la etiqueta en ${mimeType ?? 'un formato desconocido'}, no en PDF.`);
    }
    const encoded = cleanString(document.File);
    if (!encoded) throw new Error('Falabella devolvió una etiqueta vacía.');
    const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
    if (bytes.length < 4 || new TextDecoder('ascii').decode(bytes.slice(0, 4)) !== '%PDF') {
      throw new Error('Falabella no devolvió un PDF de etiqueta válido.');
    }
    return bytes;
  });
}

export async function markFalabellaOrderReadyToShip(
  orderItemIds: readonly string[],
  options: {
    packageId: string | null;
    shippingType: string | null;
    shippingProvider: string | null;
    trackingNumber: string | null;
  },
): Promise<void> {
  if (orderItemIds.length === 0) {
    throw new Error('Faltan los datos del paquete Falabella.');
  }

  const orderItemsParam = `[${orderItemIds.join(',')}]`;
  if (options.packageId) {
    try {
      await requestFalabella(
        'SetStatusToReadyToShip',
        { OrderItemIds: orderItemsParam, PackageId: options.packageId },
        'POST',
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!/E001|E024|E025|E091|E121|mandatory|required|delivery type|packing id/i.test(message)) {
        throw error;
      }
    }
  }

  const shippingType = options.shippingType?.toLowerCase() ?? '';
  const deliveryType = shippingType.includes('drop')
    ? 'dropship'
    : shippingType.includes('pickup')
      ? 'pickup'
      : shippingType.includes('cross') || shippingType.includes('warehouse')
        ? 'send_to_warehouse'
        : null;
  if (!deliveryType || !options.shippingProvider) {
    throw new Error('Falabella no entregó el tipo de envío o proveedor necesario para confirmar.');
  }

  await requestFalabella(
    'SetStatusToReadyToShip',
    {
      OrderItemIds: orderItemsParam,
      DeliveryType: deliveryType,
      ShippingProvider: options.shippingProvider,
      ...(options.trackingNumber ? { TrackingNumber: options.trackingNumber } : {}),
    },
    'POST',
  );
}
