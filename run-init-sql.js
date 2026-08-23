#!/usr/bin/env node
'use strict';
// Runs prisma/init-tables.sql using PrismaClient (compatible pgbouncer)
const { PrismaClient } = require('./node_modules/@prisma/client');
const fs = require('fs');
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
console.log(`Running ${statements.length} SQL statements...`);

const prisma = new PrismaClient();

const timer = setTimeout(() => {
  console.error('TIMEOUT: DB init exceeded 30s');
  process.exit(1);
}, 30000);

async function main() {
  for (const stmt of statements) {
    if (stmt.trim()) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (e) {
        if (e.message && e.message.includes('already exists')) {
          // idempotent — safe to ignore
        } else {
          throw e;
        }
      }
    }
  }
  console.log('Tables OK');
}

main()
  .then(() => { clearTimeout(timer); prisma.$disconnect().catch(() => {}); process.exit(0); })
  .catch(e => { clearTimeout(timer); console.error('DB Error:', e.message); prisma.$disconnect().catch(() => {}); process.exit(1); });
