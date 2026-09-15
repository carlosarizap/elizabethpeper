import pool from '@/app/lib/db';
import axios from 'axios';
import { getFalabellaSignature } from './signature-helper';
import { fetchOrderItems } from '@/app/lib/falabella/fetch-order-items'; // <-- ahora lo modularizamos
import {
    falabellaItemsAreReadyForInvoice,
    getFalabellaInvoiceType,
    getFalabellaRetryOrderItemIds,
} from '../invoices/invoice-upload-utils.ts';

export async function uploadInvoicesToFalabella() {
    const client = await pool.connect();

    try {
        const { rows: orders } = await client.query(`
      SELECT id, order_id, invoice_pdf, delivery_date, document_type
      FROM order_header
      WHERE 
        marketplace = 'falabella'
        AND has_invoice = true
        AND invoice_uploaded = false
        AND invoice_pdf IS NOT NULL
    `);

        if (orders.length === 0) {
            console.log('✅ No hay documentos pendientes de subir a Falabella.');
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

                if (!falabellaItemsAreReadyForInvoice(items)) {
                    console.log(
                        `⏳ Documento Falabella aplazado para orden: ${order.order_id}. ` +
                        'La orden todavía no alcanza ready_to_ship.'
                    );
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
                    orderItemIds,
                    invoiceNumber: order.order_id,
                    invoiceDate: invoiceDateStr,
                    invoiceType: getFalabellaInvoiceType(order.document_type),
                    operatorCode: 'FACL',
                    invoiceDocumentFormat: 'pdf',
                    invoiceDocument: order.invoice_pdf.toString('base64'),
                };

                // 4. Hacer POST
                const upload = (ids: string[]) => axios.post(
                    'https://sellercenter-api.falabella.com/v1/marketplace-sellers/invoice/pdf',
                    { ...body, orderItemIds: ids },
                    { headers }
                );

                let uploadedOrderItemIds = orderItemIds;
                let response;
                try {
                    response = await upload(orderItemIds);
                } catch (firstError: any) {
                    const retryOrderItemIds = getFalabellaRetryOrderItemIds(
                        orderItemIds,
                        firstError.response?.data,
                    );
                    const canRetry = retryOrderItemIds.length > 0
                        && retryOrderItemIds.length < orderItemIds.length;
                    if (!canRetry) throw firstError;

                    console.warn(
                        `↻ Falabella rechazó ${orderItemIds.length - retryOrderItemIds.length} ` +
                        `ítem(s) duplicado(s) de la orden ${order.order_id}. ` +
                        `Reintentando con ${retryOrderItemIds.length} identificador(es) válido(s).`
                    );
                    uploadedOrderItemIds = retryOrderItemIds;
                    response = await upload(retryOrderItemIds);
                }

                console.log(
                    `📤 ${body.invoiceType} subida correctamente para orden: ${order.order_id} ` +
                    `(${uploadedOrderItemIds.length}/${orderItemIds.length} identificadores aceptados)`,
                    response.data
                );

                await client.query(`
          UPDATE order_header 
          SET invoice_uploaded = true 
          WHERE id = $1
        `, [order.id]);

            } catch (uploadError: any) {
                const falabellaError = uploadError.response?.data;

                if (falabellaError) {
                    console.error(`❌ Error al subir documento para orden: ${order.order_id}`);
                    console.error('🔴 Mensaje principal:', falabellaError?.ErrorResponse?.Head?.ErrorMessage);
                    console.error('🔴 Código de error:', falabellaError?.ErrorResponse?.Head?.ErrorCode);
                    console.error('🔴 Detalle de errores:');
                    console.dir(falabellaError?.ErrorResponse?.Body?.errors, { depth: null });
                } else {
                    console.error(`❌ Error desconocido al subir documento para orden: ${order.order_id}`, uploadError.message);
                }
            }
        }

        console.log('🏁 Proceso de carga de documentos a Falabella finalizado.');

    } catch (error) {
        console.error('Error subiendo documentos a Falabella:', error);
    } finally {
        client.release();
    }
}
