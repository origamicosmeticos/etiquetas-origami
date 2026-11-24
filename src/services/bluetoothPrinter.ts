interface WebBluetoothCharacteristic {
  properties: {
    write: boolean
    writeWithoutResponse: boolean
  }
  writeValueWithResponse?(value: BufferSource): Promise<void>
  writeValueWithoutResponse?(value: BufferSource): Promise<void>
  writeValue?(value: BufferSource): Promise<void>
}

interface WebBluetoothService {
  getCharacteristics(): Promise<WebBluetoothCharacteristic[]>
}

interface WebBluetoothServer {
  connected: boolean
  connect(): Promise<WebBluetoothServer>
  disconnect(): void
  getPrimaryServices(): Promise<WebBluetoothService[]>
}

interface WebBluetoothDevice {
  id: string
  name?: string
  gatt?: WebBluetoothServer
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

interface NavigatorWithBluetooth extends Navigator {
  bluetooth?: {
    requestDevice(options: {
      acceptAllDevices?: boolean
      optionalServices?: string[]
    }): Promise<WebBluetoothDevice>
  }
}

// UUIDs comuns em impressoras térmicas Bluetooth 58mm (ESC/POS)
const THERMAL_PRINTER_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
]

export function isWebBluetoothSupported(): boolean {
  const nav = navigator as NavigatorWithBluetooth
  return typeof navigator !== 'undefined' && Boolean(nav.bluetooth)
}

class BluetoothThermalPrinter {
  private device: WebBluetoothDevice | null = null
  private characteristic: WebBluetoothCharacteristic | null = null
  private disconnectListeners = new Set<() => void>()

  get isConnected(): boolean {
    return Boolean(this.device?.gatt?.connected && this.characteristic)
  }

  get deviceName(): string {
    return this.device?.name || 'Impressora Térmica'
  }

  onDisconnect(cb: () => void): () => void {
    this.disconnectListeners.add(cb)
    return () => this.disconnectListeners.delete(cb)
  }

  private handleDisconnected = () => {
    this.characteristic = null
    this.disconnectListeners.forEach((cb) => cb())
  }

  async connect(): Promise<string> {
    const nav = navigator as NavigatorWithBluetooth
    if (!nav.bluetooth) {
      throw new Error('Web Bluetooth não é suportado neste navegador.')
    }

    const device = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: THERMAL_PRINTER_SERVICE_UUIDS,
    })

    if (!device.gatt) {
      throw new Error('Dispositivo Bluetooth sem suporte GATT.')
    }

    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.handleDisconnected)
    }

    this.device = device
    this.device.addEventListener('gattserverdisconnected', this.handleDisconnected)

    const server = await device.gatt.connect()
    const services = await server.getPrimaryServices()

    let writableChar: WebBluetoothCharacteristic | null = null
    for (const service of services) {
      const chars = await service.getCharacteristics()
      for (const char of chars) {
        if (char.properties.writeWithoutResponse || char.properties.write) {
          writableChar = char
          break
        }
      }
      if (writableChar) break
    }

    if (!writableChar) {
      server.disconnect()
      throw new Error('Nenhuma característica de escrita ESC/POS encontrada.')
    }

    this.characteristic = writableChar
    return this.deviceName
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect()
    }
    this.characteristic = null
  }

  /**
   * Converte um canvas (400x240px) em bitmap monocromático 1-bit ESC/POS (GS v 0)
   * e envia para a impressora em blocos seguros de MTU.
   */
  async printCanvas(
    canvas: HTMLCanvasElement,
    feedLines = 2
  ): Promise<void> {
    if (!this.isConnected || !this.characteristic) {
      throw new Error('Impressora Bluetooth não conectada.')
    }

    const payload = buildEscPosRasterPayload(canvas, feedLines)
    const chunkSize = 100

    for (let offset = 0; offset < payload.length; offset += chunkSize) {
      const chunk = payload.slice(offset, offset + chunkSize)
      if (
        this.characteristic.properties.writeWithoutResponse &&
        this.characteristic.writeValueWithoutResponse
      ) {
        await this.characteristic.writeValueWithoutResponse(chunk)
      } else if (this.characteristic.writeValueWithResponse) {
        await this.characteristic.writeValueWithResponse(chunk)
      } else if (this.characteristic.writeValue) {
        await this.characteristic.writeValue(chunk)
      }
      await sleep(14)
    }
  }
}

export const bluetoothPrinter = new BluetoothThermalPrinter()

/**
 * Gera comandos ESC/POS:
 * - ESC @ (Initialize)
 * - GS v 0 (Raster bit image, normal mode)
 * - ESC d n (Feed n lines para calibragem)
 */
export function buildEscPosRasterPayload(
  canvas: HTMLCanvasElement,
  feedLines: number
): Uint8Array {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Contexto 2D indisponível.')

  const width = canvas.width
  const height = canvas.height
  const bytesPerRow = Math.ceil(width / 8)
  const imageData = ctx.getImageData(0, 0, width, height).data

  const rasterBytes = new Uint8Array(bytesPerRow * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = imageData[idx]
      const g = imageData[idx + 1]
      const b = imageData[idx + 2]
      const a = imageData[idx + 3]

      // Luminância perceptual; pixel escuro (< 160) vira bit 1 (ponto térmico)
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b
      if (a > 128 && luminance < 160) {
        const byteIndex = y * bytesPerRow + (x >> 3)
        rasterBytes[byteIndex] |= 0x80 >> (x & 7)
      }
    }
  }

  const xL = bytesPerRow & 0xff
  const xH = (bytesPerRow >> 8) & 0xff
  const yL = height & 0xff
  const yH = (height >> 8) & 0xff

  const safeFeed = Math.max(0, Math.min(20, Math.round(feedLines)))

  // ESC @ (2) + GS v 0 m xL xH yL yH (8) + raster + ESC d n (3)
  const header = new Uint8Array([
    0x1b, 0x40,
    0x1d, 0x76, 0x30, 0x00,
    xL, xH, yL, yH,
  ])
  const footer = new Uint8Array([0x1b, 0x64, safeFeed])

  const result = new Uint8Array(header.length + rasterBytes.length + footer.length)
  result.set(header, 0)
  result.set(rasterBytes, header.length)
  result.set(footer, header.length + rasterBytes.length)
  return result
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
