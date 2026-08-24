export type GenderIdentity = {
  display_name?: string | null
  gender?: string | null
  gender_visible?: boolean | null
}

export type Identity = { label: string; colorClass: string }

export const RAINBOW_TEXT_CLASS = 'text-rainbow'

/**
 * Resolves how a member may be shown to others, honouring their privacy:
 *  - no public name            → "Anonymous"
 *  - name + visible gender     → name tinted pink / blue / rainbow
 *  - name, gender private      → plain name
 * Row-level security already hides profiles marked invisible; this only
 * formats what the database allowed us to see.
 */
export function resolveIdentity(p: GenderIdentity | null | undefined): Identity {
  if (!p) return { label: 'Anonymous', colorClass: 'text-slate-400 italic' }
  const name = p.display_name?.trim()
  if (!name) return { label: 'Anonymous', colorClass: 'text-slate-400 italic' }
  if (p.gender_visible) {
    if (p.gender === 'woman') return { label: name, colorClass: 'text-pink-400' }
    if (p.gender === 'man') return { label: name, colorClass: 'text-blue-400' }
    if (p.gender === 'non_binary') return { label: name, colorClass: RAINBOW_TEXT_CLASS }
  }
  return { label: name, colorClass: '' }
}
