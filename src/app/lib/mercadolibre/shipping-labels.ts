import { getValidAccessToken } from './token-manager';
import {
  getMercadoLibreSlaDeadline,
  type MercadoLibreLabelSnapshot,
} from './shipping-label-utils';

export {
  canMarkMercadoLibreShipmentReady,
  composeLetterLabelPdf,
  getMercadoLibreLabelEligibility,
  isMercadoLibreShipmentWaitingForLabel,
  PRINTABLE_LOGISTIC_TYPES,
  type LetterLabelSource,
} from './shipping-label-utils';

const MERCADO_LIBRE_API = 'https://api.mercadolibre.com';
export interface MercadoLibreShipmentSnapshot extends MercadoLibreLabelSnapshot {
  id: string;
  trackingNumber: string | null;
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

async function mercadoLibreRequest(
  path: string,
  options: { method?: 'GET' | 'POST' } = {},
): Promise<Response> {
  const token = await getValidAccessToken();
  const response = await fetch(`${MERCADO_LIBRE_API}${path}`, {
    method: options.method ?? 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-format-new': 'true',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Mercado Libre respondió ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`,
    );
  }
  return response;
}

export async function markMercadoLibreShipmentReadyToShip(
  shipmentId: string,
): Promise<void> {
  await mercadoLibreRequest(
    `/shipments/${encodeURIComponent(shipmentId)}/process/ready_to_ship`,
    { method: 'POST' },
  );
}

export async function fetchMercadoLibreShipmentSnapshot(
  shipmentId: string,
): Promise<MercadoLibreShipmentSnapshot> {
  const response = await mercadoLibreRequest(
    `/shipments/${encodeURIComponent(shipmentId)}`,
  );
  const payload = await response.json() as Record<string, unknown>;
  const logistic = payload.logistic && typeof payload.logistic === 'object'
    ? payload.logistic as Record<string, unknown>
    : null;

  return {
    id: cleanString(payload.id) ?? shipmentId,
    status: cleanString(payload.status),
    substatus: cleanString(payload.substatus),
    mode: cleanString(payload.mode) ?? cleanString(logistic?.mode),
    logisticType: cleanString(payload.logistic_type) ?? cleanString(logistic?.type),
    trackingNumber: cleanString(payload.tracking_number),
  };
}

export async function fetchMercadoLibreShipmentSlaDeadline(
  shipmentId: string,
  accessToken?: string,
): Promise<string | null> {
  const token = accessToken ?? await getValidAccessToken();
  const response = await fetch(
    `${MERCADO_LIBRE_API}/shipments/${encodeURIComponent(shipmentId)}/sla`,
    {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  // Mientras el envío está en manufacturing, Mercado Libre aún no publica SLA.
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Mercado Libre respondió ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`,
    );
  }
  return getMercadoLibreSlaDeadline(await response.json());
}

export async function downloadMercadoLibreLabelPdf(
  shipmentIds: readonly string[],
): Promise<Uint8Array> {
  if (shipmentIds.length === 0 || shipmentIds.length > 50) {
    throw new Error('Mercado Libre permite entre 1 y 50 etiquetas por descarga.');
  }

  const params = new URLSearchParams({
    shipment_ids: shipmentIds.join(','),
    response_type: 'pdf',
  });
  const response = await mercadoLibreRequest(`/shipment_labels?${params.toString()}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 4 || new TextDecoder('ascii').decode(bytes.slice(0, 4)) !== '%PDF') {
    throw new Error('Mercado Libre no devolvió un PDF de etiquetas válido.');
  }
  return bytes;
}
