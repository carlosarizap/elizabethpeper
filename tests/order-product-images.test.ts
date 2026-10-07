import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOrderProductImageResolver,
  type OrderProductImageCandidate,
} from '../src/app/lib/products/order-product-images.ts';

const candidates: OrderProductImageCandidate[] = [
  {
    marketplace: 'falabella',
    externalProductId: 'FA-100',
    externalVariantIds: ['FA-100-60'],
    title: 'Funda Cojín Decorativo Diseño Lino Verde Oliva',
    variantLabels: ['Funda Cojín Lino Verde Oliva 60x40'],
    imageUrl: 'https://example.com/verde.jpg',
  },
  {
    marketplace: 'falabella',
    externalProductId: 'FA-200',
    externalVariantIds: [],
    title: 'Funda Cojín Decorativo Diseño Lino Café Negro Ecocuero',
    variantLabels: [],
    imageUrl: 'https://example.com/cafe.jpg',
  },
];

test('resolves an order image by marketplace item identifier first', () => {
  const resolve = createOrderProductImageResolver(candidates);
  assert.equal(resolve({
    marketplace: 'falabella',
    marketplaceItemId: 'FA-100-60',
    productTitle: 'A title that changed after the sale',
  }), 'https://example.com/verde.jpg');
});

test('resolves the main image from an order title with variant details', () => {
  const resolve = createOrderProductImageResolver(candidates);
  assert.equal(resolve({
    marketplace: 'falabella',
    marketplaceItemId: 'order-line-id',
    productTitle: 'Funda Cojin Decorativo Diseño Lino Verde Oliva 60x40',
  }), 'https://example.com/verde.jpg');
});

test('does not guess an image for an unrelated product', () => {
  const resolve = createOrderProductImageResolver(candidates);
  assert.equal(resolve({
    marketplace: 'falabella',
    marketplaceItemId: null,
    productTitle: 'Juego de Sábanas Gris 2 Plazas',
  }), null);
});

test('can reuse an exact product photo from another marketplace', () => {
  const resolve = createOrderProductImageResolver(candidates);
  assert.equal(resolve({
    marketplace: 'walmart',
    marketplaceItemId: 'WM-order-line',
    productTitle: 'Funda Cojin Decorativo Diseño Lino Verde Oliva',
  }), 'https://example.com/verde.jpg');
});
