import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // "open" | "resolved" | null = all
    const alerts = await prisma.alert.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { rule: true, tickets: { select: { id: true, status: true } } },
      take: 100,
    })
    return NextResponse.json(alerts)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      type?: string; severity: string; title: string; description: string
      metricValue?: number; threshold?: number; ruleId?: string
    }
    const alert = await prisma.alert.create({
      data: {
        type:        body.type ?? 'manual',
        severity:    body.severity,
        title:       body.title,
        description: body.description,
        metricValue: body.metricValue,
        threshold:   body.threshold,
        ruleId:      body.ruleId,
      },
    })
    return NextResponse.json(alert)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Create failed' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id: string; status?: string; assignedTo?: string }
    const { id, ...data } = body
    const updateData: Record<string, unknown> = { ...data }
    if (data.status === 'resolved') updateData.resolvedAt = new Date()
    const alert = await prisma.alert.update({ where: { id }, data: updateData })
    return NextResponse.json(alert)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}
