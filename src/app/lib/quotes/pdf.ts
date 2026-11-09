import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import type { Quotation } from './definitions';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 46;
const RIGHT = 566;
const CONTENT_WIDTH = RIGHT - LEFT;
const ITEMS_PER_PAGE = 8;

const ink = rgb(0.13, 0.16, 0.22);
const muted = rgb(0.42, 0.46, 0.54);
const softLine = rgb(0.86, 0.89, 0.93);
const blue = rgb(0.18, 0.42, 0.72);
const paleBlue = rgb(0.94, 0.97, 1);
const paleRose = rgb(1, 0.95, 0.97);
const palePeach = rgb(1, 0.97, 0.91);
const paleGray = rgb(0.975, 0.98, 0.99);
const rose = rgb(0.86, 0.32, 0.48);
const orange = rgb(0.96, 0.55, 0.2);
const yellow = rgb(0.98, 0.76, 0.16);
const logoRainbow: RGB[] = [
  rgb(0.96, 0.18, 0.36),
  rgb(1, 0.36, 0.12),
  rgb(1, 0.57, 0.08),
  rgb(1, 0.78, 0.08),
  rgb(0.7, 0.84, 0.12),
  rgb(0.16, 0.78, 0.3),
  rgb(0.04, 0.76, 0.58),
  rgb(0.04, 0.6, 0.9),
  rgb(0.12, 0.38, 0.86),
  rgb(0.28, 0.2, 0.72),
  rgb(0.54, 0.14, 0.82),
  rgb(0.76, 0.16, 0.82),
  rgb(0.92, 0.28, 0.68),
  rgb(0.96, 0.46, 0.7),
];

function printable(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/×/g, 'x')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatClp(value: number): string {
  return `$${Math.round(value).toLocaleString('es-CL')}`;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString('es-CL', { maximumFractionDigits: 3 });
}

function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function drawRight(
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB = ink,
) {
  page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y, font, size, color });
}

function drawCentered(
  page: PDFPage,
  text: string,
  left: number,
  right: number,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB = ink,
) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: left + (right - left - width) / 2, y, font, size, color });
}

