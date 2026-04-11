import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadProgress } from '@/lib/upload-progress'

type Ctx = { params: Promise<{ reportId: string }> }

export async function GET(_: Request, { params }: Ctx) {
  try {
    const { reportId } = await params

    // Check in-memory state first (active upload)
    const state = uploadProgress.get(reportId)
    if (state) {
      return NextResponse.json(state)
    }

    // Not in memory → either old upload (done) or unknown
    const count = await prisma.deliveryOrder.count({ where: { reportId } })
    if (count > 0) {
      return NextResponse.json({ total: count, inserted: count, done: true })
    }

    return NextResponse.json({ total: 0, inserted: 0, done: false })
  } catch (e) {
    console.error('[upload/status]', e)
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 })
  }
}
