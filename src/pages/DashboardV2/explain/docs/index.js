import { mergeDocs } from './validate'
import cfp from './cfp'
import commercial from './commercial'
import finance from './finance'

// Registro de las explicaciones del botón "i" del dashboard v2 (reglas en
// validate.js). Cada pestaña suma acá su módulo (cfp, finance, commercial,
// attendance) cuando se porta, con sus muestras en docSamples.js: el test de
// integridad exige una muestra por explicación.
export const DOCS = mergeDocs({ cfp, finance, commercial })
