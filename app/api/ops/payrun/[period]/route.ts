import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { roleAtLeast } from '@/lib/auth'
import { xlsxResponse } from '@/lib/xlsx-response'
import { getRun, createOrRefreshDraft, validateRun, markPaid, reopenRun, setAdjustment, runCsv, isPeriod, RunError } from '@/lib/ops-payrun'

type Ctx = { params: Promise<{ period: string }> }

// GET /api/ops/payrun/[period]?format=xlsx — détail d'une clôture (lignes figées)
export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const { period } = await ctx.params
    if (!isPeriod(period)) return NextResponse.json({ error: 'Période invalide (AAAA-MM attendu)' }, { status: 400 })
    const run = await getRun(period)
    if (!run) return NextResponse.json({ error: 'Aucune clôture pour ce mois', period }, { status: 404 })
    if (new URL(req.url).searchParams.get('format') === 'xlsx') return xlsxResponse(runCsv(run), `paie_cloture_${period}_${run.status}`, 'Paie')
    return NextResponse.json({ run, canValidate: roleAtLeast(auth.session.role, 'ADMIN') })
  } catch (e) { return fail(e) }
}

// POST /api/ops/payrun/[period]  { action: 'draft'|'validate'|'paid'|'reopen'|'adjust', ... }
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const { period } = await ctx.params
    if (!isPeriod(period)) return NextResponse.json({ error: 'Période invalide (AAAA-MM attendu)' }, { status: 400 })
    const b = await req.json().catch(() => null) as { action?: unknown; driverCode?: unknown; amount?: unknown; note?: unknown; reason?: unknown } | null
    if (!b || typeof b.action !== 'string') return NextResponse.json({ error: 'Action manquante' }, { status: 400 })
    const by = auth.session.name || auth.session.email
    // validation, paiement et réouverture : ADMIN minimum
    if (['validate', 'paid', 'reopen'].includes(b.action) && !roleAtLeast(auth.session.role, 'ADMIN')) return NextResponse.json({ error: 'Accès refusé : rôle Administrateur requis' }, { status: 403 })
    try {
      let run
      switch (b.action) {
        case 'draft': run = await createOrRefreshDraft(period, by); await audit(auth.session, 'payrun.draft', 'payrun', period, { totals: run.totals }); break
        case 'validate': run = await validateRun(period, by); await audit(auth.session, 'payrun.validate', 'payrun', period, { totals: run.totals }); break
        case 'paid': run = await markPaid(period, by); await audit(auth.session, 'payrun.paid', 'payrun', period, { totals: run.totals }); break
        case 'reopen': run = await reopenRun(period, by, typeof b.reason === 'string' ? b.reason : ''); await audit(auth.session, 'payrun.reopen', 'payrun', period, { reason: b.reason }); break
        case 'adjust': {
          if (typeof b.driverCode !== 'string' || !/^[\w.-]{1,40}$/.test(b.driverCode)) return NextResponse.json({ error: 'Code livreur invalide' }, { status: 400 })
          run = await setAdjustment(period, b.driverCode, b.amount, b.note)
          await audit(auth.session, 'payrun.adjust', 'payrun', period, { driverCode: b.driverCode, amount: b.amount, note: b.note }); break
        }
        default: return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
      }
      return NextResponse.json({ ok: true, run })
    } catch (e) {
      if (e instanceof RunError) return NextResponse.json({ error: e.message }, { status: e.status })
      throw e
    }
  } catch (e) { return fail(e) }
}
