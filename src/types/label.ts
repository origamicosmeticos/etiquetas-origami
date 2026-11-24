export type StoreCode = 'ORI' | 'SMT' | 'CTR'

export const STORES: StoreCode[] = ['ORI', 'SMT', 'CTR']

export interface CatalogItem {
  ean: string
  descricao: string
  preco: number
  is_promo: boolean
  loja_ultima_edicao?: string
  updated_at?: string
}

export interface BatchQueueItem {
  id: string | number
  lote_nome: string
  loja_destino: StoreCode
  ean: string
  descricao: string
  preco: number
  is_promo: boolean
  quantidade: number
  status: 'pendente' | 'impresso' | string
  created_at?: string
}

export interface PrinterSettings {
  feedLines: number
  batchIntervalMs: number
  autoPrintOnScan: boolean
}

export interface LabelRenderData {
  ean: string
  descricao: string
  preco: number
  is_promo: boolean
}
