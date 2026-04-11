'use client'
import { useState } from 'react'
import { ChevronDown, CheckCircle2, HelpCircle } from 'lucide-react'
import { ScreenshotZone } from '../ScreenshotZone'
import { GuideFeedbackBar } from '../GuideFeedbackBar'

// ── Types ─────────────────────────────────────────────────────────────────
interface Step {
  title: string
  screenshot: string
  imageUrl?: string
  description: string
}

interface GuideData {
  key: string
  title: string
  description: string
  readTime: string
  link: string
  steps: Step[]
  tips: string[]
  faq: { q: string; a: string }[]
}

// ── Données des 8 guides ──────────────────────────────────────────────────
const GUIDES: GuideData[] = [
  {
    key: 'dashboard',
    title: 'Dashboard Temps Réel',
    description: 'Surveiller les livraisons en cours et les métriques live',
    readTime: '4 min',
    link: '/',
    steps: [
      { title: 'Accéder au Dashboard', screenshot: 'Vue globale du Dashboard', imageUrl: '/guides/dash-overview.jpg', description: 'Cliquez sur "Dashboard" dans la sidebar à gauche. La page affiche en temps réel l\'état de toutes les livraisons actives.' },
      { title: 'Comprendre les métriques live', screenshot: 'Cards KPI en haut de page', imageUrl: '/guides/dash-kpi-cards.jpg', description: 'Les cartes en haut résument : commandes totales, en cours, livrées, NO_SHOW, taux livraison et COD collecté. Rafraîchissement automatique.' },
      { title: 'Lire les statuts des commandes', screenshot: 'Tableau des commandes avec statuts colorés', imageUrl: '/guides/dash-orders-table.jpg', description: 'Chaque commande affiche un statut coloré : vert = livré, rouge = NO_SHOW, orange = en livraison. Cliquez sur une ligne pour voir le détail.' },
      { title: 'Interpréter les alertes temps réel', screenshot: 'Bandeau alerte et livreurs actifs', imageUrl: '/guides/dash-overview.jpg', description: 'La section "Livreurs actifs" montre en temps réel chaque livreur, son taux du jour et son statut. Un badge rouge signale une action urgente.' },
      { title: 'Filtrer par hub ou livreur', screenshot: 'Performance par Hub', imageUrl: '/guides/dash-overview.jpg', description: 'La section "Performance par Hub" à droite compare les hubs en temps réel. Utilisez la sidebar pour accéder directement aux détails d\'un hub.' },
    ],
    tips: [
      'Le rafraîchissement est automatique — pas besoin de recharger la page',
      'Rouge = action urgente requise — ne pas ignorer les alertes',
      'Vérifier le dashboard en début de chaque shift pour anticiper les problèmes',
      'Le filtre hub permet de déléguer la supervision par zone géographique',
    ],
    faq: [
      { q: 'Pourquoi les données ne se mettent pas à jour ?', a: 'Si la page est restée ouverte longtemps, rechargez-la. Le rafraîchissement automatique reprendra.' },
      { q: 'Comment filtrer par livreur spécifique ?', a: 'Utilisez le menu déroulant "Livreur" dans la barre de filtres en haut du tableau.' },
      { q: 'Que signifie le statut "En attente" ?', a: 'La commande est assignée mais le livreur n\'a pas encore commencé la livraison.' },
    ],
  },
  {
    key: 'kpis',
    title: 'KPIs & Métriques',
    description: 'Importer des fichiers Excel et analyser les performances détaillées',
    readTime: '6 min',
    link: '/kpis',
    steps: [
      { title: 'Télécharger le template CSV', screenshot: 'Zone d\'upload avec bouton Télécharger le template', imageUrl: '/guides/kpis-upload-zone.jpg', description: 'Cliquez "Télécharger le template" pour obtenir un fichier CSV vide avec les 30 colonnes attendues. Remplissez-le et réimportez.' },
      { title: 'Importer un fichier Excel', screenshot: 'Zone d\'upload avec glisser-déposer', imageUrl: '/guides/kpis-upload-zone.jpg', description: 'Glissez votre fichier .xlsx sur la zone d\'upload ou cliquez "Sélectionner un fichier". Le transfert et l\'import se font en 2 étapes avec barre de progression.' },
      { title: 'Comprendre les KPIs globaux', screenshot: 'KPIs affichés après import', imageUrl: '/guides/kpis-filterbar.jpg', description: 'Une fois importé, les KPIs s\'affichent automatiquement : taux de livraison, no-show, COD total, et temps moyen par étape.' },
      { title: 'Utiliser les filtres date/hub/livreur', screenshot: 'FilterBar avec sélecteurs', imageUrl: '/guides/kpis-filterbar.jpg', description: 'Affinez l\'analyse avec les filtres : période personnalisée, hub spécifique, ou livreur individuel. Les graphiques se mettent à jour instantanément.' },
      { title: 'Lire le classement livreurs', screenshot: 'Tableau classement livreurs', imageUrl: '/guides/kpis-filterbar.jpg', description: 'Le tableau "Classement Livreurs" trie par taux de livraison. Identifiez les meilleurs et les livreurs à accompagner.' },
      { title: 'Générer et envoyer le rapport PDF', screenshot: 'Bouton Envoyer le rapport', imageUrl: '/guides/kpis-filterbar.jpg', description: 'Cliquez "Envoyer le rapport" en haut à droite. Entrez l\'email destinataire et envoyez un PDF complet avec tous les KPIs.' },
    ],
    tips: [
      'Format accepté : .xlsx et .xls uniquement',
      'Taille maximale : 100 Mo — les fichiers plus grands doivent être découpés',
      'Les fichiers Shopify avec des millions de lignes vides sont supportés automatiquement',
      'Filtrez par hub pour comparer les performances entre zones',
      'Le rapport PDF ne s\'envoie pas si aucune commande n\'est importée',
    ],
    faq: [
      { q: 'Mon fichier ne s\'importe pas, pourquoi ?', a: 'Vérifiez que le format est .xlsx ou .xls, et que le fichier contient les colonnes attendues (téléchargez le template pour référence).' },
      { q: 'Comment comparer deux périodes ?', a: 'Importez d\'abord la période A, notez les KPIs, puis supprimez et importez la période B. La comparaison manuelle reste la solution actuelle.' },
      { q: 'Le PDF peut-il être personnalisé ?', a: 'Le PDF inclut automatiquement tous les KPIs du rapport actif. La personnalisation avancée est prévue dans un sprint futur.' },
    ],
  },
  {
    key: 'alertes',
    title: 'Alertes & Tickets',
    description: 'Gérer les alertes opérationnelles et le suivi des incidents',
    readTime: '5 min',
    link: '/alertes',
    steps: [
      { title: 'Comprendre les 3 onglets', screenshot: 'Page Alertes — onglets Alertes / Tickets / Règles', imageUrl: '/guides/alertes-tabs.jpg', description: 'La page est divisée en 3 onglets : Alertes (incidents détectés), Tickets (suivi des actions), et Règles (configuration des seuils).' },
      { title: 'Créer une règle d\'alerte', screenshot: 'Vue globale Alertes & Tickets', imageUrl: '/guides/alertes-overview.jpg', description: 'Dans l\'onglet Règles, définissez la métrique à surveiller (taux no-show, délai, etc.), le seuil de déclenchement et la sévérité.' },
      { title: 'Gérer une alerte active', screenshot: 'Liste des alertes actives', imageUrl: '/guides/alertes-overview.jpg', description: 'Dans l\'onglet Alertes, chaque alerte affiche sa sévérité, sa date et son statut. Cliquez "Résoudre" une fois l\'action prise.' },
      { title: 'Créer un ticket depuis une alerte', screenshot: 'Gestion des tickets', imageUrl: '/guides/alertes-overview.jpg', description: 'Pour les alertes nécessitant un suivi, cliquez "Créer ticket". Le ticket est automatiquement lié à l\'alerte et assignable à un responsable.' },
      { title: 'Escalader un ticket critique', screenshot: 'Statuts des tickets', imageUrl: '/guides/alertes-overview.jpg', description: 'Si un ticket n\'est pas résolu dans les délais, passez-le en "Escaladé". Il apparaîtra en priorité dans la liste et peut déclencher une notification.' },
    ],
    tips: [
      'Configurez les seuils selon votre contexte (taux no-show acceptable, délais max)',
      'Assignez chaque ticket à un responsable identifié pour éviter les oublis',
      'Visez une résolution dans les 24h pour les tickets haute priorité',
      'Les alertes auto créées par le Score IA apparaissent ici',
    ],
    faq: [
      { q: 'Comment désactiver une règle temporairement ?', a: 'Dans l\'onglet Règles, cliquez sur la règle et désactivez-la. Elle peut être réactivée à tout moment sans perte de configuration.' },
      { q: 'Qui reçoit les notifications d\'alerte ?', a: 'Les notifications sont envoyées aux administrateurs configurés dans Paramètres. La gestion fine des destinataires est prévue.' },
      { q: 'Comment clôturer un ticket ?', a: 'Dans l\'onglet Tickets, passez le statut à "Résolu". Le ticket est archivé et reste consultable dans l\'historique.' },
    ],
  },
  {
    key: 'rapports',
    title: 'Rapports & Planification',
    description: 'Configurer l\'envoi automatique de rapports PDF par email',
    readTime: '4 min',
    link: '/rapports',
    steps: [
      { title: 'Accéder à la section Rapports', screenshot: 'Page Rapports & Planification', imageUrl: '/guides/rapports-overview.jpg', description: 'Cliquez sur "Rapports" dans la sidebar. La page liste les rapports planifiés existants et l\'historique des envois.' },
      { title: 'Configurer l\'envoi automatique', screenshot: 'Formulaire nouveau rapport planifié', imageUrl: '/guides/rapports-overview.jpg', description: 'Cliquez "Nouveau rapport" et choisissez la fréquence (quotidien, hebdo, mensuel), l\'heure d\'envoi et les destinataires.' },
      { title: 'Choisir fréquence et heure', screenshot: 'Sélecteur fréquence et heure', imageUrl: '/guides/rapports-overview.jpg', description: 'Recommandé : envoi quotidien à 08:00. Le rapport PDF est généré automatiquement depuis les dernières données importées.' },
      { title: 'Ajouter les destinataires', screenshot: 'Champ email destinataires', imageUrl: '/guides/rapports-overview.jpg', description: 'Entrez les adresses email des destinataires. Séparez plusieurs adresses par des virgules. Le rapport leur sera envoyé automatiquement.' },
      { title: 'Consulter l\'historique des envois', screenshot: 'Historique des envois', imageUrl: '/guides/rapports-overview.jpg', description: 'L\'historique montre chaque envoi avec sa date, le destinataire et le statut (succès / échec). En cas d\'échec, vérifiez les paramètres SMTP.' },
    ],
    tips: [
      'Envoi quotidien à 08:00 recommandé pour le rapport du lendemain',
      'Ajoutez plusieurs destinataires pour impliquer toute l\'équipe',
      'Si l\'email n\'est pas reçu, vérifiez l\'historique et les spams',
      'Le rapport ne s\'envoie pas si aucune commande n\'est importée — importez d\'abord un fichier Excel',
    ],
    faq: [
      { q: 'L\'email n\'est pas arrivé, que faire ?', a: 'Vérifiez l\'historique pour voir si l\'envoi a réussi côté serveur. Consultez les spams. Si l\'erreur persiste, vérifiez les paramètres SMTP dans Paramètres.' },
      { q: 'Peut-on envoyer à plusieurs adresses ?', a: 'Oui, séparez les adresses par des virgules dans le champ destinataires.' },
      { q: 'Comment modifier la planification ?', a: 'Cliquez sur la planification existante, modifiez les paramètres et sauvegardez. La nouvelle configuration s\'applique dès le prochain envoi.' },
    ],
  },
  {
    key: 'livreurs',
    title: 'Base de données Livreurs',
    description: 'Gérer les fiches livreurs, documents et suivi des expirations',
    readTime: '5 min',
    link: '/livreurs',
    steps: [
      { title: 'Accéder à la liste des livreurs', screenshot: 'Tableau livreurs — vue globale', imageUrl: '/guides/livreurs-overview.jpg', description: 'La page Livreurs liste tous les livreurs actifs avec leur hub d\'appartenance, statut et score de fiabilité.' },
      { title: 'Ajouter un nouveau livreur', screenshot: 'Bouton Ajouter livreur', imageUrl: '/guides/livreurs-overview.jpg', description: 'Cliquez "Ajouter livreur" et remplissez les informations de base : prénom, nom, téléphone, hub d\'affectation.' },
      { title: 'Remplir la fiche complète', screenshot: 'Fiche livreur détaillée', imageUrl: '/guides/livreurs-overview.jpg', description: 'La fiche comprend : informations personnelles, documents (CIN, assurance, permis), et l\'historique de performance.' },
      { title: 'Uploader les documents CIN / assurance', screenshot: 'Zone upload document avec date expiration', imageUrl: '/guides/livreurs-overview.jpg', description: 'Pour chaque document, uploadez le fichier et renseignez la date d\'expiration. Le système alertera 30 jours avant expiration.' },
      { title: 'Suivre les documents expirés', screenshot: 'Badges statut et expiration', imageUrl: '/guides/livreurs-overview.jpg', description: 'Les livreurs avec documents expirés apparaissent avec un badge rouge. Traitez ces cas en priorité pour rester conforme.' },
      { title: 'Exporter la base en CSV', screenshot: 'Export CSV livreurs', imageUrl: '/guides/livreurs-overview.jpg', description: 'Cliquez "Exporter CSV" pour télécharger la liste complète des livreurs avec toutes leurs informations.' },
    ],
    tips: [
      'Toujours uploader CIN recto + verso pour une conformité complète',
      'Vérifier la date d\'expiration de l\'assurance à chaque renouvellement',
      'L\'alerte automatique se déclenche 30 jours avant expiration',
      'Utilisez la recherche pour trouver rapidement un livreur par nom ou hub',
    ],
    faq: [
      { q: 'Comment modifier une fiche livreur ?', a: 'Cliquez sur le nom du livreur dans le tableau. La fiche s\'ouvre en mode édition directe.' },
      { q: 'Que faire si l\'assurance est expirée ?', a: 'Demandez au livreur le nouveau document, uploadez-le et mettez à jour la date d\'expiration. Le badge rouge disparaît automatiquement.' },
      { q: 'Comment retrouver un livreur rapidement ?', a: 'Utilisez la barre de recherche en haut du tableau — filtrez par nom, prénom ou hub.' },
    ],
  },
  {
    key: 'onboarding',
    title: 'Onboarding Livreurs',
    description: 'Gérer le pipeline Kanban de recrutement et validation des livreurs',
    readTime: '4 min',
    link: '/onboarding',
    steps: [
      { title: 'Comprendre le pipeline Kanban', screenshot: 'Vue Kanban 5 colonnes', imageUrl: '/guides/onboarding-kanban.jpg', description: 'Le Kanban affiche 5 colonnes : Prospects, En cours, Formation, Validés, Actifs. Chaque livreur avance de gauche à droite.' },
      { title: 'Ajouter un prospect', screenshot: 'Ajouter un nouveau prospect', imageUrl: '/guides/onboarding-kanban.jpg', description: 'Cliquez "Nouveau prospect" et renseignez nom, téléphone et source du contact. Le prospect apparaît dans la première colonne.' },
      { title: 'Faire avancer le livreur dans le pipeline', screenshot: 'Déplacer une carte entre colonnes', imageUrl: '/guides/onboarding-kanban.jpg', description: 'Glissez la carte du livreur vers la colonne suivante au fur et à mesure de l\'avancement (entretien, documents, formation...).' },
      { title: 'Valider les étapes KYC / Contrat / Formation', screenshot: 'Checklist étapes validation', imageUrl: '/guides/onboarding-kanban.jpg', description: 'Chaque fiche liste les étapes obligatoires : KYC, signature contrat, formation. Cochez chaque étape pour débloquer la suivante.' },
      { title: 'Passer le livreur en statut Actif', screenshot: 'Colonne Actifs du Kanban', imageUrl: '/guides/onboarding-kanban.jpg', description: 'Une fois toutes les étapes cochées, cliquez "Passer Actif". Le livreur apparaît dans la base Livreurs et peut être assigné aux tournées.' },
    ],
    tips: [
      'Le pipeline a 5 colonnes : Prospects / En cours / Formation / Validés / Actifs',
      'Le Score IA est calculé automatiquement dès que le livreur est actif',
      'Un badge couleur indique le score de fiabilité estimé',
      'Ne pas sauter d\'étape — chaque validation est nécessaire pour la conformité',
    ],
    faq: [
      { q: 'Comment déplacer un livreur entre colonnes ?', a: 'Glissez-déposez la carte ou utilisez le menu contextuel sur la fiche pour changer la colonne directement.' },
      { q: 'Que faire si un document est rejeté ?', a: 'Repassez le livreur en colonne "En cours", demandez un nouveau document et revalidez l\'étape concernée.' },
      { q: 'Comment voir le détail d\'un livreur ?', a: 'Cliquez sur la carte du livreur pour ouvrir sa fiche complète avec toutes les étapes et documents.' },
    ],
  },
  {
    key: 'score-ia',
    title: 'Score IA Fiabilité',
    description: 'Comprendre et exploiter le score de fiabilité calculé automatiquement',
    readTime: '5 min',
    link: '/score-ia',
    steps: [
      { title: 'Comprendre le calcul du score', screenshot: 'Page Score IA — vue globale', imageUrl: '/guides/score-ia-overview.jpg', description: 'Le score = Taux livraison × 0.4 + Score academy × 0.3 + (100 - Taux noshow) × 0.3. Trois dimensions pondérées pour une vision globale.' },
      { title: 'Lire le tableau des scores', screenshot: 'Tableau scores avec badges couleur', imageUrl: '/guides/score-ia-table.jpg', description: 'Le tableau liste chaque livreur avec son score coloré : vert ≥ 80, orange 60-80, rouge < 60. Triez par score pour identifier les priorités.' },
      { title: 'Identifier les livreurs à risque', screenshot: 'Livreurs critiques en rouge', imageUrl: '/guides/score-ia-table.jpg', description: 'Les livreurs en rouge (< 60) ont déclenché une alerte automatique. Consultez leur fiche pour comprendre quel composant tire le score vers le bas.' },
      { title: 'Agir sur les recommandations', screenshot: 'Recommandations IA par livreur', imageUrl: '/guides/score-ia-overview.jpg', description: 'Chaque fiche affiche une recommandation automatique : "Améliorer taux livraison", "Compléter la formation", etc. Suivez ces actions.' },
      { title: 'Suivre l\'évolution dans le temps', screenshot: 'Évolution scores dans le temps', imageUrl: '/guides/score-ia-overview.jpg', description: 'L\'historique montre l\'évolution du score sur les derniers jours. Une tendance à la hausse confirme l\'efficacité des actions prises.' },
    ],
    tips: [
      'Score < 60 → alerte créée automatiquement dans Alertes & Tickets',
      'Le recalcul est automatique chaque nuit à 02:00 (heure Maroc)',
      'Un bon score (≥ 80) identifie les livreurs à promouvoir ou garder',
      'Couleurs : rouge < 60 / orange 60-80 / vert ≥ 80',
    ],
    faq: [
      { q: 'Comment améliorer le score d\'un livreur ?', a: 'Améliorez les 3 composantes : inscrivez-le à l\'Academy (score formation), accompagnez-le pour réduire les no-shows et surveiller son taux de livraison.' },
      { q: 'Le score impacte-t-il les assignations ?', a: 'Pas automatiquement pour l\'instant. Il sert d\'indicateur pour les décisions manuelles d\'assignation.' },
      { q: 'À quelle fréquence est-il recalculé ?', a: 'Le cron tourne chaque nuit à 02:00. Vous pouvez aussi déclencher un recalcul manuel depuis la page Score IA.' },
    ],
  },
  {
    key: 'academy',
    title: 'Academy — Formation',
    description: 'Inscrire et suivre la formation certifiante des livreurs',
    readTime: '4 min',
    link: '/academy',
    steps: [
      { title: 'Accéder au catalogue des formations', screenshot: 'Onglet Formation Livreurs — 6 modules', imageUrl: '/guides/academy-formation.jpg', description: 'L\'onglet "Formation Livreurs" affiche les 6 modules disponibles. Chaque carte indique le nombre de leçons, certifiés et participants.' },
      { title: 'Inscrire un livreur à un module', screenshot: 'Cliquer sur un module pour l\'ouvrir', imageUrl: '/guides/academy-formation.jpg', description: 'Cliquez sur un module pour l\'ouvrir. La modal affiche les leçons disponibles et les livreurs inscrits.' },
      { title: 'Suivre la progression', screenshot: 'Barre de progression par module', imageUrl: '/guides/academy-formation.jpg', description: 'La barre de progression sous chaque module indique le ratio certifiés/participants. Les leçons complétées apparaissent avec une coche verte.' },
      { title: 'Valider un certificat (score ≥ 70%)', screenshot: 'Statistiques certifications', imageUrl: '/guides/academy-formation.jpg', description: 'Après le quiz final, si le score est ≥ 70%, le livreur obtient son certificat. Le compteur "Certifications" en haut se met à jour.' },
      { title: 'Consulter les Guides Shipinfy', screenshot: 'Onglet Guides Shipinfy — liste des 8 guides', imageUrl: '/guides/academy-guides-tab.jpg', description: 'L\'onglet "Guides Shipinfy" donne accès aux 8 guides d\'utilisation de la plateforme. Cliquez sur un guide pour l\'ouvrir.' },
    ],
    tips: [
      'Commencez par le module "Soft Skills & Client" — applicable immédiatement',
      'Le certificat est obtenu avec un quiz ≥ 70% — encouragez les livreurs à repasser si échec',
      'Chaque certification améliore le composant "Score Academy" du Score IA',
      'Badge orange "Non formé" si aucun module n\'est complété',
    ],
    faq: [
      { q: 'Un livreur peut-il repasser un quiz ?', a: 'Oui, le quiz peut être repassé autant de fois que nécessaire. Seul le meilleur score est retenu.' },
      { q: 'Le certificat a-t-il une date d\'expiration ?', a: 'Non, les certificats actuels n\'expirent pas. La validité limitée est prévue dans un sprint futur.' },
      { q: 'Comment voir tous les certifiés d\'un module ?', a: 'Cliquez sur le module — la liste des certifiés apparaît dans la section "Participants certifiés" de la modal.' },
    ],
  },
]

