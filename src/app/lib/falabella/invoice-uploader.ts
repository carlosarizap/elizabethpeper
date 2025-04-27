import pool from '@/app/lib/db';
import axios from 'axios';
import { getFalabellaSignature } from './signature-helper';
import { fetchOrderItems } from '@/app/lib/falabella/fetch-order-items'; // <-- ahora lo modularizamos

export async function uploadInvoicesToFalabella() {
    const client = await pool.connect();

    try {
        const { rows: orders } = await client.query(`
      SELECT id, order_id, invoice_pdf, delivery_date
      FROM order_header
      WHERE 
        marketplace = 'falabella'
        AND has_invoice = true
        AND invoice_uploaded = false
        AND invoice_pdf IS NOT NULL
    `);

        if (orders.length === 0) {
            console.log('✅ No hay boletas pendientes de subir a Falabella.');
            return;
        }

        const userId = process.env.FALABELLA_USER_ID!;
        const apiKey = process.env.FALABELLA_API_KEY!;

        if (!userId || !apiKey) {
            console.error('❌ Falta configuración de credenciales de Falabella.');
            return;
        }

        for (const order of orders) {
            try {
                const timestamp = new Date().toISOString();

                // 1. Buscar los order items reales


                const [orderNumber, internalOrderId] = order.order_id.split("-");
                const items = await fetchOrderItems(internalOrderId, timestamp, userId, apiKey);

                if (items.length === 0) {
                    console.error(`❌ No se encontraron productos para la orden: ${order.order_id}`);
                    continue;
                }

                const orderItemIds = items.map((item: any) => item.OrderItemId);

                // 2. Firmar headers
                const headers = getFalabellaSignature({
                    Action: 'SetInvoicePDF',
                    Format: 'JSON',
                    Service: 'Invoice',
                    Timestamp: timestamp,
                    UserID: userId,
                    Version: '1.0',
                }, apiKey);

                // 3. Armar body bien

                const deliveryDate = new Date(order.delivery_date);
                const today = new Date();
                today.setHours(0, 0, 0, 0); // eliminar horas para comparación

                let invoiceDateStr = deliveryDate <= today
                    ? deliveryDate.toISOString().split('T')[0]
                    : today.toISOString().split('T')[0];

                const body = {
                    orderItemIds: orderItemIds,
                    invoiceNumber: order.order_id,
                    invoiceDate: invoiceDateStr,
                    invoiceType: 'BOLETA',
                    operatorCode: 'FACL',
                    invoiceDocumentFormat: 'pdf',
                    invoiceDocument: order.invoice_pdf.toString('base64'),
                };

                // 4. Hacer POST
                const response = await axios.post(
                    'https://sellercenter-api.falabella.com/v1/marketplace-sellers/invoice/pdf',
                    body,
                    { headers }
                );

                console.log(`📤 Boleta subida correctamente para orden: ${order.order_id}`, response.data);

                await client.query(`
          UPDATE order_header 
          SET invoice_uploaded = true 
          WHERE id = $1
        `, [order.id]);

            } catch (uploadError: any) {
                const falabellaError = uploadError.response?.data;

                if (falabellaError) {
                    console.error(`❌ Error al subir boleta para orden: ${order.order_id}`);
                    console.error('🔴 Mensaje principal:', falabellaError?.ErrorResponse?.Head?.ErrorMessage);
                    console.error('🔴 Código de error:', falabellaError?.ErrorResponse?.Head?.ErrorCode);
                    console.error('🔴 Detalle de errores:');
                    console.dir(falabellaError?.ErrorResponse?.Body?.errors, { depth: null });
                } else {
                    console.error(`❌ Error desconocido al subir boleta para orden: ${order.order_id}`, uploadError.message);
                }
            }
        }

        console.log('🏁 Proceso de carga de boletas a Falabella finalizado.');

    } catch (error) {
        console.error('Error subiendo boletas a Falabella:', error);
    } finally {
        client.release();
    }
}
