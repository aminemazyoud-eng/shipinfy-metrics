// In-memory upload progress tracker.
// Works in Docker standalone mode (single persistent Node.js process).
// Key = reportId, cleared after 10 minutes.

export interface UploadState {
  total:    number
  inserted: number
  done:     boolean
  error?:   string
}

export const uploadProgress = new Map<string, UploadState>()

// Auto-clean finished entries after 10 min to avoid memory leak
export function trackUpload(reportId: string, total: number): UploadState {
  const state: UploadState = { total, inserted: 0, done: false }
  uploadProgress.set(reportId, state)
  setTimeout(() => uploadProgress.delete(reportId), 10 * 60 * 1000)
  return state
}
