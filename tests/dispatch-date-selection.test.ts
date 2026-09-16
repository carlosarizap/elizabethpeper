import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionForCurrentDispatchDate } from '../src/app/lib/dispatches/date-selection.ts';

const order = (
  key: string,
  deliveryDate: string | null,
  overrides: Partial<{ selectable: boolean; printCount: number }> = {},
) => ({
  key,
  deliveryDate,
  selectable: overrides.selectable ?? true,
  printCount: overrides.printCount ?? 0,
});

test('al abrir despachos selecciona solamente los pendientes de hoy', () => {
  const selection = selectionForCurrentDispatchDate([
    order('falabella:hoy', '2026-09-16'),
    order('paris:hoy', '2026-09-16'),
    order('walmart:manana', '2026-09-17'),
    order('mercadolibre:sin-fecha', null),
    order('falabella:impresa', '2026-09-16', { printCount: 1 }),
    order('ripley:no-disponible', '2026-09-16', { selectable: false }),
  ], '2026-09-16');

  assert.deepEqual([...selection].sort(), ['falabella:hoy', 'paris:hoy']);
});

test('si hoy no tiene pendientes usa solamente la próxima fecha disponible', () => {
  const selection = selectionForCurrentDispatchDate([
    order('viernes', '2026-09-18'),
    order('jueves-a', '2026-09-17'),
    order('jueves-b', '2026-09-17'),
  ], '2026-09-16');

  assert.deepEqual([...selection].sort(), ['jueves-a', 'jueves-b']);
});

test('si solo quedan fechas pasadas usa la más reciente', () => {
  const selection = selectionForCurrentDispatchDate([
    order('lunes', '2026-09-14'),
    order('martes', '2026-09-15'),
  ], '2026-09-16');

  assert.deepEqual([...selection], ['martes']);
});

test('no selecciona automáticamente órdenes sin fecha confirmada', () => {
  const selection = selectionForCurrentDispatchDate([
    order('sin-fecha', null),
  ], '2026-09-16');

  assert.equal(selection.size, 0);
});
