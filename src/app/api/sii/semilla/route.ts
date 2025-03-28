import { getSemilla } from "@/app/lib/sii/getSemilla";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const semilla = await getSemilla();
    return NextResponse.json({ semilla });
  } catch (error) {
    console.error("Error al obtener semilla:", error);
    return NextResponse.json({ error: "No se pudo obtener la semilla" }, { status: 500 });
  }
}
