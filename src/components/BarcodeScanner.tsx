import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import {
  Camera,
  CameraOff,
  Flashlight,
  RefreshCw,
  Search,
  X,
  ZoomIn,
} from 'lucide-react'

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

interface DetectedBarcode {
  rawValue: string
}

interface BarcodeDetectorInstance {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance
  getSupportedFormats?: () => Promise<string[]>
}

const SCANNER_REGION_ID = 'qr-reader'

function getBarcodeDetectorCtor(): BarcodeDetectorConstructor | null {
  const win = window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
  return win.BarcodeDetector ?? null
}

function isValidEanCheckDigit(code: string): boolean {
  if (!/^\d{8}$|^\d{13}$/.test(code)) return false
  const digits = code.split('').map(Number)
  const checkDigit = digits[digits.length - 1]
  let sum = 0
  for (let i = digits.length - 2, pos = 0; i >= 0; i--, pos++) {
    sum += digits[i] * (pos % 2 === 0 ? 3 : 1)
  }
  const expected = (10 - (sum % 10)) % 10
  return expected === checkDigit
}

async function listRearCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []

  let devices = await navigator.mediaDevices.enumerateDevices()
  let videoInputs = devices.filter((d) => d.kind === 'videoinput')

  // Se os labels vierem vazios, solicita permissão brevemente para expor os nomes das lentes
  if (videoInputs.length > 0 && videoInputs.every((d) => !d.label)) {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      tempStream.getTracks().forEach((t) => t.stop())
      devices = await navigator.mediaDevices.enumerateDevices()
      videoInputs = devices.filter((d) => d.kind === 'videoinput')
    } catch {
      return []
    }
  }

  const rear = videoInputs.filter(
    (d) => !/front|user|selfie|frontal/i.test(d.label)
  )
  const pool = rear.length > 0 ? rear : videoInputs

  // Ordena colocando lentes principais primeiro e ultra-wide/macro depois
  return [...pool].sort((a, b) => {
    const score = (label: string) => {
      if (/ultra|wide|0\.5|0\.6/i.test(label)) return 2
      if (/back\s*0|camera2\s*0|main|principal/i.test(label)) return 0
      return 1
    }
    return score(a.label) - score(b.label)
  })
}

