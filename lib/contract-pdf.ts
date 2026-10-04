/**
 * lib/contract-pdf.ts — génération du contrat de travail (PDF) d'un chauffeur / helper.
 * Modèle type à faire valider par un conseil juridique avant usage (Code du travail marocain).
 * Les montants viennent de la fiche du salarié et de la configuration de paie (Paie & Bonus).
 */
export interface ContractPerson {
  code: string; firstName: string; lastName: string; jobType: 'chauffeur' | 'helper'; cin: string | null; address: string | null
  birthDate: Date | null; licenseNo: string | null; contractType: string; hireDate: Date | null
  hubName: string | null; city: string | null; vehiclePlate: string | null; dailyRate: number
}
export interface ContractPay { bonusThreshold: number; bonusPerOrder: number; onTimeBonus: number; noShowPenalty: number; latePenalty: number }

const d = (v: Date | null) => (v ? v.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '____ / ____ / ________')
const mad = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} MAD`

export async function buildContractPdf(p: ContractPerson, pay: ContractPay, company = process.env.COMPANY_NAME || 'Shipinfy'): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, info: { Title: `Contrat ${p.code}`, Author: company } })
    const bufs: Buffer[] = []
    doc.on('data', (b: Buffer) => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject)

    const post = p.jobType === 'chauffeur' ? 'Chauffeur-livreur' : 'Helper (aide-livreur)'
    const name = `${p.firstName} ${p.lastName.toUpperCase()}`
    const art = (n: number, title: string, body: string) => { doc.moveDown(0.7).font('Helvetica-Bold').fontSize(10.5).fillColor('#0f172a').text(`Article ${n} — ${title}`).font('Helvetica').fontSize(10).fillColor('#1f2937').text(body, { align: 'justify' }) }

    doc.rect(0, 0, doc.page.width, 70).fill('#0f172a')
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(company.toUpperCase(), 56, 24).font('Helvetica').fontSize(9).text('Logistique du dernier kilomètre', 56, 46)
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(16).text(`CONTRAT DE TRAVAIL ${p.contractType === 'CDI' ? 'À DURÉE INDÉTERMINÉE' : p.contractType === 'Prestation' ? '— PRESTATION DE SERVICES' : 'À DURÉE DÉTERMINÉE'}`, 56, 96, { align: 'center' })
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(`Référence ${p.code} — établi le ${d(new Date())}`, { align: 'center' })

    doc.moveDown(1.2).font('Helvetica-Bold').fontSize(10.5).fillColor('#0f172a').text('ENTRE LES SOUSSIGNÉS')
    doc.font('Helvetica').fontSize(10).fillColor('#1f2937').moveDown(0.4)
      .text(`La société ${company}, ci-après « l'Employeur », représentée par son représentant légal dûment habilité,`)
      .moveDown(0.3).text('ET', { align: 'center' }).moveDown(0.3)
      .text(`${name}, né(e) le ${d(p.birthDate)}, titulaire de la CIN n° ${p.cin ?? '________________'}, demeurant à ${p.address ?? '__________________________________________'}${p.jobType === 'chauffeur' ? `, titulaire du permis de conduire n° ${p.licenseNo ?? '____________'}` : ''}, ci-après « le Salarié ».`, { align: 'justify' })
    doc.moveDown(0.4).text('IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT :')

    art(1, 'Engagement et fonctions', `Le Salarié est engagé en qualité de ${post}. Il exerce ses fonctions pour le compte de l'Employeur dans le cadre des livraisons à domicile (dernier kilomètre) confiées par les clients de l'Employeur, selon les créneaux de livraison planifiés. ${p.jobType === 'chauffeur' ? `Il conduit le véhicule qui lui est affecté${p.vehiclePlate ? ` (immatriculation ${p.vehiclePlate})` : ''} et en assure la bonne tenue.` : `Il accompagne le chauffeur${p.vehiclePlate ? ` du véhicule ${p.vehiclePlate}` : ''}, assure le chargement, la remise des colis et l'encaissement éventuel à la livraison.`}`)
    art(2, 'Lieu de travail', `Le Salarié est rattaché au hub ${p.hubName ?? '________________'}${p.city ? ` (${p.city.charAt(0) + p.city.slice(1).toLowerCase()})` : ''}. L'Employeur peut l'affecter temporairement à un autre hub pour les besoins du service.`)
    art(3, 'Durée', p.contractType === 'CDI' ? `Le présent contrat est conclu pour une durée indéterminée à compter du ${d(p.hireDate)}, sous réserve d'une période d'essai conformément à la législation en vigueur.` : `Le présent contrat est conclu pour une durée déterminée à compter du ${d(p.hireDate)} jusqu'au ____ / ____ / ________, motif : ____________________________.`)
    art(4, 'Durée et organisation du travail', "Les créneaux de livraison s'étendent habituellement de 09h à 21h. Le Salarié est planifié selon le planning communiqué par l'Employeur, dans le respect de la durée légale du travail. La présence est pointée à la journée (arrivée et départ).")
    art(5, 'Rémunération', `Le Salarié perçoit une rémunération fixe de ${mad(p.dailyRate)} par jour travaillé (jour pointé). Il peut bénéficier de primes de performance : ${pay.bonusPerOrder > 0 ? `${mad(pay.bonusPerOrder)} par commande livrée au-delà de ${pay.bonusThreshold} commandes dans la journée` : 'selon règles communiquées'}${pay.onTimeBonus > 0 ? `, ${mad(pay.onTimeBonus)} par livraison effectuée dans le créneau promis` : ''}. ${pay.noShowPenalty > 0 || pay.latePenalty > 0 ? `Des retenues peuvent s'appliquer${pay.noShowPenalty > 0 ? ` (${mad(pay.noShowPenalty)} par commande en échec imputable au Salarié)` : ''}${pay.latePenalty > 0 ? ` (${mad(pay.latePenalty)} par livraison hors créneau)` : ''}, dans les limites prévues par la loi.` : ''} La paie est établie mensuellement à partir du pointage et des livraisons enregistrées. Les règles de prime peuvent évoluer ; toute modification est notifiée par écrit.`)
    art(6, 'Obligations du Salarié', "Le Salarié s'engage à suivre la formation initiale de l'Employeur et à valider son évaluation, à respecter les consignes de sécurité routière, les procédures de livraison et de remise des fonds, à utiliser l'application mise à disposition, à prendre soin du matériel et du véhicule, et à adopter un comportement courtois envers les clients.")
    art(7, 'Confidentialité', "Le Salarié s'interdit de divulguer toute information relative aux clients, aux commandes, aux adresses de livraison et aux méthodes de l'Employeur, pendant et après l'exécution du contrat.")
    art(8, 'Rupture', "La rupture du contrat est soumise aux dispositions du Code du travail marocain, notamment en matière de préavis et d'indemnités.")
    art(9, 'Loi applicable et litiges', "Le présent contrat est régi par le droit marocain. À défaut d'accord amiable, tout litige relève des juridictions compétentes.")

    doc.moveDown(1.6).font('Helvetica').fontSize(10).fillColor('#1f2937').text(`Fait à ______________, le ____ / ____ / ________, en deux exemplaires originaux.`)
    const y = doc.y + 24
    doc.font('Helvetica-Bold').text("L'Employeur", 56, y).text('Le Salarié', 330, y)
    doc.font('Helvetica').fontSize(8.5).fillColor('#6b7280').text('(signature précédée de « lu et approuvé »)', 56, y + 14).text('(signature précédée de « lu et approuvé »)', 330, y + 14)
    doc.fontSize(7.5).text("Modèle de contrat généré automatiquement — à faire valider par un conseil juridique avant signature.", 56, doc.page.height - 50, { align: 'center', width: doc.page.width - 112 })
    doc.end()
  })
}
