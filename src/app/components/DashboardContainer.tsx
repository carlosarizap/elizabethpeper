'use client';

import { useEffect, useState } from 'react';
import DashboardFilters from './DashboardFilters';
import MarketplaceCards from './MarketplaceCards';
import ProductStatsRow from './ProductStatsRow';
import LoadingSpinner from './LoadingSpinner';
import DashboardSummaryCards from './DashboardSummaryCards';
import DailySalesChart from './DailySalesChart';
import ReturnsOverview from './ReturnsOverview';
import OperationsOverview from './OperationsOverview';
import { DashboardStats } from '@/app/lib/definitions/dashboard';

export default function DashboardContainer() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  useEffect(() => {
    const controller = new AbortController();

    const fetchStats = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/orders/stats?year=${year}&month=${month}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('No fue posible cargar las estadísticas');
        const data: DashboardStats = await res.json();
        setStats(data);
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') return;
        console.error('Error al cargar estadísticas:', fetchError);
        setError('No pudimos cargar la información del período seleccionado.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchStats();
    return () => controller.abort();
  }, [year, month]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <DashboardFilters month={month} setMonth={setMonth} year={year} setYear={setYear} />
      </div>

      {loading ? <LoadingSpinner /> : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {!loading && !error && stats ? (
        <>
          <DashboardSummaryCards summary={stats.summary} />
          <DailySalesChart data={stats.dailySales} />
          <MarketplaceCards data={stats.marketplaces} />
          <ReturnsOverview
            summary={stats.summary}
            byMarketplace={stats.returnsByMarketplace}
            products={stats.returnedProducts}
          />
          <OperationsOverview
            statuses={stats.statusDistribution}
            documents={stats.documents}
          />
          <ProductStatsRow topProducts={stats.topProducts} rellenos={stats.rellenos} />
        </>
      ) : null}
    </div>
  );
}
