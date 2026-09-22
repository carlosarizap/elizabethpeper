const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const DISCOUNT = 20;
const SLUG = 'cyber-2026';
const NAME = 'Cyber 2026';
const START_AT = '2026-10-05T03:00:00.000Z';
const END_AT = '2026-10-08T02:59:59.000Z';
const ML_CAMPAIGN_ID = 'P-MLC17951022';
const ML_CAMPAIGN_START = '2026-10-05T02:00:00.000Z';
const ML_CAMPAIGN_END = '2026-10-12T03:00:00.000Z';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const limited = (items) => {
  const limit = Number(process.env.PROMOTION_LIMIT ?? 0);
  return Number.isFinite(limit) && limit > 0 ? items.slice(0, limit) : items;
};
const chunks = (items, size) => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, index) => items.slice(index * size, (index + 1) * size),
);

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isDecorativeCushion(title) {
  const value = normalize(title);
  if (!value.includes('cojin')) return false;
  if (/^(pack\s+)?\d*\s*rellenos?\b/.test(value)) return false;
  if (value.startsWith('relleno ') || value.includes(' para relleno')) return false;
  return value.includes('decorativ') || (value.includes('funda') && value.includes('diseno'));
}

function isActive(value) {
  const status = normalize(value);
  return ['active', 'activo', 'published', 'online'].includes(status);
}

function roundClp(value) {
  return Math.round(Number(value));
}

