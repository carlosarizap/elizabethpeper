export interface OrderDetail {
    id: string; // UUID
    id_order_header: string; // UUID que referencia a OrderHeader.id
    product_title: string;
    product_quantity: number;
    product_price: number;
    created_at: string;
    updated_at: string;
  }
  