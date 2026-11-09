import type { Metadata } from 'next';
import QuotesModule from '@/app/components/QuotesModule';

export const metadata: Metadata = {
  title: 'Elizabeth Peper - Cotizaciones',
};

export default function QuotesPage() {
  return <QuotesModule />;
}

