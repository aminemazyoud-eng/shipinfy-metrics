import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Creates the DeliveryReport shell and returns the reportId.
// The actual row insertion is handled by /upload/batch in small chunks.
export async function POST(request: Request) {
  try {
    const { filename } = await request.json() as { filename: string }
    if (!filename?.trim()) {
      return NextResponse.json({ error: 'filename requis' }, { status: 400 })
    }
    const report = await prisma.deliveryReport.create({ data: { filename: filename.trim() } })
    return NextResponse.json({ reportId: report.id, insertedAt: report.uploadedAt })
  } catch (e) {
    console.error('[upload/init]', e)
    return NextResponse.json({ error: 'Création du rapport échouée' }, { status: 500 })
  }
}
