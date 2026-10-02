import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { triggerN8N } from '@/lib/n8n-bridge'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

const CERTIFICATION_THRESHOLD = 70

// POST /api/courses/[id]/progress — enregistre / met à jour la formation d'un livreur
// body: { driverId: string, score: number }
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { id: courseId } = await params
    const body = await req.json()
    const { driverId, score } = body as { driverId?: string; score?: number }

    if (!driverId || typeof score !== 'number' || Number.isNaN(score)) {
      return NextResponse.json({ error: 'driverId et score (nombre) requis' }, { status: 400 })
    }

    const [course, driver] = await Promise.all([
      prisma.course.findUnique({ where: { id: courseId } }),
      prisma.driver.findUnique({ where: { id: driverId } }),
    ])
    if (!course) return NextResponse.json({ error: 'Module introuvable' }, { status: 404 })
    if (!driver) return NextResponse.json({ error: 'Livreur introuvable' }, { status: 404 })

    const clampedScore = Math.max(0, Math.min(100, score))
    const certified = clampedScore >= CERTIFICATION_THRESHOLD

    const progress = await prisma.courseProgress.upsert({
      where: { driverId_courseId: { driverId, courseId } },
      update: {
        score:       clampedScore,
        certified,
        completedAt: new Date(),
      },
      create: {
        driverId,
        courseId,
        score:       clampedScore,
        certified,
        completedAt: new Date(),
      },
      include: { driver: { select: { firstName: true, lastName: true } }, course: { select: { title: true } } },
    })

    // Notifie N8N (WhatsApp/etc.) quand une certification est obtenue — non bloquant
    if (certified) {
      const driverName = `${progress.driver.firstName} ${progress.driver.lastName}`.trim()
      triggerN8N('academy_certified', {
        driverId,
        driverName,
        courseId,
        courseName: progress.course.title,
        score: clampedScore,
      }).catch(() => {})
    }

    return NextResponse.json(progress, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// DELETE /api/courses/[id]/progress?driverId=xxx — retire l'enregistrement d'un livreur
export async function DELETE(req: Request, { params }: RouteCtx) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { id: courseId } = await params
    const { searchParams } = new URL(req.url)
    const driverId = searchParams.get('driverId')
    if (!driverId) return NextResponse.json({ error: 'driverId requis' }, { status: 400 })

    await prisma.courseProgress.delete({
      where: { driverId_courseId: { driverId, courseId } },
    })
    return NextResponse.json({ deleted: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
