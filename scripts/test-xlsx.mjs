// Test réel des exports/imports Excel (exceljs). Exécution : node scripts/test-xlsx.mjs
import './_ts-alias.mjs'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { lib } from './_ts-alias.mjs'

const { csvToXlsx, xlsxResponse } = await lib('xlsx-response.ts')
const { validateUploadFile, isZip, parseSpreadsheetRows } = await lib('xlsx-import.ts')

let n = 0
const ok = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log('  ok  ' + name) })

const csv = '﻿Réf;Nom;Montant;Code;Note;Tél;Delta\r\n' +
  'R-1;Élève Ça;12,50;00123;"=HYPERLINK(""x"")";+212 6 12 34 56 78;-5\r\n' +
  'R-2;Zoé;1500;00045;@cmd;0612345678;-3,25\r\n'

const buf = await csvToXlsx(csv, 'Test/Feuille')
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf)
const ws = wb.worksheets[0]

await ok('onglet nettoyé et ZIP valide', () => { assert.ok(isZip(buf)); assert.equal(ws.name, 'Test Feuille') })
await ok('accents conservés', () => { assert.equal(ws.getCell('B2').value, 'Élève Ça'); assert.equal(ws.getCell('A1').value, 'Réf') })
await ok('nombres à virgule typés', () => { assert.equal(ws.getCell('C2').value, 12.5); assert.equal(typeof ws.getCell('C3').value, 'number'); assert.equal(ws.getCell('G3').value, -3.25) })
await ok('code 00123 reste du texte', () => { assert.equal(ws.getCell('D2').value, '00123'); assert.equal(typeof ws.getCell('D2').value, 'string') })
await ok('formule neutralisée (apostrophe, pas de formule)', () => {
  const v = ws.getCell('E2').value
  assert.equal(typeof v, 'string'); assert.equal(v, '\'=HYPERLINK("x")'); assert.equal(ws.getCell('E3').value, "'@cmd")
})
await ok('téléphone numérique non préfixé, colonne Tél texte', () => { assert.equal(ws.getCell('F2').value, '+212 6 12 34 56 78'); assert.equal(ws.getCell('F3').value, '0612345678') })
await ok('ligne d\'en-tête figée et colonnes dimensionnées', () => { assert.equal(ws.views[0]?.state, 'frozen'); assert.equal(ws.views[0]?.ySplit, 1); assert.ok(ws.getColumn(2).width >= 8) })
await ok('xlsxResponse : flux + en-têtes', async () => {
  const r = xlsxResponse(csv, 'export.csv', 'X')
  assert.match(r.headers.get('content-disposition'), /export\.xlsx/)
  const b = Buffer.from(await r.arrayBuffer()); assert.ok(isZip(b))
})

// Import (worker exceljs) : formule -> valeur calculée, jamais évaluée
await ok('import : lecture, formule = result, date ISO', async () => {
  const w = new ExcelJS.Workbook(); const s1 = w.addWorksheet('S')
  s1.addRow(['order_id', 'montant', 'date']); s1.addRow(['A1', { formula: '1+1', result: 2 }, new Date('2026-01-02T03:04:05Z')]); s1.addRow([null, null, null])
  const rows = await parseSpreadsheetRows(Buffer.from(await w.xlsx.writeBuffer()), 'xlsx')
  assert.equal(rows.length, 1); assert.equal(rows[0].order_id, 'A1'); assert.equal(rows[0].montant, 2); assert.equal(rows[0].date, '2026-01-02T03:04:05.000Z')
  const c = await parseSpreadsheetRows(Buffer.from('a;b\n1;x\n;\n'), 'csv'); assert.equal(c.length, 1); assert.equal(c[0].b, 'x')
})

// Validation des uploads
const pk = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])
await ok('xlsx valide accepté', () => assert.deepEqual(validateUploadFile('a.xlsx', pk), { ok: true, kind: 'xlsx' }))
await ok('fichier non-ZIP renommé .xlsx refusé', () => { const r = validateUploadFile('a.xlsx', Buffer.from('MZ not a zip file')); assert.equal(r.ok, false) })
await ok('.xls binaire refusé avec message clair', () => { const r = validateUploadFile('a.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0])); assert.equal(r.ok, false); assert.match(r.error, /\.xls/) })
await ok('> 10 Mo refusé (413)', () => { const r = validateUploadFile('a.xlsx', Buffer.concat([pk, Buffer.alloc(10 * 1024 * 1024)])); assert.equal(r.ok, false); assert.equal(r.status, 413) })
await ok('csv accepté, csv binaire refusé', () => { assert.equal(validateUploadFile('a.csv', Buffer.from('a;b\n1;2')).ok, true); assert.equal(validateUploadFile('a.csv', pk).ok, false) })

console.log(`\n${n} vérifications OK`)
