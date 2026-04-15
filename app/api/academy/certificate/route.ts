import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const courseId   = searchParams.get('courseId')
  const driverName = searchParams.get('driverName') ?? 'Livreur'

  // Récupère le cours
  const course = courseId
    ? await prisma.course.findFirst({ where: { id: courseId } })
    : null

  const courseName = (course as any)?.title ?? 'Formation Shipinfy'
  const date = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Certificat — ${driverName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Georgia', serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 32px; }
  .cert { background: #fff; border: 3px solid #2563eb; border-radius: 16px; padding: 48px 56px; max-width: 720px; width: 100%; text-align: center; box-shadow: 0 8px 40px rgba(37,99,235,0.12); position: relative; }
  .cert::before { content: ''; position: absolute; inset: 8px; border: 1px solid #bfdbfe; border-radius: 10px; pointer-events: none; }
  .logo { display: inline-flex; align-items: center; gap: 10px; margin-bottom: 32px; }
  .logo-badge { background: #2563eb; color: #fff; font-size: 14px; font-weight: 900; padding: 6px 14px; border-radius: 8px; letter-spacing: 1px; font-family: sans-serif; }
  .logo-sub { font-size: 13px; color: #64748b; font-family: sans-serif; }
  .star { font-size: 36px; margin-bottom: 12px; }
  .title { font-size: 13px; text-transform: uppercase; letter-spacing: 3px; color: #94a3b8; margin-bottom: 8px; font-family: sans-serif; }
  .certifies { font-size: 15px; color: #64748b; margin-bottom: 12px; font-family: sans-serif; }
  .name { font-size: 42px; font-weight: bold; color: #0f172a; margin-bottom: 8px; font-family: 'Georgia', serif; }
  .desc { font-size: 15px; color: #475569; margin-bottom: 24px; font-family: sans-serif; line-height: 1.6; }
  .course-badge { display: inline-block; background: #eff6ff; border: 1.5px solid #bfdbfe; color: #1d4ed8; font-size: 16px; font-weight: 700; padding: 10px 28px; border-radius: 50px; margin-bottom: 32px; font-family: sans-serif; }
  .divider { height: 1px; background: linear-gradient(to right, transparent, #bfdbfe, transparent); margin: 24px 0; }
  .footer { display: flex; justify-content: space-between; align-items: flex-end; font-family: sans-serif; }
  .footer-item { text-align: center; }
  .footer-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
  .footer-value { font-size: 14px; font-weight: 700; color: #334155; margin-top: 4px; }
  .seal { width: 64px; height: 64px; background: #2563eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 28px; }
  @media print { body { background: white; padding: 0; } .cert { box-shadow: none; } }
</style>
</head>
<body>
<div class="cert">
  <div class="logo">
    <div class="logo-badge">SHIPINFY</div>
    <div class="logo-sub">Metrics — Academy</div>
  </div>
  <div class="star">🎓</div>
  <div class="title">Certificat de réussite</div>
  <div class="certifies">Ce certificat est décerné à</div>
  <div class="name">${driverName}</div>
  <div class="desc">pour avoir complété avec succès la formation</div>
  <div class="course-badge">${courseName}</div>
  <div class="divider"></div>
  <div class="footer">
    <div class="footer-item">
      <div class="footer-label">Date d'obtention</div>
      <div class="footer-value">${date}</div>
    </div>
    <div class="seal">✓</div>
    <div class="footer-item">
      <div class="footer-label">Plateforme</div>
      <div class="footer-value">Shipinfy Metrics</div>
    </div>
  </div>
</div>
<script>
  // Auto-print on load for "save as PDF"
  window.onload = () => {
    document.title = 'Certificat — ${driverName} — ${courseName}'
  }
</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}
