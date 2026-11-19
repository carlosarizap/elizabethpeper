import pool from '../db';
import { getValidAccessToken } from '../mercadolibre/token-manager';
import { getShopifyAccessToken } from '../shopify/token-manager';
import { readMercadoLibrePackaging, suggestProductPackaging, type ProductPackaging } from './packaging.ts';

export async function fetchWalmartProductPackaging(sku: string, title: string): Promise<ProductPackaging> {
  const aliases = await pool.query<{ marketplace: string; external_product_id: string; external_variant_id: string; seller_sku: string }>(
    `SELECT DISTINCT source_product.marketplace, source_product.external_product_id, source.external_variant_id, source.seller_sku
     FROM marketplace_catalog_variant target
     JOIN marketplace_catalog_product target_product ON target_product.id = target.marketplace_catalog_product_id
     JOIN marketplace_catalog_variant source ON source.catalog_variant_id = target.catalog_variant_id
     JOIN marketplace_catalog_product source_product ON source_product.id = source.marketplace_catalog_product_id
     WHERE target_product.marketplace = 'walmart' AND UPPER(target.seller_sku) = UPPER($1)
       AND source_product.marketplace IN ('mercado_libre', 'shopify') AND source.seller_sku IS NOT NULL`, [sku],
  );
  // A reviewed variant mapping preserves the exact size and filling option.
  for (const alias of aliases.rows.filter((r) => r.marketplace === 'mercado_libre')) {
    try {
      const token = await getValidAccessToken();
      const response = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(alias.external_product_id)}?include_attributes=all`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) continue;
      const raw = await response.json();
      const variant = raw.variations?.find((v: { id: number }) => String(v.id) === alias.external_variant_id);
      const packaging = readMercadoLibrePackaging({ attributes: [...(variant?.attributes ?? []), ...(raw.attributes ?? [])] });
      if (packaging) return packaging;
    } catch { /* Continue to Shopify weight and reviewed product profiles. */ }
  }
  let weightKg: number | undefined;
  const shopify = aliases.rows.filter((r) => r.marketplace === 'shopify');
  if (shopify.length === 1) {
    try {
      const token = await getShopifyAccessToken();
      const id = shopify[0].external_variant_id.startsWith('gid:') ? shopify[0].external_variant_id : `gid://shopify/ProductVariant/${shopify[0].external_variant_id}`;
      const response = await fetch(`https://${process.env.SHOPIFY_SHOP}.myshopify.com/admin/api/2026-01/graphql.json`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query: `query PackagingWeight($id: ID!) { productVariant(id: $id) { inventoryItem { measurement { weight { value unit } } } } }`, variables: { id } }),
        cache: 'no-store', signal: AbortSignal.timeout(20_000),
      });
      const raw = await response.json();
      const weight = raw.data?.productVariant?.inventoryItem?.measurement?.weight;
      const factors: Record<string, number> = { KILOGRAMS: 1, GRAMS: 0.001, POUNDS: 0.45359237, OUNCES: 0.028349523125 };
      const kg = Number(weight?.value) * (factors[weight?.unit] ?? NaN);
      if (response.ok && Number.isFinite(kg) && kg > 0) weightKg = kg;
    } catch { /* Estimates are identified in the screen and remain editable. */ }
  }
  const suggestion = suggestProductPackaging(title, weightKg);
  if (!suggestion) throw new Error(`El SKU ${sku} necesita medidas de embalaje. Puedes ingresarlas al preparar sus bultos.`);
  return suggestion;
}
