'use client';

import { useEffect, useState } from 'react';
import DashboardFilters from './DashboardFilters';
import MarketplaceCards from './MarketplaceCards';
import ProductStatsRow from './ProductStatsRow';
import LoadingSpinner from './LoadingSpinner';

export default function DashboardContainer() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);


useEffect(() => {
  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/stats?year=${year}&month=${month}`);
      const data = await res.json();
      setStats(data);
    } catch (error) {
      console.error("Error al cargar estadísticas:", error);
    } finally {
      setLoading(false);
    }
  };


  fetchStats();
}, [year, month]);




if (loading) return <LoadingSpinner />;

const totalVentas = stats
  ? stats.marketplaces.reduce(
      (acc: number, m: any) => acc + parseInt(m.total_ventas),
      0
    )
  : 0;

  return (
    <div className="bg-gray-100 p-5 rounded-lg shadow-sm mb-6">
      <DashboardFilters month={month} setMonth={setMonth} year={year} setYear={setYear} />
      <MarketplaceCards data={stats.marketplaces} totalVentas={totalVentas} />
      <ProductStatsRow topProducts={stats.topProducts} rellenos={stats.rellenos} />
    </div>
  );
}
