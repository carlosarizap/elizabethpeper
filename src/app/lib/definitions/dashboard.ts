export interface MarketplaceStat {
  marketplace: string;
  total_ventas: number;
  total_ordenes: number;
  participacion: number;
  ventas_mes_anterior: number;
  crecimiento: number | null;
}

export interface ProductStat {
  product_title: string;
  cantidad_total: number;
}

export interface DailySalesStat {
  day: number;
  total_ventas: number;
  total_ordenes: number;
}

export interface DashboardSummary {
  total_ventas: number;
  ventas_netas: number;
  ventas_mes_anterior: number;
  crecimiento_mensual: number | null;
  proyeccion_cierre: number;
  es_proyeccion: boolean;
  total_ordenes: number;
  ticket_promedio: number;
  unidades_vendidas: number;
  monto_devuelto: number;
  ordenes_devueltas: number;
  unidades_devueltas: number;
  tasa_devolucion: number;
  tasa_unidades_devueltas: number;
  monto_cancelado: number;
  ordenes_canceladas: number;
  tasa_cancelacion: number;
}

export interface MarketplaceReturnStat {
  marketplace: string;
  monto_devuelto: number;
  ordenes_devueltas: number;
  unidades_devueltas: number;
  tasa_devolucion: number;
}

export interface ReturnedProductStat {
  product_title: string;
  cantidad_devuelta: number;
  monto_devuelto: number;
}

export interface OrderStatusStat {
  status: string;
  total: number;
  porcentaje: number;
}

export interface DocumentStats {
  documentos_pendientes: number;
  boletas_pendientes: number;
  facturas_pendientes: number;
  notas_credito_pendientes: number;
}

export interface DashboardStats {
  marketplaces: MarketplaceStat[];
  topProducts: ProductStat[];
  rellenos: Record<string, number>;
  dailySales: DailySalesStat[];
  summary: DashboardSummary;
  returnsByMarketplace: MarketplaceReturnStat[];
  returnedProducts: ReturnedProductStat[];
  statusDistribution: OrderStatusStat[];
  documents: DocumentStats;
}
