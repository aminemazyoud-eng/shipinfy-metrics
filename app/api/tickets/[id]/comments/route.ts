import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await params
    const body = await request.json() as { author: string; content: string }
    const comment = await prisma.ticketComment.create({
      data: { ticketId, author: body.author, content: body.content },
    })
    return NextResponse.json(comment)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Create failed' }, { status: 500 })
  }
}
