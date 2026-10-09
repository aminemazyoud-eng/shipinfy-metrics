import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  const _guard = await requireSession(req, 'VIEWER'); if ('error' in _guard) return _guard.error
  try {
    const { moduleKey, helpful } = await req.json() as { moduleKey: string; helpful: boolean }
    if (!moduleKey || typeof helpful !== 'boolean') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }
    const fb = await prisma.guideFeedback.create({ data: { moduleKey, helpful } })
    return NextResponse.json(fb)
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const _guard = await requireSession(req, 'MANAGER'); if ('error' in _guard) return _guard.error
  const { searchParams } = new URL(req.url)
  const moduleKey = searchParams.get('moduleKey')
  const where = moduleKey ? { moduleKey } : {}
  const [helpful, notHelpful] = await Promise.all([
    prisma.guideFeedback.count({ where: { ...where, helpful: true } }),
    prisma.guideFeedback.count({ where: { ...where, helpful: false } }),
  ])
  return NextResponse.json({ helpful, notHelpful })
}
