'use client'
import { ImageIcon, Camera } from 'lucide-react'

interface Props {
  label: string
  imageUrl?: string
}

export function ScreenshotZone({ label, imageUrl }: Props) {
  return (
    <div className="flex flex-col gap-1 w-full">
      {/* Label capture */}
      <div className="flex items-center gap-1.5">
        <Camera size={11} className="text-amber-500" />
        <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">Capture d&apos;écran</span>
      </div>

      {imageUrl ? (
        <div className="rounded-xl overflow-hidden border-2 border-amber-400 shadow-md shadow-amber-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={label} className="w-full object-cover block" />
          <div className="px-3 py-1.5 bg-amber-50 border-t border-amber-200">
            <p className="text-[10px] text-amber-700 font-medium">{label}</p>
          </div>
        </div>
      ) : (
        <div
          className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 flex flex-col items-center justify-center gap-2"
          style={{ minHeight: '160px' }}
        >
          <ImageIcon size={22} className="text-amber-300" />
          <p className="text-xs font-medium text-amber-400 text-center px-4">{label}</p>
        </div>
      )}
    </div>
  )
}
