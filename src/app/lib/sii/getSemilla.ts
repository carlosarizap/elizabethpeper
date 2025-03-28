export async function getSemilla() {
    const response = await fetch("https://apicert.sii.cl/recursos/v1/boleta.electronica.semilla", {
      method: "GET",
      headers: {
        Accept: "application/xml",
      },
    });
  
    const xml = await response.text();
    const match = xml.match(/<SEMILLA>(.*)<\/SEMILLA>/);
  
    if (!match) throw new Error("No se pudo obtener la semilla del SII");
  
    return match[1];
  }
  