export interface DispatchShipment {
  id: string;
  externalShipmentId: string;
  status: string | null;
  substatus: string | null;
  shippingMode: string | null;
  logisticType: string | null;
}

export interface MercadoLibreDispatchOrder {
  id: string;
  orderId: string;
  deliveryDate: string;
  status: string;
  productSummary: string;
  totalUnits: number;
  shipment: DispatchShipment | null;
  eligible: boolean;
  waitingForLabel: boolean;
  canMarkReadyToShip: boolean;
  eligibilityReason: string | null;
  printCount: number;
  lastPrintRequestedAt: string | null;
}

export interface MercadoLibreDispatchResponse {
  orders: MercadoLibreDispatchOrder[];
  summary: {
    total: number;
    eligible: number;
    pendingPrint: number;
    printed: number;
    waitingForLabel: number;
  };
  generatedAt: string;
}

export interface DispatchPrintFailure {
  orderId: string;
  shipmentId: string | null;
  marketplace?: string;
  message: string;
}

export interface DispatchPrintResponse {
  batchId: string;
  status: 'completed' | 'partial';
  completedCount: number;
  failures: DispatchPrintFailure[];
  documentUrl: string;
}

export interface FalabellaDispatchOrder {
  id: string;
  orderId: string;
  sellerCenterOrderId: string;
  deliveryDate: string;
  productSummary: string;
  totalUnits: number;
  orderItemIds: string[];
  itemStatuses: string[];
  confirmed: boolean;
  printCount: number;
  lastPrintRequestedAt: string | null;
}

export interface FalabellaDispatchResponse {
  orders: FalabellaDispatchOrder[];
  summary: {
    total: number;
    pendingPrint: number;
    printed: number;
    confirmed: number;
  };
  generatedAt: string;
}

export interface ParisDispatchOrder {
  id: string;
  orderId: string;
  deliveryDate: string;
  productSummary: string;
  totalUnits: number;
  itemStatuses: string[];
  printCount: number;
  lastPrintRequestedAt: string | null;
}

export interface ParisDispatchResponse {
  orders: ParisDispatchOrder[];
  summary: {
    total: number;
    pendingPrint: number;
    printed: number;
  };
  generatedAt: string;
}

export interface RipleyDispatchOrder {
  id: string;
  orderId: string;
  deliveryDate: string;
  productSummary: string;
  totalUnits: number;
  itemStatuses: string[];
  printCount: number;
  lastPrintRequestedAt: string | null;
}

export interface RipleyDispatchResponse {
  orders: RipleyDispatchOrder[];
  integration: {
    configured: boolean;
    connected: boolean;
    message: string | null;
  };
  summary: {
    total: number;
    pendingPrint: number;
    printed: number;
  };
  generatedAt: string;
}

export interface WalmartDispatchOrder {
  id: string;
  orderId: string;
  deliveryDate: string;
  productSummary: string;
  totalUnits: number;
  itemStatuses: string[];
  acknowledged: boolean;
  printCount: number;
  lastPrintRequestedAt: string | null;
}

export interface WalmartDispatchResponse {
  orders: WalmartDispatchOrder[];
  summary: {
    total: number;
    pendingApproval: number;
    pendingPrint: number;
    printed: number;
  };
  generatedAt: string;
}
