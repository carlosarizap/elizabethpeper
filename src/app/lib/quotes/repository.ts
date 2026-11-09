import type { PoolClient } from 'pg';
import pool from '@/app/lib/db';
import { calculateQuotationTotals } from './calculations';
import type {
  Quotation,
  QuotationCatalogOption,
  QuotationCustomer,
  QuotationCustomerInput,
  QuotationInput,
  QuotationItem,
  QuotationListItem,
  QuotationStatus,
} from './definitions';

interface CustomerRow {
  id: string;
  legal_name: string;
  rut: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
}

interface QuotationHeaderRow extends CustomerRow {
  quotation_id: string;
  quote_number: string;
  sequence_number: string | number;
  quote_date: string;
  valid_until: string | null;
  delivery_date: string | null;
  delivery_note: string | null;
  status: QuotationStatus;
  currency: 'CLP';
  prices_include_vat: boolean;
  vat_rate: string | number;
  discount_type: Quotation['discountType'];
  discount_value: string | number;
  payment_terms: string | null;
  quotation_notes: string | null;
  subtotal_amount: string | number;
  discount_amount: string | number;
  net_amount: string | number;
  vat_amount: string | number;
  total_amount: string | number;
  quotation_created_at: Date | string;
  quotation_updated_at: Date | string;
}

interface QuotationItemRow {
  id: string;
  catalog_product_id: string | null;
  catalog_variant_id: string | null;
  sort_order: number;
  description: string;
  quantity: string | number;
  unit: string;
  unit_price: string | number;
  line_total: string | number;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function customerFromRow(row: CustomerRow): QuotationCustomer {
  return {
    id: row.id,
    legalName: row.legal_name,
    rut: row.rut,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    notes: row.notes,
  };
}

function itemFromRow(row: QuotationItemRow): QuotationItem {
  return {
    id: row.id,
    catalogProductId: row.catalog_product_id,
    catalogVariantId: row.catalog_variant_id,
    sortOrder: row.sort_order,
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total),
  };
}

function quotationFromRows(row: QuotationHeaderRow, items: QuotationItemRow[]): Quotation {
  return {
    id: row.quotation_id,
    quoteNumber: row.quote_number,
    sequenceNumber: Number(row.sequence_number),
    customer: customerFromRow(row),
    quoteDate: row.quote_date,
    validUntil: row.valid_until,
    deliveryDate: row.delivery_date,
    deliveryNote: row.delivery_note,
    status: row.status,
    currency: row.currency,
    pricesIncludeVat: row.prices_include_vat,
    vatRate: Number(row.vat_rate),
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    paymentTerms: row.payment_terms,
    notes: row.quotation_notes,
    totals: {
      subtotal: Number(row.subtotal_amount),
      discount: Number(row.discount_amount),
      net: Number(row.net_amount),
      vat: Number(row.vat_amount),
      total: Number(row.total_amount),
    },
    items: items.map(itemFromRow),
    createdAt: toIso(row.quotation_created_at),
    updatedAt: toIso(row.quotation_updated_at),
  };
}

