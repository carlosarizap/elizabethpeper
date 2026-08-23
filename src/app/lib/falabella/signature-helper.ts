import crypto from 'crypto';

export function calculateFalabellaSignature(
  params: Record<string, string>,
  apiKey: string,
) {
  const sortedKeys = Object.keys(params).sort();
  const baseString = sortedKeys
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  return crypto.createHmac('sha256', apiKey).update(baseString).digest('hex');
}

export function getFalabellaSignature(params: Record<string, string>, apiKey: string) {
  const signature = calculateFalabellaSignature(params, apiKey);

  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...params,
    Signature: encodeURIComponent(signature),
  };
}
