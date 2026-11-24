import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Minus, Pause, Play, Printer, Square, X } from 'lucide-react'
import type { BatchQueueItem } from '../types/label'
import { formatBRLValue } from '../utils/formatters'
import { createRenderedLabelCanvas } from '../utils/labelCanvas'
import { bluetoothPrinter } from '../services/bluetoothPrinter'
import { markBatchItemPrinted } from '../services/catalogService'

interface BatchModalProps {
  open: boolean
  items: BatchQueueItem[]
  defaultIntervalMs: number
  feedLines: number
  btConnected: boolean
  onConnectBluetooth: () => Promise<boolean>
  onClose: () => void
  onItemPrinted: (id: string | number) => void
  onToast: (msg: string, type?: 'info' | 'success' | 'error') => void
}

interface EditableBatchState {
  included: boolean
  qty: number
}

export function BatchModal({
  open,
  items,
  defaultIntervalMs,
  feedLines,
  btConnected,
  onConnectBluetooth,
  onClose,
  onItemPrinted,
  onToast,
}: BatchModalProps) {
  const [edits, setEdits] = useState<Record<string, EditableBatchState>>({})
  const [intervalMs, setIntervalMs] = useState(defaultIntervalMs)
  const [isPrinting, setIsPrinting] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const pausedRef = useRef(false)
  const cancelledRef = useRef(false)

  useEffect(() => {
    setIntervalMs(defaultIntervalMs)
  }, [defaultIntervalMs])

  useEffect(() => {
    setEdits((prev) => {
      const next: Record<string, EditableBatchState> = {}
      for (const item of items) {
        const key = String(item.id)
        next[key] = prev[key] ?? {
          included: true,
          qty: Math.max(1, item.quantidade),
        }
      }
      return next
    })
  }, [items])

  const grouped = useMemo(() => {
    const map = new Map<string, BatchQueueItem[]>()
    for (const item of items) {
      const groupName = item.lote_nome || 'Lote ERP'
      const list = map.get(groupName) ?? []
      list.push(item)
      map.set(groupName, list)
    }
    return Array.from(map.entries())
  }, [items])

  const totalSelectedLabels = useMemo(() => {
    return items.reduce((sum, item) => {
      const state = edits[String(item.id)]
      if (!state?.included) return sum
      return sum + state.qty
    }, 0)
  }, [items, edits])

  if (!open) return null

  const toggleInclude = (id: string | number) => {
    if (isPrinting) return
    const key = String(id)
    setEdits((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? { included: true, qty: 1 }),
        included: !(prev[key]?.included ?? true),
      },
    }))
  }

  const updateQty = (id: string | number, delta: number) => {
    if (isPrinting) return
    const key = String(id)
    setEdits((prev) => {
      const current = prev[key] ?? { included: true, qty: 1 }
      return {
        ...prev,
        [key]: {
          ...current,
          qty: Math.max(1, Math.min(99, current.qty + delta)),
        },
      }
    })
  }

  const waitWhilePaused = async (): Promise<boolean> => {
    while (pausedRef.current && !cancelledRef.current) {
      await new Promise((r) => setTimeout(r, 120))
    }
    return !cancelledRef.current
  }

  const handleStartBatch = async () => {
    const selectedItems = items.filter((item) => edits[String(item.id)]?.included)
    if (selectedItems.length === 0 || totalSelectedLabels === 0) {
      onToast('Selecione ao menos 1 etiqueta para imprimir.', 'error')
      return
    }

    if (!btConnected) {
      const ok = await onConnectBluetooth()
      if (!ok) return
    }

    cancelledRef.current = false
    pausedRef.current = false
    setIsPaused(false)
    setIsPrinting(true)

    const total = totalSelectedLabels
    let current = 0
    setProgress({ current: 0, total })

    try {
      for (const item of selectedItems) {
        if (cancelledRef.current) break

        const qty = edits[String(item.id)]?.qty ?? item.quantidade
        const canvas = createRenderedLabelCanvas({
          ean: item.ean,
          descricao: item.descricao,
          preco: item.preco,
          is_promo: item.is_promo,
        })

        let completedItemCopies = 0
        for (let copy = 0; copy < qty; copy++) {
          const canContinue = await waitWhilePaused()
          if (!canContinue) break

          await bluetoothPrinter.printCanvas(canvas, feedLines)
          completedItemCopies++
          current++
          setProgress({ current, total })

          if (current < total && !cancelledRef.current) {
            await new Promise((r) => setTimeout(r, Math.max(100, intervalMs)))
          }
        }

        if (completedItemCopies === qty && !cancelledRef.current) {
          await markBatchItemPrinted(item.id)
          onItemPrinted(item.id)
        }
      }

      if (cancelledRef.current) {
        onToast('Impressão do lote cancelada.', 'info')
      } else {
        onToast('Lote impresso com sucesso!', 'success')
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro durante impressão em lote.'
      onToast(message, 'error')
    } finally {
      setIsPrinting(false)
      setIsPaused(false)
      pausedRef.current = false
    }
  }

  const togglePause = () => {
    const next = !pausedRef.current
    pausedRef.current = next
    setIsPaused(next)
  }

  const handleCancelPrint = () => {
    cancelledRef.current = true
    pausedRef.current = false
    setIsPaused(false)
  }

  const pct =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#FAFAFA]">
      {/* Top Bar */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
        <div>
          <h2 className="text-base font-bold text-neutral-900">
            Lotes Recebidos do ERP
          </h2>
          <p className="text-xs text-neutral-500">
            {items.length} {items.length === 1 ? 'item pendente' : 'itens pendentes'} •{' '}
            {totalSelectedLabels}{' '}
            {totalSelectedLabels === 1 ? 'etiqueta selecionada' : 'etiquetas selecionadas'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isPrinting}
          aria-label="Fechar lote"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-700 disabled:opacity-40"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Lista agrupada por lote_nome */}
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center">
            <p className="text-sm font-semibold text-neutral-700">
              Nenhuma etiqueta pendente neste lote.
            </p>
          </div>
        ) : (
          grouped.map(([loteName, groupItems]) => (
            <section key={loteName} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-extrabold tracking-wider text-neutral-500 uppercase">
                  {loteName}
                </h3>
                <span className="text-xs font-semibold text-neutral-400">
                  {groupItems.length} {groupItems.length === 1 ? 'item' : 'itens'}
                </span>
              </div>

              <div className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
                {groupItems.map((item) => {
                  const state = edits[String(item.id)] ?? {
                    included: true,
                    qty: item.quantidade,
                  }

                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-3.5 transition-opacity ${
                        state.included ? 'opacity-100' : 'opacity-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleInclude(item.id)}
                        disabled={isPrinting}
                        aria-label="Incluir item"
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-colors ${
                          state.included
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                            : 'border-neutral-300 bg-white'
                        }`}
                      >
                        {state.included && <Check className="h-4 w-4 stroke-[3]" />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {item.is_promo && (
                            <span className="shrink-0 rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                              OFERTA
                            </span>
                          )}
                          <p className="truncate text-sm font-semibold text-neutral-900">
                            {item.descricao || `EAN ${item.ean}`}
                          </p>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
                          <span className="font-mono">{item.ean}</span>
                          <span>•</span>
                          <span className="font-bold text-neutral-900">
                            R$ {formatBRLValue(item.preco)}
                          </span>
                        </div>
                      </div>

                      {/* Seletor rápido - / + */}
                      <div className="flex shrink-0 items-center gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1">
                        <button
                          type="button"
                          onClick={() => updateQty(item.id, -1)}
                          disabled={isPrinting || state.qty <= 1}
                          aria-label="Diminuir quantidade"
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-neutral-800 shadow-2xs active:scale-95 disabled:opacity-40"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-7 text-center text-sm font-extrabold text-neutral-900">
                          {state.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQty(item.id, 1)}
                          disabled={isPrinting}
                          aria-label="Aumentar quantidade"
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-neutral-800 shadow-2xs active:scale-95 disabled:opacity-40"
                        >
                          <PlusIcon />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>

      {/* Rodapé com intervalo, progresso e ações */}
      <div className="border-t border-neutral-200 bg-white p-4 pb-6 shadow-lg">
        {isPrinting ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm font-bold text-neutral-900">
              <span>
                {isPaused
                  ? `Pausado (${progress.current} de ${progress.total})`
                  : `Imprimindo ${progress.current} de ${progress.total}...`}
              </span>
              <span className="text-emerald-600">{pct}%</span>
            </div>

            <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={togglePause}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-neutral-300 bg-white text-sm font-bold text-neutral-900 active:scale-98"
              >
                {isPaused ? (
                  <>
                    <Play className="h-4 w-4" /> Retomar
                  </>
                ) : (
                  <>
                    <Pause className="h-4 w-4" /> Pausar
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleCancelPrint}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-red-600 text-sm font-bold text-white active:scale-98"
              >
                <Square className="h-4 w-4 fill-current" /> Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-neutral-600">
              <label htmlFor="batch-interval" className="font-semibold">
                Intervalo entre etiquetas (ms)
              </label>
              <input
                id="batch-interval"
                type="number"
                min={100}
                max={5000}
                step={100}
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value) || 800)}
                className="w-24 rounded-lg border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 text-right font-mono text-sm font-bold text-neutral-900"
              />
            </div>

            <button
              type="button"
              onClick={handleStartBatch}
              disabled={totalSelectedLabels === 0}
              className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-neutral-900 text-sm font-extrabold tracking-wide text-white shadow-sm transition-transform active:scale-98 disabled:opacity-40"
            >
              <Printer className="h-5 w-5" />
              IMPRIMIR LOTE AUTOMATICAMENTE ({totalSelectedLabels})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function PlusIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
