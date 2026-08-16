import type { StandardOrderItemStatus } from '../orders/order-item-status';

export interface OrderDetail {
    id: string; // UUID
    id_order_header: string; // UUID que referencia a OrderHeader.id
    product_title: string;
    product_quantity: number;
    product_price: number;
    marketplace_item_id: string | null;
    marketplace_order_id: string | null;
    status: StandardOrderItemStatus;
    marketplace_status: string | null;
    status_updated_at: string | null;
    created_at: string;
    updated_at: string;
  }
