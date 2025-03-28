import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";

interface EnvioParams {
  token: string;
  rutEmisor: string;
  dvEmisor: string;
  rutEnvia: string;
  dvEnvia: string;
  archivoPath: string;
}

export async function generarEnvioBoletas({
  token,
  rutEmisor,
  dvEmisor,
  rutEnvia,
  dvEnvia,
  archivoPath,
}: EnvioParams) {
  const form = new FormData();
  form.append("rutSender", rutEnvia);
  form.append("dvSender", dvEnvia);
  form.append("rutCompany", rutEmisor);
  form.append("dvCompany", dvEmisor);
  form.append("archivo", fs.createReadStream(path.resolve(archivoPath)));

  try {
    const response = await axios.post(
      "https://apicert.sii.cl/recursos/v1/boleta.electronica.envio",
      form,
      {
        headers: {
          Cookie: `TOKEN=${token}`,
          "User-Agent": "Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)",
          ...form.getHeaders(),
        },
      }
    );

    return response.data;
  } catch (error: any) {
    if (error.response) {
      console.error("❌ Error al enviar al SII:");
      console.error("👉 Código HTTP:", error.response.status);
      console.error("👉 Headers:", error.response.headers);
      console.error("👉 Respuesta SII:\n", error.response.data);
    } else {
      console.error("❌ Error sin respuesta del servidor:", error.message);
    }
    throw error;
  }

}
