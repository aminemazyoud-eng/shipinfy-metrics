import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

// POST /api/courses/[id]/lessons — ajoute une leçon à un module Academy
// body: { title, type: 'video'|'quiz'|'document', contentUrl?, content?, duration?, order? }
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { id: courseId } = await params
    const body = await req.json()
    const { title, type, contentUrl, content, duration, order } = body as {
      title?: string; type?: string; contentUrl?: string; content?: string; duration?: number; order?: number
    }

    if (!title || !type) {
      return NextResponse.json({ error: 'title et type requis' }, { status: 400 })
    }
    if (!['video', 'quiz', 'document'].includes(type)) {
      return NextResponse.json({ error: "type doit être 'video', 'quiz' ou 'document'" }, { status: 400 })
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } })
    if (!course) return NextResponse.json({ error: 'Module introuvable' }, { status: 404 })

    let lessonOrder = order
    if (lessonOrder === undefined) {
      const last = await prisma.lesson.findFirst({ where: { courseId }, orderBy: { order: 'desc' } })
      lessonOrder = (last?.order ?? 0) + 1
    }

    const lesson = await prisma.lesson.create({
      data: {
        courseId,
        title,
        type,
        contentUrl: contentUrl ?? null,
        content:    content ?? null,
        duration:   duration ?? null,
        order:      lessonOrder,
      },
    })

    return NextResponse.json(lesson, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
