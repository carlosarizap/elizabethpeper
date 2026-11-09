import type {
  QuotationDiscountType,
  QuotationItemInput,
  QuotationTotals,
} from './definitions';

const moneyPrecision = 100;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * moneyPrecision) / moneyPrecision;
}

export function calculateQuotationTotals({
  items,
  pricesIncludeVat,
  vatRate = 0.19,
  discountType = 'none',
  discountValue = 0,
}: {
  items: Array<Pick<QuotationItemInput, 'quantity' | 'unitPrice'>>;
  pricesIncludeVat: boolean;
  vatRate?: number;
  discountType?: QuotationDiscountType;
  discountValue?: number;
}): QuotationTotals {
  const subtotal = roundMoney(items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
    0,
  ));
  const boundedDiscountValue = Math.max(0, Number(discountValue) || 0);
  const discount = roundMoney(discountType === 'percent'
    ? subtotal * Math.min(100, boundedDiscountValue) / 100
    : discountType === 'fixed'
      ? Math.min(subtotal, boundedDiscountValue)
      : 0);
  const amountAfterDiscount = Math.max(0, roundMoney(subtotal - discount));

  if (pricesIncludeVat) {
    const total = amountAfterDiscount;
    const net = roundMoney(total / (1 + vatRate));
    return {
      subtotal,
      discount,
      net,
      vat: roundMoney(total - net),
      total,
    };
  }

  const net = amountAfterDiscount;
  const vat = roundMoney(net * vatRate);
  return {
    subtotal,
    discount,
    net,
    vat,
    total: roundMoney(net + vat),
  };
}

