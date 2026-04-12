import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const DEFAULTS = [
  { mode: 'standard', label: 'Standard', baseRate: 15, bonusRate: 5, penaltyRate: 5, active: true },
  { mode: 'express',  label: 'Express',  baseRate: 25, bonusRate: 10, penaltyRate: 10, active: true },
]

// GET /api/remuneration/config — récupère les configs (crée les défauts si absent)
export async function GET() {
  try {
    let configs = await prisma.payConfig.findMany({ orderBy: { mode: 'asc' } })

    // Seed defaults if empty
    if (configs.length === 0) {
      await prisma.payConfig.createMany({ data: DEFAULTS, skipDuplicates: true })
      configs = await prisma.payConfig.findMany({ orderBy: { mode: 'asc' } })
    }

    return NextResponse.json(configs)
  } catch (e) {
    console.error('[api/remuneration/config GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// POST /api/remuneration/config — upsert d'une config par mode
// Body: { mode, label?, baseRate, bonusRate, penaltyRate, active? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      mode: string; label?: string
      baseRate: number; bonusRate: number; penaltyRate: number
      active?: boolean
    }

    if (!body.mode) return NextResponse.json({ error: 'mode requis' }, { status: 400 })

    const config = await prisma.payConfig.upsert({
      where:  { mode: body.mode },
      create: {
        mode:        body.mode,
        label:       body.label       ?? (body.mode === 'express' ? 'Express' : 'Standard'),
        baseRate:    body.baseRate,
        bonusRate:   body.bonusRate,
        penaltyRate: body.penaltyRate,
        active:      body.active      ?? true,
      },
      update: {
        label:       body.label       ?? undefined,
        baseRate:    body.baseRate,
        bonusRate:   body.bonusRate,
        penaltyRate: body.penaltyRate,
        active:      body.active      ?? undefined,
      },
    })

    return NextResponse.json(config)
  } catch (e) {
    console.error('[api/remuneration/config POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
