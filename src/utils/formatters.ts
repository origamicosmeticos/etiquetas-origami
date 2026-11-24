/**
 * Formata um número em reais sem o prefixo R$, ex: 15.95 -> "15,95".
 */
export function formatBRLValue(value: number): string {
  const safe = Number.isFinite(value) && value >= 0 ? value : 0
  return safe.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Aplica máscara de centavos estilo PDV brasileiro:
 * Apenas dígitos são considerados ("1595" -> "15,95", "5" -> "0,05").
 */
export function maskPriceInput(raw: string): { display: string; numeric: number } {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (!digits) {
    return { display: '0,00', numeric: 0 }
  }
  const cents = parseInt(digits, 10)
  const numeric = cents / 100
  return {
    display: formatBRLValue(numeric),
    numeric,
  }
}

/**
 * Formata o badge discreto de última atualização:
 * ex.: "Editado em ORI • Hoje às 10:15"
 */
export function formatRelativeUpdateBadge(loja?: string, updatedAt?: string): string | null {
  if (!loja && !updatedAt) return null

  const storePart = loja ? `Editado em ${loja}` : 'Editado'
  if (!updatedAt) return storePart

  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return storePart

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000)

  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')

  let dayLabel = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
  if (diffDays === 0) dayLabel = 'Hoje'
  else if (diffDays === 1) dayLabel = 'Ontem'

  return `${storePart} • ${dayLabel} às ${hh}:${mm}`
}

/**
 * Converte texto para MAIÚSCULO e quebra em até `maxLines` linhas sem cortar palavras ao meio.
 */
export function wrapUppercaseWords(
  text: string,
  maxWidthPx: number,
  ctx: CanvasRenderingContext2D,
  maxLines = 2
): string[] {
  const clean = text.trim().replace(/\s+/g, ' ').toUpperCase()
  if (!clean) return []

  const words = clean.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const candidate = currentLine ? `${currentLine} ${word}` : word

    if (ctx.measureText(candidate).width <= maxWidthPx) {
      currentLine = candidate
      continue
    }

    if (currentLine) {
      lines.push(currentLine)
      currentLine = word
      if (lines.length === maxLines - 1) {
        // Última linha disponível: concatena o restante e ajusta se exceder
        const remaining = words.slice(i).join(' ')
        lines.push(fitWithEllipsis(remaining, maxWidthPx, ctx))
        return lines
      }
    } else {
      // Uma única palavra maior que a largura máxima
      lines.push(fitWithEllipsis(word, maxWidthPx, ctx))
      currentLine = ''
      if (lines.length >= maxLines) return lines
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(fitWithEllipsis(currentLine, maxWidthPx, ctx))
  }

  return lines.slice(0, maxLines)
}

function fitWithEllipsis(text: string, maxWidthPx: number, ctx: CanvasRenderingContext2D): string {
  if (ctx.measureText(text).width <= maxWidthPx) return text
  let trimmed = text
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidthPx) {
    trimmed = trimmed.slice(0, -1)
  }
  return `${trimmed}…`
}