function promotionPrice(regular) {
  return roundClp(Number(regular) * (1 - DISCOUNT / 100));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function requestJson(url, options = {}, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      if (response.ok) return { response, body };
      const error = new Error(`${response.status} ${response.statusText}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
      error.status = response.status;
      error.body = body;
      if (![408, 409, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) throw error;
      lastError = error;
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 600 * (2 ** (attempt - 1)));
    } catch (error) {
      lastError = error;
      if (attempt === attempts || (error.status && ![408, 409, 429, 500, 502, 503, 504].includes(error.status))) throw error;
      await sleep(600 * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function getCampaign() {
  const result = await pool.query(
    `INSERT INTO product_promotion_campaign
       (slug, name, discount_percent, starts_at, ends_at, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'planned', $6::jsonb)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       discount_percent = EXCLUDED.discount_percent,
       starts_at = EXCLUDED.starts_at,
       ends_at = EXCLUDED.ends_at,
       metadata = product_promotion_campaign.metadata || EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING *`,
    [SLUG, NAME, DISCOUNT, START_AT, END_AT, JSON.stringify({
      scope: 'Fundas y cojines decorativos activos; excluye rellenos individuales',
      mercadoLibreCampaignId: ML_CAMPAIGN_ID,
      mercadoLibreStartsAt: ML_CAMPAIGN_START,
      mercadoLibreEndsAt: ML_CAMPAIGN_END,
    })],
  );
  return result.rows[0];
}

async function getTargets(marketplace) {
  const result = await pool.query(
    `SELECT
       p.marketplace,
       p.external_product_id,
       p.title,
       p.status AS product_status,
       p.catalog_product_id,
       cp.name AS master_name,
       v.external_variant_id,
       v.seller_sku,
       v.marketplace_sku,
       v.label,
       v.price,
       v.sale_price,
       v.status AS variant_status,
       v.raw_payload
     FROM marketplace_catalog_product p
     JOIN marketplace_catalog_variant v ON v.marketplace_catalog_product_id = p.id
     LEFT JOIN catalog_product cp ON cp.id = p.catalog_product_id
     WHERE p.marketplace = $1
     ORDER BY p.external_product_id, v.external_variant_id`,
    [marketplace],
  );
  return result.rows.filter((row) => {
    if (!isActive(row.product_status) || !isActive(row.variant_status)) return false;
    return isDecorativeCushion(row.title) || isDecorativeCushion(row.master_name);
  });
}

function choosePrices(row) {
  const raw = row.raw_payload || {};
  const price = toNumber(row.price);
  const salePrice = toNumber(row.sale_price);
  const compareAt = toNumber(raw.compareAtPrice ?? raw.compare_at_price);
  const regular = compareAt && price && compareAt > price ? compareAt : price;
  const target = regular ? promotionPrice(regular) : null;
  const current = salePrice ?? price;
  return {
    regular,
    current,
    compareAt,
    target,
    keepBetter: Boolean(target && current && current < target),
  };
}

async function stageTargets(campaign, marketplace, rows) {
  for (const batch of chunks(rows, 250)) {
    const input = batch.map((row) => {
      const prices = choosePrices(row);
      return {
        marketplace,
        external_product_id: row.external_product_id,
        external_variant_id: row.external_variant_id,
        seller_sku: row.seller_sku,
        title: row.title,
        regular_price: prices.regular,
        previous_price: toNumber(row.price),
        previous_compare_at_price: prices.compareAt,
        promotion_price: prices.target,
        status: prices.keepBetter ? 'skipped_better_offer' : 'planned',
        metadata: {
          marketplaceSku: row.marketplace_sku,
          sourceSalePrice: toNumber(row.sale_price),
          masterName: row.master_name,
        },
      };
    });
    await pool.query(
      `WITH input AS (
         SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
           marketplace TEXT,
           external_product_id TEXT,
           external_variant_id TEXT,
           seller_sku TEXT,
           title TEXT,
           regular_price NUMERIC,
           previous_price NUMERIC,
           previous_compare_at_price NUMERIC,
           promotion_price NUMERIC,
           status TEXT,
           metadata JSONB
         )
       )
       INSERT INTO product_promotion_item (
         campaign_id, marketplace, external_product_id, external_variant_id,
         seller_sku, title, regular_price, previous_price,
         previous_compare_at_price, promotion_price, status, metadata
       )
       SELECT $1, marketplace, external_product_id, external_variant_id,
              seller_sku, title, regular_price, previous_price,
              previous_compare_at_price, promotion_price, status, metadata
       FROM input
       ON CONFLICT (campaign_id, marketplace, external_variant_id)
       DO UPDATE SET
         external_product_id = EXCLUDED.external_product_id,
         seller_sku = EXCLUDED.seller_sku,
         title = EXCLUDED.title,
         regular_price = EXCLUDED.regular_price,
         previous_price = EXCLUDED.previous_price,
         previous_compare_at_price = EXCLUDED.previous_compare_at_price,
         promotion_price = EXCLUDED.promotion_price,
         metadata = product_promotion_item.metadata || EXCLUDED.metadata,
         status = CASE
           WHEN product_promotion_item.status IN ('applied', 'scheduled', 'restored')
             THEN product_promotion_item.status
           ELSE EXCLUDED.status
         END,
         updated_at = NOW()`,
      [campaign.id, JSON.stringify(input)],
    );
  }
}

async function getPlanned(campaignId, marketplace) {
  const result = await pool.query(
    `SELECT * FROM product_promotion_item
     WHERE campaign_id = $1 AND marketplace = $2 AND status IN ('planned', 'failed')
     ORDER BY external_product_id, external_variant_id`,
    [campaignId, marketplace],
  );
  return result.rows;
}

async function mark(item, status, details = {}) {
  await pool.query(
    `UPDATE product_promotion_item SET
       status = $2::text,
       external_promotion_id = COALESCE($3, external_promotion_id),
       last_error = $4,
       metadata = metadata || $5::jsonb,
       applied_at = CASE WHEN $2::text = 'applied' THEN NOW() ELSE applied_at END,
       restored_at = CASE WHEN $2::text = 'restored' THEN NOW() ELSE restored_at END,
       updated_at = NOW()
     WHERE id = $1`,
    [item.id, status, details.externalPromotionId ?? null, details.error ?? null, JSON.stringify(details.metadata ?? {})],
  );
}

async function getMercadoLibreToken() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM mercadolibre_tokens ORDER BY updated_at DESC LIMIT 1');
    if (!result.rows.length) throw new Error('No hay token de Mercado Libre en la base de datos.');
    const token = result.rows[0];
    const expired = Date.now() - new Date(token.updated_at).getTime() > 5.9 * 60 * 60 * 1000;
    if (!expired) return token.access_token;
    const response = await requestJson('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.MERCADO_LIBRE_CLIENT_ID,
        client_secret: process.env.MERCADO_LIBRE_CLIENT_SECRET,
        refresh_token: token.refresh_token,
      }),
    });
    await client.query(
      'UPDATE mercadolibre_tokens SET access_token=$1, refresh_token=$2, updated_at=NOW() WHERE id=$3',
      [response.body.access_token, response.body.refresh_token, token.id],
    );
    return response.body.access_token;
  } finally {
    client.release();
  }
}

async function getMlCandidates(token) {
  const result = new Map();
  let searchAfter = null;
  do {
    const url = new URL(`https://api.mercadolibre.com/seller-promotions/promotions/${ML_CAMPAIGN_ID}/items`);
    url.searchParams.set('promotion_type', 'DEAL');
    url.searchParams.set('app_version', 'v2');
    url.searchParams.set('limit', '50');
    if (searchAfter) url.searchParams.set('search_after', searchAfter);
    const { body } = await requestJson(url, { headers: { Authorization: `Bearer ${token}` } });
    for (const item of body.results ?? []) result.set(String(item.id), item);
    searchAfter = body.paging?.searchAfter ?? body.paging?.search_after ?? null;
  } while (searchAfter);
  return result;
}

