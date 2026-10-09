import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/ops-auth'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const _guard = await requireSession(request, 'DISPATCHER'); if ('error' in _guard) return _guard.error
  try {
    const { id: ticketId } = await params
    const body = await request.json() as { author: string; content: string }
    const comment = await prisma.ticketComment.create({
      data: { ticketId, author: body.author, content: body.content },
    })
    await audit(_guard.session, 'ticket.comment', 'ticket', ticketId, { commentId: comment.id })
    return NextResponse.json(comment)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Create failed' }, { status: 500 })
  }
}
