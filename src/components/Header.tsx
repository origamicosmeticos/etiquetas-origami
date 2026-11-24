import { Bluetooth, BluetoothConnected, Settings2 } from 'lucide-react'
import { STORES, type StoreCode } from '../types/label'

interface HeaderProps {
  store: StoreCode
  onSelectStore: (store: StoreCode) => void
  btConnected: boolean
  btConnecting: boolean
  btDeviceName: string
  onToggleBluetooth: () => void
  onOpenSettings: () => void
}

export function Header({
  store,
  onSelectStore,
  btConnected,
  btConnecting,
  btDeviceName,
  onToggleBluetooth,
  onOpenSettings,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-[#FAFAFA]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold tracking-tight text-neutral-900">
            Origami Etiquetas
          </h1>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Seletor rápido de loja */}
          <div
            className="flex rounded-xl bg-neutral-200/75 p-0.5"
            role="group"
            aria-label="Selecionar loja"
          >
            {STORES.map((code) => {
              const active = store === code
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => onSelectStore(code)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all active:scale-95 ${
                    active
                      ? 'bg-neutral-900 text-white shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  {code}
                </button>
              )
            })}
          </div>

          {/* Botão Bluetooth */}
          <button
            type="button"
            onClick={onToggleBluetooth}
            disabled={btConnecting}
            title={btConnected ? `Conectado: ${btDeviceName}` : 'Conectar impressora Bluetooth'}
            aria-label={btConnected ? 'Desconectar impressora' : 'Conectar impressora'}
            className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all active:scale-95 ${
              btConnected
                ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100'
            } ${btConnecting ? 'animate-pulse opacity-70' : ''}`}
          >
            {btConnected ? (
              <BluetoothConnected className="h-4.5 w-4.5 text-emerald-600" />
            ) : (
              <Bluetooth className="h-4.5 w-4.5" />
            )}
            {btConnected && (
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
            )}
          </button>

          {/* Calibragem e Preferências */}
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Configurações de impressão"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 transition-all hover:bg-neutral-100 active:scale-95"
          >
            <Settings2 className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>
    </header>
  )
}
