'use client'
import { useEffect, useState } from 'react'
import { GraduationCap, BookOpen, CheckCircle, Play, FileText, Award, Users, BookMarked, AlertTriangle } from 'lucide-react'
import { GuideContent } from './components/guides/GuideContent'

interface Lesson {
  id: string
  title: string
  type: 'video' | 'quiz' | 'document'
  duration?: number
  order: number
}

interface Course {
  id: string
  title: string
  category: string
  description: string
  color: string
  emoji: string
  order: number
  lessons: Lesson[]
  progress: { score?: number; certified?: boolean; driverId?: string }[]
}

const CATEGORY_LABELS: Record<string, string> = {
  foodtech:   'Foodtech & Marketplace',
  medical:    'Secteur Médical',
  safety:     'Sécurité Routière',
  softskills: 'Soft Skills',
  navigation: 'Navigation',
  admin:      'Administration',
}

type Tab = 'formation' | 'guides'

export default function AcademyPage() {
  const [tab, setTab] = useState<Tab>('formation')
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Course | null>(null)

  useEffect(() => {
    fetch('/api/courses').then(r => r.json()).then(d => {
      setCourses(Array.isArray(d) ? d : [])
      setLoading(false)
    })
  }, [])

  const totalCertified  = courses.reduce((s, c) => s + c.progress.filter(p => p.certified).length, 0)
  const totalLessons    = courses.reduce((s, c) => s + c.lessons.length, 0)
  const totalParticipants = new Set(courses.flatMap(c => c.progress.map(p => p.driverId)).filter(Boolean)).size
  const hasNoFormation = totalCertified === 0 && totalParticipants === 0

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-3 md:py-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3 md:mb-4">
          <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center">
            <GraduationCap size={18} className="text-purple-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Academy</h1>
            <p className="text-xs text-gray-500">Formation certifiante + Guides Shipinfy</p>
          </div>
          {hasNoFormation && (
            <div className="ml-auto flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-700 px-3 py-1.5 rounded-lg text-xs font-semibold">
              <AlertTriangle size={13} />
              Non formé
            </div>
          )}
        </div>

        {/* Stats (formation tab only) */}
        {tab === 'formation' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-3 md:mb-4">
            {[
              { label: 'Modules',        value: courses.length,   icon: BookOpen,  color: 'text-blue-600',   bg: 'bg-blue-50'   },
              { label: 'Leçons',         value: totalLessons,     icon: FileText,  color: 'text-purple-600', bg: 'bg-purple-50' },
              { label: 'Certifications', value: totalCertified,   icon: Award,     color: 'text-green-600',  bg: 'bg-green-50'  },
              { label: 'Participants',   value: totalParticipants, icon: Users,    color: 'text-orange-600', bg: 'bg-orange-50' },
            ].map(stat => (
              <div key={stat.label} className={`${stat.bg} rounded-xl p-3`}>
                <stat.icon size={16} className={`${stat.color} mb-1`} />
                <p className={`text-xl font-black ${stat.color}`}>{stat.value}</p>
                <p className="text-[11px] text-gray-500">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Onglets */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => setTab('formation')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === 'formation'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <GraduationCap size={14} />
            Formation Livreurs
          </button>
          <button
            onClick={() => setTab('guides')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === 'guides'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <BookMarked size={14} />
            Guides Shipinfy
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">

        {/* ── Onglet 1 : Formation Livreurs ── */}
        {tab === 'formation' && (
          <div className="p-6">
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1,2,3,4,5,6].map(i => <div key={i} className="h-52 bg-white animate-pulse rounded-xl border border-gray-200" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {courses.map(course => {
                  const certified    = course.progress.filter(p => p.certified).length
                  const participants = course.progress.length
                  return (
                    <div
                      key={course.id}
                      onClick={() => setSelected(course)}
                      className="bg-white rounded-xl border border-gray-200 overflow-hidden cursor-pointer hover:shadow-md hover:border-gray-300 transition-all group"
                    >
                      <div className="h-1.5 w-full" style={{ background: course.color }} />
                      <div className="p-4">
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: `${course.color}18` }}>
                            {course.emoji}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-gray-900 text-sm leading-tight">{course.title}</h3>
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full mt-1 inline-block"
                              style={{ background: `${course.color}15`, color: course.color }}>
                              {CATEGORY_LABELS[course.category] ?? course.category}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed mb-3 line-clamp-2">{course.description}</p>
                        <div className="flex items-center gap-3 text-[11px] text-gray-400 pt-2 border-t border-gray-100">
                          <span className="flex items-center gap-1"><BookOpen size={11} /> {course.lessons.length} leçons</span>
                          <span className="flex items-center gap-1"><Award size={11} /> {certified} certifiés</span>
                          <span className="flex items-center gap-1 ml-auto"><Users size={11} /> {participants}</span>
                        </div>
                        {participants > 0 && (
                          <div className="mt-2">
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${Math.round((certified/participants)*100)}%`, background: course.color }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Onglet 2 : Guides Shipinfy ── */}
        {tab === 'guides' && <GuideContent />}
      </div>

      {/* Course Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden">
            <div className="h-2" style={{ background: selected.color }} />
            <div className="p-5 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{selected.emoji}</span>
                  <div>
                    <h2 className="font-bold text-gray-900">{selected.title}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{selected.description}</p>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200">
                  <span className="text-sm">✕</span>
                </button>
              </div>
            </div>
            <div className="p-5">
              {selected.lessons.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen size={28} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Aucune leçon pour ce module</p>
                  <p className="text-xs text-gray-300 mt-1">Les leçons peuvent être ajoutées via l&apos;API</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Leçons</h3>
                  {selected.lessons.map((lesson, i) => (
                    <div key={lesson.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: `${selected.color}18` }}>
                        {lesson.type === 'video' ? <Play size={12} style={{ color: selected.color }} /> :
                         lesson.type === 'quiz'  ? <CheckCircle size={12} style={{ color: selected.color }} /> :
                         <FileText size={12} style={{ color: selected.color }} />}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{lesson.title}</p>
                        <p className="text-[10px] text-gray-400">
                          {lesson.type === 'video' ? 'Vidéo' : lesson.type === 'quiz' ? 'Quiz' : 'Document'}
                          {lesson.duration ? ` · ${lesson.duration} min` : ''}
                        </p>
                      </div>
                      <span className="text-[10px] text-gray-300">#{i+1}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
