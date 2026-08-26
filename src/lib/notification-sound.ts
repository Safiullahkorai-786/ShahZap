/*
 * ShahZap sound engine.
 *
 * Three themed bundles ("Classic", "Pop", "Zen"), each bundling four
 * distinct sounds:
 *   • message   — incoming chat message / general notification
 *   • sent      — your own message went out (tiny tick)
 *   • request   — friend request lifecycle chime
 *   • unfriend  — someone unfriended you (somber)
 *
 * Playback mode: "sound" | "buzz" (vibration only) | "mute".
 * Persisted in localStorage under "shahzap:sound". Legacy play* helpers
 * are kept as thin aliases so existing call sites keep working.
 */

export type SoundKind = 'message' | 'sent' | 'request' | 'unfriend'
export type SoundMode = 'sound' | 'buzz' | 'mute'
export type SoundBundle = 'classic' | 'pop' | 'zen'
export type SoundPrefs = { mode: SoundMode; bundle: SoundBundle }

const KEY = 'shahzap:sound'

const BUNDLE_IDS: SoundBundle[] = ['classic', 'pop', 'zen']
const MODE_IDS: SoundMode[] = ['sound', 'buzz', 'mute']

const VIBRATION: Record<SoundKind, number | number[]> = {
  message: 70,
  sent: 25,
  request: [60, 60, 60],
  unfriend: [180, 80, 180],
}

export function defaultSoundPrefs(): SoundPrefs {
  return { mode: 'sound', bundle: 'classic' }
}

export function getSoundPrefs(): SoundPrefs {
  if (typeof window === 'undefined') return defaultSoundPrefs()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return defaultSoundPrefs()
    const p = JSON.parse(raw) as Partial<SoundPrefs>
    return {
      mode: MODE_IDS.includes(p.mode as SoundMode) ? (p.mode as SoundMode) : 'sound',
      bundle: BUNDLE_IDS.includes(p.bundle as SoundBundle) ? (p.bundle as SoundBundle) : 'classic',
    }
  } catch {
    return defaultSoundPrefs()
  }
}

function savePrefs(next: SoundPrefs) {
  try { window.localStorage.setItem(KEY, JSON.stringify(next)) } catch {}
}

export function setSoundMode(mode: SoundMode): SoundPrefs {
  const next = { ...getSoundPrefs(), mode }
  savePrefs(next)
  return next
}

export function setSoundBundle(bundle: SoundBundle): SoundPrefs {
  const next = { ...getSoundPrefs(), bundle }
  savePrefs(next)
  return next
}

// ── WebAudio plumbing ──────────────────────────────────────────────────────

let ctx: AudioContext | undefined

function audio(): AudioContext | undefined {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return undefined
    ctx ??= new AudioCtor()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return undefined
  }
}

type ToneOpts = {
  freq: number
  at?: number
  dur?: number
  peak?: number
  type?: OscillatorType
  /** Slide the pitch to this value across the tone (for "boing"/pop feels). */
  glideTo?: number
}

