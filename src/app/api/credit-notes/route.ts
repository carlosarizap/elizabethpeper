import { generateCreditNotes } from '@/app/lib/actions/invoice-actions';

export async function POST() {
  await generateCreditNotes();

  return new Response(
    'Nota de CrÃ©dito preparada hasta la vista previa del SII.',
  );
}
