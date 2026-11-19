# Despachos Walmart Chile

Las órdenes con `isWCPOrder: true` preparan sus bultos antes de imprimir. Las órdenes anteriores conservan su descarga por seguimiento.

## Pantalla

En Despachos, seleccionar las órdenes y pulsar **Preparar e imprimir**. Para Walmart WCP aparece el contenido y las dimensiones de los bultos propuestos. Se pueden añadir o quitar bultos, repartir las cantidades y editar largo, ancho, alto (cm) y peso (kg). La suma de las cantidades debe coincidir exactamente con la compra. No se crea ninguna etiqueta al abrir o cancelar esta pantalla.

Las medidas se proponen a partir de los atributos de embalaje de la variante vinculada en Mercado Libre. Cuando no están disponibles, se utiliza el peso Shopify y los perfiles de cojines ya usados en las publicaciones. Para telas dobladas se proponen dimensiones compactas por categoría, identificadas como estimaciones. No se usan las dimensiones Falabella. Los límites de agrupación de 60 cm de alto y 20 kg son criterios editables de la propuesta, no límites oficiales de Walmart.

Seis caminos CAM7 se proponen en un bulto de 30 x 22 x 12 cm y 1,8 kg (Shopify registra 0,3 kg por unidad). Para seis cojines rellenos de 60 x 60, el perfil propone dos bultos de tres unidades. Los packs se cuentan como unidades comerciales, sin descomponer sus piezas.

## API y persistencia

- `GET /api/dispatches/walmart/[id]/packages`: consulta fresca de la orden, referencias de embalaje, propuesta o plan guardado.
- `POST /api/dispatches/print`: acepta `walmartPackages`, indexado por UUID de `order_header`. Cada bulto contiene `items: [{ lineNumber, quantity }]` y `packaging: { lengthCm, widthCm, heightCm, weightKg, source }`.
- Se consulta `GET /v3/shipping/labels/purchase-orders/{purchaseOrderId}` antes de crear etiquetas.
- Se crea una etiqueta por bulto con `POST /v3/shipping/labels`, `CUSTOM_PACKAGE`, unidades CM/KG y `boxItems` con SKU, línea y cantidad. Para Chile doméstico no se fuerza el transportista internacional.
- Se utiliza el PDF base64 de `shippingDocuments`; si falta, se descarga por seguimiento mediante `/v3/orders/labels`.
- Las etiquetas WCP domésticas de 288 x 576 puntos se recortan a su zona de transporte y logo, excluyendo los metadatos de integración; se agrupan hasta cuatro por hoja carta, con el contenido inmediatamente debajo de cada etiqueta. Otros formatos WCP se conservan completos, alineados arriba y con su contenido debajo. Las etiquetas anteriores conservan su composición histórica.

La migración `20261119_add_walmart_dispatch_labels.sql` agrega `walmart_dispatch_label`. Se guarda el plan completo antes del primer POST. Un bloqueo de sesión PostgreSQL evita la creación simultánea para una misma orden. Cada bulto pasa por `planned`, `creating`, `ready`, `failed` o `uncertain`. La reimpresión usa los PDFs guardados. El contenido queda bloqueado cuando existe una etiqueta creada o una respuesta ambigua; un rechazo definitivo de todos los bultos permite corregir el plan.

Ante un timeout o un error ambiguo no se repite el POST. El siguiente intento consulta las etiquetas remotas y concilia por SKU, línea y cantidad; si no puede confirmar el resultado, informa que el envío necesita revisión. No se marca una orden como enviada por imprimirla.

## Validación

La orden real `809132497955306` generó correctamente una etiqueta con seis CAM7 en un bulto. El seguimiento y PDF quedaron persistidos. Las pruebas cubren agrupaciones, conversiones de unidades, validación de contenido, reimpresiones, respuestas ambiguas, conciliación y formato del PDF; también se conserva la batería de pruebas de órdenes y etiquetas antiguas.

```powershell
node --env-file=.env --env-file=.env.local scripts/run-migration.cjs 20261119_add_walmart_dispatch_labels.sql
npm test
npx tsc --noEmit --incremental false
```

Referencias oficiales: [Create label](https://developer.walmart.com/global-marketplace/reference/createlabel), [Download bulk shipping label](https://developer.walmart.com/global-marketplace/reference/printbulkshippinglabels-1), [isWCPOrder](https://developer.walmart.com/global-marketplace/page/update-iswcporder-attribute-in-marketplace-orders-apis).