export function normalizeCustomerName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function saveCustomer(
  client: PoolClient,
  input: QuotationCustomerInput,
): Promise<CustomerRow> {
  const normalizedName = normalizeCustomerName(input.legalName);
  let existing: CustomerRow | undefined;

  if (input.id) {
    existing = (await client.query<CustomerRow>(
      `SELECT id, legal_name, rut, contact_name, email, phone, address, city, notes
       FROM quotation_customer WHERE id = $1`,
      [input.id],
    )).rows[0];
    if (!existing) throw new Error('El cliente seleccionado ya no existe.');
  } else {
    existing = (await client.query<CustomerRow>(
      `SELECT id, legal_name, rut, contact_name, email, phone, address, city, notes
       FROM quotation_customer
       WHERE ($1::text IS NOT NULL AND UPPER(rut) = UPPER($1))
          OR normalized_name = $2
       ORDER BY CASE WHEN $1::text IS NOT NULL AND UPPER(rut) = UPPER($1) THEN 0 ELSE 1 END
       LIMIT 1`,
      [input.rut || null, normalizedName],
    )).rows[0];
  }

  const values = [
    input.legalName,
    normalizedName,
    input.rut || null,
    input.contactName || null,
    input.email || null,
    input.phone || null,
    input.address || null,
    input.city || null,
    input.notes || null,
  ];

  if (existing) {
    return (await client.query<CustomerRow>(
      `UPDATE quotation_customer
       SET legal_name = $1, normalized_name = $2, rut = $3, contact_name = $4,
           email = $5, phone = $6, address = $7, city = $8, notes = $9,
           updated_at = NOW()
       WHERE id = $10
       RETURNING id, legal_name, rut, contact_name, email, phone, address, city, notes`,
      [...values, existing.id],
    )).rows[0];
  }

  return (await client.query<CustomerRow>(
    `INSERT INTO quotation_customer
       (legal_name, normalized_name, rut, contact_name, email, phone, address, city, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, legal_name, rut, contact_name, email, phone, address, city, notes`,
    values,
  )).rows[0];
}

async function insertItems(client: PoolClient, quotationId: string, input: QuotationInput): Promise<void> {
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    await client.query(
      `INSERT INTO quotation_item
         (quotation_id, catalog_product_id, catalog_variant_id, sort_order,
          description, quantity, unit, unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        quotationId,
        item.catalogProductId || null,
        item.catalogVariantId || null,
        index + 1,
        item.description,
        item.quantity,
        item.unit || 'unidad',
        item.unitPrice,
      ],
    );
  }
}

const headerSelect = `
  SELECT
    q.id AS quotation_id, q.quote_number, q.sequence_number, q.quote_date::text,
    q.valid_until::text, q.delivery_date::text, q.delivery_note, q.status, q.currency,
    q.prices_include_vat, q.vat_rate, q.discount_type, q.discount_value,
    q.payment_terms, q.notes AS quotation_notes, q.subtotal_amount, q.discount_amount,
    q.net_amount, q.vat_amount, q.total_amount,
    q.created_at AS quotation_created_at, q.updated_at AS quotation_updated_at,
    c.id, c.legal_name, c.rut, c.contact_name, c.email, c.phone, c.address, c.city, c.notes
  FROM quotation q
  JOIN quotation_customer c ON c.id = q.customer_id
`;

export async function listQuotationCustomers(search = ''): Promise<QuotationCustomer[]> {
  const normalizedSearch = search.trim();
  const result = await pool.query<CustomerRow>(
    `SELECT id, legal_name, rut, contact_name, email, phone, address, city, notes
     FROM quotation_customer
     WHERE $1 = ''
        OR legal_name ILIKE '%' || $1 || '%'
        OR COALESCE(rut, '') ILIKE '%' || $1 || '%'
        OR COALESCE(email, '') ILIKE '%' || $1 || '%'
     ORDER BY legal_name
     LIMIT 200`,
    [normalizedSearch],
  );
  return result.rows.map(customerFromRow);
}

export async function deleteQuotationCustomer(id: string): Promise<'deleted' | 'in_use' | 'missing'> {
  const deleted = await pool.query(
    `DELETE FROM quotation_customer customer
     WHERE customer.id = $1
       AND NOT EXISTS (
         SELECT 1 FROM quotation WHERE customer_id = customer.id
       )`,
    [id],
  );
  if ((deleted.rowCount ?? 0) > 0) return 'deleted';
  const existing = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM quotation_customer WHERE id = $1) AS exists`,
    [id],
  );
  return existing.rows[0]?.exists ? 'in_use' : 'missing';
}

