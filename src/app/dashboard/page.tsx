import DashboardContainer from '@/app/components/DashboardContainer';
import { Metadata } from 'next';

export const metadata: Metadata = {
    title: "Elizabeth Peper - Dashboard",
  
  };

export default function DashboardPage() {
  return (
    <main className="p-6 bg-white">
      <h1 className="text-2xl font-bold mb-4 text-gray-700">Dashboard de Ventas</h1>
      <DashboardContainer />
    </main>
  );
}
