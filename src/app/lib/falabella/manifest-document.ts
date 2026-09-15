import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const MARGIN = 36;

export interface FalabellaManifestRow {
  orderNumber: string;
  trackingNumber: string;
  productCount: number;
}

export interface FalabellaManifestData {
  manifestCode: string;
  sellerName: string;
  businessRegistrationNumber: string;
  shippingProvider: string;
  printedAt: string;
  rows: FalabellaManifestRow[];
  totalPackages: number;
  logo: { type: 'png' | 'jpg'; bytes: Uint8Array } | null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&emsp;|&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function htmlText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function cleanPdfText(value: string): string {
  return value
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchText(value: string, pattern: RegExp): string {
  return cleanPdfText(value.match(pattern)?.[1] ?? '');
}

export function parseFalabellaManifestHtml(html: string): FalabellaManifestData {
  const plain = htmlText(html);
  const firstTable = html.match(/<table\b[\s\S]*?<\/table>/i)?.[0] ?? '';
  const rows: FalabellaManifestRow[] = [];

  for (const rowMatch of firstTable.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const cells = [...rowMatch[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => htmlText(cell[1]));
    if (cells.length < 3 || !cells[0]) continue;
    const productCount = Number(cells[2]);
    rows.push({
      orderNumber: cleanPdfText(cells[0]),
      trackingNumber: cleanPdfText(cells[1]),
      productCount: Number.isFinite(productCount) ? productCount : 0,
    });
  }

  const logoMatch = html.match(/src=['"]data:image\/(png|jpe?g);base64,([^'"]+)['"]/i);
  const totalPackages = Number(matchText(plain, /Total de paquetes\s+(\d+)/i));
  const manifest: FalabellaManifestData = {
    manifestCode: matchText(plain, /\b(MF[A-Z0-9/._-]+)\b/i),
    sellerName: matchText(
      plain,
      /Nombre vendedor:\s*(.*?)\s*N[uú]mero de registro de negocio:/i,
    ),
    businessRegistrationNumber: matchText(
      plain,
      /N[uú]mero de registro de negocio:\s*(.*?)\s*Proveedor de despacho:/i,
    ),
    shippingProvider: matchText(
      plain,
      /Proveedor de despacho:\s*(.*?)\s*Manifiesto del transportista impreso el:/i,
    ),
    printedAt: matchText(
      plain,
      /Manifiesto del transportista impreso el:\s*(.*?)\s*N[º°o]\s*orden/i,
    ),
    rows,
    totalPackages: Number.isFinite(totalPackages) && totalPackages > 0
      ? totalPackages
      : rows.length,
    logo: logoMatch
      ? {
          type: logoMatch[1].toLowerCase() === 'png' ? 'png' : 'jpg',
          bytes: new Uint8Array(Buffer.from(logoMatch[2], 'base64')),
        }
      : null,
  };

  if (!manifest.manifestCode || manifest.rows.length === 0) {
    throw new Error('Falabella devolvió un manifiesto sin código u órdenes reconocibles.');
  }
  return manifest;
}

function drawText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  size = 9,
) {
  page.drawText(cleanPdfText(text), { x, y, size, font, color: rgb(0.08, 0.08, 0.08) });
}

function drawCell(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  bold = false,
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderWidth: 0.7,
    borderColor: rgb(0.15, 0.15, 0.15),
    color: bold ? rgb(0.92, 0.92, 0.92) : undefined,
  });
  const value = cleanPdfText(text);
  const fontSize = value.length > 34 ? 7 : 8;
  drawText(page, font, value, x + 5, y + (height - fontSize) / 2, fontSize);
}

