"use client";
import { useEffect, useState } from "react";

interface Order {
  id: number;
  total_amount: number;
  status: string;
  date_created: string;
  items: { title: string; quantity: number }[];
}

const OrderList = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await fetch("/api/mercadolibre/orders");

        console.log(res)
        const data = await res.json();
        setOrders(data);
      } catch (error) {
        console.error("Error fetching orders:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, []);

  if (loading) return <p className="text-center mt-5">Cargando órdenes...</p>;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Órdenes de Mercado Libre</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <table className="w-full table-auto">
          <thead>
            <tr>
              <th className="text-left">CANT</th>
              <th className="text-left">PRODUCTO</th>
              <th>C</th>
              <th>P</th>
              <th>T</th>
            </tr>
          </thead>
          <tbody>
           
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OrderList;
