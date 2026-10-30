import { mergeDocs } from './validate'
import cfp from './cfp'

// Registro de las explicaciones del botón "i" del dashboard v2 (reglas en
// validate.js). Cada pestaña suma acá su módulo (cfp, finance, commercial,
// attendance) cuando se porta, con sus muestras en docSamples.js: el test de
// integridad exige una muestra por explicación.
export const DOCS = mergeDocs({ cfp })
