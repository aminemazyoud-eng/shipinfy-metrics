import { NextResponse } from 'next/server'
import { runPredictiveAlerts, checkStandardDelays } from '@/lib/alert-engine'

// POST /api/alerts/predict — déclenchement manuel (depuis UI)
export async function POST() {
  try {
    const [predictive, standard] = await Promise.all([
      runPredictiveAlerts(),
      checkStandardDelays(),
    ])

    return NextResponse.json({
      predictive: { checked: predictive.checked, created: predictive.created },
      standard:   { checked: standard.checked,   created: standard.created   },
      total:      predictive.created + standard.created,
    })
  } catch (e) {
    console.error('[api/alerts/predict POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
