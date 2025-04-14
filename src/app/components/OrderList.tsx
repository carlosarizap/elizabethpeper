"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { Marketplace } from "../lib/constants/marketplaces";

const getMarketplaceLogo = (marketplace: Marketplace) => {
  return `/marketplaces/${marketplace}.png`;
};

const OrderList = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await fetch("/api/orders");
        const data = await res.json();
        setOrders(data);
      } catch (error) {
        console.error("Error al cargar órdenes:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, []);

  if (loading) return <p className="text-center mt-5">Cargando órdenes...</p>;

  return (
    <div className="p-6 bg-white text-black rounded-lg print:shadow-none print:p-0 print:bg-white font-sans">
      {/* Logo central */}
      <div className="flex justify-center mb-6">
        <Image
          src="/logo.png"
          alt="Logo Empresa"
          width={70}
          height={70}
          className="rounded-full border border-gray-300"
        />
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-gray-300 rounded-md overflow-hidden shadow-sm print:shadow-none">
          <thead className="bg-gray-300 text-gray-800 border-b border-gray-500 print:bg-gray-300 print:border-b print:border-gray-500 print:text-black">
            <tr>
              <th className="px-2 py-1 text-left print:py-0.5">CANT</th>
              <th className="px-2 py-1 text-left print:py-0.5">PRODUCTO</th>
              <th className="px-2 py-1 text-left print:py-0.5">MARKETPLACE</th>
              <th className="px-2 py-1 text-left print:py-0.5">ENTREGA</th>
              <th className="px-1 py-1 text-center print:py-0.5">C</th>
              <th className="px-1 py-1 text-center print:py-0.5">P</th>
              <th className="px-1 py-1 text-center print:py-0.5">T</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 print:divide-gray-400">
            {orders.map((order, index) => (
              <tr
                key={order.id}
                className={`${index % 2 === 0 ? "bg-white print:bg-white" : "bg-gray-50 print:bg-gray-100"
                  } border-t border-gray-200 print:border-gray-400 print:text-xs print:h-[20px]`}
              >
                <td className="px-2 py-1 print:py-0.5">{order.product_quantity}</td>
                <td className="px-2 py-1 print:py-0.5">{order.product_title}</td>
                <td className="px-2 py-1 print:py-0.5">
                  <Image
                    src={getMarketplaceLogo(order.marketplace as Marketplace)}
                    alt={order.marketplace}
                    width={80}
                    height={24}
                    className="object-contain h-[18px] mx-auto"
                  />
                </td>
                <td className="px-2 py-1 print:py-0.5">
                  {new Date(order.delivery_date.split("T")[0] + "T12:00:00Z").toLocaleDateString("es-CL", {
                    weekday: "long",
                    day: "numeric",
                  })}
                </td>
                <td className="px-1 py-1 text-center print:py-0.5"><input type="checkbox" /></td>
                <td className="px-1 py-1 text-center print:py-0.5"><input type="checkbox" /></td>
                <td className="px-1 py-1 text-center print:py-0.5"><input type="checkbox" /></td>
              </tr>

            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OrderList;
