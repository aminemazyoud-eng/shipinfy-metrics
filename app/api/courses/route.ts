import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const DEFAULT_COURSES = [
  { title: 'Foodtech & Marketplace', category: 'foodtech',   description: 'Gestion commandes chaud/froid, hygiène HACCP, applications partenaires (Glovo, Jumia).', color: '#ea580c', emoji: '🍔', order: 1 },
  { title: 'Secteur Santé & Médical', category: 'medical',   description: 'Chaîne du froid médicaments, conformité réglementaire, discrétion & confidentialité patient.', color: '#2563eb', emoji: '🏥', order: 2 },
  { title: 'Sécurité Routière',       category: 'safety',    description: 'Code de la route moto Maroc, conduite défensive urbaine, premiers secours & procédures.', color: '#16a34a', emoji: '🛡️', order: 3 },
  { title: 'Soft Skills & Client',    category: 'softskills', description: 'Discours professionnel, gestion des conflits & réclamations, communication WhatsApp pro.', color: '#7c3aed', emoji: '💬', order: 4 },
  { title: 'Navigation & Itinéraires',category: 'navigation', description: "Google Maps avancé, optimisation de tournée, alertes incidents & trafic.", color: '#ca8a04', emoji: '🗺️', order: 5 },
  { title: 'Administration & Droits', category: 'admin',     description: 'Statut auto-entrepreneur, déclarations CNSS & fiscalité, assurances & gestion revenus.', color: '#dc2626', emoji: '📋', order: 6 },
]

export async function GET() {
  try {
    let courses = await prisma.course.findMany({
      include: {
        lessons:  { orderBy: { order: 'asc' } },
        progress: true,
      },
      orderBy: { order: 'asc' },
    })
    // Seed default courses if none exist
    if (courses.length === 0) {
      await prisma.course.createMany({ data: DEFAULT_COURSES })
      courses = await prisma.course.findMany({
        include: { lessons: { orderBy: { order: 'asc' } }, progress: true },
        orderBy: { order: 'asc' },
      })
    }
    return NextResponse.json(courses)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
