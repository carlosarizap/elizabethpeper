// /app/api/boletas/emitir/route.ts
import { generateInvoices } from '@/app/lib/actions/invoice-actions';

export async function POST() {
  await generateInvoices();
  return new Response('Boletas generadas.');
}
