import { useEffect, useRef } from 'react'
import { Download, Printer, Zap } from 'lucide-react'
import {
  LABEL_HEIGHT,
  LABEL_WIDTH,
  downloadLabelPng,
  renderLabelToCanvas,
} from '../utils/labelCanvas'
import { isWebBluetoothSupported } from '../services/bluetoothPrinter'

interface LabelPreviewProps {
  ean: string
  descricao: string
  preco: number
  isPromo: boolean
  copies: number
  isPrinting: boolean
  autoPrintOnScan: boolean
  onToggleAutoPrint: () => void
  onPrintAndSave: (canvas: HTMLCanvasElement) => void
}

export function LabelPreview({
  ean,
  descricao,
  preco,
  isPromo,
  copies,
  isPrinting,
  autoPrintOnScan,
  onToggleAutoPrint,
  onPrintAndSave,
}: LabelPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const btSupported = isWebBluetoothSupported()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    renderLabelToCanvas(canvas, {
      ean,
      descricao,
      preco,
      is_promo: isPromo,
    })
  }, [ean, descricao, preco, isPromo])

  const handlePrintClick = () => {
    if (!canvasRef.current) return
    onPrintAndSave(canvasRef.current)
  }

  const handleDownloadPng = () => {
    if (!canvasRef.current) return
    downloadLabelPng(canvasRef.current, ean)
  }

  return (
    <section className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-2xs">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-wide text-neutral-500 uppercase">
          Pré-visualização (50 × 30 mm)
        </span>
        <button
          type="button"
          onClick={onToggleAutoPrint}
          aria-pressed={autoPrintOnScan}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
            autoPrintOnScan
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-neutral-100 text-neutral-600'
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
          Auto-imprimir ao bipar
        </button>
      </div>

      {/* Canvas 400x240px com proporção exata 5:3 */}
      <div className="flex justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-100/80 p-3">
        <canvas
          ref={canvasRef}
          width={LABEL_WIDTH}
          height={LABEL_HEIGHT}
          className="h-auto w-full max-w-[340px] rounded-md border border-neutral-200 bg-white shadow-sm"
        />
      </div>

      {/* Botão principal IMPRIMIR E SALVAR */}
      <button
        type="button"
        onClick={handlePrintClick}
        disabled={isPrinting || !ean.trim()}
        className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-neutral-900 text-base font-extrabold tracking-wide text-white shadow-sm transition-transform active:scale-98 disabled:opacity-40"
      >
        <Printer className="h-5 w-5" />
        {isPrinting
          ? 'IMPRIMINDO...'
          : `IMPRIMIR E SALVAR${copies > 1 ? ` (${copies}x)` : ''}`}
      </button>

      {/* Fallback PNG 50x30mm */}
      <button
        type="button"
        onClick={handleDownloadPng}
        disabled={!ean.trim()}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 text-xs font-bold text-neutral-700 transition-colors hover:bg-neutral-100 active:scale-98 disabled:opacity-40"
      >
        <Download className="h-4 w-4" />
        {btSupported
          ? 'Baixar PNG (50×30mm)'
          : 'Web Bluetooth indisponível — Baixar PNG (50×30mm)'}
      </button>
    </section>
  )
}
