'use client';

import { useEffect, useState } from 'react';
import DashboardFilters from './DashboardFilters';
import MarketplaceCards from './MarketplaceCards';
import ProductStatsRow from './ProductStatsRow';

export default function DashboardContainer() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/orders/stats?year=${year}&month=${month}`)
      .then(res => res.json())
      .then(setStats);
  }, [year, month]);

  if (!stats) return <p className="text-gray-500 text-sm">Cargando estadísticas...</p>;

  return (
    <div className="bg-gray-100 p-5 rounded-lg shadow-sm mb-6">
      <DashboardFilters month={month} setMonth={setMonth} year={year} setYear={setYear} />
      <MarketplaceCards data={stats.marketplaces} />
      <ProductStatsRow topProducts={stats.topProducts} rellenos={stats.rellenos} />
    </div>
  );
}