export async function listQuotationCatalogOptions(search = ''): Promise<QuotationCatalogOption[]> {
  const normalizedSearch = search.trim();
  const result = await pool.query<{
    product_id: string;
    variant_id: string;
    product_name: string;
    variant_label: string;
    canonical_sku: string | null;
    shopify_price: string | number | null;
  }>(
    `SELECT p.id AS product_id, v.id AS variant_id, p.name AS product_name,
            v.label AS variant_label, v.canonical_sku,
            shopify.shopify_price
     FROM catalog_variant v
     JOIN catalog_product p ON p.id = v.catalog_product_id
     LEFT JOIN LATERAL (
       SELECT source_variant.price AS shopify_price
       FROM marketplace_catalog_variant source_variant
       JOIN marketplace_catalog_product source_product
         ON source_product.id = source_variant.marketplace_catalog_product_id
       WHERE source_variant.catalog_variant_id = v.id
         AND source_product.marketplace = 'shopify'
         AND source_variant.price IS NOT NULL
       ORDER BY source_variant.last_synced_at DESC
       LIMIT 1
     ) shopify ON TRUE
     WHERE p.status <> 'archived' AND v.status <> 'archived'
       AND ($1 = '' OR p.name ILIKE '%' || $1 || '%'
         OR v.label ILIKE '%' || $1 || '%'
         OR COALESCE(v.canonical_sku, '') ILIKE '%' || $1 || '%')
     ORDER BY p.name, v.label
     LIMIT 300`,
    [normalizedSearch],
  );
  return result.rows.map((row) => ({
    productId: row.product_id,
    variantId: row.variant_id,
    productName: row.product_name,
    variantLabel: row.variant_label,
    sku: row.canonical_sku,
    shopifyPrice: row.shopify_price === null ? null : Number(row.shopify_price),
  }));
}

export async function listQuotations({
  search = '',
  status = 'all',
}: {
  search?: string;
  status?: QuotationStatus | 'all';
} = {}): Promise<QuotationListItem[]> {
  const result = await pool.query<{
    id: string;
    quote_number: string;
    customer_name: string;
    quote_date: string;
    delivery_date: string | null;
    status: QuotationStatus;
    total_amount: string | number;
    item_count: string | number;
    updated_at: Date | string;
  }>(
    `SELECT q.id, q.quote_number, c.legal_name AS customer_name, q.quote_date::text,
            q.delivery_date::text, q.status, q.total_amount, COUNT(i.id) AS item_count,
            q.updated_at
     FROM quotation q
     JOIN quotation_customer c ON c.id = q.customer_id
     LEFT JOIN quotation_item i ON i.quotation_id = q.id
     WHERE ($1 = '' OR q.quote_number ILIKE '%' || $1 || '%'
       OR c.legal_name ILIKE '%' || $1 || '%'
       OR COALESCE(c.rut, '') ILIKE '%' || $1 || '%')
       AND ($2 = 'all' OR q.status = $2)
     GROUP BY q.id, c.legal_name
     ORDER BY q.quote_date DESC, q.sequence_number DESC
     LIMIT 300`,
    [search.trim(), status],
  );
  return result.rows.map((row) => ({
    id: row.id,
    quoteNumber: row.quote_number,
    customerName: row.customer_name,
    quoteDate: row.quote_date,
    deliveryDate: row.delivery_date,
    status: row.status,
    total: Number(row.total_amount),
    itemCount: Number(row.item_count),
    updatedAt: toIso(row.updated_at),
  }));
}

export async function getQuotation(id: string): Promise<Quotation | null> {
  const header = (await pool.query<QuotationHeaderRow>(
    `${headerSelect} WHERE q.id = $1`,
    [id],
  )).rows[0];
  if (!header) return null;
  const items = (await pool.query<QuotationItemRow>(
    `SELECT id, catalog_product_id, catalog_variant_id, sort_order, description,
            quantity, unit, unit_price, line_total
     FROM quotation_item WHERE quotation_id = $1 ORDER BY sort_order`,
    [id],
  )).rows;
  return quotationFromRows(header, items);
}

