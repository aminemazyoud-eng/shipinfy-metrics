import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const reports = await prisma.expressReport.findMany({
      orderBy: { uploadedAt: 'desc' },
      select: {
        id: true,
        filename: true,
        uploadedAt: true,
        totalRows: true,
        storeType: true,
      },
    })
    return NextResponse.json(reports)
  } catch (e) {
    console.error('[express/reports]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const reportId = searchParams.get('reportId')
    if (!reportId) {
      return NextResponse.json({ error: 'reportId requis' }, { status: 400 })
    }
    await prisma.expressReport.delete({ where: { id: reportId } })
    return NextResponse.json({ deleted: true })
  } catch (e) {
    console.error('[express/reports/delete]', e)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
