'use client'
import { ImageIcon } from 'lucide-react'

interface Props {
  label: string
  imageUrl?: string
}

export function ScreenshotZone({ label, imageUrl }: Props) {
  if (imageUrl) {
    return (
      <div className="w-full rounded-xl overflow-hidden border border-gray-200 my-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={label} className="w-full object-cover" />
      </div>
    )
  }
  return (
    <div
      className="w-full my-4 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center gap-2 text-gray-400"
      style={{ minHeight: '200px', maxHeight: '280px' }}
    >
      <ImageIcon size={28} className="text-gray-300" />
      <p className="text-sm font-medium text-gray-400">{label}</p>
    </div>
  )
}
