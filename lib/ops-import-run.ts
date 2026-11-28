/**
 * lib/ops-import-run.ts — traitement d'UN fichier d'export, partagé par l'envoi automatique (POST /api/v1/import, clé d'API : le système d'Imad
 * envoie le fichier toutes les 5 minutes) et l'import manuel (POST /api/ops/import, écran du Dashboard).
 * Étapes : contrôle du fichier → lecture → cartographie → (dryRun : résumé seul) → enregistrement incrémental.
 */
import { validateUploadFile, parseSpreadsheetRows } from '@/lib/xlsx-import'
import { mapExportRows, EXPORT_COLUMNS, REQUIRED_COLUMNS } from '@/lib/ops-import'
import { saveImport, ImportBusyError } from '@/lib/ops-import-db'

export interface ImportOutcome { status: number; body: Record<string, unknown>; saved?: { inserted: number; replaced: number; unchanged: number }; summary?: Record<string, unknown> }

export async function runImport(buf: Buffer, fileName: string, opts: { dryRun: boolean }): Promise<ImportOutcome> {
  const check = validateUploadFile(fileName, buf)
  if (!check.ok) return { status: check.status, body: { error: check.error } }

  let rows: Record<string, unknown>[]
  try { rows = await parseSpreadsheetRows(buf, check.kind) } catch { return { status: 422, body: { error: 'Fichier illisible : vérifiez qu\'il s\'agit bien d\'un export .csv ou .xlsx non corrompu.' } } }
  const m = mapExportRows(rows)
  if (m.missingColumns.length) return { status: 422, body: { error: `Colonnes obligatoires absentes : ${m.missingColumns.join(', ')}.`, required: REQUIRED_COLUMNS, expected: EXPORT_COLUMNS } }
  if (!m.orders.length) return { status: 422, body: { error: 'Aucune commande exploitable dans ce fichier.', rejected: m.rejected.slice(0, 10) } }

  const summary = {
    dryRun: opts.dryRun, fileName, rows: m.rows, unique: m.unique, duplicates: m.duplicates, rejected: m.rejected.length, rejectedSample: m.rejected.slice(0, 10),
    period: m.period, statuses: m.statuses, unknownStatuses: m.unknownStatuses, hubs: m.hubs.map(h => h.name),
  }
  if (opts.dryRun) return { status: 200, body: summary, summary }
  try {
    const saved = await saveImport(m)
    return { status: 200, body: { ...summary, ...saved }, saved, summary }
  } catch (e) {
    if (e instanceof ImportBusyError) return { status: 409, body: { error: e.message } }
    throw e
  }
}
