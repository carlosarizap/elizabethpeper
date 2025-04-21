process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { NextResponse } from "next/server";

export async function GET() {
  const urls = [
    "/api/mercadolibre/orders",
    "/api/falabella/orders",
    "/api/ripley/orders",
    "/api/paris/orders",
  ];

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://elizabethpeper.vercel.app/";

  const results = await Promise.all(
    urls.map(async (path) => {
      try {
        const res = await fetch(`${baseUrl}${path}`);
        return { path, status: res.status };
      } catch (error) {
        return { path, error: String(error) };
      }
    })
  );

  return NextResponse.json({ results });
}
