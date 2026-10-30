// Reglas de las explicaciones del botón "i". Cada explicación es
// ctx => ({ title, unit, what, rows, total, source, caveat }):
//   · rows: [{ label, value | text, op, info }]. `value` es la contribución CON signo
//     al total (un gasto que resta va negativo, con op '−'; sin op suma, como la
//     base). `text` reemplaza al importe cuando la fila no es plata. `info: true`
//     marca una fila que aclara pero no suma (p. ej. "del total, paquetes
//     prepagos"). op '=' es un subtotal: tiene que valer lo que suman las filas de
//     arriba, y la cuenta sigue desde él.
//   · total: { label, value | text, check }. Si el total es un importe, las filas
//     tienen que sumarlo; `check: false` apaga las cuentas cuando no son sumas.

export const OPS = ['+', '−', '×', '÷', '=']

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const isText = v => typeof v === 'string' && v.trim() !== ''

// Lo que se muestra si una explicación se rompe con los datos del mes: mejor un
// aviso que un botón que no hace nada o una pantalla caída.
export const FALLBACK_DOC = {
  title: 'Explicación no disponible',
  what: 'Faltan datos de este mes para armar esta explicación.',
  rows: []
}

// Una "i" con un id que no está en el registro (el test de integridad solo ve los
// ids escritos en el código, no los que se arman en tiempo de ejecución).
export const MISSING_DOC = {
  title: 'Explicación no encontrada',
  what: 'Este número todavía no tiene su explicación.',
  rows: []
}

// Un dato faltante que se coló en un texto: tiene que verse '—', nunca esto.
const LEAKED = /\b(undefined|null|NaN|Infinity)\b/

// Junta los módulos de cada pestaña en un solo registro. Un id repetido es un error:
// la segunda explicación pisaría a la primera sin avisar.
export function mergeDocs(modules) {
  const merged = {}
  for (const [section, docs] of Object.entries(modules)) {
    for (const [id, build] of Object.entries(docs)) {
      if (id in merged) throw new Error(`Explicación duplicada: "${id}" (${section})`)
      if (typeof build !== 'function') throw new Error(`La explicación "${id}" (${section}) no es una función`)
      merged[id] = build
    }
  }
  return merged
}

export function buildDoc(docs, id, ctx) {
  const build = docs[id]
  if (!build) {
    console.error(`No existe la explicación "${id}"`)
    return MISSING_DOC
  }
  try {
    return build(ctx)
  } catch (error) {
    console.error(`No se pudo armar la explicación "${id}"`, error)
    return FALLBACK_DOC
  }
}

// Problemas de forma de una explicación ya armada. `complete`: el contexto tiene
// todos los datos, así que además cada fila tiene que tener valor y las filas
// tienen que sumar el total.
export function docProblems(doc, { complete = true } = {}) {
  if (!doc || typeof doc !== 'object') return ['no devuelve un objeto']
  const problems = []

  for (const field of ['title', 'what', 'source']) {
    if (!isText(doc[field])) problems.push(`falta ${field}`)
  }
  if (doc.unit != null && !(Array.isArray(doc.unit) && doc.unit.every(isText))) {
    problems.push('unit tiene que ser una lista de textos')
  }
  if (doc.caveat != null && !isText(doc.caveat)) problems.push('caveat vacío')
  if (!Array.isArray(doc.rows)) return [...problems, 'rows tiene que ser una lista']

  const named = doc.rows.map((row, i) => [row, `fila ${i + 1}`])
  if (doc.total != null) named.push([doc.total, 'total'])
  for (const [row, name] of named) {
    if (!row || !isText(row.label)) problems.push(`${name}: sin label`)
    if (row?.op != null && !OPS.includes(row.op)) problems.push(`${name}: op "${row.op}" no válido`)
    if (row?.text != null && typeof row.text !== 'string') problems.push(`${name}: text tiene que ser texto`)
    if (!complete || row?.text != null) continue
    if (!isNum(row?.value)) {
      problems.push(`${name}: sin valor con los datos completos`)
    } else if ((row.op === '−' && row.value > 0) || (row.op === '+' && row.value < 0)) {
      problems.push(`${name}: el signo del valor no coincide con "${row.op}"`)
    }
  }

  const texts = [doc.title, doc.what, doc.source, doc.caveat, ...(doc.unit || []), ...named.flatMap(([r]) => [r?.label, r?.text])]
  const leaked = texts.find(t => typeof t === 'string' && LEAKED.test(t))
  if (leaked) problems.push(`un dato faltante se ve en el texto: "${leaked}"`)

  if (complete && doc.total?.check !== false) problems.push(...arithmeticProblems(named, doc.total))
  return problems
}

// Cuentas de la explicación: las filas suman hasta cada subtotal '=' y hasta el
// total. Tolerancia de un peso: los componentes se redondean por separado.
function arithmeticProblems(named, total) {
  const parts = named.filter(([r]) => r && r !== total && r.text == null && !r.info)
  if (parts.some(([r]) => r.op === '×' || r.op === '÷')) {
    return isNum(total?.value) ? ['usa × o ÷: el total no es una suma, marcar total.check = false'] : []
  }
  const problems = []
  let running = 0
  for (const [row, name] of parts) {
    if (!isNum(row.value)) continue
    if (row.op !== '=') {
      running += row.value
      continue
    }
    if (Math.abs(running - row.value) > 1) {
      problems.push(`${name}: el subtotal dice ${Math.round(row.value)} y las filas de arriba suman ${Math.round(running)}`)
    }
    running = row.value
  }
  if (isNum(total?.value) && Math.abs(running - total.value) > 1) {
    problems.push(`las filas suman ${Math.round(running)} y el total dice ${Math.round(total.value)}`)
  }
  return problems
}
