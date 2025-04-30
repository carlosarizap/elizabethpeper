"use client";

import { useState } from "react";
import Image from "next/image";
import { OrderHeader } from "../lib/definitions/order_header";
import { Marketplace } from "../lib/constants/marketplaces";
import { Fragment } from "react";
import { ArrowUpIcon, ArrowDownIcon } from "@heroicons/react/24/solid"; // 👈 Importa los iconos

interface Props {
  orders: OrderHeader[];
}

const getMarketplaceLogo = (marketplace: Marketplace) => {
  return `/marketplaces/${marketplace}.png`;
};

const OrderTable = ({ orders }: Props) => {
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleSort = () => {
    setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
  };

  const sortedOrders = [...orders].sort((a, b) => {
    const dateA = new Date(a.delivery_date).getTime();
    const dateB = new Date(b.delivery_date).getTime();
    return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
  });

  return (
    <div className="overflow-x-auto mb-7">
      <table className="w-full text-sm border border-gray-300 rounded-md overflow-hidden shadow-sm text-black">
        <thead className="bg-gray-200 text-gray-700">
          <tr>
            <th className="px-3 py-2 text-left">N° Orden</th>
            <th className="px-3 py-2 text-left">Marketplace</th>
            <th className="px-3 py-2 text-left">Total</th>
            <th className="px-3 py-2 text-left">Envío</th>
            <th className="px-3 py-2 text-left">Tipo Doc</th>
            <th className="px-3 py-2 text-left">Estado</th>

            {/* Columna Entrega con icono de orden */}
            <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={handleSort}>
              <div className="flex items-center gap-1">
                Entrega
                {sortOrder === 'asc' ? (
                  <ArrowUpIcon className="w-4 h-4" />
                ) : (
                  <ArrowDownIcon className="w-4 h-4" />
                )}
              </div>
            </th>

            <th className="px-3 py-2 text-center">Boleta</th>
          </tr>
        </thead>

        <tbody>
          {sortedOrders.map((order) => (
            <Fragment key={order.id}>
              <tr className="border-t border-gray-200 bg-white">
                <td className="px-3 py-2">{order.order_id}</td>
                <td className="px-3 py-2">
                  <Image
                    src={getMarketplaceLogo(order.marketplace as Marketplace)}
                    alt={order.marketplace}
                    width={80}
                    height={24}
                    className="object-contain h-[18px] mx-auto"
                  />
                </td>
                <td className="px-3 py-2">${order.total_amount.toLocaleString("es-CL")}</td>
                <td className="px-3 py-2">${order.shipping_amount.toLocaleString("es-CL")}</td>
                <td className="px-3 py-2 capitalize">{order.document_type}</td>
                <td className="px-3 py-2">{order.status}</td>
                <td className="px-3 py-2">
                  {new Date(order.delivery_date).toLocaleDateString("es-CL")}
                </td>
                <td className="px-3 py-2 text-center">
                  {order.has_invoice ? (
                    <a
                      href={`/api/orders/invoice/download/${order.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-green-500 hover:bg-green-600 text-white font-semibold py-1 px-2 rounded text-xs"
                    >
                      Descargar
                    </a>
                  ) : (
                    <span className="text-gray-400 text-xs">Sin boleta</span>
                  )}
                </td>
              </tr>

              {/* Detalle productos */}
              <tr className="bg-gray-50">
                <td colSpan={8} className="px-4 py-3 text-sm text-gray-700">
                  {order.details.length > 0 ? (
                    <ul className="list-disc pl-6">
                      {order.details.map((detail) => (
                        <li key={detail.id}>
                          {detail.product_quantity} - {detail.product_title}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-400">Sin productos</p>
                  )}
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default OrderTable;
