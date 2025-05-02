import Image from "next/image";

interface Props {
  data: { marketplace: string; total_ventas: string; total_ordenes: number }[];
  totalVentas: number;
}

export default function MarketplaceCards({ data, totalVentas }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {/* Tarjeta de total */}
      <div className="bg-white  border rounded-lg shadow p-4 text-center col-span-2 md:col-span-4">
        <p className="text-lg text-gray-700 font-semibold mb-1">Total del Mes</p>
        <p className="text-2xl text-black font-bold">
          ${totalVentas.toLocaleString('es-CL')}
        </p>
      </div>

      {/* Tarjetas de marketplaces */}
      {data.map((m) => (
        <div key={m.marketplace} className="bg-white border rounded-lg shadow p-4 text-center">
          <Image
            src={`/marketplaces/${m.marketplace}.png`}
            alt={m.marketplace}
            width={100}
            height={30}
            className="object-contain h-[20px] mx-auto mb-2"
          />
          <p className="text-xl font-bold text-black">
            ${parseInt(m.total_ventas).toLocaleString('es-CL')}
          </p>
          <p className="text-gray-500 text-sm">
            {m.total_ordenes} ventas
          </p>
        </div>
      ))}
    </div>
  );
}
