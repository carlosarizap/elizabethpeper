import { Metadata } from "next";
import OrderList from "./components/OrderList";

export const metadata: Metadata = {
  title: "Elizabeth Peper - Órdenes",

};

export default function Home() {
  return (
    <main className="min-h-screen p-0 sm:p-6 bg-white sm:bg-gray-100 print:bg-white">
      <OrderList />
    </main>
  );
}