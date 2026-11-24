import { Layers, ChevronRight } from 'lucide-react'

interface BatchBannerProps {
  totalLabels: number
  onOpenBatch: () => void
}

export function BatchBanner({ totalLabels, onOpenBatch }: BatchBannerProps) {
  if (totalLabels <= 0) return null

  return (
    <div className="mx-auto max-w-lg px-3 pt-3">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-900 bg-neutral-900 px-4 py-3 text-white shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <Layers className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">
              Lote Recebido: {totalLabels} {totalLabels === 1 ? 'etiqueta pronta' : 'etiquetas prontas'}
            </p>
            <p className="text-xs text-neutral-300">
              Enviado pelo ERP para esta loja
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenBatch}
          className="flex shrink-0 items-center gap-1 rounded-xl bg-emerald-500 px-3.5 py-2.5 text-xs font-extrabold text-neutral-950 transition-transform active:scale-95"
        >
          Abrir Lote
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
