"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { Marketplace } from "../lib/constants/marketplaces";
import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { OrderHeader } from "../lib/definitions/order_header";
import LoadingSpinner from "../components/LoadingSpinner";

const getMarketplaceLogo = (marketplace: Marketplace) => {
  return `/marketplaces/${marketplace}.png`;
};

const OrderList = () => {
  const [orders, setOrders] = useState<OrderHeader[]>([]);
  const [rellenos, setRellenos] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const fetchOrders = async () => {
    try {
      const res = await fetch("/api/orders");
      const data = await res.json();
      setOrders(data.orders || []);
      setRellenos(data.rellenos || {});
    } catch (error) {
      console.error("Error al cargar órdenes:", error);
    } finally {
      setLoading(false);
    }
  };

  const importarOrdenes = async () => {
    setImporting(true);
    try {
      const apis = [
        "/api/mercadolibre/orders",
        "/api/falabella/orders",
        "/api/ripley/orders",
        "/api/paris/orders",
      ];

      for (const api of apis) {
        await fetch(api);
      }

      await fetchOrders(); // Refrescar las órdenes
    } catch (error) {
      console.error("Error importando órdenes:", error);
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  if (loading) return <div className="mt-6"><LoadingSpinner /></div>;

  return (
    <div className="p-0 sm:p-6 bg-white text-black rounded-lg print:shadow-none print:p-0 print:bg-white font-sans">
      {/* Logo y botón */}
      <div className="flex justify-between items-center mb-6 px-4 sm:px-0">
        <h1 className="text-lg font-bold mb-2 print:hidden">
          ELIZABETH PEPER
        </h1>
        <Image
          src="/logo.png"
          alt="Logo Empresa"
          width={70}
          height={70}
          className="rounded-full border border-gray-300"
        />
        <button
          onClick={importarOrdenes}
          disabled={importing}
          className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded shadow hover:bg-blue-700 disabled:opacity-50 font-semibold print:hidden"
        >
          <ArrowPathIcon
            className={`w-5 h-5 ${importing ? "animate-spin" : ""}`}
          />
          {importing ? "Importando..." : "Refrescar"}
        </button>
      </div>

      {/* Tabla de órdenes */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-gray-300 rounded-md overflow-hidden shadow-sm print:shadow-none">
          <thead className="bg-gray-300 text-gray-800 border-b border-gray-500 print:bg-gray-300 print:border-b print:border-gray-500 print:text-black">
            <tr>
              <th className="px-2 py-1 text-left print:py-0.5">CANT</th>
              <th className="px-2 py-1 text-left print:py-0.5">PRODUCTO</th>
              <th className="px-2 py-1 text-left print:py-0.5">MARKETPLACE</th>
              <th className="px-2 py-1 text-left print:py-0.5">CÓDIGO</th>
              <th className="px-2 py-1 text-left print:py-0.5">ENTREGA</th>
              <th className="px-1 py-1 text-center hidden sm:table-cell print:py-0.5">C</th>
              <th className="px-1 py-1 text-center hidden sm:table-cell print:py-0.5">P</th>
              <th className="px-1 py-1 text-center hidden sm:table-cell print:py-0.5">T</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 print:divide-gray-400">
            {orders.map((orderHeader, orderIndex) => {
              const isRelleno = orderHeader.details.some(detail =>
                detail.product_title.toLowerCase().includes('relleno')
              );
              const rowClassBase = `
      ${orderIndex % 2 === 0 ? "bg-white print:bg-white" : "bg-gray-50 print:bg-gray-100"} 
${isRelleno ? "bg-yellow-300 print:bg-yellow-100" : ""}
      border-t border-gray-200 print:border-gray-400 print:text-xs print:h-[20px]
    `;

              return orderHeader.details.map((detail, detailIndex) => (
                <tr key={detail.id} className={rowClassBase}>
                  <td className="px-2 py-1 print:py-0.5">{detail.product_quantity}</td>
                  <td className="px-2 py-1 print:py-0.5">{detail.product_title}</td>

                  {detailIndex === 0 && (
                    <>
                      <td
                        className="px-2 py-1 print:py-0.5"
                        rowSpan={orderHeader.details.length}
                      >
                        <Image
                          src={getMarketplaceLogo(orderHeader.marketplace as Marketplace)}
                          alt={orderHeader.marketplace}
                          width={80}
                          height={24}
                          className="object-contain h-[18px] mx-auto"
                        />
                      </td>

                      <td
                        className="px-2 py-1 print:py-0.5"
                        rowSpan={orderHeader.details.length}
                      >
                        {orderHeader.order_id.split("-")[0]}
                      </td>

                      <td
                        className="px-2 py-1 print:py-0.5"
                        rowSpan={orderHeader.details.length}
                      >
                        {new Date(orderHeader.delivery_date).toLocaleDateString("es-CL", {
                          weekday: "long",
                          day: "numeric"
                        })}
                      </td>
                    </>
                  )}

                  <td className="px-1 py-1 text-center hidden sm:table-cell print:py-0.5">
                    <input type="checkbox" />
                  </td>
                  <td className="px-1 py-1 text-center hidden sm:table-cell print:py-0.5">
                    <input type="checkbox" />
                  </td>
                  <td className="px-1 py-1 text-center hidden sm:table-cell print:py-0.5">
                    <input type="checkbox" />
                  </td>
                </tr>
              ));
            })}
          </tbody>

        </table>
      </div>

      {/* Rellenos */}
      {rellenos && (
        <div className="mt-10">
          <h2 className="text-lg font-bold mb-2">Rellenos Totales</h2>
          <table className="w-full text-sm border border-gray-300 rounded-md overflow-hidden shadow-sm">
            <thead className="bg-gray-200 text-gray-700">
              <tr>
                <th className="px-3 py-2 text-left">Tamaño</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(rellenos).map(([medida, cantidad]) => (
                <tr key={medida} className="border-t  border-gray-200">
                  <td className="px-3 py-2">{medida}</td>
                  <td className="px-3 py-2 text-right">{cantidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default OrderList;