import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { Camera, CameraOff, Flashlight, Search, X } from 'lucide-react'

interface BarcodeScannerProps {
  ean: string
  onEanChange: (ean: string) => void
  onBarcodeDetected: (ean: string) => void
}

const SCANNER_REGION_ID = 'qr-reader'

export function BarcodeScanner({
  ean,
  onEanChange,
  onBarcodeDetected,
}: BarcodeScannerProps) {
  const [cameraActive, setCameraActive] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastScanRef = useRef<{ code: string; ts: number }>({ code: '', ts: 0 })
  const onDetectedRef = useRef(onBarcodeDetected)
  onDetectedRef.current = onBarcodeDetected

  const stopCamera = useCallback(async () => {
    const instance = scannerRef.current
    if (instance) {
      try {
        if (instance.isScanning) {
          await instance.stop()
        }
        instance.clear()
      } catch {
        // ignore stop errors
      }
      scannerRef.current = null
    }
    setCameraActive(false)
    setTorchOn(false)
    setTorchSupported(false)
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    try {
      const scanner = new Html5Qrcode(SCANNER_REGION_ID, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
        ],
        verbose: false,
      })
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 260, height: 110 },
          aspectRatio: 1.777,
        },
        (decodedText) => {
          const clean = decodedText.replace(/\D/g, '')
          if (!clean) return

          const now = Date.now()
          if (
            lastScanRef.current.code === clean &&
            now - lastScanRef.current.ts < 2200
          ) {
            return
          }

          lastScanRef.current = { code: clean, ts: now }
          if (navigator.vibrate) {
            navigator.vibrate(40)
          }
          onDetectedRef.current(clean)
        },
        () => {
          // frame without barcode - expected
        }
      )

      setCameraActive(true)

      // Verifica suporte a lanterna (torch) na track ativa
      try {
        const capabilities = scanner.getRunningTrackCameraCapabilities()
        const torchFeature = capabilities.torchFeature()
        setTorchSupported(torchFeature.isSupported())
      } catch {
        setTorchSupported(false)
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Não foi possível acessar a câmera traseira.'
      setCameraError(msg)
      await stopCamera()
    }
  }, [stopCamera])

  useEffect(() => {
    return () => {
      void stopCamera()
    }
  }, [stopCamera])

  const handleToggleCamera = () => {
    if (cameraActive) {
      void stopCamera()
    } else {
      void startCamera()
    }
  }

  const handleToggleTorch = async () => {
    const scanner = scannerRef.current
    if (!scanner || !cameraActive) return
    try {
      const torchFeature = scanner.getRunningTrackCameraCapabilities().torchFeature()
      const next = !torchOn
      await torchFeature.apply(next)
      setTorchOn(next)
    } catch {
      setTorchSupported(false)
    }
  }

  const handleManualInput = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 13)
    onEanChange(digits)
    if (digits.length === 8 || digits.length === 13) {
      onBarcodeDetected(digits)
    }
  }

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = ean.replace(/\D/g, '')
    if (clean) {
      onBarcodeDetected(clean)
    }
  }

  return (
    <section className="space-y-2.5 rounded-2xl border border-neutral-200 bg-white p-3 shadow-2xs">
      {/* Área do leitor de câmera */}
      <div className="relative overflow-hidden rounded-xl bg-neutral-900">
        <div
          id={SCANNER_REGION_ID}
          className={`w-full overflow-hidden transition-all ${
            cameraActive ? 'h-44' : 'h-0'
          }`}
        />

        {!cameraActive && (
          <button
            type="button"
            onClick={handleToggleCamera}
            className="flex h-20 w-full items-center justify-center gap-2.5 bg-neutral-100 text-sm font-bold text-neutral-800 transition-colors hover:bg-neutral-200/70 active:scale-[0.99]"
          >
            <Camera className="h-5 w-5 text-neutral-700" />
            Ligar Câmera (EAN-13 / EAN-8)
          </button>
        )}

        {cameraActive && (
          <div className="absolute right-2 bottom-2 flex items-center gap-2">
            {torchSupported && (
              <button
                type="button"
                onClick={handleToggleTorch}
                aria-label="Alternar lanterna"
                className={`flex h-10 w-10 items-center justify-center rounded-xl backdrop-blur-md transition-all active:scale-95 ${
                  torchOn
                    ? 'bg-amber-400 text-neutral-950'
                    : 'bg-black/60 text-white'
                }`}
              >
                <Flashlight className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={handleToggleCamera}
              aria-label="Desligar câmera"
              className="flex h-10 items-center gap-1.5 rounded-xl bg-black/65 px-3 text-xs font-bold text-white backdrop-blur-md active:scale-95"
            >
              <CameraOff className="h-4 w-4" />
              Desligar
            </button>
          </div>
        )}
      </div>

      {cameraError && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {cameraError}
        </p>
      )}

      {/* Input manual numérico */}
      <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Digitar ou colar EAN-13 / EAN-8..."
            value={ean}
            onChange={(e) => handleManualInput(e.target.value)}
            className="h-12 w-full rounded-xl border border-neutral-300 bg-neutral-50 pr-10 pl-3.5 font-mono text-base font-semibold text-neutral-900 placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:text-neutral-400 focus:border-neutral-900 focus:bg-white focus:outline-none"
          />
          {ean && (
            <button
              type="button"
              onClick={() => onEanChange('')}
              aria-label="Limpar EAN"
              className="absolute top-1/2 right-2.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="submit"
          aria-label="Buscar EAN"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white active:scale-95"
        >
          <Search className="h-5 w-5" />
        </button>
      </form>
    </section>
  )
}
