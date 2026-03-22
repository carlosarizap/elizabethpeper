import axios from "axios";

export async function getShopifyAccessToken() {
  const shop = process.env.SHOPIFY_SHOP!;
  const clientId = process.env.SHOPIFY_CLIENT_ID!;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET!;

  if (!shop || !clientId || !clientSecret) {
    throw new Error("Faltan credenciales de Shopify.");
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

  return accessToken as string;
}