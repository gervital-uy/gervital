import fs from 'fs'
import path from 'path'
import { DOCS } from './index'
import { DOC_SAMPLES } from './docSamples'
import { docProblems } from './validate'

// Integridad del registro de explicaciones: cada "i" de la pantalla apunta a una
// explicación que existe, cada explicación tiene su muestra, con datos completos
// cierra (las filas suman el total) y con datos parciales no se rompe.

const V2_DIR = path.resolve(__dirname, '../..')

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.jsx?$/.test(entry.name) && !/\.test\.js$/.test(entry.name) ? [full] : []
  })
}

// Ids de <InfoButton id=...> e infoId=...: los literales ("x") y los que aparecen
// entre comillas dentro de una expresión ({cond ? 'a' : 'b'}). Un id que se arma
// con datos en tiempo de ejecución no se ve: para eso está MISSING_DOC.
function referencedIds() {
  const ids = new Map()
  const pattern = /(?:<InfoButton\b[^>]*?\bid|\binfoId)=(?:["']([^"']+)["']|\{([^}]*)\})/g
  for (const file of sourceFiles(V2_DIR)) {
    for (const [, literal, expression] of fs.readFileSync(file, 'utf8').matchAll(pattern)) {
      const found = literal ? [literal] : [...(expression || '').matchAll(/["']([^"']+)["']/g)].map(m => m[1])
      for (const id of found) ids.set(id, path.relative(V2_DIR, file))
    }
  }
  return ids
}

describe('registro de explicaciones', () => {
  test('cada "i" de la pantalla tiene su explicación', () => {
    const missing = [...referencedIds()].filter(([id]) => !(id in DOCS)).map(([id, file]) => `${id} (${file})`)
    expect(missing).toEqual([])
  })

  test('cada explicación tiene su muestra y cada muestra su explicación', () => {
    expect(Object.keys(DOCS).filter(id => !(id in DOC_SAMPLES))).toEqual([])
    expect(Object.keys(DOC_SAMPLES).filter(id => !(id in DOCS))).toEqual([])
  })

  const ids = Object.keys(DOCS)
  if (ids.length === 0) {
    test('todavía no hay explicaciones registradas', () => expect(ids).toEqual([]))
    return
  }

  test.each(ids)('%s cierra con datos completos', id => {
    expect(docProblems(DOCS[id](DOC_SAMPLES[id].full))).toEqual([])
  })

  test.each(ids)('%s no se rompe con datos parciales', id => {
    for (const ctx of [{}, DOC_SAMPLES[id].partial].filter(Boolean)) {
      expect(docProblems(DOCS[id](ctx), { complete: false })).toEqual([])
    }
  })
})