async function applyMercadoLibre(campaign) {
  const token = await getMercadoLibreToken();
  const candidates = await getMlCandidates(token);
  const items = limited(await getPlanned(campaign.id, 'mercado_libre'));
  const unique = new Map();
  for (const item of items) if (!unique.has(item.external_product_id)) unique.set(item.external_product_id, item);
  let applied = 0; let failed = 0;
  for (const item of unique.values()) {
    try {
      const candidate = candidates.get(item.external_product_id);
      const target = Number(item.promotion_price);
      let body;
      let externalPromotionId;
      if (candidate) {
        const min = toNumber(candidate.min_discounted_price);
        const max = toNumber(candidate.max_discounted_price);
        if ((min && target < min) || (max && target > max)) {
          throw new Error(`El 20% ($${target}) queda fuera del rango Cyber permitido ($${min}–$${max}).`);
        }
        body = { deal_price: target, promotion_id: ML_CAMPAIGN_ID, promotion_type: 'DEAL' };
        externalPromotionId = ML_CAMPAIGN_ID;
      } else {
        body = {
          deal_price: target,
          start_date: START_AT,
          finish_date: END_AT,
          promotion_type: 'PRICE_DISCOUNT',
        };
        externalPromotionId = 'PRICE_DISCOUNT';
      }
      await requestJson(
        `https://api.mercadolibre.com/seller-promotions/items/${encodeURIComponent(item.external_product_id)}?app_version=v2`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      const related = items.filter((entry) => entry.external_product_id === item.external_product_id);
      for (const entry of related) await mark(entry, 'applied', { externalPromotionId, metadata: { apiBody: body } });
      applied += 1;
    } catch (error) {
      const related = items.filter((entry) => entry.external_product_id === item.external_product_id);
      for (const entry of related) await mark(entry, 'failed', { error: error.message });
      failed += 1;
    }
    await sleep(120);
  }
  console.log(JSON.stringify({ marketplace: 'mercado_libre', applied, failed, candidates: candidates.size }));
}

function falabellaSignature(params, apiKey) {
  const base = Object.keys(params).sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  return crypto.createHmac('sha256', apiKey).update(base).digest('hex');
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '\"': '&quot;' })[character]);
}

async function falabellaCall(action, extraParams, options = {}) {
  const params = {
    Action: action,
    Format: 'JSON',
    Timestamp: new Date().toISOString(),
    UserID: process.env.FALABELLA_USER_ID,
    Version: '1.0',
    ...extraParams,
  };
  params.Signature = falabellaSignature(params, process.env.FALABELLA_API_KEY);
  const url = new URL('https://sellercenter-api.falabella.com/');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return requestJson(url, options);
}

async function waitFalabellaFeed(feedId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { body } = await falabellaCall('FeedStatus', { FeedID: String(feedId) });
    const feed = body?.SuccessResponse?.Body?.FeedDetail ?? body?.SuccessResponse?.Body ?? body;
    const status = String(feed?.Status ?? feed?.status ?? '').toLowerCase();
    if (status === 'finished') return feed;
    if (status === 'error' || status === 'failed') throw new Error(`Feed Falabella ${feedId} terminó en ${status}: ${JSON.stringify(feed)}`);
    await sleep(4000);
  }
  throw new Error(`Falabella no terminó el feed ${feedId} dentro del tiempo esperado.`);
}

