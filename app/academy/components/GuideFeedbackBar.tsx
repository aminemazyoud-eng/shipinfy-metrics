'use client'
import { useState } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'

export function GuideFeedbackBar({ moduleKey }: { moduleKey: string }) {
  const [voted, setVoted] = useState<'up' | 'down' | null>(null)

  const vote = async (helpful: boolean) => {
    if (voted) return
    setVoted(helpful ? 'up' : 'down')
    await fetch('/api/guide-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moduleKey, helpful }),
    })
  }

  return (
    <div className="mt-8 pt-6 border-t border-gray-100 flex items-center gap-4">
      <p className="text-sm text-gray-500 font-medium">Cette page vous a été utile ?</p>
      <button
        onClick={() => vote(true)}
        disabled={!!voted}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          voted === 'up' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600 hover:bg-green-50 hover:text-green-600'
        }`}
      >
        <ThumbsUp size={14} /> Oui
      </button>
      <button
        onClick={() => vote(false)}
        disabled={!!voted}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          voted === 'down' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600'
        }`}
      >
        <ThumbsDown size={14} /> Non
      </button>
      {voted && <p className="text-sm text-gray-400 italic">Merci pour votre retour !</p>}
    </div>
  )
}
