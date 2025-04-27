import pool from '@/app/lib/db';
import axios from 'axios';
import FormData from 'form-data';

export async function uploadInvoicesToRipley() {
  const client = await pool.connect();

  try {
    const { rows: orders } = await client.query(`
      SELECT id, order_id, invoice_pdf
      FROM order_header
      WHERE 
        marketplace = 'ripley'
        AND has_invoice = true
        AND invoice_uploaded = false
        AND invoice_pdf IS NOT NULL
    `);

    if (orders.length === 0) {
      console.log('✅ No hay boletas pendientes de subir a Ripley.');
      return;
    }

    const apiKey = process.env.RIPLEY_API_KEY!;

    for (const order of orders) {
      try {
        // ⚡ Limpieza del order_id
        const cleanOrderId = order.order_id.replace(/[^a-zA-Z0-9]/g, '');

        const filename = `boleta_${cleanOrderId}.pdf`;

        const form = new FormData();
        form.append('files', Buffer.from(order.invoice_pdf), {
          filename,
          contentType: 'application/pdf',
        });

        // ⚡ Crear el XML de order_documents
        const orderDocumentsXml = `
<body>
  <order_documents>
    <order_document>
      <file_name>${filename}</file_name>
      <type_code>CUSTOMER_INVOICE</type_code>
    </order_document>
  </order_documents>
</body>`.trim();

        form.append('order_documents', orderDocumentsXml, {
          contentType: 'application/xml'
        });

        const response = await axios.post(
          `https://ripley-prod.mirakl.net/api/orders/${order.order_id}/documents`,
          form,
          {
            headers: {
              ...form.getHeaders(),
              Authorization: apiKey,
            },
          }
        );

        console.log(`📤 Boleta subida correctamente para orden: ${order.order_id}`, response.data);

        if (response.data.errors_count && response.data.errors_count > 0) {
          console.error(`⚠️ Se encontraron errores subiendo boleta de orden: ${order.order_id}`);
          const errors = response.data.order_documents?.[0]?.errors;
          if (errors && Array.isArray(errors)) {
            for (const err of errors) {
              console.error(`🔴 Campo: ${err.field}`);
              console.error(`🔴 Código: ${err.code}`);
              console.error(`🔴 Mensaje: ${err.message}`);
            }
          } else {
            console.error('No se encontraron detalles de error.');
          }
          continue; // ⚡ No marcar como subida si hubo errores
        }

        // ✅ Si todo bien, actualizamos en la BD
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

    console.log('🏁 Proceso de carga de boletas a Ripley finalizado.');

  } catch (error) {
    console.error('Error general subiendo boletas a Ripley:', error);
  } finally {
    client.release();
  }
}
