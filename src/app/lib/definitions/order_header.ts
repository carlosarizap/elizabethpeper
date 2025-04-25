import { OrderDetail } from "./order_detail";

export interface OrderHeader {
    id: string;
    order_id: string;
    total_amount: number;
    shipping_amount: number;
    document_type: 'boleta' | 'factura';
    has_invoice: boolean;
    invoice_pdf: string | null;
    marketplace: string;
    status: string;
    delivery_date: string;
    created_at: string;
    updated_at: string;
    details: OrderDetail[]; // ⚡ agregamos los detalles aquí
}