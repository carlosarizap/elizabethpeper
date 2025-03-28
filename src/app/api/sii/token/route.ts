import { getSemilla } from "@/app/lib/sii/getSemilla";
import { firmarSemillaXml } from "@/app/lib/sii/firmarSemilla";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const semilla = await getSemilla();
    const xmlFirmado = firmarSemillaXml(semilla);

    const response = await fetch("https://apicert.sii.cl/recursos/v1/boleta.electronica.token", {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: xmlFirmado,
    });

    const text = await response.text();
    const match = text.match(/<TOKEN>(.*)<\/TOKEN>/);

    if (!match) {
      console.error("Respuesta del SII:", text);
      return NextResponse.json({ error: "No se pudo obtener token" }, { status: 500 });
    }

    return NextResponse.json({ token: match[1] });
  } catch (error) {
    console.error("Error al obtener token:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
