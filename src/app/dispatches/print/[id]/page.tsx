import DispatchPrintView from '@/app/components/DispatchPrintView';

export default async function DispatchPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DispatchPrintView batchId={id} />;
}
