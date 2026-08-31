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

function ensureCtx(): AudioContext | undefined {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return undefined
    ctx ??= new AudioCtor()
    return ctx
  } catch {
    return undefined
  }
}

// Resolves with a context that is actually 'running' (or undefined), so tones
// are never scheduled against a suspended (silent) context. resume() only fully
// takes effect while the tab has user activation, so we retry it briefly until
// the context reports running; if it still can't start we resolve anyway rather
// than hang the (async) play calls.
function ctxOrRunning(): Promise<AudioContext | undefined> {
  const c = ensureCtx()
  if (!c) return Promise.resolve<AudioContext | undefined>(undefined)
  if (c.state === 'running') return Promise.resolve(c)
  return new Promise<AudioContext | undefined>((resolve) => {
    const deadline = performance.now() + 150
    const attempt = () => {
      if (c.state === 'running') return resolve(c)
      if (performance.now() > deadline) return resolve(c)
      try { void c.resume().catch(() => {}) } catch {}
      setTimeout(attempt, 20)
    }
    attempt()
  })
}

let audioPromise: Promise<AudioContext | undefined> | null = null
function audio(): Promise<AudioContext | undefined> {
  audioPromise ??= ctxOrRunning().finally(() => { audioPromise = null })
  return audioPromise
}

