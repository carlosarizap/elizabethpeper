import { StarIcon, ArchiveBoxIcon } from '@heroicons/react/24/solid';

interface Props {
  topProducts: { product_title: string; cantidad_total: number }[];
  rellenos: Record<string, number>;
}

export default function ProductStatsRow({ topProducts, rellenos }: Props) {
  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* Top productos */}
      <div className="bg-white border rounded-lg shadow p-4 w-full md:w-1/2">
        <h3 className="text-gray-700 text-sm font-semibold flex items-center gap-2 mb-2">
          <StarIcon className="w-5 h-5 text-yellow-400" />
          Top 5 productos más vendidos
        </h3>
        {topProducts?.length > 0 ? (
          <ul className="text-sm list-disc pl-5 text-black">
            {topProducts.map((p, i) => (
              <li key={i}>
                {p.product_title} ({p.cantidad_total} unidades)
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-400">No hay productos vendidos este mes.</p>
        )}
      </div>

      {/* Rellenos */}
      <div className="bg-white border rounded-lg shadow p-4 w-full md:w-1/2">
        <h3 className="text-gray-700 text-sm font-semibold flex items-center gap-2 mb-2">
          <ArchiveBoxIcon className="w-5 h-5 text-blue-500" />
          Rellenos vendidos por medida
        </h3>
        {Object.keys(rellenos || {}).length > 0 ? (
          <ul className="text-sm list-disc pl-5 text-black">
            {Object.entries(rellenos).map(([medida, cantidad], i) => (
              <li key={i}>
                {medida}: {cantidad} unidades
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-400">No se vendieron rellenos este mes.</p>
        )}
      </div>
    </div>
  );
}
