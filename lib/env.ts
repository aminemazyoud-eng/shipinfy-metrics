/**
 * lib/env.ts — variables d'environnement OBLIGATOIRES (Sprint 17 A4/A5) : plus aucun secret de repli codé en dur.
 * Volontairement évalué À L'USAGE (et non au démarrage) : une variable manquante désactive la fonctionnalité concernée
 * (HTTP 503 explicite) au lieu de mettre tout le conteneur en boucle de crash.
 */
import { NextResponse } from 'next/server'

export class MissingEnvError extends Error {
  constructor(public readonly name: string) { super(`Variable d'environnement obligatoire manquante : ${name}`) }
}

export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || v.length < 16) throw new MissingEnvError(name) // un secret trop court est refusé comme absent
  return v
}

/** Réponse standard quand une route dépend d'un secret non configuré. */
export const envUnavailable = (e: unknown) =>
  e instanceof MissingEnvError ? NextResponse.json({ error: 'Fonction indisponible : configuration serveur incomplète', code: 'ENV_MISSING', variable: e.name }, { status: 503 }) : null
