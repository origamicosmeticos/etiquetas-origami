import { Minus, Plus, X } from 'lucide-react'
import type { PrinterSettings } from '../types/label'

interface SettingsModalProps {
  open: boolean
  settings: PrinterSettings
  btConnected: boolean
  btDeviceName: string
  onUpdate: (next: PrinterSettings) => void
  onClose: () => void
}

export function SettingsModal({
  open,
  settings,
  btConnected,
  btDeviceName,
  onUpdate,
  onClose,
}: SettingsModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-neutral-900">
            Calibragem & Impressora
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar configurações"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs">
            <p className="font-bold text-neutral-800">
              Status Bluetooth:{' '}
              <span className={btConnected ? 'text-emerald-600' : 'text-neutral-500'}>
                {btConnected ? `Conectado (${btDeviceName})` : 'Desconectado'}
              </span>
            </p>
            <p className="mt-1 text-neutral-500">
              Compatível com impressoras térmicas 58mm ESC/POS via Web Bluetooth
              (Chrome Android / Desktop).
            </p>
          </div>

          {/* Calibragem de avanço da etiqueta */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-neutral-900">
                Avanço da etiqueta (linhas)
              </p>
              <p className="text-xs text-neutral-500">
                Ajuste para alinhar o corte após cada etiqueta
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  onUpdate({
                    ...settings,
                    feedLines: Math.max(0, settings.feedLines - 1),
                  })
                }
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 active:scale-95"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-6 text-center font-mono text-sm font-bold">
                {settings.feedLines}
              </span>
              <button
                type="button"
                onClick={() =>
                  onUpdate({
                    ...settings,
                    feedLines: Math.min(12, settings.feedLines + 1),
                  })
                }
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 active:scale-95"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Intervalo padrão em lote */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-neutral-900">
                Intervalo padrão do lote
              </p>
              <p className="text-xs text-neutral-500">
                Pausa entre etiquetas na fila (ms)
              </p>
            </div>
            <input
              type="number"
              min={100}
              max={5000}
              step={100}
              value={settings.batchIntervalMs}
              onChange={(e) =>
                onUpdate({
                  ...settings,
                  batchIntervalMs: Math.max(100, Number(e.target.value) || 800),
                })
              }
              className="w-24 rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-right font-mono text-sm font-bold"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 h-12 w-full rounded-2xl bg-neutral-900 text-sm font-extrabold text-white active:scale-98"
        >
          Concluído
        </button>
      </div>
    </div>
  )
}
