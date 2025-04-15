
import { SignedXml } from "xml-crypto";
import { DOMParser } from "xmldom";
import fs from "fs";
import path from "path";

// Leer la llave privada y el certificado sin metadatos
const privateKey = fs.readFileSync(path.resolve("certs/private.key"), "utf-8");
const publicCert = fs.readFileSync(path.resolve("certs/certificate.crt"), "utf-8");

// Limpiar el certificado
const certBase64 = publicCert
  .replace("-----BEGIN CERTIFICATE-----", "")
  .replace("-----END CERTIFICATE-----", "")
  .replace(/\r?\n|\r/g, "")
  .trim(); // Solo la parte codificada en base64

// Personalizar la sección <KeyInfo>
class CustomKeyInfo {
  getKeyInfo(): string {
    return `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;
  }

  getKey(): null {
    return null;
  }
}

export function firmarSemillaXml(semilla: string): string {
  const xmlOriginal = `<?xml version="1.0" encoding="UTF-8"?><getToken Id="_0"><item><Semilla>${semilla}</Semilla></item></getToken>`;
  const doc = new DOMParser().parseFromString(xmlOriginal);

  const sig = new SignedXml();
  sig.addReference(
    "//*[@Id='_0']",
    ["http://www.w3.org/2000/09/xmldsig#enveloped-signature"],
    "http://www.w3.org/2000/09/xmldsig#sha1"
  );

  sig.signingKey = privateKey;
  sig.keyInfoProvider = new CustomKeyInfo() as any;

  sig.computeSignature(xmlOriginal, {
    location: { reference: "", action: "append" },
    prefix: "",
  });

  const signedXml = sig.getSignedXml();

  return signedXml;
}
