import DashboardContainer from '@/app/components/DashboardContainer';
import { Metadata } from 'next';

export const metadata: Metadata = {
    title: "Elizabeth Peper - Dashboard",
  
  };

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">
            Elizabeth Peper
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Dashboard de ventas
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Revisa el rendimiento mensual, las devoluciones y la evolución diaria de todos tus marketplaces.
          </p>
        </div>
        <DashboardContainer />
      </div>
    </main>
  );
}
