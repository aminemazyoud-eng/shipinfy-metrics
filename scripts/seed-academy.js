#!/usr/bin/env node
'use strict'
// Formations Academy propres à l'activité : Dashboard back-office, Application livreur, Modules de livraison.
// Idempotent (clé = titre du cours). Usage : node --env-file=.env.local scripts/seed-academy.js
const { PrismaClient } = require('../node_modules/@prisma/client')
const prisma = new PrismaClient()

const COURSES = [
  {
    title: 'Dashboard Back-Office', category: 'backoffice', emoji: '🖥️', color: '#7c3aed', order: 7,
    description: "Maîtriser le cockpit Shipinfy : prévisions par créneau, dispatch live, suivi des retards, pointage et paie.",
    lessons: [
      { title: 'Lire le cockpit : prévisions et live', type: 'document', duration: 8, content: "Le cockpit affiche, pour chaque hub, le nombre de commandes PRÉVUES et DÉJÀ REÇUES par créneau (09-12, 12-15, 15-18, 18-21). Vert : moins de 70 % de la capacité. Orange : entre 70 et 100 %. Rouge : saturé, il manque des équipes. Regardez la veille pour anticiper : renforcez un hub rouge avant le créneau." },
      { title: 'Dispatcher : assigner, auto-dispatch, changer de hub', type: 'document', duration: 10, content: "Dispatch live : sélectionnez des commandes « À dispatcher » puis cliquez « Assigner » sur la carte d'une équipe. « Auto-dispatch » répartit tout le hub en équilibrant la charge et en regroupant les adresses proches. Pour renforcer un hub saturé, utilisez « Rapatrier ici » ou le menu « ⇄ Hub » : le chauffeur, son helper et son véhicule changent de hub." },
      { title: 'Suivi des commandes et retards', type: 'document', duration: 7, content: "Suivi commandes : une ligne rouge = commande en retard (créneau dépassé, non livrée). Orange = livrée hors créneau. Ambre = fin de créneau dans moins de 45 minutes. Cliquez une commande pour voir sa chronologie et créer une réclamation liée." },
      {
        title: 'Quiz — Dashboard Back-Office', type: 'quiz', duration: 5, questions: [
          { question: 'Une case rouge dans la grille de prévisions signifie :', options: ['Commande en retard', 'Créneau saturé : charge ≥ 100 % de la capacité', 'Livreur absent', 'Erreur de synchro'], correct: 1 },
          { question: 'Pour renforcer un hub saturé, vous utilisez :', options: ['Supprimer des commandes', 'Rapatrier ou changer de hub un chauffeur', 'Attendre le lendemain', 'Changer le créneau du client'], correct: 1 },
          { question: "Que fait l'auto-dispatch ?", options: ['Envoie un SMS aux clients', 'Répartit les commandes en équilibrant la charge et la proximité', 'Clôture les commandes', 'Calcule la paie'], correct: 1 },
          { question: 'Une ligne ambre dans le suivi indique :', options: ['Commande livrée', 'Fin de créneau dans moins de 45 minutes', 'NO_SHOW', 'Commande annulée'], correct: 1 },
        ],
      },
    ],
  },
  {
    title: 'Application Livreur', category: 'app-livreur', emoji: '📱', color: '#0891b2', order: 8,
    description: "Utiliser l'application de livraison au quotidien : tournée, statuts, preuve de livraison et encaissement.",
    lessons: [
      { title: 'Démarrer sa journée : pointage et tournée', type: 'document', duration: 6, content: "Chaque matin : pointez votre arrivée (QR ou saisie par le référent), vérifiez le véhicule, ouvrez votre tournée du jour. Vos commandes sont classées par créneau. Le pointage se fait à la journée : il conditionne votre fixe journalier." },
      { title: 'Changer les statuts au bon moment', type: 'document', duration: 8, content: "Assignée → En transport (chargement terminé) → En livraison (vous partez chez le client) → Livrée ou NO_SHOW. Mettez à jour le statut immédiatement : le dispatch et le client voient l'avancement en temps réel. Ne marquez jamais « Livrée » avant la remise effective." },
      { title: 'Preuve de livraison et encaissement', type: 'document', duration: 7, content: "Paiement à la livraison : encaissez le montant exact affiché, remettez le justificatif, versez les fonds selon la procédure du hub. En cas de refus ou d'absence : appelez le client, attendez le délai prévu, puis déclarez NO_SHOW avec le motif." },
      {
        title: 'Quiz — Application Livreur', type: 'quiz', duration: 5, questions: [
          { question: 'À quel moment passer une commande en « En livraison » ?', options: ['Dès la réception', "Quand vous partez chez le client", 'Après la livraison', 'Le soir'], correct: 1 },
          { question: 'Client absent : que faites-vous ?', options: ['Vous laissez le colis devant la porte', "Vous l'appelez, attendez le délai prévu, puis NO_SHOW avec motif", 'Vous annulez la commande', 'Vous ignorez'], correct: 1 },
          { question: 'Le pointage est :', options: ['Par commande', 'À la journée (arrivée et départ)', 'Hebdomadaire', 'Facultatif'], correct: 1 },
          { question: 'Montant à encaisser :', options: ['Arrondi à la dizaine', 'Le montant exact affiché', 'À négocier', 'Aucun'], correct: 1 },
        ],
      },
    ],
  },
  {
    title: 'Modules de Livraison', category: 'delivery', emoji: '📦', color: '#16a34a', order: 9,
    description: "Les règles de la livraison Marjane × E-Delivery : créneaux, ponctualité, remise, NO_SHOW et réclamations.",
    lessons: [
      { title: 'Les 4 créneaux et la ponctualité', type: 'document', duration: 6, content: "Quatre créneaux de 3 h : 09h-12h, 12h-15h, 15h-18h, 18h-21h. La livraison doit être réalisée DANS la fenêtre promise au client. Un retard déclenche une alerte et peut donner lieu à une réclamation. Arrivez 10 minutes avant la fin de fenêtre au plus tard chez le dernier client." },
      { title: 'Remise du colis et relation client', type: 'document', duration: 7, content: "Présentez-vous, vérifiez l'identité du destinataire, remettez les produits (froid/frais en priorité), faites vérifier la commande. Soyez courtois, en tenue, sans discussion de prix. En cas de litige, renvoyez vers le service client." },
      { title: 'NO_SHOW, tentatives et réclamations', type: 'document', duration: 8, content: "Avant tout NO_SHOW : 2 appels espacés + message WhatsApp. Le nombre maximal de tentatives est défini par le client (souvent 3-4). Chaque échec est tracé avec motif. Toute réclamation client est créée depuis le suivi de commande et traitée par le service client." },
      {
        title: 'Quiz — Modules de Livraison', type: 'quiz', duration: 5, questions: [
          { question: 'Combien de créneaux de livraison existe-t-il ?', options: ['2', '4', '6', '9'], correct: 1 },
          { question: 'Avant de déclarer un NO_SHOW :', options: ['Rien', '2 appels espacés + message WhatsApp', 'Un seul appel', 'Attendre le lendemain'], correct: 1 },
          { question: 'Que livrer en priorité ?', options: ['Le plus lourd', 'Le froid / frais', 'Le plus loin', 'Au hasard'], correct: 1 },
          { question: 'Où crée-t-on une réclamation liée à une commande ?', options: ['Par téléphone uniquement', 'Depuis le suivi de commande', 'Dans la paie', "Dans l'Academy"], correct: 1 },
        ],
      },
    ],
  },
]

async function main() {
  let created = 0
  for (const c of COURSES) {
    if (await prisma.course.findFirst({ where: { title: c.title } })) continue
    const course = await prisma.course.create({ data: { title: c.title, category: c.category, description: c.description, color: c.color, emoji: c.emoji, order: c.order } })
    for (const [i, l] of c.lessons.entries()) {
      const lesson = await prisma.lesson.create({ data: { courseId: course.id, title: l.title, type: l.type, content: l.content ?? null, duration: l.duration, order: i + 1 } })
      for (const [j, q] of (l.questions || []).entries()) await prisma.quizQuestion.create({ data: { lessonId: lesson.id, question: q.question, options: JSON.stringify(q.options), correct: q.correct, order: j + 1 } })
    }
    created++
  }
  console.log(`[seed-academy] ${created} cours créé(s)`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
