import type { PoolClient } from 'pg';

interface ProductFingerprint {
  familyTokens: string[];
  kind: string | null;
  packQuantity: number;
  colors: string[];
  distinctiveTokens: string[];
  normalized: string;
}

const STOP_WORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'para', 'por', 'con', 'sin',
  'color', 'diseno', 'modelo', 'marca', 'unidad', 'unidades', 'cm', 'x',
  'decorativo', 'decorativa', 'decorativos', 'decorativas', 'nuevo', 'nueva',
  'incluye', 'tipo', 'estandar', 'standard', 'funda', 'fundas', 'relleno',
  'rellenos', 'medida', 'medidas', 'plaza', 'plazas', 'king', 'super',
]);

const COLORS = new Set([
  'amarillo', 'azul', 'beige', 'blanco', 'burdeo', 'cafe', 'calipso', 'celeste',
  'crema', 'dorado', 'fucsia', 'gris', 'lila', 'marfil', 'morado', 'mostaza',
  'naranjo', 'naranja', 'negro', 'plateado', 'rojo', 'rosa', 'rosado',
  'terracota', 'turquesa', 'verde', 'violeta', 'arena', 'camel', 'chocolate',
  'crudo', 'natural', 'perla', 'petroleo', 'topo',
]);

const GENERIC_PRODUCTS = new Set([
  'alfombra', 'alfombras', 'cama', 'camino', 'cojin', 'cojines', 'colchon',
  'cortina', 'cortinas', 'cubrecama', 'delantal', 'delantales', 'juego',
  'mantel', 'manteles', 'mascota', 'pack', 'piecera', 'plumon', 'puff',
  'sabana', 'sabanas', 'servilleta', 'servilletas', 'taburete', 'toalla',
  'toallas',
]);

function normalizeProductText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bmarron\b/g, 'cafe')
    .replace(/eco\s*cuero/g, 'ecocuero')
    .replace(/poly\s*cott?on/g, 'polycotton')
    .replace(/\bset\b/g, 'pack')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function productKind(normalized: string): string | null {
  if (/\b(cama|colchon)\b.*\bmascota|\bmascota\b.*\b(cama|colchon)\b/.test(normalized)) return 'mascota';
  if (/\bcojin para relleno\b|\brelleno(?:s)? (?:de |para )?cojin|\bpack\b.*\brelleno/.test(normalized)) return 'relleno_cojin';
  if (/\b(cojin|cojines|funda|fundas)\b/.test(normalized)) return 'cojin';
  if (/\b(cortina|cortinas)\b/.test(normalized)) return 'cortina';
  if (/\b(mantel|manteles)\b/.test(normalized)) return 'mantel';
  if (/\bcamino\b.*\bmesa\b/.test(normalized)) return 'camino_mesa';
  if (/\b(servilleta|servilletas)\b/.test(normalized)) return 'servilleta';
  if (/\b(puff|taburete)\b/.test(normalized)) return 'puff';
  if (/\b(sabana|sabanas)\b/.test(normalized)) return 'sabana';
  if (/\b(alfombra|alfombras)\b/.test(normalized)) return 'alfombra';
  if (/\b(piecera|pie de cama)\b/.test(normalized)) return 'piecera';
  if (/\b(plumon|cubrecama|cubre cama)\b/.test(normalized)) return 'cubrecama';
  if (/\b(toalla|toallas)\b/.test(normalized)) return 'toalla';
  if (/\b(delantal|delantales)\b/.test(normalized)) return 'delantal';
  return null;
}

function fingerprintProduct(value: string): ProductFingerprint {
  const normalized = normalizeProductText(value);
  const withoutDimensions = normalized.replace(/\b\d{2,3}\s*x\s*\d{2,3}\b/g, ' ');
  const familyTokens = [...new Set(withoutDimensions.split(' ').filter((token) => (
    token.length >= 3 && !/^\d+$/.test(token) && !STOP_WORDS.has(token)
  )))];
  const packMatch = normalized.match(/\bpack\s*(?:de\s*)?(\d{1,2})\b|\b(\d{1,2})\s*unidades\b/);
  const packValue = Number(packMatch?.[1] ?? packMatch?.[2] ?? 1);
  return {
    normalized,
    familyTokens,
    kind: productKind(normalized),
    packQuantity: Number.isFinite(packValue) && packValue > 1 ? packValue : 1,
    colors: [...new Set(normalized.split(' ').filter((token) => COLORS.has(token)))],
    distinctiveTokens: familyTokens.filter((token) => (
      !GENERIC_PRODUCTS.has(token) && !COLORS.has(token)
    )),
  };
}

