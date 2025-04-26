// /app/api/boletas/emitir/route.ts
import { generateInvoices } from '@/app/lib/actions/invoice-actions';
import { uploadInvoicesToMercadoLibre } from '@/app/lib/mercadolibre/invoice-uploader';

export async function POST() {
  await generateInvoices();
  await uploadInvoicesToMercadoLibre();
  return new Response('Boletas generadas.');
}
