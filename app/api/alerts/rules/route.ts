import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const rules = await prisma.alertRule.findMany({ orderBy: { createdAt: 'asc' } })
    return NextResponse.json(rules)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      name: string; metric: string; operator: string; threshold: number; severity: string
    }
    const rule = await prisma.alertRule.create({ data: body })
    return NextResponse.json(rule)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Create failed' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id: string; enabled?: boolean; threshold?: number; severity?: string }
    const { id, ...data } = body
    const rule = await prisma.alertRule.update({ where: { id }, data })
    return NextResponse.json(rule)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await prisma.alertRule.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
