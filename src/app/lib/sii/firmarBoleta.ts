import { SignedXml } from "xml-crypto";
import { DOMParser, XMLSerializer } from "xmldom";
import fs from "fs";
import path from "path";
import * as xpath from "xpath";

const privateKey = fs.readFileSync(path.resolve("certs/private.key"), "utf-8");
const publicCert = fs.readFileSync(path.resolve("certs/certificate.crt"), "utf-8");

const certBase64 = publicCert
  .replace("-----BEGIN CERTIFICATE-----", "")
  .replace("-----END CERTIFICATE-----", "")
  .replace(/\r?\n|\r/g, "")
  .trim();

class CustomKeyInfo {
  getKeyInfo(): string {
    return `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;
  }
  getKey(): null {
    return null;
  }
}

export function firmarBoletaXml(xmlContent: string): string {
  const doc = new DOMParser().parseFromString(xmlContent, "text/xml");

  const select = xpath.useNamespaces({ sii: "http://www.sii.cl/SiiDte" });
  const documentoNode = select("//sii:Documento", doc)[0] as Element;

  if (!documentoNode) {
    throw new Error("❌ No se encontró el nodo <Documento> para firmar");
  }

  if (!documentoNode.getAttribute("ID")) {
    documentoNode.setAttribute("ID", "F1T1");
  }

  // Agregar TmstFirma
  const fecha = new Date().toISOString();
  const tmstNode = doc.createElement("TmstFirma");
  tmstNode.appendChild(doc.createTextNode(fecha));
  documentoNode.appendChild(tmstNode);

  const sig = new SignedXml();
  sig.canonicalizationAlgorithm = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"; // obligatorio para SII
  sig.signatureAlgorithm = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";

  sig.addReference(
    "//*[@ID='F1T1']",
    ["http://www.w3.org/2000/09/xmldsig#enveloped-signature"],
    "http://www.w3.org/2000/09/xmldsig#sha1"
  );

  sig.signingKey = privateKey;
  sig.keyInfoProvider = new CustomKeyInfo() as any;

  sig.computeSignature(new XMLSerializer().serializeToString(doc), {
    location: { reference: "//*[local-name()='Documento']", action: "append" },
  });

  return sig.getSignedXml();
}