async function applyFalabella(campaign) {
  const items = limited(await getPlanned(campaign.id, 'falabella'));
  let applied = 0; let failed = 0;
  for (const batch of chunks(items, 400)) {
    const xml = `<Request>${batch.map((item) => `<Product><SellerSku>${xmlEscape(item.seller_sku)}</SellerSku><BusinessUnits><BusinessUnit><OperatorCode>facl</OperatorCode><Price>${roundClp(item.regular_price)}</Price><SpecialPrice>${roundClp(item.promotion_price)}</SpecialPrice><SpecialFromDate>2026-10-05 00:00:00</SpecialFromDate><SpecialToDate>2026-10-07 23:59:59</SpecialToDate></BusinessUnit></BusinessUnits></Product>`).join('')}</Request>`;
    try {
      const { body } = await falabellaCall('ProductUpdate', {}, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: xml });
      const feedId = body?.SuccessResponse?.Head?.RequestId
        ?? body?.SuccessResponse?.Body?.RequestId
        ?? body?.SuccessResponse?.Body?.FeedID
        ?? body?.RequestId;
      if (!feedId) throw new Error(`Falabella no devolvió RequestId: ${JSON.stringify(body)}`);
      const feed = await waitFalabellaFeed(feedId);
      const failedRecords = Number(feed?.FailedRecords ?? feed?.failedRecords ?? 0);
      if (failedRecords > 0) throw new Error(`Feed ${feedId}: ${failedRecords} registro(s) fallaron: ${JSON.stringify(feed)}`);
      for (const item of batch) await mark(item, 'applied', { externalPromotionId: String(feedId), metadata: { feed } });
      applied += batch.length;
    } catch (error) {
      for (const item of batch) await mark(item, 'failed', { error: error.message });
      failed += batch.length;
    }
  }
  console.log(JSON.stringify({ marketplace: 'falabella', applied, failed }));
}

async function getParisToken() {
  const { body } = await requestJson('https://api-developers.ecomm.cencosud.com/v1/auth/apiKey', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PARIS_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  });
  const token = body?.accessToken ?? body?.access_token ?? body?.token;
  if (!token) throw new Error(`París no devolvió access token: ${JSON.stringify(body)}`);
  return token;
}

