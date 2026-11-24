import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { Camera, CameraOff, Flashlight, Search, X, ZoomIn } from 'lucide-react'

interface BarcodeScannerProps {
  ean: string
  onEanChange: (ean: string) => void
  onBarcodeDetected: (ean: string) => void
}

interface ExtendedMediaTrackCapabilities extends MediaTrackCapabilities {
  focusMode?: string[]
  zoom?: { min: number; max: number; step: number }
  torch?: boolean
}

interface ExtendedConstraintSet extends MediaTrackConstraintSet {
  focusMode?: string
  zoom?: number
  torch?: boolean
}

const SCANNER_REGION_ID = 'qr-reader'

function isValidEanCheckDigit(code: string): boolean {
  if (!/^\d{8}$|^\d{13}$/.test(code)) return false
  const digits = code.split('').map(Number)
  const checkDigit = digits[digits.length - 1]
  let sum = 0
  // Da direita para a esquerda (excluindo o dígito verificador), pesos alternam 3, 1, 3, 1...
  for (let i = digits.length - 2, pos = 0; i >= 0; i--, pos++) {
    sum += digits[i] * (pos % 2 === 0 ? 3 : 1)
  }
  const expected = (10 - (sum % 10)) % 10
  return expected === checkDigit
}

async function selectMainRearCameraId(): Promise<string | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null

  let devices = await navigator.mediaDevices.enumerateDevices()
  let videoInputs = devices.filter((d) => d.kind === 'videoinput')

  // Se os labels vierem vazios (permissão ainda não concedida), solicita permissão brevemente
  if (videoInputs.length > 0 && videoInputs.every((d) => !d.label)) {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      tempStream.getTracks().forEach((t) => t.stop())
      devices = await navigator.mediaDevices.enumerateDevices()
      videoInputs = devices.filter((d) => d.kind === 'videoinput')
    } catch {
      return null
    }
  }

  if (videoInputs.length === 0) return null

  // Filtra câmeras traseiras (evita frontais)
  const rearCandidates = videoInputs.filter((d) => {
    const label = d.label.toLowerCase()
    const isFront = /front|user|selfie|frontal/.test(label)
    if (isFront) return false
    return /back|rear|traseira|environment/.test(label) || videoInputs.length === 1
  })

  const pool = rearCandidates.length > 0
    ? rearCandidates
    : videoInputs.filter((d) => !/front|user|selfie|frontal/i.test(d.label))

  if (pool.length === 0) return null

  // Exclui lentes ultra-wide / macro ("ultra", "wide", "0.5", "0.6")
  const nonUltraWide = pool.filter(
    (d) => !/ultra|wide|0\.5|0\.6/i.test(d.label)
  )
  const candidates = nonUltraWide.length > 0 ? nonUltraWide : pool

  // Prefere câmera principal ("back 0", "camera2 0", "main")
  const mainCam =
    candidates.find((d) => /back\s*0|camera2\s*0|main|principal/i.test(d.label)) ??
    candidates[0]

  return mainCam?.deviceId || null
}

function getActiveVideoTrack(): MediaStreamTrack | null {
  const video = document.querySelector<HTMLVideoElement>(`#${SCANNER_REGION_ID} video`)
  const stream = video?.srcObject
  if (stream instanceof MediaStream) {
    return stream.getVideoTracks()[0] ?? null
  }
  return null
}

