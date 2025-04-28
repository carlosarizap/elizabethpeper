import { fetchAllOrders } from "@/app/lib/data/order-data";
import { NextResponse, NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const page = Number(url.searchParams.get("page") || 1);
    const search = url.searchParams.get("search") || '';
    const marketplace = url.searchParams.get("marketplace") || '';
    const documentType = url.searchParams.get("documentType") || '';
    const deliveryDate = url.searchParams.get("deliveryDate") || '';
    const startDate = url.searchParams.get("startDate") || '';
    const endDate = url.searchParams.get("endDate") || '';
    const hasInvoice = url.searchParams.get("hasInvoice") || '';

    const { orders } = await fetchAllOrders(page, search, marketplace, documentType, deliveryDate, startDate, endDate, hasInvoice);

    return NextResponse.json({ orders });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Error al cargar órdenes." }, { status: 500 });
  }
}
