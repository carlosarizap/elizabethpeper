import { OrderDetail } from "./order_detail";
import type { StandardOrderStatus } from "../orders/order-status";
import type { StandardOrderReturnStatus } from "../orders/order-item-status";

export interface OrderHeader {
    id: string;
    order_id: string;
    total_amount: number;
    shipping_amount: number;
    document_type: 'boleta' | 'factura';
    has_invoice: boolean;
    invoice_pdf: string | null;
    has_credit_note: boolean;
    credit_note_pdf?: string | null;
    sii_folio: number | null;
    sii_issued_at: string | null;
    marketplace: string;
    status: StandardOrderStatus;
    return_status: StandardOrderReturnStatus;
    return_updated_at: string | null;
    company_rut: string | null;
    billing_city: string | null;
    delivery_date: string;
    created_at: string;
    updated_at: string;
    details: OrderDetail[]; // ⚡ agregamos los detalles aquí
}
