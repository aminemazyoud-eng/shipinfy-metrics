// Aide pour les scripts de test : permet à Node (>= 22.15, suppression de types native) d'importer les fichiers lib/*.ts
// qui utilisent l'alias '@/...' (résolu vers la racine du projet, extension .ts). Aucune dépendance.
import { registerHooks } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = path.join(root, specifier.slice(2))
      const file = [base, base + '.ts', path.join(base, 'index.ts')].find(f => path.extname(f) && existsSync(f))
      if (file) return nextResolve(pathToFileURL(file).href, context)
    }
    return nextResolve(specifier, context)
  },
})

export const projectRoot = root
export const lib = (name) => import(pathToFileURL(path.join(root, 'lib', name)).href)