async function applyParis(campaign) {
  const token = await getParisToken();
  const items = limited(await getPlanned(campaign.id, 'paris'));
  let applied = 0; let failed = 0;
  for (const item of items) {
    try {
      const sku = item.external_product_id;
      if (!sku) throw new Error('La publicación de París no tiene identificador de producto.');
      const apiBody = { prices: [
        {
          value: roundClp(item.regular_price),
          storePrice: '8678fdf5-86f9-4530-aaee-dd67b9843976',
          type: '6503baaf-16d0-4590-a4d6-494719593a12',
        },
        {
          value: roundClp(item.promotion_price),
          storePrice: '8678fdf5-86f9-4530-aaee-dd67b9843976',
          type: 'c25aaf10-fd85-416d-b2bd-d64ffa174ba7',
          showFrom: START_AT,
          showTo: END_AT,
        },
      ] };
      await requestJson(`https://api-developers.ecomm.cencosud.com/v2/prices/product/${encodeURIComponent(sku)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(apiBody),
      });
      await mark(item, 'applied', { externalPromotionId: 'paris-precio-oferta', metadata: { apiBody } });
      applied += 1;
    } catch (error) {
      await mark(item, 'failed', { error: error.message });
      failed += 1;
    }
    await sleep(120);
  }
  console.log(JSON.stringify({ marketplace: 'paris', applied, failed }));
}

async function fetchAllRipleyOffers() {
  const headers = { Authorization: process.env.RIPLEY_API_KEY, Accept: 'application/json' };
  const offers = new Map();
  let offset = 0;
  do {
    const url = new URL('https://ripley-prod.mirakl.net/api/offers');
    url.searchParams.set('max', '100');
    url.searchParams.set('offset', String(offset));
    const { body } = await requestJson(url, { headers });
    for (const offer of body.offers ?? []) offers.set(String(offer.offer_id), offer);
    const total = Number(body.total_count ?? offers.size);
    offset += (body.offers ?? []).length;
    if (!(body.offers ?? []).length || offset >= total) break;
  } while (true);
  return offers;
}

async function applyRipley(campaign) {
  const items = limited(await getPlanned(campaign.id, 'ripley'));
  const offers = await fetchAllRipleyOffers();
  let applied = 0; let failed = 0;
  for (const batch of chunks(items, 100)) {
    const valid = [];
    for (const item of batch) {
      const offer = offers.get(String(item.external_variant_id));
      if (!offer) {
        await mark(item, 'failed', { error: 'No se encontró la oferta activa en OF24.' });
        failed += 1;
        continue;
      }
      valid.push({ item, offer });
    }
    if (!valid.length) continue;
    const apiBody = { offers: valid.map(({ item, offer }) => ({
      product_id: offer.product_sku,
      product_id_type: 'SKU',
      shop_sku: offer.shop_sku,
      price: roundClp(item.regular_price),
      quantity: Number(offer.quantity ?? 0),
      state_code: String(offer.state_code ?? '11'),
      logistic_class: typeof offer.logistic_class === 'object' ? offer.logistic_class.code : offer.logistic_class,
      leadtime_to_ship: Number(offer.leadtime_to_ship ?? 1),
      update_delete: 'update',
      discount: { price: roundClp(item.promotion_price), start_date: START_AT, end_date: END_AT },
    })) };
    try {
      const { body } = await requestJson('https://ripley-prod.mirakl.net/api/offers', {
        method: 'POST',
        headers: { Authorization: process.env.RIPLEY_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(apiBody),
      });
      const importId = body?.import_id ?? body?.importId ?? body?.id;
      for (const { item } of valid) await mark(item, 'applied', { externalPromotionId: importId ? String(importId) : 'OF24', metadata: { importResponse: body } });
      applied += valid.length;
    } catch (error) {
      for (const { item } of valid) await mark(item, 'failed', { error: error.message });
      failed += valid.length;
    }
  }
  console.log(JSON.stringify({ marketplace: 'ripley', applied, failed }));
}

async function scheduleShopify(campaign) {
  const items = limited(await getPlanned(campaign.id, 'shopify'));
  for (const item of items) await mark(item, 'scheduled', { externalPromotionId: SLUG });
  console.log(JSON.stringify({ marketplace: 'shopify', scheduled: items.length }));
}

function walmartCredentials() {
  const clientId = process.env.WALMART_CLIENT_ID?.trim();
  const clientSecret = process.env.WALMART_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Faltan WALMART_CLIENT_ID o WALMART_CLIENT_SECRET.');
  return { clientId, clientSecret };
}

function walmartHeaders(credentials, accessToken, contentType) {
  return {
    Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
    ...(accessToken ? { 'WM_SEC.ACCESS_TOKEN': accessToken } : {}),
    WM_MARKET: 'cl',
    WM_GLOBAL_VERSION: '3.1',
    'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
    'WM_SVC.NAME': 'Walmart Marketplace',
    Accept: 'application/json',
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}

async function getWalmartToken() {
  const credentials = walmartCredentials();
  const { body } = await requestJson('https://marketplace.walmartapis.com/v3/token', {
    method: 'POST',
    headers: walmartHeaders(credentials, null, 'application/x-www-form-urlencoded'),
    body: 'grant_type=client_credentials',
  });
  if (!body?.access_token) throw new Error(`Walmart no devolvió access token: ${JSON.stringify(body)}`);
  return { credentials, accessToken: body.access_token };
}

async function fetchWalmartTargets() {
  const session = await getWalmartToken();
  const rows = [];
  for (let offset = 0; offset < 20_000; offset += 200) {
    const url = new URL('https://marketplace.walmartapis.com/v3/items');
    url.searchParams.set('limit', '200');
    url.searchParams.set('offset', String(offset));
    const { body } = await requestJson(url, { headers: walmartHeaders(session.credentials, session.accessToken) });
    const items = Array.isArray(body?.ItemResponse) ? body.ItemResponse : [];
    for (const item of items) {
      const sellerSku = String(item.sku ?? '').trim();
      const title = String(item.productName ?? '').trim();
      const price = toNumber(typeof item.price === 'object' ? item.price?.amount : item.price);
      const active = String(item.publishedStatus ?? '').toUpperCase() === 'PUBLISHED';
      if (!sellerSku || !title || !price || !active || !isDecorativeCushion(title)) continue;
      rows.push({
        marketplace: 'walmart',
        external_product_id: String(item.wpid ?? sellerSku),
        title,
        product_status: 'active',
        master_name: null,
        external_variant_id: sellerSku,
        seller_sku: sellerSku,
        marketplace_sku: item.wpid ? String(item.wpid) : null,
        label: title,
        price,
        sale_price: null,
        variant_status: 'active',
        raw_payload: item,
      });
    }
    const total = Number(body?.totalItems ?? rows.length);
    if (items.length < 200 || offset + items.length >= total) break;
  }
  return rows;
}

async function applyWalmart(campaign) {
  const session = await getWalmartToken();
  const items = limited(await getPlanned(campaign.id, 'walmart'));
  let applied = 0; let failed = 0;

  async function walmartRequest(path, options = {}) {
    try {
      return await requestJson(`https://marketplace.walmartapis.com${path}`, {
        ...options,
        headers: {
          ...walmartHeaders(
            session.credentials,
            session.accessToken,
            options.body ? 'application/json' : undefined,
          ),
          ...(options.headers ?? {}),
        },
      });
    } catch (error) {
      if (error?.status !== 401) throw error;
      session.accessToken = (await getWalmartToken()).accessToken;
      return requestJson(`https://marketplace.walmartapis.com${path}`, {
        ...options,
        headers: {
          ...walmartHeaders(
            session.credentials,
            session.accessToken,
            options.body ? 'application/json' : undefined,
          ),
          ...(options.headers ?? {}),
        },
      });
    }
  }

  async function applyOne(item) {
    try {
      const existing = await walmartRequest(`/v3/promo/sku/${encodeURIComponent(item.seller_sku)}`);
      const pricing = existing.body?.payload?.pricingList?.pricing;
      const promotions = Array.isArray(pricing) ? pricing : pricing ? [pricing] : [];
      const exact = promotions.find((promotion) => (
        Number(promotion?.currentPrice?.value?.amount) === roundClp(item.promotion_price)
        && Number(promotion?.effectiveDate) === Date.parse(START_AT)
        && Number(promotion?.expirationDate) === Date.parse(END_AT)
      ));
      if (exact) {
        await mark(item, 'applied', {
          externalPromotionId: String(exact.promoId ?? 'walmart-promotion'),
          metadata: { verifiedPromotion: exact },
        });
        applied += 1;
        return;
      }

      const apiBody = {
        sku: item.seller_sku,
        pricing: [{
          currentPriceType: 'REDUCED',
          currentPrice: { currency: 'CLP', amount: roundClp(item.promotion_price) },
          comparisonPrice: { currency: 'CLP', amount: roundClp(item.regular_price) },
          comparisonPriceType: 'BASE',
          effectiveDate: START_AT,
          expirationDate: END_AT,
          processMode: 'UPSERT',
        }],
      };
      const { body } = await walmartRequest('/v3/price?promo=true', {
        method: 'PUT',
        body: JSON.stringify(apiBody),
      });
      const errors = Array.isArray(body?.errors) ? body.errors : [];
      if (Number(body?.statusCode ?? 200) >= 400 || errors.length) {
        throw new Error(`Walmart rechazó la promoción: ${JSON.stringify(body)}`);
      }
      await mark(item, 'applied', {
        externalPromotionId: 'walmart-cl-price-api',
        metadata: { apiResponse: body },
      });
      applied += 1;
    } catch (error) {
      await mark(item, 'failed', { error: error.message });
      failed += 1;
    }
  }

  for (const item of items) {
    await applyOne(item);
    await sleep(1000);
  }
  console.log(JSON.stringify({ marketplace: 'walmart', applied, failed }));
}

