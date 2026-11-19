export interface ProductPackaging {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  source: string;
}

export function readMercadoLibrePackaging(value: unknown): ProductPackaging | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as { attributes?: Array<{ id: string; value_name?: string; values?: Array<{ struct?: { number: number; unit: string } }> }> };
  const measure = (id: string, weight = false) => {
    const attribute = item.attributes?.find((a) => a.id === id);
    const structured = attribute?.values?.[0]?.struct;
    const match = attribute?.value_name?.match(/^([\d.,]+)\s*(cm|mm|m|kg|g)$/i);
    const number = structured?.number ?? (match ? Number(match[1].replace(',', '.')) : NaN);
    const unit = (structured?.unit ?? match?.[2] ?? '').toLowerCase();
    const factors: Record<string, number> = weight ? { kg: 1, g: 0.001 } : { cm: 1, mm: 0.1, m: 100 };
    return number * (factors[unit] ?? NaN);
  };
  const packaging = {
    lengthCm: measure('SELLER_PACKAGE_LENGTH'), widthCm: measure('SELLER_PACKAGE_WIDTH'),
    heightCm: measure('SELLER_PACKAGE_HEIGHT'), weightKg: measure('SELLER_PACKAGE_WEIGHT', true), source: 'mercado_libre',
  };
  return [packaging.lengthCm, packaging.widthCm, packaging.heightCm, packaging.weightKg]
    .every((n) => Number.isFinite(n) && n > 0) ? packaging : null;
}

// Packaging already used to publish the evaluated cushion variants in
// scripts/new-cushion-catalog-data.cjs (centimeters and grams).
const CUSHION_PROFILES = [
  { size: '45x45', cover: [32, 27, 5, 400], filled: [45, 45, 16, 900] },
  { size: '50x50', cover: [35, 30, 6, 500], filled: [50, 50, 18, 1100] },
  { size: '60x60', cover: [40, 35, 7, 650], filled: [60, 60, 20, 1300] },
  { size: '50x30', cover: [35, 28, 5, 400], filled: [50, 30, 15, 800] },
  { size: '60x40', cover: [42, 30, 7, 750], filled: [60, 40, 18, 1200] },
  { size: '80x40', cover: [42, 30, 7, 750], filled: [80, 40, 18, 1800] },
];

export function suggestProductPackaging(title: string, weightKg?: number): ProductPackaging | null {
  const normalized = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const measure = normalized.match(/(\d+)\s*[x×]\s*(\d+)/);
  if (/cojin|funda/.test(normalized) && measure) {
    const profile = CUSHION_PROFILES.find((p) => p.size === `${measure[1]}x${measure[2]}` || p.size === `${measure[2]}x${measure[1]}`);
    if (profile) {
      const [lengthCm, widthCm, heightCm, grams] = /funda|sin relleno/.test(normalized) ? profile.cover : profile.filled;
      return { lengthCm, widthCm, heightCm, weightKg: weightKg || grams / 1000, source: 'perfil_cojines_evaluado' };
    }
  }
  const textile = /camino de mesa/.test(normalized) ? [30, 22, 2, 0.3]
    : /servilleta/.test(normalized) ? [25, 25, 3, 0.3]
      : /mantel/.test(normalized) ? [35, 30, 5, 0.8]
        : /cortina/.test(normalized) ? [35, 30, 8, 1.5]
          : /sabana/.test(normalized) ? [35, 30, 10, 1.5]
            : /pie de cama/.test(normalized) ? [35, 30, 6, 0.7] : null;
  if (textile) {
    return { lengthCm: textile[0], widthCm: textile[1], heightCm: textile[2], weightKg: weightKg || textile[3],
      source: weightKg ? 'estimado_tela_peso_shopify' : 'estimado_tela' };
  }
  return null;
}

export function suggestGroupedPackages(lines: Array<{ lineNumber: string; quantity: number; packaging: ProductPackaging | null }>) {
  const packages: Array<{ items: Array<{ lineNumber: string; quantity: number }>; packaging: ProductPackaging }> = [];
  if (lines.some((line) => !line.packaging)) return [{
    items: lines.map((line) => ({ lineNumber: line.lineNumber, quantity: line.quantity })),
    packaging: { lengthCm: 0, widthCm: 0, heightCm: 0, weightKg: 0, source: 'manual' },
  }];
  // Editable packing proposal, not carrier limits. Stack packages up to 60 cm
  // high and 20 kg; several large cushions naturally produce several boxes.
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10_000) throw new Error('Cantidad inválida para sugerir bultos.');
    const unit = line.packaging!;
    for (let n = 0; n < line.quantity; n += 1) {
      let box = packages.find((p) => p.packaging.heightCm + unit.heightCm <= 60 && p.packaging.weightKg + unit.weightKg <= 20);
      if (!box) {
        box = { items: [], packaging: { lengthCm: 0, widthCm: 0, heightCm: 0, weightKg: 0, source: 'agrupacion_sugerida' } };
        packages.push(box);
      }
      box.packaging.lengthCm = Math.max(box.packaging.lengthCm, unit.lengthCm, unit.widthCm);
      box.packaging.widthCm = Math.max(box.packaging.widthCm, Math.min(unit.lengthCm, unit.widthCm));
      box.packaging.heightCm = Number((box.packaging.heightCm + unit.heightCm).toFixed(2));
      box.packaging.weightKg = Number((box.packaging.weightKg + unit.weightKg).toFixed(3));
      const item = box.items.find((i) => i.lineNumber === line.lineNumber);
      if (item) item.quantity += 1;
      else box.items.push({ lineNumber: line.lineNumber, quantity: 1 });
    }
  }
  return packages;
}

export function walmartBoxDimensions(packaging: ProductPackaging) {
  if (![packaging.lengthCm, packaging.widthCm, packaging.heightCm, packaging.weightKg]
    .every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error('El embalaje debe tener largo, ancho, alto y peso mayores que cero.');
  }
  return {
    boxDimensionUnit: 'CM', boxWeightUnit: 'KG',
    boxLength: packaging.lengthCm, boxWidth: packaging.widthCm,
    boxHeight: packaging.heightCm, boxWeight: packaging.weightKg,
  };
}
