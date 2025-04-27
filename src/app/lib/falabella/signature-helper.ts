import crypto from 'crypto';

export function getFalabellaSignature(params: Record<string, string>, apiKey: string) {
  const sortedKeys = Object.keys(params).sort();
  const baseString = sortedKeys.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join("&");

  const signature = crypto.createHmac('sha256', apiKey).update(baseString).digest('hex');

  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...params,
    Signature: encodeURIComponent(signature),
  };
}
