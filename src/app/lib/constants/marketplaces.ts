// src/lib/constants/marketplaces.ts
export const MARKETPLACES = {
    MERCADO_LIBRE: 'mercado_libre',
    FALABELLA: 'falabella',
    RIPLEY: 'ripley',
    PARIS: 'paris',
  } as const;
  
  export type Marketplace = (typeof MARKETPLACES)[keyof typeof MARKETPLACES];
  