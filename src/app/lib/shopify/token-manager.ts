import axios from "axios";

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getShopifyAccessToken() {
  const shop = process.env.SHOPIFY_SHOP!;
  const clientId = process.env.SHOPIFY_CLIENT_ID!;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET!;

  if (!shop || !clientId || !clientSecret) {
    throw new Error("Faltan credenciales de Shopify.");
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const response = await axios.post(
    `https://${shop}.myshopify.com/admin/oauth/access_token`,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }).toString(),
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const accessToken = response.data?.access_token;
  if (!accessToken) {
    throw new Error("No se obtuvo access token válido de Shopify.");
  }


  const expiresIn = Number(response.data?.expires_in ?? 3600);
  cachedToken = {
    value: accessToken,
    expiresAt: Date.now() + Math.max(300, expiresIn) * 1000,
  };

  return accessToken as string;
}

export async function getShopifyGrantedScopes(
  accessToken: string,
): Promise<Set<string>> {
  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) throw new Error('Falta SHOPIFY_SHOP.');
  const response = await axios.get(
    `https://${shop}.myshopify.com/admin/oauth/access_scopes.json`,
    { headers: { 'X-Shopify-Access-Token': accessToken } },
  );
  return new Set<string>(
    (response.data?.access_scopes ?? [])
      .map((scope: { handle?: unknown }) => String(scope.handle ?? '').trim())
      .filter(Boolean),
  );
}
