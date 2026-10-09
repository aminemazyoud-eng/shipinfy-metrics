#!/usr/bin/env node
'use strict';
// Runs prisma/init-tables.sql using PrismaClient (compatible pgbouncer)
const { PrismaClient } = require('./node_modules/@prisma/client');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, 'prisma', 'init-tables.sql'), 'utf8');

// Split SQL into statements, handling PostgreSQL dollar-quoting ($$...$$)
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  let i = 0;
  while (i < sql.length) {
    if (!inDollarQuote && sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (sql[i] === '$' && sql[i + 1] === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i += 2;
      continue;
    }
    if (!inDollarQuote && sql[i] === ';') {
      const stmt = current.trim();
      if (stmt.length > 0) statements.push(stmt);
      current = '';
      i++;
      continue;
    }
    current += sql[i];
    i++;
  }
  const last = current.trim();
  if (last.length > 0) statements.push(last);
  return statements;
}

const statements = splitStatements(sql);
const hash = crypto.createHash('sha256').update(sql).digest('hex');
console.log(`Running ${statements.length} SQL statements...`);

const prisma = new PrismaClient();

const timer = setTimeout(() => {
  console.error('TIMEOUT: DB init exceeded 180s');
  process.exit(1);
}, 180000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BACKOFF = [2000, 5000]; // 3 tentatives : immédiate, +2 s, +5 s

// Erreurs transitoires (réseau, pooler saturé, deadlock, timeout) : on réessaie. Toute autre erreur reste fatale.
function isTransient(e) {
  const m = String((e && e.message) || e);
  return /timeout|timed out|connection|ECONN|ETIMEDOUT|EAI_AGAIN|deadlock|terminat|reset by peer|Can't reach|too many clients|P1001|P1002|P1008|P1017|P2024/i.test(m);
}

async function withRetry(label, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransient(e) || attempt >= BACKOFF.length) throw e;
      console.warn(`Erreur transitoire (${label}), nouvel essai dans ${BACKOFF[attempt] / 1000}s : ${String(e.message).split('\n')[0].slice(0, 160)}`);
      await sleep(BACKOFF[attempt]);
    }
  }
}

async function main() {
  // Démarrage instantané : si ce fichier SQL exact a déjà été appliqué en entier, on ne fait rien.
  let canRecord = true;
  try {
    await withRetry('_schema_version', async () => {
      await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS _schema_version (hash text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
    });
    try { await prisma.$executeRawUnsafe('ALTER TABLE _schema_version ENABLE ROW LEVEL SECURITY'); } catch (e) { /* non bloquant */ }
    const rows = await withRetry('lecture version', () => prisma.$queryRawUnsafe('SELECT hash FROM _schema_version WHERE hash = $1', hash));
    if (Array.isArray(rows) && rows.length > 0) {
      console.log('Schéma déjà à jour');
      return;
    }
  } catch (e) {
    if (e && e.message && e.message.includes('already exists')) { /* course entre deux démarrages : idempotent */ }
    else { canRecord = false; console.warn('Table _schema_version indisponible, exécution complète :', String(e.message).split('\n')[0]); }
  }

  for (const stmt of statements) {
    if (!stmt.trim()) continue;
    try {
      await withRetry(stmt.slice(0, 50).replace(/\s+/g, ' '), () => prisma.$executeRawUnsafe(stmt));
    } catch (e) {
      if (e.message && e.message.includes('already exists')) {
        // idempotent — safe to ignore
      } else if (/ignoré/.test(stmt)) {
        // bloc OPTIONNEL (index, trigger d'audit…) : son échec ne doit JAMAIS empêcher le démarrage de l'application
        console.warn('Bloc optionnel ignoré :', String(e.message).split('\n')[0].slice(0, 200));
      } else {
        throw e;
      }
    }
  }
  // Le hash n'est enregistré qu'APRÈS le succès complet : un échec partiel sera rejoué au prochain démarrage.
  if (canRecord) {
    try { await withRetry('enregistrement version', () => prisma.$executeRawUnsafe('INSERT INTO _schema_version (hash) VALUES ($1) ON CONFLICT (hash) DO NOTHING', hash)); }
    catch (e) { console.warn('Version non enregistrée (sans gravité) :', String(e.message).split('\n')[0]); }
  }
  console.log('Tables OK');
}

main()
  .then(() => { clearTimeout(timer); prisma.$disconnect().catch(() => {}); process.exit(0); })
  .catch(e => { clearTimeout(timer); console.error('DB Error:', e.message); prisma.$disconnect().catch(() => {}); process.exit(1); });
