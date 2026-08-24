let ctx: AudioContext | undefined

function tone(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  peak: number,
  type: OscillatorType = 'sine',
) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, ctx.currentTime + startAt)
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + startAt)
  gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + startAt + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration)
  gain.connect(ctx.destination)
  osc.connect(gain)
  osc.start(ctx.currentTime + startAt)
  osc.stop(ctx.currentTime + startAt + duration + 0.05)
}

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

/** Unfriended: soft descending two-note, somber but gentle. */
export function playUnfriendSound() {
  const c = audio()
  if (!c) return
  tone(c, 587.33, 0, 0.25, 0.15, 'triangle')
  tone(c, 392, 0.16, 0.45, 0.14, 'triangle')
}

/** Incoming chat message: quick bright two-note ping. */
export function playMessageSound() {
  const c = audio()
  if (!c) return
  tone(c, 880, 0, 0.28, 0.2)
  tone(c, 1318.51, 0.12, 0.34, 0.18)
}

/** New friend request: warm rising three-note chime, clearly distinct. */
export function playFriendRequestSound() {
  const c = audio()
  if (!c) return
  tone(c, 523.25, 0, 0.22, 0.16, 'triangle')
  tone(c, 659.25, 0.14, 0.22, 0.16, 'triangle')
  tone(c, 783.99, 0.28, 0.42, 0.18, 'triangle')
  tone(c, 1046.5, 0.42, 0.35, 0.12, 'triangle')
}
