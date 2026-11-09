export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
export type QuotationDiscountType = 'none' | 'percent' | 'fixed';

export interface QuotationCustomer {
  id: string;
  legalName: string;
  rut: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
}

export interface QuotationItem {
  id: string;
  catalogProductId: string | null;
  catalogVariantId: string | null;
  sortOrder: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface QuotationTotals {
  subtotal: number;
  discount: number;
  net: number;
  vat: number;
  total: number;
}

export interface Quotation {
  id: string;
  quoteNumber: string;
  sequenceNumber: number;
  customer: QuotationCustomer;
  quoteDate: string;
  validUntil: string | null;
  deliveryDate: string | null;
  deliveryNote: string | null;
  status: QuotationStatus;
  currency: 'CLP';
  pricesIncludeVat: boolean;
  vatRate: number;
  discountType: QuotationDiscountType;
  discountValue: number;
  paymentTerms: string | null;
  notes: string | null;
  totals: QuotationTotals;
  items: QuotationItem[];
  createdAt: string;
  updatedAt: string;
}

export interface QuotationListItem {
  id: string;
  quoteNumber: string;
  customerName: string;
  quoteDate: string;
  deliveryDate: string | null;
  status: QuotationStatus;
  total: number;
  itemCount: number;
  updatedAt: string;
}

export interface QuotationCustomerInput {
  id?: string | null;
  legalName: string;
  rut?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
}

export interface QuotationItemInput {
  id?: string | null;
  catalogProductId?: string | null;
  catalogVariantId?: string | null;
  description: string;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
}

export interface QuotationInput {
  customer: QuotationCustomerInput;
  quoteDate: string;
  validUntil?: string | null;
  deliveryDate?: string | null;
  deliveryNote?: string | null;
  pricesIncludeVat: boolean;
  vatRate?: number;
  discountType?: QuotationDiscountType;
  discountValue?: number;
  paymentTerms?: string | null;
  notes?: string | null;
  items: QuotationItemInput[];
}

export interface QuotationCatalogOption {
  productId: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  sku: string | null;
  shopifyPrice: number | null;
}

