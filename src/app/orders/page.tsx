"use client";

import { useEffect, useState } from "react";
import { OrderHeader } from "../lib/definitions/order_header";
import Pagination from "../components/Pagination";
import OrderTable from "../components/OrderTable";

const PAGE_SIZE = 10;

const OrderMaintainer = () => {
    const [orders, setOrders] = useState<OrderHeader[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [loading, setLoading] = useState(true);

    const fetchOrders = async () => {
        try {
            const res = await fetch("/api/orders/all");
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
    }, []);

    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const currentOrders = orders.slice(startIndex, startIndex + PAGE_SIZE);

    if (loading) return <p className="text-center mt-5">Cargando órdenes...</p>;

    return (
        <div className="min-h-screen bg-white p-6 rounded-lg shadow-md">
            <h1 className="text-2xl font-bold mb-6 text-black">Mantenedor de Órdenes</h1>

            <OrderTable orders={currentOrders} />

            <Pagination
                currentPage={currentPage}
                totalPages={Math.ceil(orders.length / PAGE_SIZE)}
                onPageChange={(page) => setCurrentPage(page)}
            />
        </div>
    );
};

export default OrderMaintainer;
