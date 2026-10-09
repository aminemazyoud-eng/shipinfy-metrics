// Test des fonctions pures de rétention (Sprint 18) — node scripts/test-retention.mjs
import assert from 'node:assert/strict'
import { lib } from './_ts-alias.mjs'

const r = await lib('ops-retention.ts')
const DAY = 86_400_000
const NOW = Date.parse('2026-10-09T04:15:00Z')
let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name) }

ok('constantes de durée', () => {
  assert.deepEqual({ ...r.RETENTION_DAYS }, { OpsSyncRun: 30, OpsSyncReject: 60, OpsNotifLog: 90, DeliveryAlert: 90, QrScanNonce: 7, OpsOutbox: 30, ReliabilityScore: 180, OpsProof: 180, OpsDriverAction: 90 })
  assert.equal(r.BATCH_SIZE, 5000)
  assert.equal(r.PROOF_BATCH_SIZE, 500)
})
ok('cutoffDate = now - N jours', () => {
  assert.equal(r.cutoffDate(30, NOW).getTime(), NOW - 30 * DAY)
  assert.equal(r.cutoffDate(7, NOW).toISOString(), '2026-10-02T04:15:00.000Z')
})
ok('retentionCutoffs couvre toutes les tables', () => {
  const c = r.retentionCutoffs(NOW)
  assert.deepEqual(Object.keys(c).sort(), Object.keys(r.RETENTION_DAYS).sort())
  assert.equal(c.ReliabilityScore.getTime(), NOW - 180 * DAY)
})
ok('aucune table protégée dans la rétention', () => {
  for (const t of ['OpsAuditLog', 'OpsOrder', 'OpsOrderEvent', 'OpsPayRun', 'DriverAttendance']) assert.ok(!(t in r.RETENTION_DAYS))
})
ok('latestScoreIds garde le plus récent par livreur', () => {
  const d = (s) => new Date(s)
  const ids = r.latestScoreIds([
    { id: 'a1', driverName: 'A', calculatedAt: d('2026-01-01') },
    { id: 'a2', driverName: 'A', calculatedAt: d('2026-02-01') },
    { id: 'b1', driverName: 'B', calculatedAt: d('2025-01-01') },
  ])
  assert.deepEqual([...ids].sort(), ['a2', 'b1'])
})
console.log(`\ntest-retention : ${n} groupes de tests OK`)
