// Compression d'image côté client (canvas) pour l'application livreur : JPEG, largeur max 1024 px, taille <= photoMaxKB.
// pickQuality est pure (testée par Node) ; le reste n'utilise le DOM qu'à l'appel.

export const MAX_WIDTH = 1024
export const Q_MAX = 0.85
export const Q_MIN = 0.3

/**
 * Qualité JPEG à essayer ensuite selon la taille obtenue et la taille cible.
 * - déjà sous la cible : qualité haute ;
 * - sinon on réduit en proportion (la taille JPEG décroît à peu près linéairement avec la qualité sur la plage utile), avec une marge de 8 %.
 */
export function pickQuality(sizeBytes: number, maxKB: number, current: number = Q_MAX): number {
  const target = Math.max(1, maxKB) * 1024
  if (!(sizeBytes > 0)) return Q_MAX
  if (sizeBytes <= target) return Math.min(Q_MAX, Math.max(Q_MIN, current))
  const ratio = (target * 0.92) / sizeBytes // < 1
  const q = current * ratio
  return Math.round(Math.min(Q_MAX, Math.max(Q_MIN, q)) * 100) / 100
}

/** Dimensions réduites en conservant le ratio (jamais agrandi). */
export function fitWidth(w: number, h: number, maxW: number = MAX_WIDTH): { w: number; h: number } {
  if (w <= maxW) return { w, h }
  const k = maxW / w
  return { w: maxW, h: Math.max(1, Math.round(h * k)) }
}

export interface CompressedImage { dataBase64: string; mime: 'image/jpeg'; bytes: number; width: number; height: number; quality: number }

/** Taille décodée d'une chaîne base64. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - pad
}

async function loadBitmap(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() }
    } catch { /* repli sur <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('image')); img.src = url })
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} }
  } finally { URL.revokeObjectURL(url) }
}

function toBlob(canvas: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', q))
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] ?? '')
    r.onerror = () => rej(new Error('read'))
    r.readAsDataURL(b)
  })
}

/** Compresse une photo : redimensionne à 1024 px max puis ajuste la qualité (jusqu'à 6 essais, puis réduit encore la largeur). */
export async function compressImage(file: Blob, maxKB: number): Promise<CompressedImage> {
  const bm = await loadBitmap(file)
  try {
    let { w, h } = fitWidth(bm.w, bm.h)
    let q = Q_MAX
    const canvas = document.createElement('canvas')
    let blob: Blob = file
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
      ctx.drawImage(bm.src, 0, 0, w, h)
      blob = await toBlob(canvas, q)
      if (blob.size <= maxKB * 1024) break
      const nq = pickQuality(blob.size, maxKB, q)
      if (nq >= q - 0.02 || nq <= Q_MIN + 0.001) { // qualité au plancher : on réduit la largeur
        w = Math.max(320, Math.round(w * 0.8)); h = Math.max(240, Math.round(h * 0.8)); q = Math.max(Q_MIN, nq)
      } else q = nq
    }
    const dataBase64 = await blobToBase64(blob)
    return { dataBase64, mime: 'image/jpeg', bytes: blob.size, width: w, height: h, quality: q }
  } finally { bm.close() }
}