export function BarcodeScanner({
  ean,
  onEanChange,
  onBarcodeDetected,
}: BarcodeScannerProps) {
  const [cameraActive, setCameraActive] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [zoom2x, setZoom2x] = useState(false)
  const [cssZoomFallback, setCssZoomFallback] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastScanRef = useRef<{ code: string; ts: number }>({ code: '', ts: 0 })
  const consecutiveScanRef = useRef<{ code: string; count: number }>({
    code: '',
    count: 0,
  })
  const onDetectedRef = useRef(onBarcodeDetected)

  useEffect(() => {
    onDetectedRef.current = onBarcodeDetected
  }, [onBarcodeDetected])

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
    consecutiveScanRef.current = { code: '', count: 0 }
    setCameraActive(false)
    setTorchOn(false)
    setTorchSupported(false)
    setZoom2x(false)
    setCssZoomFallback(false)
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    consecutiveScanRef.current = { code: '', count: 0 }
    try {
      const mainCameraId = await selectMainRearCameraId()
      const cameraConfig: string | MediaTrackConstraints = mainCameraId
        ? { deviceId: { exact: mainCameraId } }
        : { facingMode: 'environment' }

      const scanner = new Html5Qrcode(SCANNER_REGION_ID, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
        ],
        verbose: false,
      })
      scannerRef.current = scanner

      await scanner.start(
        cameraConfig,
        {
          fps: 12,
          aspectRatio: 4 / 3,
          qrbox: (viewfinderWidth, viewfinderHeight) => ({
            width: Math.min(340, Math.round(viewfinderWidth * 0.85)),
            height: Math.min(140, Math.round(viewfinderHeight * 0.42)),
          }),
          videoConstraints: {
            ...(mainCameraId
              ? { deviceId: { exact: mainCameraId } }
              : { facingMode: 'environment' }),
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        (decodedText) => {
          const clean = decodedText.replace(/\D/g, '')
          if (!isValidEanCheckDigit(clean)) {
            return
          }

          // Exige 2 leituras consecutivas idênticas para evitar leituras parciais/erradas
          if (consecutiveScanRef.current.code === clean) {
            consecutiveScanRef.current.count += 1
          } else {
            consecutiveScanRef.current = { code: clean, count: 1 }
          }

          if (consecutiveScanRef.current.count < 2) {
            return
          }

          const now = Date.now()
          if (
            lastScanRef.current.code === clean &&
            now - lastScanRef.current.ts < 2200
          ) {
            return
          }

          consecutiveScanRef.current = { code: '', count: 0 }
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

      // Configura foco automático contínuo e verifica lanterna na track ativa
      const track = getActiveVideoTrack()
      if (track) {
        try {
          const caps = track.getCapabilities?.() as ExtendedMediaTrackCapabilities | undefined
          if (caps?.focusMode?.includes('continuous')) {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' } as ExtendedConstraintSet],
            })
          }
          if (caps?.torch) {
            setTorchSupported(true)
          }
        } catch {
          // Alguns aparelhos não expõem focusMode/torch via capabilities
        }
      }

      try {
        const capabilities = scanner.getRunningTrackCameraCapabilities()
        const torchFeature = capabilities.torchFeature()
        if (torchFeature.isSupported()) {
          setTorchSupported(true)
        }
      } catch {
        // ignore
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
    const next = !torchOn
    try {
      const torchFeature = scanner.getRunningTrackCameraCapabilities().torchFeature()
      if (torchFeature.isSupported()) {
        await torchFeature.apply(next)
        setTorchOn(next)
        return
      }
    } catch {
      // fallback via MediaStreamTrack
    }

    const track = getActiveVideoTrack()
    if (track) {
      try {
        await track.applyConstraints({
          advanced: [{ torch: next } as ExtendedConstraintSet],
        })
        setTorchOn(next)
        return
      } catch {
        setTorchSupported(false)
      }
    }
  }

  const handleToggleZoom = async () => {
    if (!cameraActive) return
    const nextZoom2x = !zoom2x
    const targetZoom = nextZoom2x ? 2 : 1
    const track = getActiveVideoTrack()

    if (track) {
      try {
        const caps = track.getCapabilities?.() as ExtendedMediaTrackCapabilities | undefined
        if (caps?.zoom) {
          const clampedZoom = Math.min(
            caps.zoom.max,
            Math.max(caps.zoom.min, targetZoom)
          )
          await track.applyConstraints({
            advanced: [{ zoom: clampedZoom } as ExtendedConstraintSet],
          })
          setCssZoomFallback(false)
          setZoom2x(nextZoom2x)
          return
        }
      } catch {
        // Fallback visual caso applyConstraints de zoom falhe
      }
    }

    setCssZoomFallback(nextZoom2x)
    setZoom2x(nextZoom2x)
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
            cameraActive ? 'aspect-[4/3] min-h-[260px]' : 'h-0'
          } ${cssZoomFallback ? '[&_video]:scale-200 [&_video]:transition-transform' : '[&_video]:scale-100 [&_video]:transition-transform'}`}
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
          <div className="absolute right-2.5 bottom-2.5 z-10 flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleZoom}
              aria-label="Alternar zoom"
              className={`flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold backdrop-blur-md transition-all active:scale-95 ${
                zoom2x
                  ? 'bg-emerald-500 text-neutral-950'
                  : 'bg-black/60 text-white'
              }`}
            >
              <ZoomIn className="h-4 w-4" />
              {zoom2x ? 'Zoom 2x' : 'Zoom 1x'}
            </button>
            {torchSupported && (
              <button
                type="button"
                onClick={handleToggleTorch}
                aria-label="Alternar lanterna"
                className={`flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold backdrop-blur-md transition-all active:scale-95 ${
                  torchOn
                    ? 'bg-amber-400 text-neutral-950'
                    : 'bg-black/60 text-white'
                }`}
              >
                <Flashlight className="h-4 w-4" />
                Lanterna
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
