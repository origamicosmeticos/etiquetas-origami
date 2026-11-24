import { useEffect, useRef } from 'react'
import { Flame, Minus, Plus } from 'lucide-react'
import { formatBRLValue, formatRelativeUpdateBadge, maskPriceInput } from '../utils/formatters'

interface LabelFormProps {
  descricao: string
  onDescricaoChange: (val: string) => void
  preco: number
  onPrecoChange: (val: number) => void
  isPromo: boolean
  onIsPromoChange: (val: boolean) => void
  copies: number
  onCopiesChange: (val: number) => void
  lastEditStore?: string
  lastEditAt?: string
  isSearching?: boolean
  focusPriceSignal: number
}

export function LabelForm({
  descricao,
  onDescricaoChange,
  preco,
  onPrecoChange,
  isPromo,
  onIsPromoChange,
  copies,
  onCopiesChange,
  lastEditStore,
  lastEditAt,
  isSearching,
  focusPriceSignal,
}: LabelFormProps) {
  const priceInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (focusPriceSignal > 0) {
      priceInputRef.current?.focus()
      priceInputRef.current?.select()
    }
  }, [focusPriceSignal])

  const badgeText = formatRelativeUpdateBadge(lastEditStore, lastEditAt)
  const priceDisplay = formatBRLValue(preco)

  const handlePriceChange = (raw: string) => {
    const { numeric } = maskPriceInput(raw)
    onPrecoChange(numeric)
  }

  return (
    <section className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-2xs">
      {/* Descrição Opcional e Sempre Editável */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label
            htmlFor="label-desc"
            className="text-xs font-bold tracking-wide text-neutral-500 uppercase"
          >
            Descrição (Opcional)
          </label>
          {isSearching && (
            <span className="text-[11px] font-medium text-neutral-400">
              Buscando...
            </span>
          )}
        </div>
        <input
          id="label-desc"
          type="text"
          value={descricao}
          onChange={(e) => onDescricaoChange(e.target.value)}
          placeholder="Nome do produto (opcional)"
          maxLength={80}
          className="h-12 w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3.5 text-base font-semibold text-neutral-900 placeholder:font-normal placeholder:text-neutral-400 focus:border-neutral-900 focus:bg-white focus:outline-none"
        />
      </div>

      {/* Preço (R$) com máscara brasileira e fonte extra grande */}
      <div>
        <label
          htmlFor="label-price"
          className="mb-1 block text-xs font-bold tracking-wide text-neutral-500 uppercase"
        >
          Preço
        </label>
        <div className="relative flex items-center rounded-xl border border-neutral-300 bg-neutral-50 px-3.5 focus-within:border-neutral-900 focus-within:bg-white">
          <span className="mr-2 text-2xl font-extrabold text-neutral-400 select-none">
            R$
          </span>
          <input
            ref={priceInputRef}
            id="label-price"
            type="text"
            inputMode="decimal"
            value={priceDisplay}
            onChange={(e) => handlePriceChange(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="h-16 w-full bg-transparent text-4xl font-black tracking-tight text-neutral-900 focus:outline-none"
          />
        </div>

        {badgeText && (
          <p className="mt-1.5 px-0.5 text-[11px] font-medium text-neutral-400">
            {badgeText}
          </p>
        )}
      </div>

      {/* Modo Oferta + Cópias */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {/* Toggle Oferta */}
        <button
          type="button"
          onClick={() => onIsPromoChange(!isPromo)}
          aria-pressed={isPromo}
          className={`flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-extrabold transition-all active:scale-95 ${
            isPromo
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-300 bg-neutral-50 text-neutral-700'
          }`}
        >
          <Flame className={`h-4 w-4 ${isPromo ? 'text-amber-400' : 'text-neutral-400'}`} />
          Modo Oferta
        </button>

        {/* Seletor rápido de cópias: 1, 2, 3, + */}
        <div className="flex items-center gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onCopiesChange(n)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-extrabold transition-all active:scale-95 ${
                copies === n
                  ? 'bg-neutral-900 text-white shadow-2xs'
                  : 'text-neutral-600 hover:bg-white'
              }`}
            >
              {n}
            </button>
          ))}

          {copies > 3 && (
            <>
              <button
                type="button"
                onClick={() => onCopiesChange(Math.max(1, copies - 1))}
                aria-label="Menos cópias"
                className="flex h-9 w-8 items-center justify-center rounded-lg bg-white text-neutral-800 active:scale-95"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-7 text-center text-sm font-black text-neutral-900">
                {copies}
              </span>
            </>
          )}

          <button
            type="button"
            onClick={() => onCopiesChange(Math.min(99, copies < 3 ? 4 : copies + 1))}
            aria-label="Mais cópias"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-neutral-900 shadow-2xs active:scale-95"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  )
}