function tone(c: AudioContext, { freq, at = 0, dur = 0.25, peak = 0.16, type = 'sine', glideTo }: ToneOpts) {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  const t0 = c.currentTime + at
  osc.frequency.setValueAtTime(freq, t0)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  gain.connect(c.destination)
  osc.connect(gain)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

// ── The three bundles ───────────────────────────────────────────────────────

function playClassic(kind: SoundKind) {
  const c = audio(); if (!c) return
  if (kind === 'message') {
    tone(c, { freq: 880, dur: 0.28, peak: 0.2 })
    tone(c, { freq: 1318.51, at: 0.12, dur: 0.34, peak: 0.18 })
  } else if (kind === 'sent') {
    tone(c, { freq: 1244.51, dur: 0.09, peak: 0.08 })
  } else if (kind === 'request') {
    tone(c, { freq: 523.25, dur: 0.22, type: 'triangle' })
    tone(c, { freq: 659.25, at: 0.14, dur: 0.22, type: 'triangle' })
    tone(c, { freq: 783.99, at: 0.28, dur: 0.42, type: 'triangle' })
    tone(c, { freq: 1046.5, at: 0.42, dur: 0.35, peak: 0.12, type: 'triangle' })
  } else {
    tone(c, { freq: 587.33, dur: 0.25, type: 'triangle' })
    tone(c, { freq: 392, at: 0.16, dur: 0.45, peak: 0.14, type: 'triangle' })
  }
}

function playPop(kind: SoundKind) {
  const c = audio(); if (!c) return
  if (kind === 'message') {
    tone(c, { freq: 420, glideTo: 980, dur: 0.16, peak: 0.22, type: 'square' })
    tone(c, { freq: 990, at: 0.1, glideTo: 640, dur: 0.12, peak: 0.12, type: 'square' })
  } else if (kind === 'sent') {
    tone(c, { freq: 760, glideTo: 1150, dur: 0.07, peak: 0.09, type: 'square' })
  } else if (kind === 'request') {
    tone(c, { freq: 392, glideTo: 784, dur: 0.2, peak: 0.18, type: 'triangle' })
    tone(c, { freq: 523.25, glideTo: 1046.5, at: 0.18, dur: 0.24, peak: 0.18, type: 'triangle' })
  } else {
    tone(c, { freq: 196, glideTo: 130, dur: 0.4, peak: 0.22 })
    tone(c, { freq: 98, at: 0.05, dur: 0.45, peak: 0.16 })
  }
}

function playZen(kind: SoundKind) {
  const c = audio(); if (!c) return
  if (kind === 'message') {
    tone(c, { freq: 783.99, dur: 0.5, peak: 0.14 })
    tone(c, { freq: 1174.66, at: 0.06, dur: 0.55, peak: 0.09 })
  } else if (kind === 'sent') {
    tone(c, { freq: 1046.5, dur: 0.12, peak: 0.05 })
  } else if (kind === 'request') {
    tone(c, { freq: 440, dur: 0.35, peak: 0.13 })
    tone(c, { freq: 554.37, at: 0.18, dur: 0.35, peak: 0.13 })
    tone(c, { freq: 659.25, at: 0.36, dur: 0.4, peak: 0.13 })
    tone(c, { freq: 880, at: 0.54, dur: 0.6, peak: 0.11 })
  } else {
    tone(c, { freq: 220, dur: 0.9, peak: 0.15 })
    tone(c, { freq: 329.63, dur: 0.85, peak: 0.07 })
  }
}

const PLAYERS: Record<SoundBundle, (k: SoundKind) => void> = {
  classic: playClassic,
  pop: playPop,
  zen: playZen,
}

/*
 * Buzz fallback for devices WITHOUT a vibration motor / API — notably
 * iOS Safari & PWA, which expose no navigator.vibrate at all. A short
 * low-frequency motor-like pulse pattern stands in for the haptic.
 */
function playBuzzTone(kind: SoundKind) {
  const c = audio(); if (!c) return
  const pulse = (at: number, dur: number) => {
    tone(c, { freq: 105, at, dur, peak: 0.3, type: 'sawtooth' })
    tone(c, { freq: 210, at, dur: dur * 0.8, peak: 0.08, type: 'sine' })
  }
  if (kind === 'sent') pulse(0, 0.05)
  else if (kind === 'message') { pulse(0, 0.07); pulse(0.11, 0.07) }
  else if (kind === 'request') { pulse(0, 0.06); pulse(0.1, 0.06); pulse(0.2, 0.09) }
  else { pulse(0, 0.18); pulse(0.26, 0.24) }
}

/** Play/vibrate per current user preferences. Safe to call anywhere. */
export function notify(kind: SoundKind) {
  const { mode, bundle } = getSoundPrefs()
  if (mode === 'mute') return
  if (mode === 'buzz') {
    // True haptics where the platform supports them (Android browsers);
    // vibrate() returns false when there's no motor — fall back to a
    // low buzz-tone so the mode always gives tangible feedback.
    let vibrated = false
    try { vibrated = navigator.vibrate?.(VIBRATION[kind]) === true } catch {}
    if (!vibrated) playBuzzTone(kind)
    return
  }
  ;(PLAYERS[bundle] ?? playClassic)(kind)
}

// ── Legacy aliases (existing call sites across pages/bell) ────────────────

export function playMessageSound() { notify('message') }
export function playFriendRequestSound() { notify('request') }
export function playUnfriendSound() { notify('unfriend') }
export function playSentSound() { notify('sent') }