function dice(left: readonly string[], right: readonly string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const overlap = left.filter((token) => rightSet.has(token)).length;
  return (2 * overlap) / (left.length + right.length);
}

function scoreProductFamily(source: ProductFingerprint, target: ProductFingerprint): number {
  let score = dice(source.familyTokens, target.familyTokens) * 0.72;
  if (source.kind && target.kind) score += source.kind === target.kind ? 0.2 : -0.45;
  if (source.packQuantity !== target.packQuantity) score -= 0.28;
  else if (source.packQuantity > 1) score += 0.08;
  if (source.colors.length && target.colors.length) {
    const targetColors = new Set(target.colors);
    const overlap = source.colors.filter((color) => targetColors.has(color)).length;
    const union = new Set([...source.colors, ...target.colors]).size;
    score += overlap === union ? 0.05 : -0.45;
  }
  if (source.distinctiveTokens.length && target.distinctiveTokens.length) {
    const similarity = dice(source.distinctiveTokens, target.distinctiveTokens);
    score += similarity === 0 ? -0.38 : similarity * 0.08;
  }
  return Math.max(0, Math.min(1, score));
}

export interface OrderProductImageCandidate {
  marketplace: string;
  externalProductId: string;
  externalVariantIds: string[];
  title: string;
  variantLabels: string[];
  imageUrl: string;
}

interface OrderProductImageInput {
  marketplace: string;
  marketplaceItemId: string | null;
  productTitle: string;
}

interface PreparedCandidate extends OrderProductImageCandidate {
  normalizedTitle: string;
  fingerprint: ReturnType<typeof fingerprintProduct>;
}

