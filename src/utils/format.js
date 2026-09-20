// Uruguayan peso, no decimals. Uses es-UY grouping (1.284.000) with the $ symbol.
export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-UY', {
    style: 'currency',
    currency: 'UYU',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0
  }).format(amount || 0)
}

// Compact axis/legend labels: 850 → "850", 500000 → "500k", 1200000 → "1,2M".
export function formatCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000) {
    const v = (n / 1_000_000).toFixed(1).replace(/\.0$/, '').replace('.', ',')
    return `${v}M`
  }
  if (abs >= 1_000) {
    return `${Math.round(n / 1_000)}k`
  }
  return String(Math.round(n))
}

// Cédula uruguaya para display: el último dígito es el verificador y va precedido
// por un guion, los miles del resto se separan con punto (12345678 → 1.234.567-8).
// La cédula se guarda siempre sin puntos ni guion, así que esto es solo lectura.
export function formatCedula(value) {
  const raw = String(value ?? '').trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 2) return raw
  const body = digits.slice(0, -1)
  const checkDigit = digits.slice(-1)
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${checkDigit}`
}
