"use client";
import { useEffect, useState } from "react";

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
    <div className="container mx-auto p-4 bg-white text-black shadow rounded-lg">
    <h1 className="text-2xl font-bold mb-4">Órdenes de Mercado Libre</h1>
    <table className="w-full text-sm border border-gray-200">
      <thead className="bg-gray-100">
        <tr>
          <th className="text-left px-2 py-1">CANT</th>
          <th className="text-left px-2 py-1">PRODUCTO</th>
          <th className="text-left px-2 py-1">MARKETPLACE</th>
          <th className="text-left px-2 py-1">ENTREGA</th>
          <th className="px-2 py-1">C</th>
          <th className="px-2 py-1">P</th>
          <th className="px-2 py-1">T</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.id} className="border-t border-gray-200">
            <td className="px-2 py-1">{order.product_quantity}</td>
            <td className="px-2 py-1">{order.product_title}</td>
            <td className="px-2 py-1">{order.marketplace}</td>
            <td className="px-2 py-1">
              {new Date(order.delivery_date).toLocaleDateString("es-CL", {
                weekday: "long",
                day: "numeric",
              })}
            </td>
            <td className="px-2 py-1 text-center"><input type="checkbox" /></td>
            <td className="px-2 py-1 text-center"><input type="checkbox" /></td>
            <td className="px-2 py-1 text-center"><input type="checkbox" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>  
  );
};

export default OrderList;