export function BarcodeScanner({
  ean,
  onEanChange,
  onBarcodeDetected,
}: BarcodeScannerProps) {
  const [cameraActive, setCameraActive] = useState(false)
  const [usingNativeDetector, setUsingNativeDetector] = useState(false)
  const [rearCameras, setRearCameras] = useState<MediaDeviceInfo[]>([])
  const [lensIndex, setLensIndex] = useState(0)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [zoom2x, setZoom2x] = useState(false)
  const [cssZoomFallback, setCssZoomFallback] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const nativeVideoRef = useRef<HTMLVideoElement | null>(null)
  const nativeStreamRef = useRef<MediaStream | null>(null)
  const rafIdRef = useRef<number | null>(null)
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

  const getActiveTrack = useCallback((): MediaStreamTrack | null => {
    if (nativeStreamRef.current) {
      return nativeStreamRef.current.getVideoTracks()[0] ?? null
    }
    const video = document.querySelector<HTMLVideoElement>(
      `#${SCANNER_REGION_ID} video`
    )
    const stream = video?.srcObject
    if (stream instanceof MediaStream) {
      return stream.getVideoTracks()[0] ?? null
    }
    return null
  }, [])

  const handleDecodedCandidate = useCallback((decodedText: string) => {
    const clean = decodedText.replace(/\D/g, '')
    if (!isValidEanCheckDigit(clean)) return

    if (consecutiveScanRef.current.code === clean) {
      consecutiveScanRef.current.count += 1
    } else {
      consecutiveScanRef.current = { code: clean, count: 1 }
    }

    if (consecutiveScanRef.current.count < 2) return

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
  }, [])

  const stopCamera = useCallback(async () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }

    if (nativeStreamRef.current) {
      nativeStreamRef.current.getTracks().forEach((t) => t.stop())
      nativeStreamRef.current = null
    }

    if (nativeVideoRef.current) {
      nativeVideoRef.current.srcObject = null
    }

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
    setUsingNativeDetector(false)
    setTorchOn(false)
    setTorchSupported(false)
    setZoom2x(false)
    setCssZoomFallback(false)
  }, [])

  const configureActiveTrack = useCallback(async (track: MediaStreamTrack | null) => {
    if (!track) return
    try {
      const caps = track.getCapabilities?.() as
        | ExtendedMediaTrackCapabilities
        | undefined
      if (caps?.focusMode?.includes('continuous')) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous' } as ExtendedConstraintSet],
        })
      }
      if (caps?.torch) {
        setTorchSupported(true)
      }
    } catch {
      // ignore unsupported track constraints
    }
  }, [])

  const startCameraWithLens = useCallback(
    async (targetLensIdx: number) => {
      await stopCamera()
      setCameraError(null)

      try {
        const cameras = await listRearCameras()
        setRearCameras(cameras)

        const safeIndex =
          cameras.length > 0 ? targetLensIdx % cameras.length : 0
        setLensIndex(safeIndex)
        const chosenDeviceId = cameras[safeIndex]?.deviceId

        const baseVideoConstraints: MediaTrackConstraints = {
          ...(chosenDeviceId
            ? { deviceId: { exact: chosenDeviceId } }
            : { facingMode: 'environment' }),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        }

        // 1. Preferência: BarcodeDetector nativo (ML Kit no Chrome Android)
        const DetectorCtor = getBarcodeDetectorCtor()
        if (DetectorCtor && nativeVideoRef.current) {
          try {
            let supportsEan = true
            if (DetectorCtor.getSupportedFormats) {
              const supported = await DetectorCtor.getSupportedFormats()
              supportsEan =
                supported.includes('ean_13') || supported.includes('ean_8')
            }

            if (supportsEan) {
              const detector = new DetectorCtor({
                formats: ['ean_13', 'ean_8'],
              })
              const stream = await navigator.mediaDevices.getUserMedia({
                video: baseVideoConstraints,
                audio: false,
              })

              nativeStreamRef.current = stream
              const videoEl = nativeVideoRef.current
              videoEl.srcObject = stream
              await videoEl.play()

              setUsingNativeDetector(true)
              setCameraActive(true)

              const track = stream.getVideoTracks()[0] ?? null
              await configureActiveTrack(track)

              let detecting = false
              const scanLoop = () => {
                if (!nativeStreamRef.current || !nativeVideoRef.current) return
                if (!detecting && nativeVideoRef.current.readyState >= 2) {
                  detecting = true
                  detector
                    .detect(nativeVideoRef.current)
                    .then((barcodes) => {
                      if (barcodes.length > 0 && barcodes[0].rawValue) {
                        handleDecodedCandidate(barcodes[0].rawValue)
                      }
                    })
                    .catch(() => {
                      // ignore transient frame decode errors
                    })
                    .finally(() => {
                      detecting = false
                    })
                }
                rafIdRef.current = requestAnimationFrame(scanLoop)
              }
              rafIdRef.current = requestAnimationFrame(scanLoop)
              return
            }
          } catch {
            // Se falhar, cai no fallback html5-qrcode abaixo
            if (nativeStreamRef.current) {
              nativeStreamRef.current.getTracks().forEach((t) => t.stop())
              nativeStreamRef.current = null
            }
          }
        }

        // 2. Fallback: html5-qrcode (apenas EAN-13 e EAN-8)
        const scanner = new Html5Qrcode(SCANNER_REGION_ID, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
          ],
          verbose: false,
        })
        scannerRef.current = scanner

        await scanner.start(
          chosenDeviceId
            ? { deviceId: { exact: chosenDeviceId } }
            : { facingMode: 'environment' },
          {
            fps: 12,
            aspectRatio: 4 / 3,
            qrbox: (viewfinderWidth, viewfinderHeight) => ({
              width: Math.round(viewfinderWidth * 0.9),
              height: Math.round(viewfinderHeight * 0.7),
            }),
            videoConstraints: baseVideoConstraints,
          },
          (decodedText) => handleDecodedCandidate(decodedText),
          () => {
            // frame without barcode
          }
        )

        setUsingNativeDetector(false)
        setCameraActive(true)

        await configureActiveTrack(getActiveTrack())
        try {
          const torchFeature = scanner
            .getRunningTrackCameraCapabilities()
            .torchFeature()
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
    },
    [configureActiveTrack, getActiveTrack, handleDecodedCandidate, stopCamera]
  )

  useEffect(() => {
    return () => {
      void stopCamera()
    }
  }, [stopCamera])

  const handleToggleCamera = () => {
    if (cameraActive) {
      void stopCamera()
    } else {
      void startCameraWithLens(lensIndex)
    }
  }

  const handleCycleLens = () => {
    if (rearCameras.length <= 1) return
    const nextIdx = (lensIndex + 1) % rearCameras.length
    void startCameraWithLens(nextIdx)
  }

  const handleToggleTorch = async () => {
    if (!cameraActive) return
    const next = !torchOn

    if (scannerRef.current) {
      try {
        const torchFeature = scannerRef.current
          .getRunningTrackCameraCapabilities()
          .torchFeature()
        if (torchFeature.isSupported()) {
          await torchFeature.apply(next)
          setTorchOn(next)
          return
        }
      } catch {
        // fallback via track
      }
    }

    const track = getActiveTrack()
    if (track) {
      try {
        await track.applyConstraints({
          advanced: [{ torch: next } as ExtendedConstraintSet],
        })
        setTorchOn(next)
      } catch {
        setTorchSupported(false)
      }
    }
  }

  const handleToggleZoom = async () => {
    if (!cameraActive) return
    const nextZoom2x = !zoom2x
    const track = getActiveTrack()

    if (track) {
      try {
        const caps = track.getCapabilities?.() as
          | ExtendedMediaTrackCapabilities
          | undefined
        if (caps?.zoom) {
          const targetZoom = nextZoom2x
            ? Math.min(2, caps.zoom.max)
            : Math.max(1, caps.zoom.min)
          await track.applyConstraints({
            advanced: [{ zoom: targetZoom } as ExtendedConstraintSet],
          })
          setCssZoomFallback(false)
          setZoom2x(nextZoom2x)
          return
        }
      } catch {
        // Fallback visual no <video> mantendo resolução nativa 1920x1080
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
        {/* Vídeo nativo para BarcodeDetector */}
        <div
          className={`relative w-full overflow-hidden ${
            cameraActive && usingNativeDetector
              ? 'aspect-[4/3] min-h-[260px]'
              : 'hidden'
          }`}
        >
          <video
            ref={nativeVideoRef}
            playsInline
            muted
            className={`h-full w-full object-cover transition-transform ${
              cssZoomFallback ? 'scale-200' : 'scale-100'
            }`}
          />
          {/* Mira retangular larga 90% x 70% */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[70%] w-[90%] rounded-xl border-2 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.32)]" />
          </div>
        </div>

        {/* Fallback html5-qrcode */}
        <div
          id={SCANNER_REGION_ID}
          className={`w-full overflow-hidden transition-all ${
            cameraActive && !usingNativeDetector
              ? 'aspect-[4/3] min-h-[260px]'
              : 'h-0'
          } ${
            cssZoomFallback
              ? '[&_video]:scale-200 [&_video]:transition-transform'
              : '[&_video]:scale-100 [&_video]:transition-transform'
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
          <div className="absolute right-2.5 bottom-2.5 left-2.5 z-10 flex flex-wrap items-center justify-end gap-1.5">
            {rearCameras.length > 1 && (
              <button
                type="button"
                onClick={handleCycleLens}
                aria-label="Trocar lente"
                className="flex h-10 items-center gap-1.5 rounded-xl bg-black/60 px-3 text-xs font-bold text-white backdrop-blur-md active:scale-95"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Lente {lensIndex + 1}/{rearCameras.length}
              </button>
            )}
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
