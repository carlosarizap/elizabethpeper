import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';

interface ProductSummaryBlockOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  orderId: string;
  productSummary: string | null | undefined;
  regularFont: PDFFont;
  boldFont: PDFFont;
  bodyFontSize?: number;
  maxLines?: number;
}

function printableText(value: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  return [...value]
    .map((character) => {
      if (character === '\n' || character === '\r') return '\n';
      const normalized = character
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/\u00b7/g, ' - ');
      return [...normalized]
        .map((candidate) => supported.has(candidate.codePointAt(0) ?? -1) ? candidate : '?')
        .join('');
    })
    .join('')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t\f\v ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function wrapPdfText(
  value: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const paragraphs = printableText(value, font).split('\n').filter(Boolean);
  const lines: string[] = [];
  let truncated = false;

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    const words = paragraph.split(' ').filter(Boolean);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = '';
      }
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }

      let remainingWord = word;
      while (remainingWord && font.widthOfTextAtSize(remainingWord, fontSize) > maxWidth) {
        let splitAt = remainingWord.length - 1;
        while (
          splitAt > 1
          && font.widthOfTextAtSize(`${remainingWord.slice(0, splitAt)}-`, fontSize) > maxWidth
        ) {
          splitAt -= 1;
        }
        lines.push(`${remainingWord.slice(0, splitAt)}-`);
        remainingWord = remainingWord.slice(splitAt);
        if (lines.length >= maxLines) {
          truncated = true;
          break;
        }
      }
      current = remainingWord;
    }
    if (truncated) break;
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length >= maxLines && paragraphIndex < paragraphs.length - 1) {
      truncated = true;
      break;
    }
  }

  if (truncated && lines.length > 0) {
    let last = lines.at(-1) ?? '';
    while (last && font.widthOfTextAtSize(`${last}...`, fontSize) > maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    lines[lines.length - 1] = `${last}...`;
  }
  return lines;
}

export function drawProductSummaryBlock(
  page: PDFPage,
  options: ProductSummaryBlockOptions,
): void {
  const padding = 5;
  const headingSize = Math.max(6.5, (options.bodyFontSize ?? 7) + 0.5);
  const bodySize = options.bodyFontSize ?? 7;
  const lineHeight = bodySize + 1.2;
  const heading = printableText(`CONTENIDO - ORDEN ${options.orderId}`, options.boldFont);
  const summary = options.productSummary?.trim() || 'Sin detalle de productos';
  const maxTextWidth = options.width - padding * 2;
  const availableBodyHeight = options.height - padding * 2 - headingSize - 3;
  const maxLines = Math.min(
    options.maxLines ?? Number.POSITIVE_INFINITY,
    Math.max(1, Math.floor(availableBodyHeight / lineHeight)),
  );
  const lines = wrapPdfText(
    summary,
    options.regularFont,
    bodySize,
    maxTextWidth,
    maxLines,
  );

  page.drawText(heading, {
    x: options.x + padding,
    y: options.y + options.height - padding - headingSize,
    size: headingSize,
    font: options.boldFont,
    color: rgb(0.05, 0.09, 0.16),
  });

  let lineY = options.y + options.height - padding - headingSize - 3 - bodySize;
  for (const line of lines) {
    page.drawText(line, {
      x: options.x + padding,
      y: lineY,
      size: bodySize,
      font: options.regularFont,
      color: rgb(0.05, 0.09, 0.16),
    });
    lineY -= lineHeight;
  }
}
