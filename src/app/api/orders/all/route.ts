process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { fetchAllOrders } from "@/app/lib/data/order-data";
import { NextResponse, NextRequest } from "next/server"; // 👈 Importa NextRequest

export async function GET(req: NextRequest) { // 👈 Usa NextRequest aquí
  try {
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || 1);
    const query = url.searchParams.get("query") || '';

    const { orders } = await fetchAllOrders(page, query);
    return NextResponse.json({ orders });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Error al cargar órdenes." }, { status: 500 });
  }
}