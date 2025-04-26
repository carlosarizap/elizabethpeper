import pool from '@/app/lib/db';
import { getValidAccessToken } from '@/app/lib/mercadolibre/token-manager';
import axios from 'axios';
import FormData from 'form-data';

export async function uploadInvoicesToMercadoLibre() {
  const client = await pool.connect();

  try {
    const { rows: orders } = await client.query(`
      SELECT id, order_id, invoice_pdf
      FROM order_header
      WHERE 
        marketplace = 'mercado_libre'
        AND has_invoice = true
        AND invoice_uploaded = false
        AND invoice_pdf IS NOT NULL
    `);

    if (orders.length === 0) {
      console.log('✅ No hay boletas pendientes de subir a MercadoLibre.');
      return;
    }

    const token = await getValidAccessToken();
    if (!token) {
      console.error('❌ No se pudo obtener Access Token válido de MercadoLibre.');
      return;
    }

    for (const order of orders) {
      try {
        const form = new FormData();
        form.append('fiscal_document', Buffer.from(order.invoice_pdf), {
          filename: `boleta_${order.id}.pdf`,
          contentType: 'application/pdf',
        });

        const url = `https://api.mercadolibre.com/packs/${order.order_id}/fiscal_documents`;

        const response = await axios.post(url, form, {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${token}`,
          },
        });

        console.log(`📤 Boleta subida correctamente para pack_id: ${order.order_id}`, response.data);

        await client.query(`
          UPDATE order_header 
          SET invoice_uploaded = true 
          WHERE id = $1
        `, [order.id]);

      } catch (uploadError: any) {
        console.error(`❌ Error al subir boleta para pack_id: ${order.order_id}`, uploadError.response?.data || uploadError.message);
      }
    }

    console.log('🏁 Proceso de carga de boletas finalizado.');

  } catch (error) {
    console.error('Error subiendo boletas a MercadoLibre:', error);
  } finally {
    client.release();
  }
}
