import { supabase } from '../lib/supabase'
import type {
  BatchQueueItem,
  CatalogItem,
  PrinterSettings,
  StoreCode,
} from '../types/label'

const STORE_KEY = 'origami_store'
const CATALOG_CACHE_KEY = 'origami_catalog_cache_v1'
const SETTINGS_KEY = 'origami_printer_settings_v1'

const DEFAULT_SETTINGS: PrinterSettings = {
  feedLines: 2,
  batchIntervalMs: 800,
  autoPrintOnScan: false,
}

export function getStoredStore(): StoreCode {
  try {
    const val = localStorage.getItem(STORE_KEY)
    if (val === 'ORI' || val === 'SMT' || val === 'CTR') return val
  } catch {
    // ignore storage errors
  }
  return 'ORI'
}

export function saveStoredStore(store: StoreCode): void {
  try {
    localStorage.setItem(STORE_KEY, store)
  } catch {
    // ignore
  }
}

export function getPrinterSettings(): PrinterSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<PrinterSettings>
    return {
      feedLines:
        typeof parsed.feedLines === 'number'
          ? parsed.feedLines
          : DEFAULT_SETTINGS.feedLines,
      batchIntervalMs:
        typeof parsed.batchIntervalMs === 'number'
          ? parsed.batchIntervalMs
          : DEFAULT_SETTINGS.batchIntervalMs,
      autoPrintOnScan:
        typeof parsed.autoPrintOnScan === 'boolean'
          ? parsed.autoPrintOnScan
          : DEFAULT_SETTINGS.autoPrintOnScan,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function savePrinterSettings(settings: PrinterSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // ignore
  }
}

function readCatalogCache(): Record<string, CatalogItem> {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, CatalogItem>) : {}
  } catch {
    return {}
  }
}

export function getLocalCatalogItem(ean: string): CatalogItem | null {
  const clean = ean.trim()
  if (!clean) return null
  const cache = readCatalogCache()
  return cache[clean] ?? null
}

export function saveLocalCatalogItem(item: CatalogItem): void {
  try {
    const cache = readCatalogCache()
    cache[item.ean] = item
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // ignore
  }
}

export async function fetchSupabaseCatalogItem(
  ean: string
): Promise<CatalogItem | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('etiquetas_catalogo')
    .select('ean, descricao, preco, is_promo, loja_ultima_edicao, updated_at')
    .eq('ean', ean)
    .maybeSingle()

  if (error || !data) return null

  const item: CatalogItem = {
    ean: String(data.ean),
    descricao: String(data.descricao ?? ''),
    preco: Number(data.preco ?? 0),
    is_promo: Boolean(data.is_promo),
    loja_ultima_edicao: data.loja_ultima_edicao ?? undefined,
    updated_at: data.updated_at ?? undefined,
  }
  saveLocalCatalogItem(item)
  return item
}

export async function fetchOpenBeautyFactsName(ean: string): Promise<string> {
  try {
    const res = await fetch(
      `https://world.openbeautyfacts.org/api/v0/product/${encodeURIComponent(ean)}.json`
    )
    if (!res.ok) return ''
    const json = (await res.json()) as {
      status?: number
      product?: {
        product_name_pt?: string
        product_name?: string
        generic_name?: string
        brands?: string
      }
    }
    if (json.status !== 1 || !json.product) return ''
    const name =
      json.product.product_name_pt ||
      json.product.product_name ||
      json.product.generic_name ||
      ''
    return name.trim()
  } catch {
    return ''
  }
}

export async function upsertCatalogItem(
  item: Omit<CatalogItem, 'updated_at'>
): Promise<{ savedRemote: boolean; item: CatalogItem; error?: string }> {
  const nowIso = new Date().toISOString()
  const fullItem: CatalogItem = {
    ...item,
    updated_at: nowIso,
  }

  saveLocalCatalogItem(fullItem)

  if (!supabase) {
    return { savedRemote: false, item: fullItem }
  }

  const { error } = await supabase.from('etiquetas_catalogo').upsert(
    {
      ean: fullItem.ean,
      descricao: fullItem.descricao,
      preco: fullItem.preco,
      is_promo: fullItem.is_promo,
      loja_ultima_edicao: fullItem.loja_ultima_edicao,
      updated_at: nowIso,
    },
    { onConflict: 'ean' }
  )

  if (error) {
    return { savedRemote: false, item: fullItem, error: error.message }
  }

  return { savedRemote: true, item: fullItem }
}

export async function fetchPendingBatches(
  store: StoreCode
): Promise<BatchQueueItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('fila_impressao_lotes')
    .select(
      'id, lote_nome, loja_destino, ean, descricao, preco, is_promo, quantidade, status, created_at'
    )
    .eq('loja_destino', store)
    .eq('status', 'pendente')
    .order('lote_nome', { ascending: true })
    .order('id', { ascending: true })

  if (error || !data) return []

  return data.map((row) => ({
    id: row.id,
    lote_nome: String(row.lote_nome ?? 'Lote ERP'),
    loja_destino: row.loja_destino as StoreCode,
    ean: String(row.ean ?? ''),
    descricao: String(row.descricao ?? ''),
    preco: Number(row.preco ?? 0),
    is_promo: Boolean(row.is_promo),
    quantidade: Math.max(1, Number(row.quantidade ?? 1)),
    status: String(row.status ?? 'pendente'),
    created_at: row.created_at ?? undefined,
  }))
}

export async function markBatchItemPrinted(
  id: string | number
): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from('fila_impressao_lotes')
    .update({ status: 'impresso' })
    .eq('id', id)
  return !error
}
