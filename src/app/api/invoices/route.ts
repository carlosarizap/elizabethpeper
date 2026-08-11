// /app/api/boletas/emitir/route.ts
import { generateInvoices } from '@/app/lib/actions/invoice-actions';
import { uploadInvoicesToFalabella } from '@/app/lib/falabella/invoice-uploader';
import { uploadInvoicesToMercadoLibre } from '@/app/lib/mercadolibre/invoice-uploader';
import { uploadInvoicesToParis } from '@/app/lib/paris/invoice-uploader';
import { uploadInvoicesToRipley } from '@/app/lib/ripley/invoice-uploader';
import { uploadInvoicesToShopify } from '@/app/lib/shopify/invoice-uploader';

export async function POST() {
  await generateInvoices();
  await uploadInvoicesToMercadoLibre();
  await uploadInvoicesToFalabella();
  await uploadInvoicesToParis();
  await uploadInvoicesToRipley();
  await uploadInvoicesToShopify();

  return new Response('Documentos tributarios emitidos y PDF guardados correctamente.');
}
