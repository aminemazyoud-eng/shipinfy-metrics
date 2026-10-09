import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/ops-auth'

export async function GET(request: Request) {
  const _guard = await requireSession(request, 'VIEWER'); if ('error' in _guard) return _guard.error
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const tickets = await prisma.ticket.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        comments:  { orderBy: { createdAt: 'asc' } },
        alert: { select: { id: true, title: true, severity: true } },
      },
      take: 200,
    })
    return NextResponse.json(tickets)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const _guard = await requireSession(request, 'DISPATCHER'); if ('error' in _guard) return _guard.error
  try {
    const body = await request.json() as {
      title: string; description: string; priority?: string; alertId?: string; assignedTo?: string
    }
    const ticket = await prisma.ticket.create({
      data: {
        title:       body.title,
        description: body.description,
        priority:    body.priority ?? 'moyenne',
        alertId:     body.alertId,
        assignedTo:  body.assignedTo,
      },
      include: { comments: true, alert: { select: { id: true, title: true, severity: true } } },
    })
    await audit(_guard.session, 'ticket.create', 'ticket', ticket.id, { priority: ticket.priority, alertId: body.alertId ?? null })
    return NextResponse.json(ticket)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Create failed' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const _guard = await requireSession(request, 'DISPATCHER'); if ('error' in _guard) return _guard.error
  try {
    const body = await request.json() as { id: string; status?: string; assignedTo?: string; priority?: string }
    const { id, ...data } = body
    const ticket = await prisma.ticket.update({
      where: { id },
      data,
      include: { comments: true, alert: { select: { id: true, title: true, severity: true } } },
    })
    await audit(_guard.session, 'ticket.update', 'ticket', id, { fields: Object.keys(data), status: data.status, priority: data.priority })
    return NextResponse.json(ticket)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const _guard = await requireSession(request, 'DISPATCHER'); if ('error' in _guard) return _guard.error
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await prisma.ticket.delete({ where: { id } })
    await audit(_guard.session, 'ticket.delete', 'ticket', id)
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
