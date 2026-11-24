import JsBarcode from 'jsbarcode'
import type { LabelRenderData } from '../types/label'
import { formatBRLValue, wrapUppercaseWords } from './formatters'

export const LABEL_WIDTH = 400
export const LABEL_HEIGHT = 240
const SAFE_BOTTOM_MARGIN = 16
const SIDE_PADDING = 14

/**
 * Renderiza uma etiqueta de gôndola 50x30mm (400x240px @ 203 DPI) em um canvas.
 */
export function renderLabelToCanvas(
  canvas: HTMLCanvasElement,
  data: LabelRenderData
): void {
  canvas.width = LABEL_WIDTH
  canvas.height = LABEL_HEIGHT

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Fundo branco sólido para impressão térmica 1-bit
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT)
  ctx.imageSmoothingEnabled = false

  let cursorY = 6

  // 1. Tarja preta "OFERTA" (se ativo)
  if (data.is_promo) {
    const bannerH = 26
    ctx.fillStyle = '#000000'
    ctx.fillRect(SIDE_PADDING, cursorY, LABEL_WIDTH - SIDE_PADDING * 2, bannerH)

    ctx.fillStyle = '#FFFFFF'
    ctx.font = '800 17px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('OFERTA', LABEL_WIDTH / 2, cursorY + bannerH / 2 + 1)

    cursorY += bannerH + 5
  }

  // 2. Descrição opcional (MAIÚSCULO, máx. 2 linhas sem cortar palavras)
  const descTrimmed = data.descricao.trim()
  if (descTrimmed) {
    ctx.fillStyle = '#000000'
    ctx.font = '700 18px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    const lines = wrapUppercaseWords(
      descTrimmed,
      LABEL_WIDTH - SIDE_PADDING * 2,
      ctx,
      2
    )
    const lineHeight = 20
    for (const line of lines) {
      ctx.fillText(line, LABEL_WIDTH / 2, cursorY)
      cursorY += lineHeight
    }
    cursorY += 3
  } else if (!data.is_promo) {
    // Espaço superior mínimo quando não há descrição nem oferta
    cursorY += 8
  }

  // 3. Preço na base com margem inferior segura de 16px
  const priceText = `R$ ${formatBRLValue(data.preco)}`
  const priceBottomY = LABEL_HEIGHT - SAFE_BOTTOM_MARGIN
  ctx.fillStyle = '#000000'
  ctx.font = '900 42px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(priceText, LABEL_WIDTH / 2, priceBottomY)

  // Altura aproximada ocupada pelo preço
  const priceTopY = priceBottomY - 44

  // 4. Código de barras no espaço central disponível
  const cleanEan = data.ean.replace(/\D/g, '')
  const availableBarcodeH = Math.max(42, priceTopY - cursorY - 4)
  const digitFontSize = 15
  const barHeight = Math.max(28, Math.min(72, availableBarcodeH - digitFontSize - 6))

  if (cleanEan.length > 0) {
    const barcodeCanvas = document.createElement('canvas')
    const rendered = tryRenderBarcode(barcodeCanvas, cleanEan, barHeight, digitFontSize)

    if (rendered) {
      // Centraliza sem distorcer; reduz apenas se ultrapassar a largura útil
      const maxBarW = LABEL_WIDTH - SIDE_PADDING * 2
      const scale = barcodeCanvas.width > maxBarW ? maxBarW / barcodeCanvas.width : 1
      const drawW = Math.round(barcodeCanvas.width * scale)
      const drawH = Math.round(barcodeCanvas.height * scale)
      const drawX = Math.round((LABEL_WIDTH - drawW) / 2)
      const drawY = Math.round(cursorY + (availableBarcodeH - drawH) / 2)

      ctx.drawImage(barcodeCanvas, drawX, drawY, drawW, drawH)
    }
  } else {
    ctx.fillStyle = '#9CA3AF'
    ctx.font = '600 13px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('DIGITE OU BIPE UM EAN', LABEL_WIDTH / 2, cursorY + availableBarcodeH / 2)
  }
}

function tryRenderBarcode(
  target: HTMLCanvasElement,
  code: string,
  barHeight: number,
  fontSize: number
): boolean {
  const preferredFormat =
    code.length === 13 ? 'EAN13' : code.length === 8 ? 'EAN8' : 'CODE128'

  const formatsToTry =
    preferredFormat === 'CODE128' ? ['CODE128'] : [preferredFormat, 'CODE128']

  for (const format of formatsToTry) {
    try {
      JsBarcode(target, code, {
        format,
        width: 2,
        height: barHeight,
        displayValue: true,
        fontSize,
        fontOptions: 'bold',
        font: 'monospace',
        textMargin: 2,
        margin: 0,
        background: '#FFFFFF',
        lineColor: '#000000',
      })
      return true
    } catch {
      // Tenta próximo formato se o dígito verificador ainda estiver incompleto
    }
  }
  return false
}

/**
 * Gera um canvas offscreen pronto para impressão em lote.
 */
export function createRenderedLabelCanvas(data: LabelRenderData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  renderLabelToCanvas(canvas, data)
  return canvas
}

/**
 * Baixa o canvas como PNG 50x30mm (fallback quando Web Bluetooth não está disponível).
 */
export function downloadLabelPng(canvas: HTMLCanvasElement, ean: string): void {
  const link = document.createElement('a')
  const safeEan = ean.replace(/\D/g, '') || 'etiqueta'
  link.download = `origami-${safeEan}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}