function wrapText(value: string, font: PDFFont, size: number, width: number, maxLines = 2): string[] {
  const clean = printable(value);
  const words = clean.split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.length && lines.join(' ').length < clean.length && lines.length) {
    let last = lines.at(-1) ?? '';
    while (last && font.widthOfTextAtSize(`${last}...`, size) > width) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trim()}...`;
  }
  return lines;
}

function drawAccent(page: PDFPage) {
  const segment = PAGE_WIDTH / logoRainbow.length;
  logoRainbow.forEach((color, index) => {
    page.drawRectangle({ x: segment * index, y: PAGE_HEIGHT - 7, width: segment + 1, height: 7, color });
  });
}

function drawHeader(
  page: PDFPage,
  quotation: Quotation,
  regular: PDFFont,
  bold: PDFFont,
  logo: Awaited<ReturnType<PDFDocument['embedPng']>> | null,
  compact = false,
) {
  drawAccent(page);

  const logoSize = compact ? 42 : 66;
  if (logo) {
    const dimensions = logo.scaleToFit(logoSize, logoSize);
    page.drawImage(logo, {
      x: LEFT,
      y: compact ? 704 : 690,
      width: dimensions.width,
      height: dimensions.height,
    });
  }

  const companyX = LEFT + (compact ? 54 : 82);
  const companyY = compact ? 732 : 744;
  page.drawText('ELIZABETH PEPER', { x: companyX, y: companyY, font: bold, size: compact ? 11 : 13, color: ink });
  page.drawText('Decoración textil para espacios únicos', { x: companyX, y: companyY - 16, font: regular, size: 7.5, color: muted });
  if (!compact) {
    page.drawText('RUT 77.312.865-0  |  elizabethpeper@yahoo.com', { x: companyX, y: companyY - 31, font: regular, size: 6.8, color: muted });
  }

  drawRight(page, 'COTIZACIÓN', RIGHT, compact ? 732 : 744, bold, compact ? 16 : 20, blue);
  drawRight(page, `Nº ${quotation.quoteNumber}`, RIGHT, compact ? 712 : 718, bold, compact ? 9 : 10, ink);
  if (!compact) {
    drawRight(page, `Fecha: ${formatDate(quotation.quoteDate)}`, RIGHT, 699, regular, 8, muted);
    if (quotation.validUntil) drawRight(page, `Válida hasta: ${formatDate(quotation.validUntil)}`, RIGHT, 686, regular, 7.5, muted);
  }

  if (compact) {
    page.drawLine({ start: { x: LEFT, y: 690 }, end: { x: RIGHT, y: 690 }, color: softLine, thickness: 1 });
    return 674;
  }

  const customerTop = 666;
  const customerBottom = 606;
  page.drawRectangle({ x: LEFT, y: customerBottom, width: CONTENT_WIDTH, height: customerTop - customerBottom, color: paleBlue });
  page.drawRectangle({ x: LEFT, y: customerBottom, width: 5, height: customerTop - customerBottom, color: blue });
  page.drawText('PREPARADO PARA', { x: LEFT + 17, y: customerTop - 17, font: bold, size: 6.5, color: blue });
  const customerName = wrapText(quotation.customer.legalName, bold, 12, 292, 1)[0] || '';
  page.drawText(customerName, { x: LEFT + 17, y: customerTop - 36, font: bold, size: 12, color: ink });

  const customerMeta = [
    quotation.customer.rut ? `RUT ${quotation.customer.rut}` : null,
    quotation.customer.contactName ? `Contacto: ${quotation.customer.contactName}` : null,
    quotation.customer.phone,
  ].filter(Boolean).join('  |  ');
  if (customerMeta) page.drawText(printable(customerMeta), { x: LEFT + 17, y: customerBottom + 10, font: regular, size: 7, color: muted });

  const contactLines = [
    quotation.customer.email,
    [quotation.customer.address, quotation.customer.city].filter(Boolean).join(', '),
  ].filter(Boolean) as string[];
  contactLines.slice(0, 2).forEach((line, index) => {
    const clipped = wrapText(line, regular, 7, 176, 1)[0] || '';
    page.drawText(clipped, { x: 378, y: customerTop - 27 - index * 15, font: regular, size: 7, color: ink });
  });

  return 590;
}

function drawItemsTable(
  page: PDFPage,
  quotation: Quotation,
  regular: PDFFont,
  bold: PDFFont,
  items: Quotation['items'],
  startY: number,
  itemOffset: number,
) {
  const columns = [LEFT, 78, 127, 360, 458, RIGHT];
  const headerHeight = 29;
  const rowHeight = 32;
  const tableBottom = startY - headerHeight - ITEMS_PER_PAGE * rowHeight;

  page.drawRectangle({ x: LEFT, y: startY - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: paleRose });
  page.drawRectangle({ x: LEFT, y: startY - headerHeight, width: 5, height: headerHeight, color: rose });
  for (let index = 0; index < ITEMS_PER_PAGE; index += 1) {
    const y = startY - headerHeight - (index + 1) * rowHeight;
    if (index % 2 === 1) page.drawRectangle({ x: LEFT, y, width: CONTENT_WIDTH, height: rowHeight, color: paleGray });
    page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, color: softLine, thickness: 0.55 });
  }
  page.drawLine({ start: { x: LEFT, y: tableBottom }, end: { x: RIGHT, y: tableBottom }, color: softLine, thickness: 0.8 });

  drawCentered(page, '#', columns[0], columns[1], startY - 18, bold, 7, rose);
  drawCentered(page, 'CANT.', columns[1], columns[2], startY - 18, bold, 6.8, rose);
  page.drawText('DESCRIPCIÓN', { x: columns[2] + 6, y: startY - 18, font: bold, size: 6.8, color: rose });
  drawRight(page, quotation.pricesIncludeVat ? 'PRECIO IVA INCL.' : 'PRECIO UNIT.', columns[4] - 7, startY - 18, bold, 6.3, rose);
  drawRight(page, 'TOTAL', columns[5] - 7, startY - 18, bold, 6.8, rose);

  items.forEach((item, index) => {
    const rowTop = startY - headerHeight - index * rowHeight;
    const baseline = rowTop - 19;
    drawCentered(page, String(itemOffset + index + 1), columns[0], columns[1], baseline, bold, 7, muted);
    drawCentered(page, formatQuantity(item.quantity), columns[1], columns[2], baseline, regular, 7.5);
    const unitText = item.unit && item.unit !== 'unidad' ? ` (${printable(item.unit)})` : '';
    const descriptionLines = wrapText(`${item.description}${unitText}`, regular, 7, columns[3] - columns[2] - 12, 2);
    descriptionLines.forEach((line, lineIndex) => page.drawText(line, {
      x: columns[2] + 6,
      y: rowTop - 13 - lineIndex * 9,
      size: 7,
      font: lineIndex === 0 ? bold : regular,
      color: ink,
    }));
    drawRight(page, formatClp(item.unitPrice), columns[4] - 7, baseline, regular, 7.3);
    drawRight(page, formatClp(item.lineTotal), columns[5] - 7, baseline, bold, 7.3);
  });
  return tableBottom;
}

function drawSummaryAndFooter(
  page: PDFPage,
  quotation: Quotation,
  regular: PDFFont,
  bold: PDFFont,
  tableBottom: number,
) {
  let cursor = tableBottom - 12;

  if (quotation.deliveryDate || quotation.deliveryNote) {
    const note = quotation.deliveryNote || `Entrega: ${formatDate(quotation.deliveryDate)}`;
    page.drawRectangle({ x: LEFT, y: cursor - 31, width: CONTENT_WIDTH, height: 31, color: palePeach });
    page.drawText('ENTREGA', { x: LEFT + 12, y: cursor - 19, size: 6.5, font: bold, color: orange });
    const lines = wrapText(note, regular, 7.3, CONTENT_WIDTH - 83, 2);
    lines.forEach((line, index) => page.drawText(line, { x: LEFT + 70, y: cursor - 14 - index * 9, size: 7.3, font: regular, color: ink }));
    cursor -= 39;
  }

  const summaryRows: Array<[string, number, boolean]> = [
    [quotation.pricesIncludeVat ? 'Subtotal IVA incluido' : 'Subtotal', quotation.totals.subtotal, false],
  ];
  if (quotation.totals.discount > 0) summaryRows.push(['Descuento', -quotation.totals.discount, false]);
  summaryRows.push(['Neto', quotation.totals.net, false]);
  summaryRows.push([`IVA ${Math.round(quotation.vatRate * 100)}%`, quotation.totals.vat, false]);
  summaryRows.push(['TOTAL', quotation.totals.total, true]);

  const summaryLeft = 354;
  const rowHeight = 17;
  const summaryHeight = summaryRows.length * rowHeight;
  const summaryBottom = cursor - summaryHeight;
  page.drawRectangle({ x: summaryLeft, y: summaryBottom, width: RIGHT - summaryLeft, height: summaryHeight, color: paleBlue });
  summaryRows.forEach(([label, value, isTotal], index) => {
    const top = cursor - index * rowHeight;
    if (index > 0) page.drawLine({ start: { x: summaryLeft + 10, y: top }, end: { x: RIGHT - 10, y: top }, color: softLine, thickness: 0.5 });
    const y = top - 11.5;
    page.drawText(label, { x: summaryLeft + 12, y, size: isTotal ? 8 : 7, font: isTotal ? bold : regular, color: isTotal ? blue : muted });
    drawRight(page, formatClp(value), RIGHT - 12, y, isTotal ? bold : regular, isTotal ? 9.5 : 7.2, isTotal ? blue : ink);
  });

  const infoTop = cursor;
  const infoBottom = Math.max(summaryBottom, 90);
  page.drawRectangle({ x: LEFT, y: infoBottom, width: 286, height: infoTop - infoBottom, color: paleGray });
  page.drawText('DATOS PARA TRANSFERENCIA', { x: LEFT + 12, y: infoTop - 17, size: 6.5, font: bold, color: blue });
  const bankLines = [
    'Elizabeth Peper EIRL  |  RUT 77.312.865-0',
    'Banco Falabella  |  Cuenta corriente',
    'Nº 3-101-000183-5',
    'elizabethpeper@yahoo.com',
  ];
  bankLines.forEach((line, index) => page.drawText(line, {
    x: LEFT + 12,
    y: infoTop - 31 - index * 11,
    size: index === 3 ? 7.3 : 7,
    font: index === 0 || index === 2 ? bold : regular,
    color: index === 3 ? blue : ink,
  }));

  const notes: string[] = [];
  if (quotation.paymentTerms) notes.push(`Condiciones de pago: ${quotation.paymentTerms}`);
  if (quotation.notes) notes.push(quotation.notes);
  let notesY = Math.min(summaryBottom, infoBottom) - 15;
  notes.slice(0, 2).forEach((note) => {
    const lines = wrapText(note, regular, 6.7, 260, 2);
    lines.forEach((line) => {
      page.drawText(line, {
      x: LEFT,
      y: notesY,
      size: 6.7,
      font: regular,
      color: muted,
      });
      notesY -= 8;
    });
    notesY -= 6;
  });
}

export async function createQuotationPdf(quotation: Quotation): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(`Cotización ${quotation.quoteNumber}`);
  document.setAuthor('Elizabeth Peper EIRL');
  document.setSubject(`Cotización para ${quotation.customer.legalName}`);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  try {
    logo = await document.embedPng(await fs.readFile(path.join(process.cwd(), 'public', 'logo.png')));
  } catch (error) {
    console.warn('Quotation PDF logo is unavailable:', error);
  }

  const chunks = Array.from(
    { length: Math.ceil(quotation.items.length / ITEMS_PER_PAGE) },
    (_, index) => quotation.items.slice(index * ITEMS_PER_PAGE, (index + 1) * ITEMS_PER_PAGE),
  );
  chunks.forEach((items, pageIndex) => {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const compact = pageIndex > 0;
    const headerBottom = drawHeader(page, quotation, regular, bold, logo, compact);
    const tableBottom = drawItemsTable(page, quotation, regular, bold, items, headerBottom, pageIndex * ITEMS_PER_PAGE);
    if (pageIndex === chunks.length - 1) drawSummaryAndFooter(page, quotation, regular, bold, tableBottom);

    page.drawLine({ start: { x: LEFT, y: 35 }, end: { x: RIGHT, y: 35 }, color: softLine, thickness: 0.6 });
    page.drawText('Gracias por confiar en Elizabeth Peper', { x: LEFT, y: 22, size: 6.5, font: regular, color: muted });
    drawRight(page, `Página ${pageIndex + 1} de ${chunks.length}`, RIGHT, 22, regular, 6.5, muted);
  });
  return document.save();
}