// Creating/resuming an AudioContext outside a user gesture leaves it suspended
// and it produces no sound (autoplay policy). We therefore create + resume it on
// EVERY tap/key anywhere on the page, so that by the time a call rings (incoming
// arrives via a realtime event, not a gesture) the context is already running and
// unlocked. Re-running on each gesture also re-grants activation so the context
// can be resumed for later realtime-triggered rings.
function unlockAudio() { void audio() }
if (typeof window !== 'undefined') {
  const evts = ['pointerdown', 'touchstart', 'keydown', 'pointerup', 'click'] as const
  const onGesture = () => unlockAudio()
  for (const e of evts) window.addEventListener(e, onGesture, { passive: true })
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
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  gain.connect(c.destination)
  osc.connect(gain)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

// ── The three bundles ───────────────────────────────────────────────────────

async function playClassic(kind: SoundKind) {
  const c = await audio(); if (!c) return
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

async function playPop(kind: SoundKind) {
  const c = await audio(); if (!c) return
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

async function playZen(kind: SoundKind) {
  const c = await audio(); if (!c) return
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
  classic: (k) => void playClassic(k),
  pop: (k) => void playPop(k),
  zen: (k) => void playZen(k),
}

/*
 * Buzz fallback for devices WITHOUT a vibration motor / API — notably
 * iOS Safari & PWA, which expose no navigator.vibrate at all. A short
 * low-frequency motor-like pulse pattern stands in for the haptic.
 */
async function playBuzzTone(kind: SoundKind) {
  const c = await audio(); if (!c) return
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
    if (!vibrated) void playBuzzTone(kind)
    return
  }
  ;(PLAYERS[bundle] ?? playClassic)(kind)
}

// ── Legacy aliases (existing call sites across pages/bell) ────────────────

export function playMessageSound() { notify('message') }
export function playFriendRequestSound() { notify('request') }
export function playUnfriendSound() { notify('unfriend') }
export function playSentSound() { notify('sent') }

// ── Call ring ───────────────────────────────────────────────────────────────
//
// The ringtone (the "call volume" — what you hear when someone calls). Distinct
// INCOMING and OUTGOING rings are generated per sound pack, and any one-shot
// cadence is replayed on a loop until stopRing() is called (or the call is
// answered / times out).

export type RingKind = 'incoming' | 'outgoing'

const RING_VOLUME_KEY = 'shahzap:ring-volume'
const DEFAULT_RING_VOLUME = 1

let ringTimer: ReturnType<typeof setInterval> | undefined

/**
 * Persisted ring volume, 0..1. Defaults to full. Treated as the master gain
 * for ring tones so a lower value softens the ringing without muting it.
 */
export function getRingVolume(): number {
  if (typeof window === 'undefined') return DEFAULT_RING_VOLUME
  try {
    const raw = Number(window.localStorage.getItem(RING_VOLUME_KEY))
    if (!Number.isFinite(raw)) return DEFAULT_RING_VOLUME
    return Math.min(1, Math.max(0, raw))
  } catch {
    return DEFAULT_RING_VOLUME
  }
}

export function setRingVolume(vol: number): number {
  const next = Math.min(1, Math.max(0, vol))
  try { window.localStorage.setItem(RING_VOLUME_KEY, String(next)) } catch {}
  return next
}

// Ringtone loudness boost above the base synth level. The synth's natural peaks
// (≤ 0.32) read as quiet pipey tones next to a real phone ringer, so we scale
// them up by this factor (still honouring the user's ring-volume slider). Kept
// under 1.0 at vol=1 so the loudest tones don't clip/hard-limit.
const RING_BOOST = 2.6

/** Ring tones honour the volume pref via a shared gain scale + loudness boost. */
function ringTone(c: AudioContext, vol: number, opts: ToneOpts & { at?: number }) {
  const peak = Math.min(0.98, (opts.peak ?? 0.16) * vol * RING_BOOST)
  tone(c, { ...opts, peak })
}

// One cadence of the ring for a given pack + direction. Each cadence is short
// enough to fit inside its pack's ring interval below, and replayed on a loop.
function ringClassic(c: AudioContext, vol: number, kind: RingKind) {
  if (kind === 'incoming') {
    ringTone(c, vol, { freq: 440, at: 0, dur: 0.45, peak: 0.32 })
    ringTone(c, vol, { freq: 440, at: 0.55, dur: 0.45, peak: 0.32 })
  } else {
    ringTone(c, vol, { freq: 425, at: 0, dur: 0.32, peak: 0.2 })
    ringTone(c, vol, { freq: 320, at: 0.42, dur: 0.3, peak: 0.18 })
  }
}

function ringPop(c: AudioContext, vol: number, kind: RingKind) {
  if (kind === 'incoming') {
    ringTone(c, vol, { freq: 523.25, at: 0, dur: 0.18, peak: 0.26, type: 'triangle' })
    ringTone(c, vol, { freq: 659.25, at: 0.2, dur: 0.18, peak: 0.26, type: 'triangle' })
    ringTone(c, vol, { freq: 783.99, at: 0.4, dur: 0.2, peak: 0.26, type: 'triangle' })
    ringTone(c, vol, { freq: 1046.5, at: 0.62, dur: 0.28, peak: 0.22, type: 'triangle' })
  } else {
    ringTone(c, vol, { freq: 392, at: 0, dur: 0.2, peak: 0.22, type: 'triangle' })
    ringTone(c, vol, { freq: 329.63, at: 0.22, dur: 0.2, peak: 0.22, type: 'triangle' })
    ringTone(c, vol, { freq: 261.63, at: 0.44, dur: 0.3, peak: 0.2, type: 'triangle' })
  }
}

function ringZen(c: AudioContext, vol: number, kind: RingKind) {
  if (kind === 'incoming') {
    ringTone(c, vol, { freq: 440, at: 0, dur: 0.5, peak: 0.14 })
    ringTone(c, vol, { freq: 554.37, at: 0.28, dur: 0.5, peak: 0.14 })
  } else {
    ringTone(c, vol, { freq: 523.25, at: 0, dur: 0.38, peak: 0.12 })
    ringTone(c, vol, { freq: 415.3, at: 0.24, dur: 0.4, peak: 0.11 })
  }
}

/** Loop cadence (ms) per pack — must be >= the rendered cadence length. */
const RING_RHYTHM: Record<SoundBundle, number> = {
  classic: 2300,
  pop: 2000,
  zen: 2400,
}

function ringBuzz(c: AudioContext, vol: number, kind: RingKind) {
  const pulse = (at: number, dur: number) => {
    ringTone(c, vol, { freq: 105, at, dur, peak: 0.3, type: 'sawtooth' })
  }
  if (kind === 'incoming') { pulse(0, 0.12); pulse(0.22, 0.12); pulse(0.44, 0.2) }
  else { pulse(0, 0.12); pulse(0.2, 0.12) }
}

async function playRingCadence(bundle: SoundBundle, kind: RingKind, mode: SoundMode, vol: number) {
  const c = await audio(); if (!c) return
  if (mode === 'sound') {
    if (bundle === 'classic') ringClassic(c, vol, kind)
    else if (bundle === 'pop') ringPop(c, vol, kind)
    else ringZen(c, vol, kind)
    return
  }
  // buzz / haptic fallback
  ringBuzz(c, vol, kind)
}

/**
 * Start the looping call ring for the given direction, themed on the chosen
 * sound pack and bound by ring volume. Calling again restarts it.
 */
export function playRing(kind: RingKind) {
  stopRing()
  const { mode, bundle } = getSoundPrefs()
  const vol = getRingVolume()
  if (mode === 'mute') return
  void playRingCadence(bundle, kind, mode, vol)
  if (mode === 'buzz') {
    // Let the OS haptics carry the loop; no audio cadence needs to repeat.
    try { navigator.vibrate?.(kind === 'incoming' ? [250, 120, 250, 120, 250] : [140, 90, 140]) } catch {}
    return
  }
  const rhythm = RING_RHYTHM[bundle] ?? 2300
  ringTimer = setInterval(() => void playRingCadence(bundle, kind, mode, vol), rhythm)
}

/** Stop the looping call ring immediately. Safe to call anytime. */
export function stopRing() {
  if (ringTimer) { clearInterval(ringTimer); ringTimer = undefined }
}