async function stageAll(campaign) {
  const marketplaces = ['mercado_libre', 'falabella', 'paris', 'ripley', 'shopify'];
  for (const marketplace of marketplaces) {
    const rows = await getTargets(marketplace);
    await stageTargets(campaign, marketplace, rows);
    console.log(JSON.stringify({ marketplace, selected: rows.length }));
  }
  const walmartRows = await fetchWalmartTargets();
  await stageTargets(campaign, 'walmart', walmartRows);
  console.log(JSON.stringify({ marketplace: 'walmart', selected: walmartRows.length }));
}

async function summary(campaign) {
  const result = await pool.query(
    `SELECT marketplace, status, COUNT(*)::int AS count
     FROM product_promotion_item WHERE campaign_id=$1
     GROUP BY marketplace, status ORDER BY marketplace, status`,
    [campaign.id],
  );
  console.table(result.rows);
}

async function main() {
  const command = process.argv[2] ?? 'plan';
  const marketplace = process.argv[3] ?? null;
  const campaign = await getCampaign();
  if (command === 'plan') {
    await stageAll(campaign);
  } else if (command === 'apply') {
    await stageAll(campaign);
    const actions = {
      mercado_libre: applyMercadoLibre,
      falabella: applyFalabella,
      paris: applyParis,
      ripley: applyRipley,
      shopify: scheduleShopify,
      walmart: applyWalmart,
    };
    if (marketplace) {
      if (!actions[marketplace]) throw new Error(`Marketplace inválido: ${marketplace}`);
      await actions[marketplace](campaign);
    } else {
      for (const action of Object.values(actions)) await action(campaign);
    }
  } else if (command !== 'summary') {
    throw new Error('Uso: node --env-file=.env scripts/cyber-2026-promotions.cjs [plan|apply|summary] [marketplace]');
  }
  await summary(campaign);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
