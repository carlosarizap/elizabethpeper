import pool from '@/app/lib/db';
import axios from 'axios';
import FormData from 'form-data';
import { getParisUploadAccessToken } from './token-manager';

export async function uploadInvoicesToParis() {
  const client = await pool.connect();

  try {
    const { rows: orders } = await client.query(`
      SELECT id, order_id, invoice_pdf, document_type
      FROM order_header
      WHERE 
        marketplace = 'paris'
        AND has_invoice = true
        AND invoice_uploaded = false
        AND invoice_pdf IS NOT NULL
    `);

    if (orders.length === 0) {
      console.log('✅ No hay boletas pendientes de subir a París.');
      return;
    }

    const accessToken = process.env.PARIS_ACCESS_TOKEN!;
    const sellerId = process.env.PARIS_SELLER_ID!;
    const uploadAccessToken = await getParisUploadAccessToken();

    if (!accessToken || !sellerId) {
      console.error('❌ Faltan credenciales de París.');
      return;
    }

    for (const order of orders) {
      try {
        const form = new FormData();
        form.append('seller_id', sellerId);
        form.append('invoice_number', order.order_id);
        form.append('invoice_type', order.document_type);
        form.append('order_number', order.order_id);
        form.append('file', Buffer.from(order.invoice_pdf), {
          filename: `boleta_${order.id}.pdf`,
          contentType: 'application/pdf',
        });

        const response = await axios.post(
          'https://api-developers.ecomm.cencosud.com/v1/invoice',
          form,
          {
            headers: {
              ...form.getHeaders(),
              Authorization: `Bearer ${uploadAccessToken}`,
            },
          }
        );

        console.log(`📤 Boleta subida correctamente para orden: ${order.order_id}`, response.data);

        await client.query(`
          UPDATE order_header
          SET invoice_uploaded = true
          WHERE id = $1
        `, [order.id]);

      } catch (uploadError: any) {
        const errorData = uploadError.response?.data;
        console.error(`❌ Error al subir boleta para orden: ${order.order_id}`);
        if (errorData) {
          console.dir(errorData, { depth: null });
        } else {
          console.error(uploadError.message);
        }
      }
    }

    console.log('🏁 Proceso de carga de boletas a París finalizado.');
  } catch (error) {
    console.error('Error general subiendo boletas a París:', error);
  } finally {
    client.release();
  }
}
