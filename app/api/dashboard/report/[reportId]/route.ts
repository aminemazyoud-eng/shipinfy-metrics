import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/ops-auth'

export async function DELETE(_req: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const _guard = await requireSession(_req, 'MANAGER'); if ('error' in _guard) return _guard.error
  try {
    const { reportId } = await params
    const count = await prisma.deliveryOrder.count({ where: { reportId } })
    await prisma.deliveryReport.delete({ where: { id: reportId } })
    await audit(_guard.session, 'report.delete', 'report', reportId, { deletedOrders: count })
    return NextResponse.json({ deleted: true, deletedOrders: count })
  } catch {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
