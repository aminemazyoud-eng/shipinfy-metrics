import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail } from '@/lib/ops-auth'
import { roleAtLeast } from '@/lib/auth'
import { listRuns } from '@/lib/ops-payrun'

// GET /api/ops/payrun — liste des clôtures mensuelles (statut, totaux, validation) = historique
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json({ runs: await listRuns(), canValidate: roleAtLeast(auth.session.role, 'ADMIN') })
  } catch (e) { return fail(e) }
}