// ── Accordéon FAQ ─────────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-medium text-gray-800">{q}</span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform flex-shrink-0 ml-2 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 text-sm text-gray-600 bg-gray-50 border-t border-gray-100">
          {a}
        </div>
      )}
    </div>
  )
}

// ── Rendu d'un guide complet ──────────────────────────────────────────────
function GuideView({ guide, onClose }: { guide: GuideData; onClose: () => void }) {
  const [readProgress, setReadProgress] = useState(0)

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const pct = Math.round((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100)
    setReadProgress(Math.min(100, pct))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Progress bar de lecture */}
      <div className="h-1 bg-gray-100 flex-shrink-0">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${readProgress}%` }}
        />
      </div>

      {/* Contenu scrollable */}
      <div className="flex-1 overflow-y-auto p-6" onScroll={handleScroll}>

        {/* En-tête guide */}
        <div className="mb-6 pb-4 border-b border-gray-100">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">{guide.title}</h2>
              <p className="text-sm text-gray-500">{guide.description}</p>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 flex-shrink-0 text-gray-500 text-sm">✕</button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full font-medium">Lecture : {guide.readTime}</span>
            <a href={guide.link} className="text-xs bg-gray-900 text-white px-3 py-1 rounded-full font-medium hover:bg-gray-700 transition-colors">
              Aller au module →
            </a>
          </div>
        </div>

        {/* Section 1 — À quoi ça sert */}
        <div className="mb-6">
          <h3 className="text-base font-bold text-gray-800 mb-2">À quoi ça sert ?</h3>
          <p className="text-sm text-gray-600 leading-relaxed">
            Ce guide vous explique comment utiliser <strong>{guide.title}</strong> de la plateforme Shipinfy Metrics.
            Suivez les étapes dans l&apos;ordre pour maîtriser cette section en {guide.readTime}.
          </p>
        </div>

        {/* Section 2 — Étapes */}
        <div className="mb-6">
          <h3 className="text-base font-bold text-gray-800 mb-4">Comment l&apos;utiliser ?</h3>
          <div className="space-y-5">
            {guide.steps.map((step, i) => (
              <div key={i} className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {i + 1}
                  </div>
                  <span className="text-sm font-semibold text-gray-800">{step.title}</span>
                </div>
                <div className="p-4">
                  <ScreenshotZone label={step.screenshot} imageUrl={step.imageUrl} />
                  <p className="text-sm text-gray-600 leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 3 — Tips */}
        <div className="mb-6">
          <h3 className="text-base font-bold text-gray-800 mb-3">Tips & Bonnes pratiques</h3>
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 space-y-2">
            {guide.tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-blue-800">{tip}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4 — FAQ */}
        <div className="mb-6">
          <h3 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
            <HelpCircle size={16} className="text-gray-400" /> FAQ
          </h3>
          <div className="space-y-2">
            {guide.faq.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </div>

        {/* Footer */}
        <GuideFeedbackBar moduleKey={guide.key} />

        <div className="mt-4 pt-4 border-t border-gray-100 text-center">
          <a href={guide.link} className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
            Aller au module →
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Composant principal exporté ───────────────────────────────────────────
export function GuideContent() {
  const [selected, setSelected] = useState<GuideData | null>(null)

  if (selected) {
    return <GuideView guide={selected} onClose={() => setSelected(null)} />
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900">Guides Shipinfy</h2>
        <p className="text-sm text-gray-500 mt-1">Documentation complète de chaque module — étapes, captures et FAQ</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {GUIDES.map((guide, i) => (
          <button
            key={guide.key}
            onClick={() => setSelected(guide)}
            className="text-left bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-blue-200 transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-sm font-bold text-blue-600 flex-shrink-0">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm group-hover:text-blue-600 transition-colors">{guide.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{guide.description}</p>
                <span className="mt-2 inline-block text-xs text-blue-500 font-medium">{guide.readTime} de lecture</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
