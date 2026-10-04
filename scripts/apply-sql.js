#!/usr/bin/env node
'use strict'
// Applique un fichier SQL (idempotent) via Prisma — compatible pgbouncer, gère les blocs $$.
// Usage : node --env-file=.env.local scripts/apply-sql.js <fichier.sql>
const { PrismaClient } = require('../node_modules/@prisma/client')
const fs = require('fs')

function split(sql) {
  const out = []; let cur = ''; let dollar = false
  for (let i = 0; i < sql.length; i++) {
    if (!dollar && sql[i] === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue }
    if (sql[i] === '$' && sql[i + 1] === '$') { dollar = !dollar; cur += '$$'; i++; continue }
    if (!dollar && sql[i] === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
    cur += sql[i]
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('fichier SQL requis')
  const prisma = new PrismaClient()
  const stmts = split(fs.readFileSync(file, 'utf8'))
  for (const s of stmts) {
    try { await prisma.$executeRawUnsafe(s) } catch (e) { if (!String(e.message).includes('already exists')) throw e }
  }
  console.log(`[apply-sql] ${stmts.length} instructions OK`)
  await prisma.$disconnect()
}
main().catch(e => { console.error('[apply-sql] ERREUR', e.message); process.exit(1) })
