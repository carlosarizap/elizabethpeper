import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFilledProductUnitCount,
  getProductSize,
  isFilledProductTitle,
} from '../src/app/lib/products/fill-classification.ts';

test('clasifica productos con relleno', () => {
  assert.equal(isFilledProductTitle('Cojín Decorativo 60x60 Relleno Blanco'), true);
  assert.equal(isFilledProductTitle('Funda Cojín · 60x60 / Con Relleno'), true);
});

test('excluye productos sin relleno', () => {
  assert.equal(isFilledProductTitle('Funda Cojín · 45x45 / Sin Relleno'), false);
  assert.equal(isFilledProductTitle('Funda Cojín 50x50 - SIN EL RELLENO'), false);
});

test('un producto que no menciona relleno no se clasifica como relleno', () => {
  assert.equal(isFilledProductTitle('Funda Cojín Decorativo 45x45'), false);
});

test('cojin con medida y sin funda se considera relleno aunque no lo diga', () => {
  assert.equal(isFilledProductTitle('Cojín Decorativo Lino Azul 60x60'), true);
  assert.equal(isFilledProductTitle('COJIN DECORATIVO 50 × 30 TERRACOTA'), true);
  assert.equal(getFilledProductUnitCount('Cojín Decorativo Lino Azul 60x60', 2), 2);
});

test('la regla implicita exige cojin, medida y ausencia de funda', () => {
  assert.equal(isFilledProductTitle('Cojín Decorativo Lino Azul'), false);
  assert.equal(isFilledProductTitle('Almohadón Decorativo 60x60'), false);
  assert.equal(isFilledProductTitle('Funda Cojín Decorativo Lino Azul 60x60'), false);
});

test('normaliza medidas con espacios y signo de multiplicacion', () => {
  assert.equal(getProductSize('Cojín 50 × 30'), '50x30');
  assert.equal(getProductSize('Cojín 100x100'), '100x100');
  assert.equal(getProductSize('Cojín sin medida'), null);
});

test('cada unidad de un pack de 6 cuenta como seis rellenos', () => {
  const title = 'Cojin Para Relleno 50x50 Cm Pack De 6 Unidades Blanco';
  assert.equal(getFilledProductUnitCount(title, 1), 6);
  assert.equal(getFilledProductUnitCount(title, 2), 12);
  assert.equal(getFilledProductUnitCount('Cojín 50x50 Relleno Pack x 6', 1), 6);
});

test('productos normales respetan su cantidad y sin relleno cuentan cero', () => {
  assert.equal(getFilledProductUnitCount('Cojín 60x60 Con Relleno', 3), 3);
  assert.equal(getFilledProductUnitCount('Funda 60x60 Sin Relleno Pack de 6', 2), 0);
});
