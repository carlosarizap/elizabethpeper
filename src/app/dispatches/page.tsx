import type { Metadata } from 'next';
import DispatchCenter from '@/app/components/DispatchCenter';

export const metadata: Metadata = {
  title: 'Elizabeth Peper - Despachos',
};

export default function DispatchesPage() {
  return <DispatchCenter />;
}