function normalizedMarketplace(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function normalizedIdentifier(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export function createOrderProductImageResolver(
  candidates: readonly OrderProductImageCandidate[],
): (input: OrderProductImageInput) => string | null {
  const candidatesByMarketplace = new Map<string, PreparedCandidate[]>();
  const candidatesByIdentifier = new Map<string, PreparedCandidate>();
  const candidatesByTitle = new Map<string, PreparedCandidate>();
  const candidatesByGlobalTitle = new Map<string, PreparedCandidate>();
  const allCandidates: PreparedCandidate[] = [];
  const resultCache = new Map<string, string | null>();

  for (const candidate of candidates) {
    if (!candidate.imageUrl?.trim()) continue;
    const marketplace = normalizedMarketplace(candidate.marketplace);
    const fingerprint = fingerprintProduct(candidate.title);
    const prepared: PreparedCandidate = {
      ...candidate,
      imageUrl: candidate.imageUrl.trim(),
      normalizedTitle: fingerprint.normalized,
      fingerprint,
    };
    const marketplaceCandidates = candidatesByMarketplace.get(marketplace) ?? [];
    marketplaceCandidates.push(prepared);
    candidatesByMarketplace.set(marketplace, marketplaceCandidates);
    allCandidates.push(prepared);

    for (const identifier of [candidate.externalProductId, ...candidate.externalVariantIds]) {
      const normalized = normalizedIdentifier(identifier);
      if (normalized) candidatesByIdentifier.set(`${marketplace}:${normalized}`, prepared);
    }
    if (prepared.normalizedTitle) {
      candidatesByTitle.set(`${marketplace}:${prepared.normalizedTitle}`, prepared);
      candidatesByGlobalTitle.set(prepared.normalizedTitle, prepared);
    }
    for (const label of candidate.variantLabels) {
      const normalized = fingerprintProduct(label).normalized;
      if (normalized) candidatesByTitle.set(`${marketplace}:${normalized}`, prepared);
    }
  }

  return ({ marketplace, marketplaceItemId, productTitle }) => {
    const normalizedMarket = normalizedMarketplace(marketplace);
    const itemId = normalizedIdentifier(marketplaceItemId);
    const titleFingerprint = fingerprintProduct(productTitle);
    const cacheKey = `${normalizedMarket}:${itemId}:${titleFingerprint.normalized}`;
    if (resultCache.has(cacheKey)) return resultCache.get(cacheKey) ?? null;

    const identifierMatch = itemId
      ? candidatesByIdentifier.get(`${normalizedMarket}:${itemId}`)
      : undefined;
    if (identifierMatch) {
      resultCache.set(cacheKey, identifierMatch.imageUrl);
      return identifierMatch.imageUrl;
    }

    const titleMatch = candidatesByTitle.get(
      `${normalizedMarket}:${titleFingerprint.normalized}`,
    );
    if (titleMatch) {
      resultCache.set(cacheKey, titleMatch.imageUrl);
      return titleMatch.imageUrl;
    }

    const globalTitleMatch = candidatesByGlobalTitle.get(titleFingerprint.normalized);
    if (globalTitleMatch) {
      resultCache.set(cacheKey, globalTitleMatch.imageUrl);
      return globalTitleMatch.imageUrl;
    }

    let bestMatch: PreparedCandidate | null = null;
    let bestScore = 0;
    for (const candidate of candidatesByMarketplace.get(normalizedMarket) ?? []) {
      const score = scoreProductFamily(titleFingerprint, candidate.fingerprint);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }

    // A conservative threshold avoids showing a visually convincing but incorrect
    // fabric when an order title cannot be tied safely to the synchronized catalog.
    let imageUrl = bestMatch && bestScore >= 0.82 ? bestMatch.imageUrl : null;
    if (!imageUrl) {
      for (const candidate of allCandidates) {
        const score = scoreProductFamily(titleFingerprint, candidate.fingerprint);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }
      // Cross-marketplace matching is intentionally stricter. It is useful for
      // channels that do not publish images, but must not confuse similar fabrics.
      imageUrl = bestMatch && bestScore >= 0.92 ? bestMatch.imageUrl : null;
    }
    resultCache.set(cacheKey, imageUrl);
    return imageUrl;
  };
}

export async function loadOrderProductImageCandidates(
  client: PoolClient,
  marketplaces: readonly string[],
): Promise<OrderProductImageCandidate[]> {
  const uniqueMarketplaces = [...new Set([
    ...marketplaces.map(normalizedMarketplace).filter(Boolean),
    'shopify',
  ])];
  if (uniqueMarketplaces.length === 0) return [];

  try {
    const result = await client.query<{
      marketplace: string;
      external_product_id: string;
      external_variant_ids: string[] | null;
      title: string;
      variant_labels: string[] | null;
      image_url: string;
    }>(
      `SELECT
         source_product.marketplace,
         source_product.external_product_id,
         source_product.title,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT source_variant.external_variant_id), NULL)
           AS external_variant_ids,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT source_variant.label), NULL)
           AS variant_labels,
         COALESCE(
           NULLIF(source_product.image_urls->>0, ''),
           MIN(NULLIF(source_variant.image_url, '')),
           linked_shopify.image_url
         ) AS image_url
       FROM marketplace_catalog_product source_product
       LEFT JOIN marketplace_catalog_variant source_variant
         ON source_variant.marketplace_catalog_product_id = source_product.id
       LEFT JOIN LATERAL (
         SELECT COALESCE(
                  NULLIF(shopify_product.image_urls->>0, ''),
                  MIN(NULLIF(shopify_variant.image_url, ''))
                ) AS image_url
         FROM marketplace_catalog_product shopify_product
         LEFT JOIN marketplace_catalog_variant shopify_variant
           ON shopify_variant.marketplace_catalog_product_id = shopify_product.id
         WHERE shopify_product.marketplace = 'shopify'
           AND shopify_product.catalog_product_id = source_product.catalog_product_id
         GROUP BY shopify_product.id
         ORDER BY shopify_product.id
         LIMIT 1
       ) linked_shopify ON TRUE
       WHERE source_product.marketplace = ANY($1::text[])
       GROUP BY source_product.id, linked_shopify.image_url
       HAVING COALESCE(
         NULLIF(source_product.image_urls->>0, ''),
         MIN(NULLIF(source_variant.image_url, '')),
         linked_shopify.image_url
       ) IS NOT NULL`,
      [uniqueMarketplaces],
    );

    return result.rows.map((row) => ({
      marketplace: row.marketplace,
      externalProductId: row.external_product_id,
      externalVariantIds: row.external_variant_ids ?? [],
      title: row.title,
      variantLabels: row.variant_labels ?? [],
      imageUrl: row.image_url,
    }));
  } catch (error) {
    // Product images are an enhancement; an unavailable or not-yet-migrated
    // catalog must never prevent the order list itself from loading.
    console.warn('No fue posible asociar imágenes del catálogo a las órdenes:', error);
    return [];
  }
}
