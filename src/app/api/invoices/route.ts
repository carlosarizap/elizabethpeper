// /app/api/boletas/emitir/route.ts
import { generateInvoices } from '@/app/lib/actions/invoice-actions';
import { uploadInvoicesToFalabella } from '@/app/lib/falabella/invoice-uploader';
import { uploadInvoicesToMercadoLibre } from '@/app/lib/mercadolibre/invoice-uploader';

export async function POST() {
  //await generateInvoices();
  //await uploadInvoicesToMercadoLibre();
  await uploadInvoicesToFalabella();
  return new Response('Boletas generadas.');
}
