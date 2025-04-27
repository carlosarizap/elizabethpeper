import { getFalabellaSignature } from './signature-helper';
import axios from 'axios';

export async function fetchOrderItems(orderId: string, timestamp: string, userId: string, apiKey: string) {
  const params = {
    Action: 'GetOrderItems',
    Format: 'JSON',
    Timestamp: timestamp,
    UserID: userId,
    Version: '1.0',
    OrderId: orderId,
  };

  const headers = getFalabellaSignature(params, apiKey);

  const url = `https://sellercenter-api.falabella.com/?${new URLSearchParams({
    ...params,
    Signature: headers.Signature,
  }).toString()}`;

  const res = await axios.get(url, { headers });

  const data = res.data;

  const items = data?.SuccessResponse?.Body?.OrderItems?.OrderItem;
  if (!items) return [];

  return Array.isArray(items) ? items : [items];
}
