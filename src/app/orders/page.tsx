"use client";

import { useEffect, useState } from "react";
import { OrderHeader } from "../lib/definitions/order_header";
import Pagination from "../components/Pagination";
import OrderTable from "../components/OrderTable";
import OrderFilters, { Filters } from "../components/OrderFilters";
import LoadingSpinner from "../components/LoadingSpinner"; // 👈 Importar el spinner

const PAGE_SIZE = 10;

const OrderMaintainer = () => {
  const [orders, setOrders] = useState<OrderHeader[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({
    search: "",
    marketplace: "",
    documentType: "",
    deliveryDate: "",
    startDate: "",
    endDate: "",
    hasInvoice: "",
  });
  
  const fetchOrders = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        search: filters.search,
        marketplace: filters.marketplace,
        documentType: filters.documentType,
        deliveryDate: filters.deliveryDate,
        startDate: filters.startDate,
        endDate: filters.endDate,
        hasInvoice: filters.hasInvoice,
      });
      const res = await fetch(`/api/orders/all?${params.toString()}`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (error) {
      console.error("Error al cargar órdenes:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    setCurrentPage(1); // Siempre volver a página 1 al aplicar filtros
  }, [filters]);

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const currentOrders = orders.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <div className="min-h-screen bg-white p-6 rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-6 text-black">Mantenedor de Órdenes</h1>

      <OrderFilters onFilterChange={setFilters} />


      
      {loading ? <LoadingSpinner /> : <OrderTable orders={currentOrders} />}

      <Pagination
        currentPage={currentPage}
        totalPages={Math.ceil(orders.length / PAGE_SIZE)}
        onPageChange={(page) => setCurrentPage(page)}
      />
    </div>
  );
};

export default OrderMaintainer;
