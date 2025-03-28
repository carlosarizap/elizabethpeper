import { getSemilla } from "@/app/lib/sii/getSemilla";
import { firmarSemillaXml } from "@/app/lib/sii/firmarSemilla";
import { generarEnvioBoletas } from "@/app/lib/sii/generarEnvioBoletas";
import { firmarBoletaXml } from "@/app/lib/sii/firmarBoleta";
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST() {
  try {
    // Paso 1: Obtener semilla
    const semilla = await getSemilla();

    // Paso 2: Firmar semilla
    const xmlFirmado = firmarSemillaXml(semilla);

    // Paso 3: Obtener token
    const tokenResponse = await fetch("https://apicert.sii.cl/recursos/v1/boleta.electronica.token", {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: xmlFirmado,
    });

    const tokenText = await tokenResponse.text();
    const match = tokenText.match(/<TOKEN>(.*)<\/TOKEN>/);
    if (!match) {
      console.error("❌ No se pudo obtener el token:", tokenText);
      return NextResponse.json({ error: "Token inválido" }, { status: 500 });
    }

    const token = match[1];

    // Paso 4: Leer y firmar la boleta
    const xmlPath = path.resolve("boletas/boleta-ejemplo.xml");
    const originalXml = fs.readFileSync(xmlPath, "utf-8");

    const firmado = firmarBoletaXml(originalXml);

    // Guardar firmado con encoding correcto
    fs.writeFileSync(xmlPath, firmado, { encoding: "latin1" });

    console.log("✅ Boleta firmada correctamente");

    // Paso 5: Enviar al SII
    const resultado = await generarEnvioBoletas({
      token: token,
      rutEmisor: "76262353",
      dvEmisor: "K",
      rutEnvia: "60803000",
      dvEnvia: "K",
      archivoPath: xmlPath,
    });

    return NextResponse.json({ respuesta: resultado });
  } catch (error) {
    console.error("❌ Error en el flujo de boleta:", error);
    return NextResponse.json({ error: "Error interno en el flujo" }, { status: 500 });
  }
}
