import axios from 'axios';

export async function getParisUploadAccessToken() {
  const apiKey = process.env.PARIS_ACCESS_TOKEN!; // Tu API Key real
  if (!apiKey) throw new Error('API Key no configurada.');

  const response = await axios.post(
    'https://api-developers.ecomm.cencosud.com/v1/auth/apiKey',
    {},
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const accessToken = response.data?.accessToken;
  if (!accessToken) throw new Error('No se obtuvo Access Token válido.');

  return accessToken;
}