export async function composeFalabellaManifestLetterPdf(html: string): Promise<Uint8Array> {
  const manifest = parseFalabellaManifestHtml(html);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const embeddedLogo = manifest.logo
    ? manifest.logo.type === 'png'
      ? await pdf.embedPng(manifest.logo.bytes).catch(() => null)
      : await pdf.embedJpg(manifest.logo.bytes).catch(() => null)
    : null;

  let page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  let y = LETTER_HEIGHT - MARGIN;
  if (embeddedLogo) {
    const scale = Math.min(150 / embeddedLogo.width, 42 / embeddedLogo.height);
    page.drawImage(embeddedLogo, {
      x: MARGIN,
      y: y - embeddedLogo.height * scale,
      width: embeddedLogo.width * scale,
      height: embeddedLogo.height * scale,
    });
  } else {
    drawText(page, bold, 'FALABELLA', MARGIN, y - 24, 18);
  }
  drawText(page, bold, 'MANIFIESTO DE DESPACHO', 340, y - 17, 14);
  drawText(page, regular, manifest.manifestCode, 340, y - 35, 8);
  y -= 66;

  drawText(page, bold, 'Nombre vendedor:', MARGIN, y, 8);
  drawText(page, regular, manifest.sellerName, 112, y, 8);
  drawText(page, bold, 'Nro. registro:', 340, y, 8);
  drawText(page, regular, manifest.businessRegistrationNumber, 421, y, 8);
  y -= 18;
  drawText(page, bold, 'Proveedor de despacho:', MARGIN, y, 8);
  drawText(page, regular, manifest.shippingProvider, 151, y, 8);
  drawText(page, bold, 'Impreso el:', 390, y, 8);
  drawText(page, regular, manifest.printedAt, 455, y, 8);
  y -= 28;

  const widths = [165, 245, 130];
  const drawTableHeader = () => {
    drawCell(page, bold, 'Nro. orden', MARGIN, y - 24, widths[0], 24, true);
    drawCell(page, bold, 'Numero de seguimiento', MARGIN + widths[0], y - 24, widths[1], 24, true);
    drawCell(page, bold, 'Cantidad de productos', MARGIN + widths[0] + widths[1], y - 24, widths[2], 24, true);
    y -= 24;
  };
  drawTableHeader();

  for (const row of manifest.rows) {
    if (y - 24 < 54) {
      page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
      y = LETTER_HEIGHT - MARGIN;
      drawText(page, bold, `Manifiesto ${manifest.manifestCode}`, MARGIN, y, 10);
      y -= 20;
      drawTableHeader();
    }
    drawCell(page, regular, row.orderNumber, MARGIN, y - 24, widths[0], 24);
    drawCell(page, regular, row.trackingNumber, MARGIN + widths[0], y - 24, widths[1], 24);
    drawCell(
      page,
      regular,
      String(row.productCount),
      MARGIN + widths[0] + widths[1],
      y - 24,
      widths[2],
      24,
    );
    y -= 24;
  }

  if (y < 245) {
    page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
    y = LETTER_HEIGHT - MARGIN;
    drawText(page, bold, `Manifiesto ${manifest.manifestCode}`, MARGIN, y, 10);
    y -= 30;
  } else {
    y -= 18;
  }

  drawCell(page, bold, 'Total de paquetes', MARGIN, y - 42, 180, 22, true);
  drawCell(page, regular, String(manifest.totalPackages), MARGIN, y - 64, 180, 22);
  drawCell(page, bold, 'Fecha de entrega (DD-MM-AA)', 252, y - 42, 324, 22, true);
  drawCell(page, regular, '', 252, y - 86, 324, 44);
  y -= 105;
  drawCell(page, bold, 'Timbre del operador logistico', MARGIN, y - 22, 260, 22, true);
  drawCell(page, regular, '', MARGIN, y - 112, 260, 90);
  drawCell(page, bold, 'Nombre', 316, y - 22, 260, 22, true);
  drawCell(page, regular, '', 316, y - 59, 260, 37);
  drawCell(page, bold, 'RUT', 316, y - 81, 260, 22, true);
  drawCell(page, regular, '', 316, y - 112, 260, 31);

  return pdf.save();
}
