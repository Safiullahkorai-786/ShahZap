export type Base = 'dark' | 'white'
export type Accent = 'none' | 'pink' | 'emerald' | 'purple' | 'yellow' | 'sunset' | 'ocean' | 'aurora'
export type Selection = { base: Base; accent: Accent }

const KEY = 'shahzap:theme'

export const ACCENTS: { id: Accent; label: string; preview: string }[] = [
  { id: 'none', label: 'Classic', preview: 'linear-gradient(135deg,#22d3ee,#0ea5e9)' },
  { id: 'pink', label: 'Pink', preview: '#ec4899' },
  { id: 'emerald', label: 'Emerald', preview: '#10b981' },
  { id: 'purple', label: 'Purple', preview: '#8b5cf6' },
  { id: 'yellow', label: 'Yellow', preview: '#f59e0b' },
  { id: 'sunset', label: 'Sunset', preview: 'linear-gradient(135deg,#7e22ce,#db2777,#f59e0b)' },
  { id: 'ocean', label: 'Ocean', preview: 'linear-gradient(135deg,#0369a1,#06b6d4)' },
  { id: 'aurora', label: 'Aurora', preview: 'linear-gradient(135deg,#10b981,#8b5cf6)' },
]

export function getSelection(): Selection {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        const p = JSON.parse(raw) as Partial<Selection>
        if ((p.base === 'dark' || p.base === 'white') && typeof p.accent === 'string') {
          return { base: p.base, accent: p.accent as Accent }
        }
        // Legacy values from the old single-value system.
        if (raw === 'light') return { base: 'white', accent: 'none' }
      }
    } catch {}
  }
  return { base: 'dark', accent: 'none' }
}

export function applySelection(sel: Selection) {
  const el = document.documentElement
  el.dataset.base = sel.base
  el.dataset.accent = sel.accent
  localStorage.setItem(KEY, JSON.stringify(sel))
}
