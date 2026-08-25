function normalizeProductTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isFilledProductTitle(title: string): boolean {
  const normalized = normalizeProductTitle(title);
  if (/\bsin(?:\s+el)?\s+relleno\b/.test(normalized)) return false;
  if (/\brelleno\b/.test(normalized)) return true;

  return /\bcojin\b/.test(normalized) &&
    !/\bfunda\b/.test(normalized) &&
    getProductSize(normalized) !== null;
}

export function getProductSize(title: string): string | null {
  const match = normalizeProductTitle(title).match(
    /\b(\d{2,3})\s*[x×]\s*(\d{2,3})\b/,
  );
  return match ? `${match[1]}x${match[2]}` : null;
}

export function getFilledProductUnitCount(
  title: string,
  productQuantity: number,
): number {
  if (!isFilledProductTitle(title)) return 0;

  const quantity = Number.isFinite(productQuantity)
    ? Math.max(0, Math.trunc(productQuantity))
    : 0;
  const normalized = normalizeProductTitle(title);
  const packMatch = normalized.match(/\bpack(?:\s+de|\s*x)?\s*(\d{1,3})\b/);
  const unitsPerPack = packMatch ? Math.max(1, Number(packMatch[1])) : 1;

  return quantity * unitsPerPack;
}
