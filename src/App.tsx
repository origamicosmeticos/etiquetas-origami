import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Header } from './components/Header'
import { BatchBanner } from './components/BatchBanner'
import { BatchModal } from './components/BatchModal'
import { BarcodeScanner } from './components/BarcodeScanner'
import { LabelForm } from './components/LabelForm'
import { LabelPreview } from './components/LabelPreview'
import { SettingsModal } from './components/SettingsModal'
import { isSupabaseConfigured } from './lib/supabase'
import {
  bluetoothPrinter,
  isWebBluetoothSupported,
} from './services/bluetoothPrinter'
import {
  fetchOpenBeautyFactsName,
  fetchPendingBatches,
  fetchSupabaseCatalogItem,
  getLocalCatalogItem,
  getPrinterSettings,
  getStoredStore,
  savePrinterSettings,
  saveStoredStore,
  upsertCatalogItem,
} from './services/catalogService'
import type { BatchQueueItem, PrinterSettings, StoreCode } from './types/label'
import { createRenderedLabelCanvas } from './utils/labelCanvas'

interface ToastState {
  id: number
  message: string
  type: 'info' | 'success' | 'error'
}

export function App() {
  const [store, setStore] = useState<StoreCode>(() => getStoredStore())
  const [settings, setSettings] = useState<PrinterSettings>(() =>
    getPrinterSettings()
  )

  // Bluetooth state
  const [btConnected, setBtConnected] = useState(bluetoothPrinter.isConnected)
  const [btConnecting, setBtConnecting] = useState(false)
  const [btDeviceName, setBtDeviceName] = useState(bluetoothPrinter.deviceName)

  // Batch queue state
  const [batchItems, setBatchItems] = useState<BatchQueueItem[]>([])
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)

  // Single label state
  const [ean, setEan] = useState('')
  const [descricao, setDescricao] = useState('')
  const [preco, setPreco] = useState(0)
  const [isPromo, setIsPromo] = useState(false)
  const [copies, setCopies] = useState(1)
  const [lastEditStore, setLastEditStore] = useState<string | undefined>()
  const [lastEditAt, setLastEditAt] = useState<string | undefined>()
  const [isSearching, setIsSearching] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [focusPriceSignal, setFocusPriceSignal] = useState(0)

  const [toast, setToast] = useState<ToastState | null>(null)
  const lookupSeqRef = useRef(0)

  const showToast = useCallback(
    (message: string, type: 'info' | 'success' | 'error' = 'info') => {
      const id = Date.now()
      setToast({ id, message, type })
      window.setTimeout(() => {
        setToast((curr) => (curr?.id === id ? null : curr))
      }, 3200)
    },
    []
  )

  useEffect(() => {
    const unsubscribe = bluetoothPrinter.onDisconnect(() => {
      setBtConnected(false)
      showToast('Impressora Bluetooth desconectada.', 'info')
    })
    return unsubscribe
  }, [showToast])

  // Consulta lotes pendentes ao abrir ou trocar de loja
  useEffect(() => {
    let active = true
    fetchPendingBatches(store).then((items) => {
      if (active) setBatchItems(items)
    })
    return () => {
      active = false
    }
  }, [store])

  const totalPendingLabels = useMemo(
    () => batchItems.reduce((sum, item) => sum + Math.max(1, item.quantidade), 0),
    [batchItems]
  )

  const handleSelectStore = (nextStore: StoreCode) => {
    setStore(nextStore)
    saveStoredStore(nextStore)
  }

  const handleUpdateSettings = (next: PrinterSettings) => {
    setSettings(next)
    savePrinterSettings(next)
  }

  const connectBluetooth = useCallback(async (): Promise<boolean> => {
    if (!isWebBluetoothSupported()) {
      showToast(
        'Web Bluetooth não suportado neste navegador. Use o botão Baixar PNG.',
        'error'
      )
      return false
    }
    setBtConnecting(true)
    try {
      const name = await bluetoothPrinter.connect()
      setBtConnected(true)
      setBtDeviceName(name)
      showToast(`Conectado a ${name}`, 'success')
      return true
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Falha ao conectar Bluetooth.'
      if (!msg.toLowerCase().includes('cancel')) {
        showToast(msg, 'error')
      }
      return false
    } finally {
      setBtConnecting(false)
    }
  }, [showToast])

  const handleToggleBluetooth = async () => {
    if (btConnected) {
      bluetoothPrinter.disconnect()
      setBtConnected(false)
      showToast('Impressora desconectada.', 'info')
    } else {
      await connectBluetooth()
    }
  }

  const printCopiesToBluetooth = useCallback(
    async (canvas: HTMLCanvasElement, count: number) => {
      for (let i = 0; i < count; i++) {
        await bluetoothPrinter.printCanvas(canvas, settings.feedLines)
        if (i < count - 1) {
          await new Promise((r) => setTimeout(r, 250))
        }
      }
    },
    [settings.feedLines]
  )

  const handleLookupEan = useCallback(
    async (rawEan: string) => {
      const cleanEan = rawEan.replace(/\D/g, '')
      if (!cleanEan) return

      setEan(cleanEan)
      const seq = ++lookupSeqRef.current

      // 1. Cache local instantâneo
      const local = getLocalCatalogItem(cleanEan)
      if (local) {
        setDescricao(local.descricao)
        setPreco(local.preco)
        setIsPromo(local.is_promo)
        setLastEditStore(local.loja_ultima_edicao)
        setLastEditAt(local.updated_at)
        if (local.descricao.trim()) {
          setFocusPriceSignal((s) => s + 1)
        }
      } else {
        setDescricao('')
        setPreco(0)
        setIsPromo(false)
        setLastEditStore(undefined)
        setLastEditAt(undefined)
      }

      // 2. Busca paralela no Supabase (prioriza sempre dado mais recente)
      setIsSearching(true)
      try {
        const remote = await fetchSupabaseCatalogItem(cleanEan)
        if (seq !== lookupSeqRef.current) return

        if (remote) {
          setDescricao(remote.descricao)
          setPreco(remote.preco)
          setIsPromo(remote.is_promo)
          setLastEditStore(remote.loja_ultima_edicao)
          setLastEditAt(remote.updated_at)
          if (remote.descricao.trim()) {
            setFocusPriceSignal((s) => s + 1)
          }

          if (settings.autoPrintOnScan && bluetoothPrinter.isConnected) {
            const canvas = createRenderedLabelCanvas({
              ean: cleanEan,
              descricao: remote.descricao,
              preco: remote.preco,
              is_promo: remote.is_promo,
            })
            await printCopiesToBluetooth(canvas, copies)
            showToast(`Auto-impresso (${copies}x)`, 'success')
          }
          return
        }

        // 3. Fallback OpenBeautyFacts se não existir no Supabase
        if (!local?.descricao) {
          const suggestedName = await fetchOpenBeautyFactsName(cleanEan)
          if (seq !== lookupSeqRef.current) return
          if (suggestedName) {
            setDescricao(suggestedName)
            setFocusPriceSignal((s) => s + 1)
          }
        }
      } finally {
        if (seq === lookupSeqRef.current) {
          setIsSearching(false)
        }
      }
    },
    [copies, printCopiesToBluetooth, settings.autoPrintOnScan, showToast]
  )

  const handlePrintAndSave = async (canvas: HTMLCanvasElement) => {
    const cleanEan = ean.replace(/\D/g, '')
    if (!cleanEan) {
      showToast('Informe ou bipe um código EAN.', 'error')
      return
    }

    setIsPrinting(true)
    try {
      // Upsert no Supabase + atualização localStorage
      const { savedRemote, item, error } = await upsertCatalogItem({
        ean: cleanEan,
        descricao: descricao.trim(),
        preco,
        is_promo: isPromo,
        loja_ultima_edicao: store,
      })

      setLastEditStore(item.loja_ultima_edicao)
      setLastEditAt(item.updated_at)

      if (error) {
        showToast(`Salvo localmente (Supabase: ${error})`, 'info')
      }

      // Impressão Bluetooth
      if (!bluetoothPrinter.isConnected) {
        if (!isWebBluetoothSupported()) {
          showToast(
            savedRemote
              ? 'Salvo! Use "Baixar PNG" (navegador sem Web Bluetooth).'
              : 'Salvo localmente! Use "Baixar PNG" para exportar.',
            'info'
          )
          return
        }
        const connected = await connectBluetooth()
        if (!connected) return
      }

      await printCopiesToBluetooth(canvas, copies)
      showToast(
        `Impresso ${copies}x e ${savedRemote ? 'salvo no catálogo' : 'salvo localmente'}!`,
        'success'
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao imprimir.'
      showToast(msg, 'error')
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <div className="min-h-dvh bg-[#FAFAFA] pb-10">
      <Header
        store={store}
        onSelectStore={handleSelectStore}
        btConnected={btConnected}
        btConnecting={btConnecting}
        btDeviceName={btDeviceName}
        onToggleBluetooth={handleToggleBluetooth}
        onOpenSettings={() => setSettingsModalOpen(true)}
      />

      {!isSupabaseConfigured && (
        <div className="mx-auto max-w-lg px-3 pt-2.5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
            Modo offline/local: configure <code className="font-mono font-bold">.env</code> com{' '}
            <code className="font-mono font-bold">VITE_SUPABASE_URL</code> e{' '}
            <code className="font-mono font-bold">VITE_SUPABASE_ANON_KEY</code> para sincronizar com o Supabase.
          </div>
        </div>
      )}

      <BatchBanner
        totalLabels={totalPendingLabels}
        onOpenBatch={() => setBatchModalOpen(true)}
      />

      <main className="mx-auto max-w-lg space-y-3 px-3 pt-3">
        <BarcodeScanner
          ean={ean}
          onEanChange={setEan}
          onBarcodeDetected={handleLookupEan}
        />

        <LabelForm
          descricao={descricao}
          onDescricaoChange={setDescricao}
          preco={preco}
          onPrecoChange={setPreco}
          isPromo={isPromo}
          onIsPromoChange={setIsPromo}
          copies={copies}
          onCopiesChange={setCopies}
          lastEditStore={lastEditStore}
          lastEditAt={lastEditAt}
          isSearching={isSearching}
          focusPriceSignal={focusPriceSignal}
        />

        <LabelPreview
          ean={ean}
          descricao={descricao}
          preco={preco}
          isPromo={isPromo}
          copies={copies}
          isPrinting={isPrinting}
          autoPrintOnScan={settings.autoPrintOnScan}
          onToggleAutoPrint={() =>
            handleUpdateSettings({
              ...settings,
              autoPrintOnScan: !settings.autoPrintOnScan,
            })
          }
          onPrintAndSave={handlePrintAndSave}
        />
      </main>

      <BatchModal
        open={batchModalOpen}
        items={batchItems}
        defaultIntervalMs={settings.batchIntervalMs}
        feedLines={settings.feedLines}
        btConnected={btConnected}
        onConnectBluetooth={connectBluetooth}
        onClose={() => setBatchModalOpen(false)}
        onItemPrinted={(id) =>
          setBatchItems((prev) => prev.filter((item) => item.id !== id))
        }
        onToast={showToast}
      />

      <SettingsModal
        open={settingsModalOpen}
        settings={settings}
        btConnected={btConnected}
        btDeviceName={btDeviceName}
        onUpdate={handleUpdateSettings}
        onClose={() => setSettingsModalOpen(false)}
      />

      {/* Toast flutuante */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
          <div
            className={`rounded-2xl px-4 py-2.5 text-xs font-bold shadow-lg ${
              toast.type === 'error'
                ? 'bg-red-600 text-white'
                : toast.type === 'success'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-neutral-900 text-white'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
