import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

async function generateReference(): Promise<string> {
  const count = await prisma.supportTicket.count()
  return `SUP-${String(count + 1).padStart(4, '0')}`
}

// GET /api/support?status=ouvert&priority=urgent&limit=50
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status   = searchParams.get('status')   ?? undefined
    const priority = searchParams.get('priority') ?? undefined
    const limit    = Math.min(parseInt(searchParams.get('limit') ?? '100'), 200)

    const tickets = await prisma.supportTicket.findMany({
      where: {
        ...(status   ? { status }   : {}),
        ...(priority ? { priority } : {}),
      },
      orderBy: [
        { priority: 'asc' }, // urgent first (alphabetically urgent > normale)
        { createdAt: 'desc' },
      ],
      take: limit,
    })

    return NextResponse.json(tickets)
  } catch (e) {
    console.error('[api/support GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// POST /api/support — créer un ticket
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      category: string; priority?: string; subject: string; description: string
      clientName?: string; clientPhone?: string; orderRef?: string; assignedTo?: string
    }

    if (!body.category || !body.subject || !body.description) {
      return NextResponse.json({ error: 'category, subject et description requis' }, { status: 400 })
    }

    const reference = await generateReference()

    const ticket = await prisma.supportTicket.create({
      data: {
        reference,
        category:    body.category,
        priority:    body.priority   ?? 'normale',
        status:      'ouvert',
        subject:     body.subject,
        description: body.description,
        clientName:  body.clientName  ?? null,
        clientPhone: body.clientPhone ?? null,
        orderRef:    body.orderRef    ?? null,
        assignedTo:  body.assignedTo  ?? null,
      },
    })

    return NextResponse.json(ticket, { status: 201 })
  } catch (e) {
    console.error('[api/support POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
