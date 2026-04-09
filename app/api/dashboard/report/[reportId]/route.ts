import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function DELETE(_req: Request, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const { reportId } = await params
    const count = await prisma.deliveryOrder.count({ where: { reportId } })
    await prisma.deliveryReport.delete({ where: { id: reportId } })
    return NextResponse.json({ deleted: true, deletedOrders: count })
  } catch {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