export async function createQuotation(input: QuotationInput): Promise<Quotation> {
  const totals = calculateQuotationTotals(input);
  const client = await pool.connect();
  let quotationId = '';
  try {
    await client.query('BEGIN');
    const customer = await saveCustomer(client, input.customer);
    const quotation = (await client.query<{ id: string }>(
      `INSERT INTO quotation
         (customer_id, quote_date, valid_until, delivery_date, delivery_note,
          prices_include_vat, vat_rate, discount_type, discount_value,
          payment_terms, notes, subtotal_amount, discount_amount, net_amount,
          vat_amount, total_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        customer.id, input.quoteDate, input.validUntil || null, input.deliveryDate || null,
        input.deliveryNote || null, input.pricesIncludeVat, input.vatRate ?? 0.19,
        input.discountType ?? 'none', input.discountValue ?? 0, input.paymentTerms || null,
        input.notes || null, totals.subtotal, totals.discount, totals.net, totals.vat, totals.total,
      ],
    )).rows[0];
    quotationId = quotation.id;
    await insertItems(client, quotationId, input);
    await client.query(
      `INSERT INTO quotation_status_history (quotation_id, from_status, to_status, note)
       VALUES ($1, NULL, 'draft', 'Cotización creada')`,
      [quotationId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return (await getQuotation(quotationId))!;
}

export async function updateQuotation(id: string, input: QuotationInput): Promise<Quotation | null> {
  const totals = calculateQuotationTotals(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = (await client.query<{ id: string }>(
      `SELECT id FROM quotation WHERE id = $1 FOR UPDATE`,
      [id],
    )).rows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return null;
    }
    const customer = await saveCustomer(client, input.customer);
    await client.query(
      `UPDATE quotation
       SET customer_id = $2, quote_date = $3, valid_until = $4, delivery_date = $5,
           delivery_note = $6, prices_include_vat = $7, vat_rate = $8,
           discount_type = $9, discount_value = $10, payment_terms = $11, notes = $12,
           subtotal_amount = $13, discount_amount = $14, net_amount = $15,
           vat_amount = $16, total_amount = $17, updated_at = NOW()
       WHERE id = $1`,
      [
        id, customer.id, input.quoteDate, input.validUntil || null, input.deliveryDate || null,
        input.deliveryNote || null, input.pricesIncludeVat, input.vatRate ?? 0.19,
        input.discountType ?? 'none', input.discountValue ?? 0, input.paymentTerms || null,
        input.notes || null, totals.subtotal, totals.discount, totals.net, totals.vat, totals.total,
      ],
    );
    await client.query(`DELETE FROM quotation_item WHERE quotation_id = $1`, [id]);
    await insertItems(client, id, input);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getQuotation(id);
}

export async function deleteQuotation(id: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM quotation WHERE id = $1`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function changeQuotationStatus(
  id: string,
  nextStatus: QuotationStatus,
  note?: string | null,
): Promise<Quotation | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = (await client.query<{ status: QuotationStatus }>(
      `SELECT status FROM quotation WHERE id = $1 FOR UPDATE`,
      [id],
    )).rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return null;
    }
    if (current.status !== nextStatus) {
      await client.query(
        `UPDATE quotation
         SET status = $2::varchar,
             sent_at = CASE WHEN $2::varchar = 'sent' THEN COALESCE(sent_at, NOW()) ELSE sent_at END,
             accepted_at = CASE WHEN $2::varchar = 'accepted' THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
             updated_at = NOW()
         WHERE id = $1`,
        [id, nextStatus],
      );
      await client.query(
        `INSERT INTO quotation_status_history (quotation_id, from_status, to_status, note)
         VALUES ($1, $2, $3, $4)`,
        [id, current.status, nextStatus, note || null],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getQuotation(id);
}

